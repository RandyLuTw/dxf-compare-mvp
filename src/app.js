import { parseDxfFile, collectDxfFilesFromInput, pairByBaseName } from "./dxfLoader.js";
import { normalizeDxf } from "./dxfNormalizer.js";
import { compareNormalizedDxf } from "./dxfComparer.js";
import { DxfCanvasRenderer, buildRenderItemsSingle, buildRenderItemsOverlay } from "./dxfRenderer.js";
import {
  renderLayerPanel,
  renderDocumentDiffTable,
  renderEntityDiffList,
  renderFolderResultsTable,
} from "./diffPanel.js";
import { DIFF_STATUS, downloadText, htmlEscape } from "./utils.js";

export function createApp() {
  const els = bindElements();

  const state = {
    tolerances: { coordTol: 0.1, lengthTol: 0.1, radiusTol: 0.1, angleTol: 0.1 },
    compareFlags: { ignoreLineTypeDiff: true, ignoreColorDiff: true },
    overlayShift: { dx: 0, dy: 0 },
    displayMode: "split",
    fileA: null,
    fileB: null,
    parsedA: null,
    parsedB: null,
    normA: null,
    normB: null,
    diffResult: null,
    layerVisibility: {},
    folder: {
      listA: [],
      listB: [],
      results: [],
      stopRequested: false,
      detailMap: new Map(),
    },
  };

  const rendererA = new DxfCanvasRenderer(els.canvasA, els.coordA);
  const rendererB = new DxfCanvasRenderer(els.canvasB, els.coordB);
  const rendererOverlay = new DxfCanvasRenderer(els.canvasOverlay, els.coordOverlay);

  hookEvents();
  applyDisplayMode();
  setStatus("就緒，請載入 A/B DXF");

  function bindElements() {
    return {
      tabSingle: document.getElementById("tab-single"),
      tabFolder: document.getElementById("tab-folder"),
      singleView: document.getElementById("single-view"),
      folderView: document.getElementById("folder-view"),

      fileA: document.getElementById("file-a"),
      fileB: document.getElementById("file-b"),
      appStatus: document.getElementById("app-status"),
      displayMode: document.getElementById("display-mode"),
      fitBtn: document.getElementById("fit-btn"),
      zoomInBtn: document.getElementById("zoom-in-btn"),
      zoomOutBtn: document.getElementById("zoom-out-btn"),
      runCompareBtn: document.getElementById("run-compare-btn"),
      openHelpBtn: document.getElementById("open-help-btn"),
      exportJsonBtn: document.getElementById("export-json-btn"),
      exportHtmlBtn: document.getElementById("export-html-btn"),
      exportStatsBtn: document.getElementById("export-stats-btn"),
      ignoreLineType: document.getElementById("ignore-linetype"),
      ignoreColor: document.getElementById("ignore-color"),
      overlayDx: document.getElementById("overlay-dx"),
      overlayDy: document.getElementById("overlay-dy"),
      autoAlignBtn: document.getElementById("auto-align-btn"),

      tolCoord: document.getElementById("tol-coord"),
      tolLength: document.getElementById("tol-length"),
      tolAngle: document.getElementById("tol-angle"),

      singleContent: document.getElementById("single-content"),
      panelA: document.getElementById("panel-a"),
      panelB: document.getElementById("panel-b"),
      panelOverlay: document.getElementById("panel-overlay"),

      canvasA: document.getElementById("canvas-a"),
      canvasB: document.getElementById("canvas-b"),
      canvasOverlay: document.getElementById("canvas-overlay"),
      coordA: document.getElementById("coord-a"),
      coordB: document.getElementById("coord-b"),
      coordOverlay: document.getElementById("coord-overlay"),

      layerList: document.getElementById("layer-list"),
      docDiffTable: document.getElementById("doc-diff-table"),
      entityDiffList: document.getElementById("entity-diff-list"),
      showUnchanged: document.getElementById("show-unchanged"),

      folderA: document.getElementById("folder-a"),
      folderB: document.getElementById("folder-b"),
      runFolderCompareBtn: document.getElementById("run-folder-compare-btn"),
      stopFolderCompareBtn: document.getElementById("stop-folder-compare-btn"),
      folderOnlyDiff: document.getElementById("folder-only-diff"),
      folderSort: document.getElementById("folder-sort"),
      folderResultBody: document.querySelector("#folder-result-table tbody"),
      folderProgress: document.getElementById("folder-progress"),
      folderProgressText: document.getElementById("folder-progress-text"),
      folderErrors: document.getElementById("folder-errors"),
      exportFolderJsonBtn: document.getElementById("export-folder-json-btn"),
      exportFolderCsvBtn: document.getElementById("export-folder-csv-btn"),
      exportFolderHtmlBtn: document.getElementById("export-folder-html-btn"),
    };
  }

  function hookEvents() {
    els.tabSingle.addEventListener("click", () => switchTab("single"));
    els.tabFolder.addEventListener("click", () => switchTab("folder"));

    els.fileA.addEventListener("change", async (e) => {
      state.fileA = e.target.files?.[0] || null;
      await loadSingleFile("A");
    });

    els.fileB.addEventListener("change", async (e) => {
      state.fileB = e.target.files?.[0] || null;
      await loadSingleFile("B");
    });

    els.displayMode.addEventListener("change", () => {
      state.displayMode = els.displayMode.value;
      applyDisplayMode();
      rerenderAll();
    });

    els.fitBtn.addEventListener("click", () => {
      rendererA.fit();
      rendererB.fit();
      rendererOverlay.fit();
    });

    els.zoomInBtn.addEventListener("click", () => currentRenderer()?.zoomIn());
    els.zoomOutBtn.addEventListener("click", () => currentRenderer()?.zoomOut());

    els.runCompareBtn.addEventListener("click", () => runSingleCompare());
    els.openHelpBtn.addEventListener("click", openHelpDoc);
    els.showUnchanged.addEventListener("change", () => refreshPanels());

    els.tolCoord.addEventListener("change", syncTolerances);
    els.tolLength.addEventListener("change", syncTolerances);
    els.tolAngle.addEventListener("change", syncTolerances);
    els.ignoreLineType.addEventListener("change", syncCompareFlags);
    els.ignoreColor.addEventListener("change", syncCompareFlags);
    els.overlayDx.addEventListener("change", syncOverlayShiftFromInputs);
    els.overlayDy.addEventListener("change", syncOverlayShiftFromInputs);
    els.autoAlignBtn.addEventListener("click", applyAutoAlignmentFromDiff);

    els.exportJsonBtn.addEventListener("click", exportSingleJson);
    els.exportHtmlBtn.addEventListener("click", exportSingleHtml);
    els.exportStatsBtn.addEventListener("click", exportSingleStats);

    els.folderA.addEventListener("change", (e) => {
      state.folder.listA = collectDxfFilesFromInput(e.target.files);
    });
    els.folderB.addEventListener("change", (e) => {
      state.folder.listB = collectDxfFilesFromInput(e.target.files);
    });

    els.runFolderCompareBtn.addEventListener("click", runFolderCompare);
    els.stopFolderCompareBtn.addEventListener("click", () => { state.folder.stopRequested = true; });
    els.folderOnlyDiff.addEventListener("change", renderFolderTable);
    els.folderSort.addEventListener("change", renderFolderTable);

    els.exportFolderJsonBtn.addEventListener("click", exportFolderJson);
    els.exportFolderCsvBtn.addEventListener("click", exportFolderCsv);
    els.exportFolderHtmlBtn.addEventListener("click", exportFolderHtml);
  }

  function switchTab(tab) {
    const isSingle = tab === "single";
    els.tabSingle.classList.toggle("active", isSingle);
    els.tabFolder.classList.toggle("active", !isSingle);
    els.singleView.classList.toggle("active", isSingle);
    els.folderView.classList.toggle("active", !isSingle);
  }

  async function loadSingleFile(side) {
    try {
      const file = side === "A" ? state.fileA : state.fileB;
      if (!file) return;
      const parsed = await parseDxfFile(file);
      const normalized = normalizeDxf(parsed, state.tolerances);

      if (side === "A") {
        state.parsedA = parsed;
        state.normA = normalized;
        setStatus(`A 載入成功: ${parsed.name}，entities=${normalized.entities.length}`);
      } else {
        state.parsedB = parsed;
        state.normB = normalized;
        setStatus(`B 載入成功: ${parsed.name}，entities=${normalized.entities.length}`);
      }

      recomputeLayerVisibility();
      rerenderAll();
    } catch (err) {
      setStatus(`載入失敗: ${err.message}`);
      alert(err.message);
    }
  }

  function syncTolerances() {
    state.tolerances.coordTol = Number(els.tolCoord.value) || 0.1;
    state.tolerances.lengthTol = Number(els.tolLength.value) || 0.1;
    state.tolerances.radiusTol = state.tolerances.lengthTol;
    state.tolerances.angleTol = Number(els.tolAngle.value) || 0.1;
  }

  function syncCompareFlags() {
    state.compareFlags.ignoreLineTypeDiff = Boolean(els.ignoreLineType.checked);
    state.compareFlags.ignoreColorDiff = Boolean(els.ignoreColor.checked);
  }

  function getCompareOptions() {
    return {
      ...state.tolerances,
      ignoreLineTypeDiff: state.compareFlags.ignoreLineTypeDiff,
      ignoreColorDiff: state.compareFlags.ignoreColorDiff,
    };
  }

  function setOverlayShift(dx, dy) {
    state.overlayShift.dx = Number(dx) || 0;
    state.overlayShift.dy = Number(dy) || 0;
    els.overlayDx.value = String(state.overlayShift.dx);
    els.overlayDy.value = String(state.overlayShift.dy);
  }

  function syncOverlayShiftFromInputs() {
    setOverlayShift(Number(els.overlayDx.value) || 0, Number(els.overlayDy.value) || 0);
    rerenderAll();
  }

  function applyAutoAlignmentFromDiff() {
    const offset = state.diffResult?.alignment?.offset;
    if (!offset) return;
    setOverlayShift(-offset.x, -offset.y);
    rerenderAll();
    setStatus(`已套用平移校正: dx=${state.overlayShift.dx.toFixed(3)}, dy=${state.overlayShift.dy.toFixed(3)}`);
  }

  function recomputeLayerVisibility() {
    const layers = new Set([...(state.normA?.layers || []), ...(state.normB?.layers || [])]);
    for (const layer of layers) {
      if (!(layer in state.layerVisibility)) state.layerVisibility[layer] = true;
    }

    renderLayerPanel(els.layerList, Array.from(layers).sort(), state.layerVisibility, (layer, visible) => {
      state.layerVisibility[layer] = visible;
      rerenderAll();
    });
  }

  function runSingleCompare() {
    if (!state.normA || !state.normB) {
      alert("請先載入 A 與 B 檔案");
      return;
    }
    syncTolerances();
    syncCompareFlags();
    state.diffResult = compareNormalizedDxf(state.normA, state.normB, getCompareOptions());
    applyAutoAlignmentFromDiff();
    setStatus(`比對完成: 文件差異 ${state.diffResult.stats.documentDiffCount}，圖形差異 ${state.diffResult.stats.entityDiffCount}`);
    refreshPanels();
    rerenderAll();
  }

  function setStatus(text) {
    if (els.appStatus) els.appStatus.textContent = `狀態: ${text}`;
  }

  function openHelpDoc() {
    window.open("./README.md", "_blank", "noopener,noreferrer");
  }

  function refreshPanels() {
    renderDocumentDiffTable(els.docDiffTable, state.diffResult?.documentDiffs || []);
    renderEntityDiffList(
      els.entityDiffList,
      state.diffResult?.entityDiffs || [],
      els.showUnchanged.checked,
      (diffItem) => {
        const pt = mapPointToCurrentView(diffItem);
        currentRenderer()?.focusWorldPoint(pt);
      },
    );
  }

  function mapPointToCurrentView(diffItem) {
    const point = diffItem?.position || { x: 0, y: 0 };
    if (state.displayMode === "split") return point;
    if (diffItem?.status === DIFF_STATUS.ADDED) {
      return { x: point.x + state.overlayShift.dx, y: point.y + state.overlayShift.dy };
    }
    return point;
  }

  function applyDisplayMode() {
    const mode = state.displayMode;
    els.singleContent.className = `single-content ${mode}`;

    const split = mode === "split";
    els.panelA.classList.toggle("hidden", !split);
    els.panelB.classList.toggle("hidden", !split);
    els.panelOverlay.classList.toggle("hidden", split);
  }

  function currentRenderer() {
    return state.displayMode === "split" ? rendererA : rendererOverlay;
  }

  function rerenderAll() {
    rendererA.setItems(buildRenderItemsSingle(state.normA, "A"), state.layerVisibility);
    rendererB.setItems(buildRenderItemsSingle(state.normB, "B"), state.layerVisibility);

    const overlayItems = state.diffResult
      ? buildRenderItemsOverlay(state.diffResult, state.displayMode, { shiftB: state.overlayShift })
      : [
        ...buildRenderItemsSingle(state.normA, "A"),
        ...buildRenderItemsSingle(state.normB, "B").map((it) => ({ ...it, shift: state.overlayShift })),
      ];
    rendererOverlay.setItems(overlayItems, state.layerVisibility);
  }

  function exportSingleJson() {
    if (!state.diffResult) return alert("請先完成比對");
    downloadText("dxf-diff-result.json", JSON.stringify({
      metadata: {
        fileA: state.normA?.meta,
        fileB: state.normB?.meta,
        tolerances: state.tolerances,
      },
      ...state.diffResult,
    }, null, 2), "application/json;charset=utf-8");
  }

  function exportSingleStats() {
    if (!state.diffResult) return alert("請先完成比對");
    downloadText("dxf-diff-stats.json", JSON.stringify(state.diffResult.stats, null, 2), "application/json;charset=utf-8");
  }

  function exportSingleHtml() {
    if (!state.diffResult) return alert("請先完成比對");
    const docRows = state.diffResult.documentDiffs.map((d) =>
      `<tr><td>${htmlEscape(d.field)}</td><td>${htmlEscape(d.status)}</td><td>${htmlEscape(String(d.a ?? "-"))}</td><td>${htmlEscape(String(d.b ?? "-"))}</td></tr>`).join("");
    const entRows = state.diffResult.entityDiffs.map((d) =>
      `<tr><td>${htmlEscape(d.status)}</td><td>${htmlEscape(d.entityType)}</td><td>${htmlEscape(d.layer)}</td><td>${htmlEscape(d.description)}</td></tr>`).join("");

    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>DXF Diff Report</title></head><body>
      <h1>DXF Diff Report</h1>
      <h2>Document Diff</h2><table border="1" cellspacing="0" cellpadding="4"><tr><th>Field</th><th>Status</th><th>A</th><th>B</th></tr>${docRows}</table>
      <h2>Entity Diff</h2><table border="1" cellspacing="0" cellpadding="4"><tr><th>Status</th><th>Type</th><th>Layer</th><th>Description</th></tr>${entRows}</table>
    </body></html>`;

    downloadText("dxf-diff-summary.html", html, "text/html;charset=utf-8");
  }

  async function runFolderCompare() {
    const pairs = pairByBaseName(state.folder.listA, state.folder.listB);
    if (!pairs.length) {
      alert("請先選擇兩個資料夾中的 DXF 檔案");
      return;
    }

    state.folder.stopRequested = false;
    state.folder.results = [];
    state.folder.detailMap.clear();
    els.folderErrors.textContent = "";

    els.folderProgress.max = pairs.length;
    els.folderProgress.value = 0;

    for (let i = 0; i < pairs.length; i += 1) {
      if (state.folder.stopRequested) break;
      const p = pairs[i];
      els.folderProgressText.textContent = `Processing ${i + 1} / ${pairs.length}`;
      els.folderProgress.value = i + 1;

      let row = {
        name: p.name,
        pathA: p.a?.relativePath || "",
        pathB: p.b?.relativePath || "",
        status: DIFF_STATUS.SAME,
        documentDiffCount: 0,
        entityDiffCount: 0,
        cutLayerDiffCount: 0,
        cutLayerText: "Same",
        note: "",
        canOpen: false,
      };

      try {
        if (p.a && p.b) {
          const parsedA = await parseDxfFile(p.a.file);
          const parsedB = await parseDxfFile(p.b.file);
          const normA = normalizeDxf(parsedA, state.tolerances);
          const normB = normalizeDxf(parsedB, state.tolerances);
          const diff = compareNormalizedDxf(normA, normB, getCompareOptions());

          row.documentDiffCount = diff.stats.documentDiffCount;
          row.entityDiffCount = diff.stats.entityDiffCount;
          row.cutLayerDiffCount = diff.stats.cutLayerEntityDiffCount ?? 0;
          row.cutLayerText = row.cutLayerDiffCount === 0 ? "Same" : `Diff(${row.cutLayerDiffCount})`;
          row.status = (diff.stats.documentDiffCount === 0 && diff.stats.entityDiffCount === 0)
            ? DIFF_STATUS.SAME
            : DIFF_STATUS.MODIFIED;
          row.canOpen = true;

          state.folder.detailMap.set(p.name, { normA, normB, diff });
        } else if (p.a && !p.b) {
          row.status = DIFF_STATUS.REMOVED;
          row.cutLayerText = "-";
        } else if (!p.a && p.b) {
          row.status = DIFF_STATUS.ADDED;
          row.cutLayerText = "-";
        }
      } catch (err) {
        row.status = DIFF_STATUS.ERROR;
        row.error = err.message;
        row.cutLayerText = "Error";
        els.folderErrors.textContent += `${p.name}: ${err.message}\n`;
      }

      state.folder.results.push(row);
      renderFolderTable();
      await tick();
    }

    els.folderProgressText.textContent = `Processing ${Math.min(els.folderProgress.value, pairs.length)} / ${pairs.length}`;
  }

  function sortRows(rows) {
    const sortMode = els.folderSort.value;
    const sorted = [...rows];
    if (sortMode === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      sorted.sort((a, b) => {
        const da = (a.documentDiffCount || 0) + (a.entityDiffCount || 0);
        const db = (b.documentDiffCount || 0) + (b.entityDiffCount || 0);
        return sortMode === "diffDesc" ? db - da : da - db;
      });
    }
    return sorted;
  }

  function renderFolderTable() {
    let rows = [...state.folder.results];
    if (els.folderOnlyDiff.checked) {
      rows = rows.filter((r) => [DIFF_STATUS.MODIFIED, DIFF_STATUS.ADDED, DIFF_STATUS.REMOVED, DIFF_STATUS.ERROR].includes(r.status));
    }
    rows = sortRows(rows);

    renderFolderResultsTable(
      els.folderResultBody,
      rows,
      (row) => {
        const detail = state.folder.detailMap.get(row.name);
        if (!detail) return;
        state.normA = detail.normA;
        state.normB = detail.normB;
        // Re-run compare with current UI options so "查看詳情" always shows latest diff behavior.
        syncTolerances();
        syncCompareFlags();
        state.diffResult = compareNormalizedDxf(state.normA, state.normB, getCompareOptions());
        state.displayMode = "overlay";
        els.displayMode.value = "overlay";
        const offset = state.diffResult?.alignment?.offset;
        if (offset) setOverlayShift(-offset.x, -offset.y);
        switchTab("single");
        recomputeLayerVisibility();
        applyDisplayMode();
        refreshPanels();
        // Render after single view becomes visible; hidden canvas can report zero size.
        requestAnimationFrame(() => {
          rerenderAll();
          rendererOverlay.fit();
        });
        setStatus(`已載入詳情: ${row.name}，文件差異 ${state.diffResult.stats.documentDiffCount}，圖形差異 ${state.diffResult.stats.entityDiffCount}`);
      },
      (row, note) => {
        row.note = note;
      },
    );
  }

  function exportFolderJson() {
    downloadText("folder-diff-report.json", JSON.stringify(state.folder.results, null, 2), "application/json;charset=utf-8");
  }

  function exportFolderCsv() {
    const lines = ["filename,status,documentDiffCount,entityDiffCount,cutLayerDiffCount,cutLayerResult,note"];
    for (const r of state.folder.results) {
      lines.push(`${csv(r.name)},${csv(r.status)},${r.documentDiffCount ?? 0},${r.entityDiffCount ?? 0},${r.cutLayerDiffCount ?? 0},${csv(r.cutLayerText ?? "-")},${csv(r.note ?? "")}`);
    }
    downloadText("folder-diff-report.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportFolderHtml() {
    const rows = state.folder.results.map((r) => `<tr><td>${htmlEscape(r.name)}</td><td>${htmlEscape(r.status)}</td><td>${r.documentDiffCount ?? "-"}</td><td>${r.entityDiffCount ?? "-"}</td><td>${htmlEscape(r.cutLayerText ?? "-")}</td><td>${htmlEscape(r.note ?? "")}</td></tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="UTF-8"><title>Folder DXF Report</title></head><body>
      <h1>Folder Compare Report</h1>
      <table border="1" cellspacing="0" cellpadding="4"><tr><th>檔名</th><th>狀態</th><th>文件差異數量</th><th>圖形差異數量</th><th>CUT圖層圖型差異</th><th>註解</th></tr>${rows}</table>
    </body></html>`;
    downloadText("folder-diff-report.html", html, "text/html;charset=utf-8");
  }

  function csv(value) {
    const v = String(value ?? "");
    return `"${v.replace(/"/g, '""')}"`;
  }

  function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { state };
}
