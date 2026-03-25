import {
  roundTo,
  cleanText,
  canonicalColor,
  canonicalLineType,
  createBBox,
  expandBBox,
  mergeBBox,
  bboxCenter,
  bboxFromPoints,
  safeArray,
  asNumber,
} from "./utils.js";

function normPoint(p, precision) {
  if (!p) return null;
  return {
    x: roundTo(asNumber(p.x, 0), precision),
    y: roundTo(asNumber(p.y, 0), precision),
    z: roundTo(asNumber(p.z, 0), precision),
  };
}

function arcEndpoint(center, radius, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  return {
    x: center.x + radius * Math.cos(rad),
    y: center.y + radius * Math.sin(rad),
  };
}

function calcLineLength(start, end) {
  if (!start || !end) return null;
  return Math.hypot(end.x - start.x, end.y - start.y);
}

function buildEntityBase(entity, precision) {
  return {
    type: String(entity.type || "UNKNOWN").toUpperCase(),
    layer: entity.layer || "0",
    color: canonicalColor(entity.colorNumber ?? entity.colorIndex ?? entity.color),
    lineType: canonicalLineType(entity.lineType || entity.ltype),
    handle: entity.handle || null,
    bbox: createBBox(),
    center: { x: 0, y: 0 },
    geom: {},
  };
}

function normalizeEntity(entity, precision) {
  const base = buildEntityBase(entity, precision);

  switch (base.type) {
    case "LINE": {
      const start = normPoint(entity.vertices?.[0] || entity.start, precision);
      const end = normPoint(entity.vertices?.[1] || entity.end, precision);
      base.geom.start = start;
      base.geom.end = end;
      expandBBox(base.bbox, start?.x, start?.y);
      expandBBox(base.bbox, end?.x, end?.y);
      base.geom.length = roundTo(calcLineLength(start, end), precision);
      break;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const vertices = safeArray(entity.vertices).map((v) => normPoint(v, precision));
      base.geom.vertices = vertices;
      base.geom.closed = Boolean(entity.shape || entity.closed);
      for (const p of vertices) expandBBox(base.bbox, p?.x, p?.y);
      break;
    }
    case "CIRCLE": {
      const center = normPoint(entity.center, precision);
      const radius = roundTo(asNumber(entity.radius, 0), precision);
      base.geom.center = center;
      base.geom.radius = radius;
      expandBBox(base.bbox, center.x - radius, center.y - radius);
      expandBBox(base.bbox, center.x + radius, center.y + radius);
      break;
    }
    case "ARC": {
      const center = normPoint(entity.center, precision);
      const radius = roundTo(asNumber(entity.radius, 0), precision);
      const startAngle = roundTo(asNumber(entity.startAngle, 0), 0.01);
      const endAngle = roundTo(asNumber(entity.endAngle, 0), 0.01);
      base.geom.center = center;
      base.geom.radius = radius;
      base.geom.startAngle = startAngle;
      base.geom.endAngle = endAngle;
      const startP = arcEndpoint(center, radius, startAngle);
      const endP = arcEndpoint(center, radius, endAngle);
      const bb = bboxFromPoints([startP, endP, { x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y + radius }]);
      mergeBBox(base.bbox, bb);
      break;
    }
    case "TEXT":
    case "MTEXT": {
      const insertion = normPoint(entity.startPoint || entity.position, precision);
      const text = cleanText(entity.text || entity.string || entity.mtext || "");
      base.geom.insertion = insertion;
      base.geom.text = text;
      base.geom.height = roundTo(asNumber(entity.textHeight || entity.height, 0), precision);
      expandBBox(base.bbox, insertion?.x, insertion?.y);
      break;
    }
    case "INSERT": {
      const insertion = normPoint(entity.position || entity.insertionPoint, precision);
      base.geom.blockName = cleanText(entity.name || entity.block || "");
      base.geom.insertion = insertion;
      base.geom.rotation = roundTo(asNumber(entity.rotation, 0), 0.01);
      base.geom.scaleX = roundTo(asNumber(entity.xScale, 1), precision);
      base.geom.scaleY = roundTo(asNumber(entity.yScale, 1), precision);
      base.geom.scaleZ = roundTo(asNumber(entity.zScale, 1), precision);
      expandBBox(base.bbox, insertion?.x, insertion?.y);
      break;
    }
    default: {
      const vertices = safeArray(entity.vertices).map((v) => normPoint(v, precision));
      for (const p of vertices) expandBBox(base.bbox, p?.x, p?.y);
      base.geom.raw = true;
      break;
    }
  }

  base.center = bboxCenter(base.bbox);
  return base;
}

function layerSet(parsed) {
  const layers = new Set();
  const tableLayers = parsed.tables?.layer?.layers || parsed.tables?.layers || {};
  for (const key of Object.keys(tableLayers)) layers.add(key);
  for (const entity of safeArray(parsed.entities)) {
    if (entity.layer) layers.add(entity.layer);
  }
  return Array.from(layers).sort();
}

export function normalizeDxf(parsedDoc, options = {}) {
  const precision = options.coordTol ?? 0.001;
  const parsed = parsedDoc?.parsed;
  const entities = safeArray(parsed?.entities).map((e) => normalizeEntity(e, precision));

  const bbox = createBBox();
  for (const e of entities) mergeBBox(bbox, e.bbox);

  return {
    meta: {
      name: parsedDoc?.name || "unknown",
      size: parsedDoc?.size || 0,
      lastModified: parsedDoc?.lastModified || 0,
      rawTextLength: parsedDoc?.rawTextLength || 0,
      units: parsed?.header?.$INSUNITS ?? null,
      acadver: parsed?.header?.$ACADVER ?? null,
    },
    header: parsed?.header || {},
    blocks: parsed?.blocks || {},
    layers: layerSet(parsed || {}),
    entities,
    bounds: bbox,
  };
}
