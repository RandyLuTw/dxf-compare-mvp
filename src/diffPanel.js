import { htmlEscape, formatNum } from "./utils.js";

export function renderLayerPanel(container, layers, visibility, onToggle) {
  container.innerHTML = "";
  for (const layer of layers) {
    const row = document.createElement("label");
    row.style.display = "block";
    row.innerHTML = `<input type="checkbox" ${visibility[layer] !== false ? "checked" : ""} /> ${htmlEscape(layer)}`;
    row.querySelector("input").addEventListener("change", (e) => onToggle(layer, e.target.checked));
    container.appendChild(row);
  }
}

export function renderDocumentDiffTable(container, items) {
  const rows = items.map((d) => `
    <tr>
      <td>${htmlEscape(d.field)}</td>
      <td>${htmlEscape(d.status)}</td>
      <td>${htmlEscape(String(d.a ?? "-"))}</td>
      <td>${htmlEscape(String(d.b ?? "-"))}</td>
    </tr>
  `).join("");

  container.innerHTML = `
    <table>
      <thead><tr><th>欄位</th><th>狀態</th><th>A</th><th>B</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderEntityDiffList(container, diffs, showUnchanged, onClick) {
  container.innerHTML = "";
  const view = showUnchanged ? diffs : diffs.filter((d) => d.status !== "Unchanged");

  for (const d of view) {
    const div = document.createElement("div");
    div.className = "diff-item";
    div.innerHTML = `
      <div><b class="status-${d.status}">${htmlEscape(d.status)}</b> | ${htmlEscape(d.entityType)} | ${htmlEscape(d.layer)}</div>
      <div>${htmlEscape(d.description)}</div>
      <div>位置: (${formatNum(d.position?.x, 3)}, ${formatNum(d.position?.y, 3)})</div>
    `;
    div.addEventListener("click", () => onClick(d));
    container.appendChild(div);
  }
}

export function renderFolderResultsTable(tbody, rows, onViewDetail) {
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${htmlEscape(r.name)}</td>
      <td>${htmlEscape(r.pathA || "-")}</td>
      <td>${htmlEscape(r.pathB || "-")}</td>
      <td class="status-${r.status}">${htmlEscape(r.status)}</td>
      <td>${r.documentDiffCount ?? "-"}</td>
      <td>${r.entityDiffCount ?? "-"}</td>
      <td><button ${r.canOpen ? "" : "disabled"}>查看詳情</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => onViewDetail(r));
    tbody.appendChild(tr);
  }
}
