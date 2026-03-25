export const DIFF_STATUS = {
  ADDED: "Added",
  REMOVED: "Removed",
  MODIFIED: "Modified",
  UNCHANGED: "Unchanged",
  ERROR: "Error",
  SAME: "Same",
};

export function roundTo(value, precision = 1e-6) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.round(value / precision) * precision;
}

export function nearlyEqual(a, b, tol = 1e-6) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tol;
}

export function cleanText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

export function canonicalColor(color) {
  if (color == null || color === "") return "BYLAYER";
  return String(color);
}

export function canonicalLineType(lineType) {
  if (!lineType) return "BYLAYER";
  return String(lineType).trim().toUpperCase();
}

export function createBBox() {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

export function expandBBox(bbox, x, y) {
  if (typeof x !== "number" || typeof y !== "number") return;
  bbox.minX = Math.min(bbox.minX, x);
  bbox.minY = Math.min(bbox.minY, y);
  bbox.maxX = Math.max(bbox.maxX, x);
  bbox.maxY = Math.max(bbox.maxY, y);
}

export function mergeBBox(a, b) {
  if (!b || !isBBoxValid(b)) return a;
  expandBBox(a, b.minX, b.minY);
  expandBBox(a, b.maxX, b.maxY);
  return a;
}

export function isBBoxValid(bbox) {
  return bbox && Number.isFinite(bbox.minX) && Number.isFinite(bbox.minY)
    && Number.isFinite(bbox.maxX) && Number.isFinite(bbox.maxY);
}

export function bboxCenter(bbox) {
  if (!isBBoxValid(bbox)) return { x: 0, y: 0 };
  return { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 };
}

export function bboxFromPoints(points = []) {
  const bbox = createBBox();
  for (const p of points) {
    expandBBox(bbox, p.x, p.y);
  }
  return bbox;
}

export function distance2D(a, b) {
  const dx = (a?.x ?? 0) - (b?.x ?? 0);
  const dy = (a?.y ?? 0) - (b?.y ?? 0);
  return Math.hypot(dx, dy);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function asNumber(n, fallback = null) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function formatNum(n, digits = 4) {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number(n).toFixed(digits);
}

export function htmlEscape(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
