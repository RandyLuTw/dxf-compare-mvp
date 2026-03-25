import {
  DIFF_STATUS,
  nearlyEqual,
  distance2D,
  formatNum,
  bboxCenter,
} from "./utils.js";

const SUPPORTED_TYPES = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "CIRCLE", "ARC", "TEXT", "MTEXT", "INSERT"]);

function entityCategory(type) {
  return ["TEXT", "MTEXT"].includes(type) ? "text" : "geometry";
}

function countByType(entities) {
  const counts = {};
  for (const e of entities) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return counts;
}

function docDiffItem(field, a, b, isEqual) {
  return {
    field,
    a,
    b,
    status: isEqual ? DIFF_STATUS.UNCHANGED : DIFF_STATUS.MODIFIED,
  };
}

function buildDocumentDiff(a, b) {
  const aEntities = a.entities.filter((e) => SUPPORTED_TYPES.has(e.type));
  const bEntities = b.entities.filter((e) => SUPPORTED_TYPES.has(e.type));

  const aType = countByType(aEntities);
  const bType = countByType(bEntities);

  const textA = (aType.TEXT || 0) + (aType.MTEXT || 0);
  const textB = (bType.TEXT || 0) + (bType.MTEXT || 0);

  const geomA = aEntities.length - textA;
  const geomB = bEntities.length - textB;

  const items = [
    docDiffItem("檔案名稱", a.meta.name, b.meta.name, a.meta.name === b.meta.name),
    docDiffItem("檔案大小", a.meta.size, b.meta.size, a.meta.size === b.meta.size),
    docDiffItem("DXF 版本", a.meta.acadver, b.meta.acadver, a.meta.acadver === b.meta.acadver),
    docDiffItem("單位($INSUNITS)", a.meta.units, b.meta.units, a.meta.units === b.meta.units),
    docDiffItem("圖層總數", a.layers.length, b.layers.length, a.layers.length === b.layers.length),
    docDiffItem("Block 定義數量", Object.keys(a.blocks).length, Object.keys(b.blocks).length, Object.keys(a.blocks).length === Object.keys(b.blocks).length),
    docDiffItem("Entity 總數", aEntities.length, bEntities.length, aEntities.length === bEntities.length),
    docDiffItem("文字物件數量", textA, textB, textA === textB),
    docDiffItem("幾何物件數量", geomA, geomB, geomA === geomB),
    docDiffItem(
      "Extents",
      `${formatNum(a.bounds.minX)},${formatNum(a.bounds.minY)} ~ ${formatNum(a.bounds.maxX)},${formatNum(a.bounds.maxY)}`,
      `${formatNum(b.bounds.minX)},${formatNum(b.bounds.minY)} ~ ${formatNum(b.bounds.maxX)},${formatNum(b.bounds.maxY)}`,
      nearlyEqual(a.bounds.minX, b.bounds.minX, 0.001)
      && nearlyEqual(a.bounds.minY, b.bounds.minY, 0.001)
      && nearlyEqual(a.bounds.maxX, b.bounds.maxX, 0.001)
      && nearlyEqual(a.bounds.maxY, b.bounds.maxY, 0.001)
    ),
  ];

  return items;
}

function docAnchor(doc) {
  const minX = Number.isFinite(doc?.bounds?.minX) ? doc.bounds.minX : 0;
  const minY = Number.isFinite(doc?.bounds?.minY) ? doc.bounds.minY : 0;
  return { x: minX, y: minY };
}

function shiftPoint(p, anchor) {
  if (!p) return p;
  return { ...p, x: p.x - anchor.x, y: p.y - anchor.y };
}

function shiftEntityForCompare(entity, anchor) {
  const cloned = {
    ...entity,
    center: shiftPoint(entity.center, anchor),
    bbox: {
      ...entity.bbox,
      minX: entity.bbox.minX - anchor.x,
      minY: entity.bbox.minY - anchor.y,
      maxX: entity.bbox.maxX - anchor.x,
      maxY: entity.bbox.maxY - anchor.y,
    },
    geom: { ...entity.geom },
  };

  if (cloned.geom.start) cloned.geom.start = shiftPoint(cloned.geom.start, anchor);
  if (cloned.geom.end) cloned.geom.end = shiftPoint(cloned.geom.end, anchor);
  if (cloned.geom.center) cloned.geom.center = shiftPoint(cloned.geom.center, anchor);
  if (cloned.geom.insertion) cloned.geom.insertion = shiftPoint(cloned.geom.insertion, anchor);
  if (Array.isArray(cloned.geom.vertices)) {
    cloned.geom.vertices = cloned.geom.vertices.map((p) => shiftPoint(p, anchor));
  }

  return cloned;
}

function groupKey(e) {
  let suffix = "";
  if (["TEXT", "MTEXT"].includes(e.type)) suffix = `|${e.geom.text || ""}`;
  if (e.type === "INSERT") suffix = `|${e.geom.blockName || ""}`;
  return `${e.type}|${e.layer}${suffix}`;
}

function compareProps(a, b, tol) {
  const changes = [];
  const centerDist = distance2D(a.center, b.center);
  if (centerDist > tol.coordTol) changes.push(`幾何位置差異(${formatNum(centerDist)})`);

  if (!nearlyEqual(a.geom.length, b.geom.length, tol.lengthTol)) {
    if (a.geom.length != null || b.geom.length != null) changes.push("長度差異");
  }
  if (!nearlyEqual(a.geom.radius, b.geom.radius, tol.radiusTol)) {
    if (a.geom.radius != null || b.geom.radius != null) changes.push("半徑差異");
  }
  if (!nearlyEqual(a.geom.startAngle, b.geom.startAngle, tol.angleTol)
    || !nearlyEqual(a.geom.endAngle, b.geom.endAngle, tol.angleTol)
    || !nearlyEqual(a.geom.rotation, b.geom.rotation, tol.angleTol)) {
    if (a.type === "ARC" || a.type === "INSERT") changes.push("角度差異");
  }

  if ((a.geom.text || "") !== (b.geom.text || "")) changes.push("文字內容差異");
  if ((a.layer || "") !== (b.layer || "")) changes.push("圖層差異");
  if ((a.color || "") !== (b.color || "")) changes.push("顏色差異");
  if ((a.lineType || "") !== (b.lineType || "")) changes.push("線型差異");
  if ((a.geom.blockName || "") !== (b.geom.blockName || "")) changes.push("Block 名稱差異");

  const ap = a.geom.insertion || a.geom.center;
  const bp = b.geom.insertion || b.geom.center;
  if (ap && bp && distance2D(ap, bp) > tol.coordTol) changes.push("插入點差異");

  if (!nearlyEqual(a.geom.scaleX, b.geom.scaleX, tol.lengthTol)
    || !nearlyEqual(a.geom.scaleY, b.geom.scaleY, tol.lengthTol)
    || !nearlyEqual(a.geom.scaleZ, b.geom.scaleZ, tol.lengthTol)) {
    if (a.type === "INSERT") changes.push("縮放差異");
  }

  return [...new Set(changes)];
}

function matchingScore(a, b, tol) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a.type !== b.type) return Number.POSITIVE_INFINITY;
  const d = distance2D(a.center, b.center);
  let score = d;
  if (a.layer !== b.layer) score += 2 * tol.coordTol;
  if (["TEXT", "MTEXT"].includes(a.type) && a.geom.text !== b.geom.text) score += 2 * tol.coordTol;
  if (a.type === "INSERT" && a.geom.blockName !== b.geom.blockName) score += 2 * tol.coordTol;
  return score;
}

function findBestMatch(a, candidates, used, tol) {
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    if (used.has(i)) continue;
    const score = matchingScore(a, candidates[i], tol);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best == null) return null;
  if (bestScore > tol.coordTol * 50) return null;
  return best;
}

export function compareNormalizedDxf(a, b, tol) {
  const documentDiffs = buildDocumentDiff(a, b);
  const anchorA = docAnchor(a);
  const anchorB = docAnchor(b);
  const offset = { x: anchorB.x - anchorA.x, y: anchorB.y - anchorA.y };
  documentDiffs.push(docDiffItem(
    "平移偏移(B-A, 以最小XY對齊)",
    `dx=${formatNum(offset.x)}, dy=${formatNum(offset.y)}`,
    "圖形比對已套用此偏移校正",
    nearlyEqual(offset.x, 0, tol.coordTol) && nearlyEqual(offset.y, 0, tol.coordTol),
  ));

  const entitiesA = a.entities
    .filter((e) => SUPPORTED_TYPES.has(e.type))
    .map((e) => ({ src: e, cmp: shiftEntityForCompare(e, anchorA) }));
  const entitiesB = b.entities
    .filter((e) => SUPPORTED_TYPES.has(e.type))
    .map((e) => ({ src: e, cmp: shiftEntityForCompare(e, anchorB) }));

  const groupedB = new Map();
  for (const e of entitiesB) {
    const key = groupKey(e.cmp);
    if (!groupedB.has(key)) groupedB.set(key, []);
    groupedB.get(key).push(e);
  }

  const usedByGroup = new Map();
  const diffs = [];

  for (const aEnt of entitiesA) {
    const key = groupKey(aEnt.cmp);
    const candidates = groupedB.get(key) || entitiesB.filter((bEnt) => bEnt.cmp.type === aEnt.cmp.type);
    const used = usedByGroup.get(key) || new Set();
    usedByGroup.set(key, used);

    const idx = findBestMatch(aEnt.cmp, candidates.map((x) => x.cmp), used, tol);
    if (idx == null) {
      diffs.push({
        status: DIFF_STATUS.REMOVED,
        entityType: aEnt.src.type,
        layer: aEnt.src.layer,
        description: "A 有、B 沒有",
        a: aEnt.src,
        b: null,
        position: aEnt.src.center,
      });
      continue;
    }

    used.add(idx);
    const bEnt = candidates[idx];
    const changes = compareProps(aEnt.cmp, bEnt.cmp, tol);
    diffs.push({
      status: changes.length ? DIFF_STATUS.MODIFIED : DIFF_STATUS.UNCHANGED,
      entityType: aEnt.src.type,
      layer: `${aEnt.src.layer}${aEnt.src.layer !== bEnt.src.layer ? ` -> ${bEnt.src.layer}` : ""}`,
      description: changes.length ? changes.join("、") : "相同",
      a: aEnt.src,
      b: bEnt.src,
      position: bboxCenter(aEnt.src.bbox),
    });
  }

  for (const bEnt of entitiesB) {
    const exists = diffs.some((d) => d.b === bEnt.src);
    if (!exists) {
      diffs.push({
        status: DIFF_STATUS.ADDED,
        entityType: bEnt.src.type,
        layer: bEnt.src.layer,
        description: "B 新增",
        a: null,
        b: bEnt.src,
        position: bEnt.src.center,
      });
    }
  }

  const stats = {
    documentDiffCount: documentDiffs.filter((d) => d.status !== DIFF_STATUS.UNCHANGED).length,
    entityDiffCount: diffs.filter((d) => d.status !== DIFF_STATUS.UNCHANGED).length,
    added: diffs.filter((d) => d.status === DIFF_STATUS.ADDED).length,
    removed: diffs.filter((d) => d.status === DIFF_STATUS.REMOVED).length,
    modified: diffs.filter((d) => d.status === DIFF_STATUS.MODIFIED).length,
    unchanged: diffs.filter((d) => d.status === DIFF_STATUS.UNCHANGED).length,
  };

  return { documentDiffs, entityDiffs: diffs, stats, alignment: { anchorA, anchorB, offset } };
}
