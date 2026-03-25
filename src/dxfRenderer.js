import { createBBox, mergeBBox, isBBoxValid, formatNum } from "./utils.js";

const STATUS_COLOR = {
  Added: "#3ecf63",
  Removed: "#ff5b5b",
  Modified: "#ffad42",
  Unchanged: "#8092a8",
  DefaultA: "#6eb6ff",
  DefaultB: "#ffd166",
};

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.floor(rect.width * ratio));
  const h = Math.max(1, Math.floor(rect.height * ratio));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { ratio, rect };
}

function drawEntity(ctx, ent, worldToScreen, strokeStyle, fillStyle) {
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = fillStyle || strokeStyle;
  ctx.lineWidth = 1;

  switch (ent.type) {
    case "LINE": {
      if (!ent.geom.start || !ent.geom.end) break;
      const a = worldToScreen(ent.geom.start);
      const b = worldToScreen(ent.geom.end);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      break;
    }
    case "LWPOLYLINE":
    case "POLYLINE": {
      const vs = ent.geom.vertices || [];
      if (!vs.length) break;
      ctx.beginPath();
      const p0 = worldToScreen(vs[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < vs.length; i += 1) {
        const p = worldToScreen(vs[i]);
        ctx.lineTo(p.x, p.y);
      }
      if (ent.geom.closed) ctx.closePath();
      ctx.stroke();
      break;
    }
    case "CIRCLE": {
      if (!ent.geom.center || ent.geom.radius == null) break;
      const c = worldToScreen(ent.geom.center);
      const edge = worldToScreen({ x: ent.geom.center.x + ent.geom.radius, y: ent.geom.center.y });
      const r = Math.abs(edge.x - c.x);
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "ARC": {
      if (!ent.geom.center || ent.geom.radius == null) break;
      const c = worldToScreen(ent.geom.center);
      const edge = worldToScreen({ x: ent.geom.center.x + ent.geom.radius, y: ent.geom.center.y });
      const r = Math.abs(edge.x - c.x);
      const sa = (ent.geom.startAngle || 0) * Math.PI / 180;
      const ea = (ent.geom.endAngle || 0) * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, -sa, -ea, true);
      ctx.stroke();
      break;
    }
    case "TEXT":
    case "MTEXT": {
      if (!ent.geom.insertion && !ent.center) break;
      const p = worldToScreen(ent.geom.insertion || ent.center);
      ctx.font = "12px Consolas";
      ctx.fillText(ent.geom.text || "", p.x, p.y);
      break;
    }
    case "INSERT": {
      if (!ent.geom.insertion && !ent.center) break;
      const p = worldToScreen(ent.geom.insertion || ent.center);
      ctx.beginPath();
      ctx.rect(p.x - 4, p.y - 4, 8, 8);
      ctx.stroke();
      ctx.font = "11px Consolas";
      ctx.fillText(ent.geom.blockName || "INSERT", p.x + 6, p.y - 6);
      break;
    }
    default:
      break;
  }
}

export class DxfCanvasRenderer {
  constructor(canvas, coordEl) {
    this.canvas = canvas;
    this.coordEl = coordEl;
    this.items = [];
    this.layerVisibility = null;
    this.view = { scale: 1, offsetX: 0, offsetY: 0 };
    this.drag = null;
    this.onHoverCoord = null;
    this.setupEvents();
    window.addEventListener("resize", () => this.render());
  }

  setupEvents() {
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 0.9;
      this.zoom(delta, e.offsetX, e.offsetY);
    });

    this.canvas.addEventListener("mousedown", (e) => {
      this.drag = { x: e.clientX, y: e.clientY, ox: this.view.offsetX, oy: this.view.offsetY };
    });
    window.addEventListener("mouseup", () => { this.drag = null; });

    window.addEventListener("mousemove", (e) => {
      if (this.drag) {
        const dx = e.clientX - this.drag.x;
        const dy = e.clientY - this.drag.y;
        this.view.offsetX = this.drag.ox + dx;
        this.view.offsetY = this.drag.oy + dy;
        this.render();
      }

      const rect = this.canvas.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const wx = (e.clientX - rect.left - this.view.offsetX) / this.view.scale;
        const wy = -(e.clientY - rect.top - this.view.offsetY) / this.view.scale;
        this.coordEl.textContent = `x: ${formatNum(wx, 3)}, y: ${formatNum(wy, 3)}`;
      }
    });
  }

  setItems(items, layerVisibility) {
    this.items = items || [];
    this.layerVisibility = layerVisibility || null;
    this.fit();
  }

  bounds() {
    const bb = createBBox();
    for (const it of this.items) {
      if (this.layerVisibility && this.layerVisibility[it.entity.layer] === false) continue;
      mergeBBox(bb, it.entity.bbox);
    }
    return bb;
  }

  fit() {
    const { rect } = resizeCanvas(this.canvas);
    const bb = this.bounds();
    if (!isBBoxValid(bb)) {
      this.view.scale = 1;
      this.view.offsetX = rect.width / 2;
      this.view.offsetY = rect.height / 2;
      this.render();
      return;
    }

    const worldW = Math.max(1e-6, bb.maxX - bb.minX);
    const worldH = Math.max(1e-6, bb.maxY - bb.minY);
    const pad = 0.9;
    const sX = (rect.width * pad) / worldW;
    const sY = (rect.height * pad) / worldH;
    this.view.scale = Math.min(sX, sY);

    const cx = (bb.minX + bb.maxX) / 2;
    const cy = (bb.minY + bb.maxY) / 2;
    this.view.offsetX = rect.width / 2 - cx * this.view.scale;
    this.view.offsetY = rect.height / 2 + cy * this.view.scale;
    this.render();
  }

  zoom(factor, screenX, screenY) {
    const wx = (screenX - this.view.offsetX) / this.view.scale;
    const wy = (screenY - this.view.offsetY) / this.view.scale;
    this.view.scale *= factor;
    this.view.offsetX = screenX - wx * this.view.scale;
    this.view.offsetY = screenY - wy * this.view.scale;
    this.render();
  }

  zoomIn() { this.zoom(1.15, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2); }
  zoomOut() { this.zoom(0.85, this.canvas.clientWidth / 2, this.canvas.clientHeight / 2); }

  focusWorldPoint(point) {
    const rect = this.canvas.getBoundingClientRect();
    this.view.offsetX = rect.width / 2 - point.x * this.view.scale;
    this.view.offsetY = rect.height / 2 + point.y * this.view.scale;
    this.render();
  }

  render() {
    const { ratio, rect } = resizeCanvas(this.canvas);
    const ctx = this.canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.scale(ratio, ratio);

    const worldToScreen = (p) => ({
      x: p.x * this.view.scale + this.view.offsetX,
      y: -p.y * this.view.scale + this.view.offsetY,
    });

    for (const item of this.items) {
      if (!item?.entity) continue;
      if (this.layerVisibility && this.layerVisibility[item.entity.layer] === false) continue;
      try {
        let color = STATUS_COLOR[item.status] || STATUS_COLOR.Unchanged;
        if (item.status === "DefaultA") color = STATUS_COLOR.DefaultA;
        if (item.status === "DefaultB") color = STATUS_COLOR.DefaultB;
        drawEntity(ctx, item.entity, worldToScreen, color, color);
      } catch (err) {
        // Skip broken entities to keep viewer responsive.
      }
    }

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(0, 0, rect.width, rect.height);
  }
}

export function buildRenderItemsSingle(doc, sourceName) {
  if (!doc) return [];
  const status = sourceName === "A" ? "DefaultA" : "DefaultB";
  return doc.entities.map((e) => ({ entity: e, status }));
}

export function buildRenderItemsOverlay(diffResult, mode = "overlay") {
  if (!diffResult) return [];
  const out = [];
  for (const d of diffResult.entityDiffs) {
    if (mode === "diff" && d.status === "Unchanged") continue;
    if (d.status === "Added" && d.b) out.push({ entity: d.b, status: "Added" });
    else if (d.status === "Removed" && d.a) out.push({ entity: d.a, status: "Removed" });
    else if (d.status === "Modified") {
      if (d.a) out.push({ entity: d.a, status: "Modified" });
      if (d.b) out.push({ entity: d.b, status: "Modified" });
    } else if (d.status === "Unchanged" && d.a) {
      out.push({ entity: d.a, status: "Unchanged" });
    }
  }
  return out;
}
