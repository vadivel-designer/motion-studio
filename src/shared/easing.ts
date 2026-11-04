import type { Easing } from './schema';

const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

/** Standard CSS cubic-bezier solver (Newton + bisection). Pure & deterministic. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, u: number): number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  let t = u;
  for (let i = 0; i < 8; i++) {
    const err = sx(t) - u;
    if (Math.abs(err) < 1e-7) return sy(t);
    const d = dx(t);
    if (Math.abs(d) < 1e-6) break;
    t -= err / d;
  }
  let lo = 0, hi = 1;
  t = u;
  for (let i = 0; i < 60; i++) {
    const x = sx(t);
    if (Math.abs(x - u) < 1e-7) break;
    if (u > x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return sy(t);
}

/** Unit step response of a damped spring (0 -> 1, zero initial velocity) at time t seconds. */
export function springValue(stiffness: number, damping: number, mass: number, t: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (t <= 0) return 0;
  if (zeta < 1 - 1e-9) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta <= 1 + 1e-9) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const r = Math.sqrt(zeta * zeta - 1);
  const s1 = -w0 * (zeta - r), s2 = -w0 * (zeta + r);
  return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
}

const settleCache = new Map<string, number>();
/** Time (s) after which the spring stays within 0.1% of its target. */
export function springSettleTime(stiffness: number, damping: number, mass: number): number {
  const key = `${stiffness}|${damping}|${mass}`;
  const hit = settleCache.get(key);
  if (hit !== undefined) return hit;
  const dt = 1 / 240, max = 30;
  let last = 0;
  for (let t = 0; t <= max; t += dt) {
    if (Math.abs(1 - springValue(stiffness, damping, mass, t)) > 0.001) last = t;
  }
  const settle = Math.max(last + dt, 0.05);
  settleCache.set(key, settle);
  return settle;
}

/**
 * Evaluate an easing at normalised progress u in [0,1] -> eased progress.
 * Springs map the segment onto the spring's settle time, so a segment always
 * lands exactly on its end value.
 */
export function evalEasing(e: Easing, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  switch (e.type) {
    case 'linear': return u;
    case 'ease-in': return cubicBezier(0.42, 0, 1, 1, u);
    case 'ease-out': return cubicBezier(0, 0, 0.58, 1, u);
    case 'ease-in-out': return cubicBezier(0.42, 0, 0.58, 1, u);
    case 'cubic-bezier': return cubicBezier(clamp01(e.x1), e.y1, clamp01(e.x2), e.y2, u);
    case 'spring': return springValue(e.stiffness, e.damping, e.mass, u * springSettleTime(e.stiffness, e.damping, e.mass));
  }
}

export const EASING_LABELS: Record<Easing['type'], { label: string; hint: string }> = {
  linear: { label: 'Constant speed', hint: 'Moves at the same speed the whole way.' },
  'ease-in': { label: 'Starts slow, ends fast', hint: 'Gently accelerates away from the keyframe.' },
  'ease-out': { label: 'Starts fast, ends slow', hint: 'Rushes out, then gently settles at the next keyframe.' },
  'ease-in-out': { label: 'Slow at both ends', hint: 'Eases out of one keyframe and into the next.' },
  'cubic-bezier': { label: 'Custom curve', hint: 'Shape the speed curve with four control values.' },
  spring: { label: 'Springy bounce', hint: 'Overshoots the target and wobbles to rest like a spring.' },
};

export const DEFAULT_EASING: Easing = { type: 'ease-in-out' };

export function defaultEasing(type: Easing['type']): Easing {
  switch (type) {
    case 'cubic-bezier': return { type, x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 };
    case 'spring': return { type, stiffness: 170, damping: 12, mass: 1 };
    default: return { type } as Easing;
  }
}
