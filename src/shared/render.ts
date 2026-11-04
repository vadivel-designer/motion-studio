import { resolveLayer } from './animation';
import { cursorPosition } from './cursor';
import { evalEasing } from './easing';
import type { CursorLayer, ImageLayer, Layer, Project, ShapeLayer, TextLayer } from './schema';

/**
 * THE one drawing function. Used by the editor preview AND by the export page.
 * Output depends only on (project, timeSec, resources): no Date.now(), no random,
 * no CSS animations, no accumulated state.
 */
export interface Resources {
  /** Decoded image for an image asset, or null if missing / not loaded. */
  getImage(assetId: string): CanvasImageSource | null;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Size { w: number; h: number }

export function fontString(l: Pick<TextLayer, 'fontFamily' | 'fontSize' | 'fontWeight'>): string {
  const fam = l.fontFamily.replace(/["\\]/g, '');
  return `${l.fontWeight} ${l.fontSize}px "${fam}", sans-serif`;
}

function setTextStyle(ctx: Ctx, l: TextLayer) {
  ctx.font = fontString(l);
  (ctx as any).letterSpacing = `${l.letterSpacing}px`;
  ctx.textBaseline = 'middle';
}

export function textLines(l: TextLayer): string[] {
  return l.content.split('\n');
}

/** Un-scaled size of a (resolved) layer's own box, in project pixels. */
export function layerSize(l: Layer, ctx: Ctx): Size {
  switch (l.type) {
    case 'text': {
      ctx.save();
      setTextStyle(ctx, l);
      const lines = textLines(l);
      let w = 0;
      for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
      ctx.restore();
      return { w: Math.max(w, 1), h: Math.max(lines.length * l.lineHeight * l.fontSize, 1) };
    }
    case 'image':
    case 'shape':
      return { w: l.width, h: l.height };
    case 'cursor':
      return { w: 0, h: 0 };
  }
}

function roundedRectPath(ctx: Ctx, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(w - r, 0);
  ctx.arcTo(w, 0, w, r, r);
  ctx.lineTo(w, h - r);
  ctx.arcTo(w, h, w - r, h, r);
  ctx.lineTo(r, h);
  ctx.arcTo(0, h, 0, h - r, r);
  ctx.lineTo(0, r);
  ctx.arcTo(0, 0, r, 0, r);
  ctx.closePath();
}

function drawShape(ctx: Ctx, l: ShapeLayer) {
  const { width: w, height: h } = l;
  ctx.beginPath();
  if (l.shape === 'rect') roundedRectPath(ctx, w, h, l.cornerRadius);
  else if (l.shape === 'ellipse') ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else {
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
  }
  ctx.fillStyle = l.fill;
  ctx.fill();
  if (l.strokeWidth > 0) {
    ctx.lineWidth = l.strokeWidth;
    ctx.strokeStyle = l.stroke;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

function drawText(ctx: Ctx, l: TextLayer, size: Size) {
  setTextStyle(ctx, l);
  ctx.fillStyle = l.color;
  const lh = l.lineHeight * l.fontSize;
  textLines(l).forEach((line, i) => {
    let x = 0;
    ctx.textAlign = 'left';
    if (l.align === 'center') { ctx.textAlign = 'center'; x = size.w / 2; }
    else if (l.align === 'right') { ctx.textAlign = 'right'; x = size.w; }
    ctx.fillText(line, x, (i + 0.5) * lh);
  });
}

function drawMissing(ctx: Ctx, w: number, h: number, label: string) {
  ctx.fillStyle = '#2b2b33';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.strokeStyle = '#4a4a58';
  ctx.lineWidth = Math.max(2, Math.min(w, h) / 60);
  const step = Math.max(16, Math.min(w, h) / 8);
  for (let d = -h; d < w; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, h);
    ctx.lineTo(d + h, 0);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = '#e0556a';
  ctx.lineWidth = Math.max(2, Math.min(w, h) / 80);
  ctx.strokeRect(0, 0, w, h);
  ctx.fillStyle = '#e8e8ee';
  const fs = Math.max(12, Math.min(w / 10, h / 6, 80));
  ctx.font = `600 ${fs}px sans-serif`;
  (ctx as any).letterSpacing = '0px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Missing asset', w / 2, h / 2 - fs * 0.6, w * 0.9);
  ctx.font = `400 ${fs * 0.7}px sans-serif`;
  ctx.fillText(label, w / 2, h / 2 + fs * 0.6, w * 0.9);
}

function drawImage(ctx: Ctx, l: ImageLayer, res: Resources | undefined, label: string) {
  const img = res?.getImage(l.assetId) ?? null;
  if (!img) { drawMissing(ctx, l.width, l.height, label); return; }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, l.width, l.height);
}

const CURSOR_PATH = 'M0 0 L0 34 L9 26 L15 40 L21 37 L15 24 L27 24 Z';
export const RIPPLE_DURATION = 0.5;

function drawCursor(ctx: Ctx, l: CursorLayer, t: number) {
  const pos = cursorPosition(l.points, t, l.smoothing);
  if (!pos) return;
  for (const c of l.clicks) {
    const p = (t - c.time) / RIPPLE_DURATION;
    if (p < 0 || p >= 1) continue;
    const e = evalEasing({ type: 'ease-out' }, p);
    const cp = cursorPosition(l.points, c.time, l.smoothing) ?? pos;
    ctx.save();
    ctx.globalAlpha *= (1 - e) * 0.8;
    ctx.strokeStyle = l.rippleColor;
    ctx.lineWidth = 6 * l.scale + 6 * (1 - e);
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, (16 + 90 * e) * l.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.scale(l.scale * 1.5, l.scale * 1.5);
  const path = new Path2D(CURSOR_PATH);
  ctx.fillStyle = l.color;
  ctx.fill(path);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#000000';
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.restore();
}

/** True if the layer is on screen at scene-local time `t`. */
export function layerActive(l: Layer, t: number): boolean {
  return l.visible && t >= l.start && t < l.start + l.duration;
}

export function sceneActive(s: { start: number; duration: number }, t: number): boolean {
  return t >= s.start && t < s.start + s.duration;
}

export function drawLayer(ctx: Ctx, resolved: Layer, res: Resources | undefined, localT: number, assetName = '') {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, resolved.opacity));
  if (resolved.type === 'cursor') {
    drawCursor(ctx, resolved, localT);
  } else {
    const size = layerSize(resolved, ctx);
    ctx.translate(resolved.x, resolved.y);
    ctx.rotate((resolved.rotation * Math.PI) / 180);
    ctx.scale(resolved.scale, resolved.scale);
    ctx.translate(-resolved.anchor.x * size.w, -resolved.anchor.y * size.h);
    if (resolved.type === 'text') drawText(ctx, resolved, size);
    else if (resolved.type === 'shape') drawShape(ctx, resolved);
    else drawImage(ctx, resolved, res, assetName);
  }
  ctx.restore();
}

/**
 * Draw one frame.
 * @param scale canvas pixels per project pixel (devicePixelRatio-aware in the preview, 1 at export).
 * Everything is drawn directly at the target scale, so text and vectors stay crisp at any resolution.
 */
export function renderFrame(project: Project, timeSec: number, ctx: Ctx, scale: number, resources?: Resources): void {
  const { width, height, background } = project.settings;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, Math.ceil(width * scale), Math.ceil(height * scale));
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, Math.ceil(width * scale), Math.ceil(height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  const names = new Map(project.assets.map((a) => [a.id, a.originalName]));
  for (const scene of project.scenes) {
    if (!sceneActive(scene, timeSec)) continue;
    const st = timeSec - scene.start;
    for (const layer of scene.layers) {
      if (!layerActive(layer, st)) continue;
      const lt = st - layer.start;
      const resolved = resolveLayer(layer, lt);
      drawLayer(ctx, resolved, resources, lt, layer.type === 'image' ? names.get(layer.assetId) ?? layer.assetId : '');
    }
  }
  ctx.restore();
}
