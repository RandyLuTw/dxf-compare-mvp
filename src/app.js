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
import {
  saveOutputDirectoryHandle,
  loadOutputDirectoryHandle,
  ensureReadWritePermission,
  writeTextFileToDirectory,
  readTextFileFromDirectory,
} from "./storage.js";

export function createApp() {
  const BATCH_PROFILE_KEY = "dxf.batch.profiles.v1";
  const BATCH_PROGRESS_KEY = "dxf.batch.progress.v1";
  const BATCH_PROFILE_FILE = "batch-profiles.json";
  const BATCH_PROGRESS_FILE = "batch-progress.json";
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
      pathA: "",
      pathB: "",
      results: [],
      stopRequested: false,
      detailMap: new Map(),
      outputDirHandle: null,
      outputDirLabel: "",
      profiles: {},
      nextStartIndex: 1,
    },
  };

  const rendererA = new DxfCanvasRenderer(els.canvasA, els.coordA);
  const rendererB = new DxfCanvasRenderer(els.canvasB, els.coordB);
  const rendererOverlay = new DxfCanvasRenderer(els.canvasOverlay, els.coordOverlay);

  hookEvents();
  applyDisplayMode();
  setStatus("就緒，請載入 A/B DXF");
  initializeFolderBatchSettings();

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
      folderALabel: document.getElementById("folder-a-label"),
      folderBLabel: document.getElementById("folder-b-label"),
      runFolderCompareBtn: document.getElementById("run-folder-compare-btn"),
      continueFolderCompareBtn: document.getElementById("continue-folder-compare-btn"),
      stopFolderCompareBtn: document.getElementById("stop-folder-compare-btn"),
      batchSize: document.getElementById("batch-size"),
      batchStart: document.getElementById("batch-start"),
      autoExportBatchCsv: document.getElementById("auto-export-batch-csv"),
      pickOutputFolderBtn: document.getElementById("pick-output-folder-btn"),
      outputFolderLabel: document.getElementById("output-folder-label"),
      batchProfileName: document.getElementById("batch-profile-name"),
      saveBatchProfileBtn: document.getElementById("save-batch-profile-btn"),
      batchProfileSelect: document.getElementById("batch-profile-select"),
      loadBatchProfileBtn: document.getElementById("load-batch-profile-btn"),
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
      state.folder.pathA = inferFolderPathLabel(e.target.files, "A");
      updateFolderPathLabels();
      state.folder.nextStartIndex = 1;
      els.batchStart.value = "1";
    });
    els.folderB.addEventListener("change", (e) => {
      state.folder.listB = collectDxfFilesFromInput(e.target.files);
      state.folder.pathB = inferFolderPathLabel(e.target.files, "B");
      updateFolderPathLabels();
      state.folder.nextStartIndex = 1;
      els.batchStart.value = "1";
    });

    els.runFolderCompareBtn.addEventListener("click", () => runFolderCompare({ continueFromSaved: false }));
    els.continueFolderCompareBtn.addEventListener("click", () => runFolderCompare({ continueFromSaved: true }));
    els.stopFolderCompareBtn.addEventListener("click", () => { state.folder.stopRequested = true; });
    els.pickOutputFolderBtn.addEventListener("click", pickOutputFolder);
    els.saveBatchProfileBtn.addEventListener("click", saveBatchProfile);
    els.loadBatchProfileBtn.addEventListener("click", loadSelectedBatchProfile);
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

  async function initializeFolderBatchSettings() {
    loadBatchProfilesFromStorage();
    updateBatchProfileSelect();
    loadBatchProgressFromStorage();
    updateFolderPathLabels();

    try {
      const handle = await loadOutputDirectoryHandle();
      if (handle && await ensureReadWritePermission(handle)) {
        state.folder.outputDirHandle = handle;
        state.folder.outputDirLabel = handle.name;
        await loadBatchSettingsFromOutputFolder();
        updateOutputFolderLabel();
      } else {
        updateOutputFolderLabel();
      }
    } catch {
      updateOutputFolderLabel();
    }
  }

  function loadBatchProfilesFromStorage() {
    try {
      const raw = localStorage.getItem(BATCH_PROFILE_KEY);
      state.folder.profiles = raw ? JSON.parse(raw) : {};
    } catch {
      state.folder.profiles = {};
    }
  }

  function saveBatchProfilesToStorage() {
    localStorage.setItem(BATCH_PROFILE_KEY, JSON.stringify(state.folder.profiles));
    void saveBatchProfilesToOutputFolder();
  }

  function loadBatchProgressFromStorage() {
    try {
      const raw = localStorage.getItem(BATCH_PROGRESS_KEY);
      const progress = raw ? JSON.parse(raw) : null;
      if (!progress) return;
      els.batchStart.value = String(progress.nextStartIndex || 1);
      state.folder.nextStartIndex = Number(progress.nextStartIndex || 1);
      if (progress.batchSize) els.batchSize.value = String(progress.batchSize);
      if (typeof progress.autoExportBatchCsv === "boolean") els.autoExportBatchCsv.checked = progress.autoExportBatchCsv;
      state.folder.pathA = progress.pathA || state.folder.pathA;
      state.folder.pathB = progress.pathB || state.folder.pathB;
      updateFolderPathLabels();
      if (progress.profileName) {
        els.batchProfileSelect.value = progress.profileName;
      }
    } catch {
      state.folder.nextStartIndex = 1;
    }
  }

  function saveBatchProgressToStorage(extra = {}) {
    const data = {
      nextStartIndex: state.folder.nextStartIndex,
      batchSize: Number(els.batchSize.value) || 100,
      autoExportBatchCsv: Boolean(els.autoExportBatchCsv.checked),
      profileName: els.batchProfileSelect.value || "",
      pathA: state.folder.pathA || "",
      pathB: state.folder.pathB || "",
      ...extra,
    };
    localStorage.setItem(BATCH_PROGRESS_KEY, JSON.stringify(data));
    void saveBatchProgressToOutputFolder(data);
  }

  async function saveBatchProfilesToOutputFolder() {
    try {
      if (!state.folder.outputDirHandle) return;
      if (!await ensureReadWritePermission(state.folder.outputDirHandle)) return;
      const text = JSON.stringify(state.folder.profiles, null, 2);
      await writeTextFileToDirectory(state.folder.outputDirHandle, BATCH_PROFILE_FILE, text);
    } catch {
      // Ignore output folder write errors and keep localStorage as source of truth.
    }
  }

  async function saveBatchProgressToOutputFolder(progressData) {
    try {
      if (!state.folder.outputDirHandle) return;
      if (!await ensureReadWritePermission(state.folder.outputDirHandle)) return;
      const text = JSON.stringify(progressData, null, 2);
      await writeTextFileToDirectory(state.folder.outputDirHandle, BATCH_PROGRESS_FILE, text);
    } catch {
      // Ignore output folder write errors and keep localStorage as source of truth.
    }
  }

  async function loadBatchSettingsFromOutputFolder() {
    try {
      if (!state.folder.outputDirHandle) return;
      if (!await ensureReadWritePermission(state.folder.outputDirHandle)) return;

      try {
        const profileText = await readTextFileFromDirectory(state.folder.outputDirHandle, BATCH_PROFILE_FILE);
        const profiles = JSON.parse(profileText || "{}");
        if (profiles && typeof profiles === "object") {
          state.folder.profiles = profiles;
          localStorage.setItem(BATCH_PROFILE_KEY, JSON.stringify(state.folder.profiles));
          updateBatchProfileSelect();
        }
      } catch {
        // No profile file yet.
      }

      try {
        const progressText = await readTextFileFromDirectory(state.folder.outputDirHandle, BATCH_PROGRESS_FILE);
        const progress = JSON.parse(progressText || "{}");
        if (progress && typeof progress === "object") {
          localStorage.setItem(BATCH_PROGRESS_KEY, JSON.stringify(progress));
          loadBatchProgressFromStorage();
        }
      } catch {
        // No progress file yet.
      }
    } catch {
      // Ignore permission/IO errors.
    }
  }

  function updateBatchProfileSelect() {
    const current = els.batchProfileSelect.value;
    els.batchProfileSelect.innerHTML = "<option value=''>-- 選擇設定檔 --</option>";
    for (const name of Object.keys(state.folder.profiles).sort()) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      els.batchProfileSelect.appendChild(option);
    }
    if (current && state.folder.profiles[current]) els.batchProfileSelect.value = current;
  }

  function saveBatchProfile() {
    const name = (els.batchProfileName.value || "").trim();
    if (!name) {
      alert("請先輸入設定檔名稱");
      return;
    }
    state.folder.profiles[name] = {
      batchSize: Number(els.batchSize.value) || 100,
      startIndex: Number(els.batchStart.value) || 1,
      autoExportBatchCsv: Boolean(els.autoExportBatchCsv.checked),
      folderOnlyDiff: Boolean(els.folderOnlyDiff.checked),
      folderSort: els.folderSort.value || "name",
      pathA: state.folder.pathA || "",
      pathB: state.folder.pathB || "",
    };
    saveBatchProfilesToStorage();
    updateBatchProfileSelect();
    els.batchProfileSelect.value = name;
    setStatus(`已儲存分批設定: ${name}`);
  }

  function loadSelectedBatchProfile() {
    const name = els.batchProfileSelect.value;
    const profile = state.folder.profiles[name];
    if (!profile) {
      alert("請先選擇有效的設定檔");
      return;
    }
    els.batchSize.value = String(profile.batchSize || 100);
    els.batchStart.value = String(profile.startIndex || 1);
    els.autoExportBatchCsv.checked = profile.autoExportBatchCsv !== false;
    els.folderOnlyDiff.checked = Boolean(profile.folderOnlyDiff);
    els.folderSort.value = profile.folderSort || "name";
    state.folder.pathA = profile.pathA || "";
    state.folder.pathB = profile.pathB || "";
    updateFolderPathLabels();
    renderFolderTable();
    setStatus(`已載入分批設定: ${name}（路徑已回填，請重新選取資料夾）`);
  }

  async function pickOutputFolder() {
    if (!window.showDirectoryPicker) {
      alert("目前瀏覽器不支援資料夾寫入 API，將改用一般下載。");
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite", id: "dxf-compare-output" });
      const ok = await ensureReadWritePermission(handle);
      if (!ok) {
        alert("未取得寫入權限，將改用一般下載。");
        return;
      }
      state.folder.outputDirHandle = handle;
      state.folder.outputDirLabel = handle.name;
      await saveOutputDirectoryHandle(handle);
      await loadBatchSettingsFromOutputFolder();
      await saveBatchProfilesToOutputFolder();
      saveBatchProgressToStorage();
      updateOutputFolderLabel();
      setStatus(`已設定輸出資料夾: ${handle.name}（設定檔將同步至 ${BATCH_PROFILE_FILE} / ${BATCH_PROGRESS_FILE}）`);
    } catch {
      // user cancel
    }
  }

  function updateOutputFolderLabel() {
    const text = state.folder.outputDirLabel
      ? `輸出資料夾: ${state.folder.outputDirLabel}`
      : "輸出資料夾: (未設定，將改用瀏覽器下載；建議選 D:\\DXFCOMPARE)";
    els.outputFolderLabel.textContent = text;
  }

  function inferFolderPathLabel(fileList, side) {
    const files = Array.from(fileList || []);
    if (!files.length) return "";
    const first = files[0];
    const rel = first.webkitRelativePath || first.name || "";
    const root = rel.split("/")[0] || rel.split("\\")[0] || "";
    return root ? root : `Folder ${side}`;
  }

  function updateFolderPathLabels() {
    if (els.folderALabel) els.folderALabel.textContent = `Folder A 路徑: ${state.folder.pathA || "(未選擇)"}`;
    if (els.folderBLabel) els.folderBLabel.textContent = `Folder B 路徑: ${state.folder.pathB || "(未選擇)"}`;
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

  async function runFolderCompare({ continueFromSaved = false } = {}) {
    const pairs = pairByBaseName(state.folder.listA, state.folder.listB);
    if (!pairs.length) {
      alert("請先選擇兩個資料夾中的 DXF 檔案");
      return;
    }

    const batchSize = Math.max(1, Number(els.batchSize.value) || 100);
    const initialStart = continueFromSaved
      ? Math.max(1, state.folder.nextStartIndex || Number(els.batchStart.value) || 1)
      : Math.max(1, Number(els.batchStart.value) || 1);
    if (initialStart > pairs.length) {
      alert(`起始索引 ${initialStart} 已超過總筆數 ${pairs.length}`);
      return;
    }

    state.folder.stopRequested = false;
    if (!continueFromSaved) {
      state.folder.results = [];
      state.folder.detailMap.clear();
    }
    els.folderErrors.textContent = "";

    const totalToRun = pairs.length - initialStart + 1;
    let processedInRun = 0;
    els.folderProgress.max = totalToRun;
    els.folderProgress.value = 0;

    let batchStart = initialStart;
    while (batchStart <= pairs.length && !state.folder.stopRequested) {
      const batchEnd = Math.min(pairs.length, batchStart + batchSize - 1);
      const batchPairs = pairs.slice(batchStart - 1, batchEnd);
      const batchRows = [];

      for (let i = 0; i < batchPairs.length; i += 1) {
        if (state.folder.stopRequested) break;
        const p = batchPairs[i];
        const absoluteIndex = batchStart + i;
        processedInRun += 1;
        els.folderProgressText.textContent = `Processing ${processedInRun} / ${totalToRun} (global ${absoluteIndex} / ${pairs.length})`;
        els.folderProgress.value = processedInRun;

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
        batchRows.push(row);
        renderFolderTable();
        await tick();
      }

      state.folder.nextStartIndex = Math.min(pairs.length + 1, batchEnd + 1);
      els.batchStart.value = String(state.folder.nextStartIndex);
      saveBatchProgressToStorage({
        nextStartIndex: state.folder.nextStartIndex,
        lastBatchStart: batchStart,
        lastBatchEnd: batchEnd,
        totalPairs: pairs.length,
      });

      if (els.autoExportBatchCsv.checked && batchRows.length) {
        await exportBatchCsv(batchRows, batchStart, batchEnd);
      }

      batchStart = batchEnd + 1;
    }

    if (state.folder.stopRequested) {
      els.folderProgressText.textContent = `已停止，下一批起始: ${state.folder.nextStartIndex}`;
    } else {
      els.folderProgressText.textContent = `全部完成，共 ${pairs.length} 筆，下一批起始: ${state.folder.nextStartIndex}`;
    }
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

  function buildFolderCsv(rows) {
    const lines = ["filename,status,documentDiffCount,entityDiffCount,cutLayerDiffCount,cutLayerResult,note"];
    for (const r of rows) {
      lines.push(`${csv(r.name)},${csv(r.status)},${r.documentDiffCount ?? 0},${r.entityDiffCount ?? 0},${r.cutLayerDiffCount ?? 0},${csv(r.cutLayerText ?? "-")},${csv(r.note ?? "")}`);
    }
    return lines.join("\n");
  }

  async function exportBatchCsv(batchRows, startIndex, endIndex) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `folder-diff-batch-${startIndex}-${endIndex}-${ts}.csv`;
    const csvText = buildFolderCsv(batchRows);

    try {
      if (state.folder.outputDirHandle && await ensureReadWritePermission(state.folder.outputDirHandle)) {
        await writeTextFileToDirectory(state.folder.outputDirHandle, filename, csvText);
        setStatus(`批次 CSV 已寫入: ${state.folder.outputDirLabel}/${filename}`);
        return;
      }
    } catch {
      // Fallback to browser download below.
    }
    downloadText(filename, csvText, "text/csv;charset=utf-8");
    setStatus(`批次 CSV 已下載: ${filename}`);
  }

  function exportFolderCsv() {
    downloadText("folder-diff-report.csv", buildFolderCsv(state.folder.results), "text/csv;charset=utf-8");
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
