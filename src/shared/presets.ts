import { upsertKeyframe } from './animation';
import type { Easing, Layer } from './schema';

export type PresetKind = 'fade' | 'slide' | 'scale';
export type PresetPhase = 'in' | 'out';
export type Direction = 'left' | 'right' | 'up' | 'down';

export interface PresetParams {
  kind: PresetKind;
  phase: PresetPhase;
  direction: Direction;
  distance: number; // px (slide)
  delay: number; // s
  duration: number; // s
  easing: Easing;
  scaleFrom: number; // scale preset: scale at the hidden end
}

export const DEFAULT_PRESET: PresetParams = {
  kind: 'fade',
  phase: 'in',
  direction: 'left',
  distance: 300,
  delay: 0,
  duration: 0.6,
  easing: { type: 'ease-out' },
  scaleFrom: 0,
};

export const presetTag = (kind: PresetKind, phase: PresetPhase) => `${phase}:${kind}`;

/**
 * Generates ordinary keyframes on `layer` (mutates it – call on an immer draft or a clone).
 * Re-applying the same kind+phase first removes the keyframes that kind+phase generated before.
 * Rest values are the layer's static values.
 */
export function applyPreset(layer: Layer, p: PresetParams): void {
  if (layer.type === 'cursor') return;
  const tag = presetTag(p.kind, p.phase);
  for (const prop of Object.keys(layer.keyframes)) {
    layer.keyframes[prop] = layer.keyframes[prop].filter((k) => k.preset !== tag);
    if (layer.keyframes[prop].length === 0) delete layer.keyframes[prop];
  }
  const minSpan = 1 / 60;
  const dur = Math.max(minSpan, p.duration);
  let t0: number, t1: number;
  if (p.phase === 'in') {
    t0 = Math.max(0, p.delay);
    t1 = t0 + dur;
  } else {
    t1 = Math.max(dur, layer.duration - Math.max(0, p.delay));
    t0 = Math.max(0, t1 - dur);
  }
  t1 = Math.min(Math.max(t1, t0 + minSpan), Math.max(layer.duration, t0 + minSpan));

  const put = (prop: string, rest: number, hidden: number) => {
    const list = (layer.keyframes[prop] ??= []);
    const [from, to] = p.phase === 'in' ? [hidden, rest] : [rest, hidden];
    for (const [time, value] of [[t0, from], [t1, to]] as [number, number][]) {
      // a hand-made keyframe at exactly the same time is replaced by the preset's
      const clash = list.findIndex((k) => Math.abs(k.time - time) < 1e-6);
      if (clash >= 0) list.splice(clash, 1);
      upsertKeyframe(list, time, value, p.easing);
      list.find((k) => Math.abs(k.time - time) < 1e-6)!.preset = tag;
    }
  };

  if (p.kind === 'fade') put('opacity', layer.opacity, 0);
  else if (p.kind === 'scale') put('scale', layer.scale, p.scaleFrom);
  else {
    const d = p.distance;
    if (p.direction === 'left') put('x', layer.x, layer.x - d);
    else if (p.direction === 'right') put('x', layer.x, layer.x + d);
    else if (p.direction === 'up') put('y', layer.y, layer.y - d);
    else put('y', layer.y, layer.y + d);
  }
}

/* ---------- stagger ---------- */
export type StaggerOrder = 'forward' | 'reverse' | 'random';
export interface StaggerParams { order: StaggerOrder; interval: number; seed: number }

/** mulberry32: tiny seeded PRNG, so "random" order is reproducible. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rank (0..n-1) assigned to each layer, given layers in z-order. */
export function staggerRanks(n: number, order: StaggerOrder, seed: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  if (order === 'reverse') return idx.map((i) => n - 1 - i);
  if (order === 'forward') return idx;
  const rnd = seededRandom(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx; // idx[layerIndex] = rank
}

/** Offsets layer start times: start = earliest start + rank × interval. Mutates the given layers. */
export function applyStagger(layers: Layer[], p: StaggerParams): void {
  if (layers.length < 2) return;
  const base = Math.min(...layers.map((l) => l.start));
  const ranks = staggerRanks(layers.length, p.order, p.seed);
  layers.forEach((l, i) => { l.start = Math.max(0, base + ranks[i] * p.interval); });
}
