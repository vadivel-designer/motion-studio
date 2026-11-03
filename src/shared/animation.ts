import { DEFAULT_EASING, evalEasing } from './easing';
import type { Easing, Keyframe, Layer, LayerType } from './schema';

export type PropKind = 'number' | 'color';
export interface PropMeta { label: string; kind: PropKind }

export const PROP_META: Record<string, PropMeta> = {
  x: { label: 'Position X', kind: 'number' },
  y: { label: 'Position Y', kind: 'number' },
  scale: { label: 'Scale', kind: 'number' },
  rotation: { label: 'Rotation', kind: 'number' },
  opacity: { label: 'Opacity', kind: 'number' },
  fontSize: { label: 'Font size', kind: 'number' },
  lineHeight: { label: 'Line height', kind: 'number' },
  letterSpacing: { label: 'Letter spacing', kind: 'number' },
  color: { label: 'Color', kind: 'color' },
  width: { label: 'Width', kind: 'number' },
  height: { label: 'Height', kind: 'number' },
  fill: { label: 'Fill', kind: 'color' },
  stroke: { label: 'Stroke color', kind: 'color' },
  strokeWidth: { label: 'Stroke width', kind: 'number' },
  cornerRadius: { label: 'Corner radius', kind: 'number' },
};

const TRANSFORM = ['x', 'y', 'scale', 'rotation', 'opacity'];
export function animatableProps(type: LayerType): string[] {
  switch (type) {
    case 'text': return [...TRANSFORM, 'fontSize', 'lineHeight', 'letterSpacing', 'color'];
    case 'image': return [...TRANSFORM, 'width', 'height'];
    case 'shape': return [...TRANSFORM, 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'cornerRadius'];
    case 'cursor': return ['scale', 'opacity'];
  }
}

/* ---------- colors ---------- */
export function parseHex(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
    h.length >= 8 ? parseInt(h.slice(6, 8), 16) : 255,
  ];
}
export function toHex(c: [number, number, number, number]): string {
  const p = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${p(c[0])}${p(c[1])}${p(c[2])}${c[3] >= 254.5 ? '' : p(c[3])}`;
}
export function lerpColor(a: string, b: string, u: number): string {
  const ca = parseHex(a), cb = parseHex(b);
  return toHex([0, 1, 2, 3].map((i) => ca[i] + (cb[i] - ca[i]) * u) as [number, number, number, number]);
}

/* ---------- keyframe evaluation ---------- */
export type Value = number | string;

export function lerpValue(a: Value, b: Value, u: number): Value {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u;
  if (typeof a === 'string' && typeof b === 'string') return lerpColor(a, b, u);
  return a;
}

/**
 * Value of an animated property at `t` (seconds, layer-relative).
 * Before the first keyframe → first value; after the last → last value.
 * `keyframes` must be sorted by time.
 */
export function evalKeyframes(keyframes: readonly Keyframe[] | undefined, t: number, base: Value): Value {
  if (!keyframes || keyframes.length === 0) return base;
  const first = keyframes[0];
  if (t <= first.time) return first.value;
  const last = keyframes[keyframes.length - 1];
  if (t >= last.time) return last.value;
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    if (t >= a.time && t < b.time) {
      const span = b.time - a.time;
      const u = span <= 0 ? 1 : (t - a.time) / span;
      return lerpValue(a.value, b.value, evalEasing(a.easing, u));
    }
  }
  return last.value;
}

/** Layer with every animated property replaced by its value at layer-local time `t`. */
export function resolveLayer<L extends Layer>(layer: L, t: number): L {
  const kfs = layer.keyframes;
  let out: any = layer;
  for (const prop in kfs) {
    const list = kfs[prop];
    if (!list || list.length === 0) continue;
    if (out === layer) out = { ...layer };
    out[prop] = evalKeyframes(list, t, (layer as any)[prop]);
  }
  return out;
}

/* ---------- keyframe editing helpers (pure; mutate the array they are given) ---------- */
export const KF_EPS = 1e-6;

export function findKeyframeIndex(list: readonly Keyframe[] | undefined, time: number, tol = KF_EPS): number {
  if (!list) return -1;
  let best = -1, bestD = Infinity;
  list.forEach((k, i) => {
    const d = Math.abs(k.time - time);
    if (d <= tol && d < bestD) { best = i; bestD = d; }
  });
  return best;
}

export function upsertKeyframe(list: Keyframe[], time: number, value: Value, easing?: Easing, tol = KF_EPS): void {
  const i = findKeyframeIndex(list, time, tol);
  if (i >= 0) {
    list[i].value = value;
    if (easing) list[i].easing = easing;
    return;
  }
  list.push({ time, value, easing: easing ?? DEFAULT_EASING });
  list.sort((a, b) => a.time - b.time);
}

export function layerEnd(layer: { start: number; duration: number }): number {
  return layer.start + layer.duration;
}

export const snapToFrame = (t: number, fps: number) => Math.round(t * fps) / fps;
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function formatTime(t: number, fps: number): string {
  const frame = Math.round(t * fps);
  const secs = frame / fps;
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}
