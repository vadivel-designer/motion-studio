import { describe, expect, it } from 'vitest';
import { cubicBezier, evalEasing, springSettleTime, springValue } from '../../src/shared/easing';
import type { Easing } from '../../src/shared/schema';

const ALL: Easing[] = [
  { type: 'linear' },
  { type: 'ease-in' },
  { type: 'ease-out' },
  { type: 'ease-in-out' },
  { type: 'cubic-bezier', x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  { type: 'cubic-bezier', x1: 0.3, y1: -0.5, x2: 0.7, y2: 1.5 },
  { type: 'spring', stiffness: 170, damping: 12, mass: 1 },
  { type: 'spring', stiffness: 100, damping: 40, mass: 1 }, // overdamped
  { type: 'spring', stiffness: 100, damping: 20, mass: 1 }, // critically damped
];

describe('easing', () => {
  it.each(ALL)('%j starts at 0 and ends at exactly 1', (e) => {
    expect(evalEasing(e, 0)).toBe(0);
    expect(evalEasing(e, 1)).toBe(1);
    expect(evalEasing(e, -3)).toBe(0);
    expect(evalEasing(e, 7)).toBe(1);
  });

  it.each(ALL)('%j is deterministic', (e) => {
    for (let i = 0; i <= 20; i++) expect(evalEasing(e, i / 20)).toBe(evalEasing(e, i / 20));
  });

  it('linear is the identity', () => {
    for (const u of [0.1, 0.33, 0.5, 0.9]) expect(evalEasing({ type: 'linear' }, u)).toBe(u);
  });

  it('ease-in is slow at the start, ease-out is fast at the start, ease-in-out is symmetric', () => {
    expect(evalEasing({ type: 'ease-in' }, 0.25)).toBeLessThan(0.25);
    expect(evalEasing({ type: 'ease-out' }, 0.25)).toBeGreaterThan(0.25);
    expect(evalEasing({ type: 'ease-in-out' }, 0.5)).toBeCloseTo(0.5, 5);
    const a = evalEasing({ type: 'ease-in-out' }, 0.2), b = evalEasing({ type: 'ease-in-out' }, 0.8);
    expect(a + b).toBeCloseTo(1, 5);
  });

  it('matches known CSS cubic-bezier values', () => {
    // CSS `ease` = cubic-bezier(.25,.1,.25,1): value at 0.5 ≈ 0.8024
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3);
    // CSS `ease-in-out` (.42,0,.58,1) at 0.25 ≈ 0.129
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.25)).toBeCloseTo(0.1291, 3);
  });

  it('monotonic for ease curves', () => {
    for (const t of ['ease-in', 'ease-out', 'ease-in-out'] as const) {
      let prev = -1;
      for (let i = 0; i <= 100; i++) { const v = evalEasing({ type: t }, i / 100); expect(v).toBeGreaterThanOrEqual(prev); prev = v; }
    }
  });

  it('bezier with y control points outside 0..1 overshoots', () => {
    const e: Easing = { type: 'cubic-bezier', x1: 0.3, y1: -0.5, x2: 0.7, y2: 1.5 };
    const ys = Array.from({ length: 101 }, (_, i) => evalEasing(e, i / 100));
    expect(Math.min(...ys)).toBeLessThan(0);
    expect(Math.max(...ys)).toBeGreaterThan(1);
  });

  it('underdamped spring overshoots, overdamped does not', () => {
    const under: Easing = { type: 'spring', stiffness: 170, damping: 8, mass: 1 };
    const over: Easing = { type: 'spring', stiffness: 100, damping: 40, mass: 1 };
    const max = (e: Easing) => Math.max(...Array.from({ length: 200 }, (_, i) => evalEasing(e, i / 200)));
    expect(max(under)).toBeGreaterThan(1.05);
    expect(max(over)).toBeLessThanOrEqual(1.0001);
  });

  it('spring physics: value 0 at t=0, settles to 1', () => {
    expect(springValue(170, 12, 1, 0)).toBe(0);
    expect(springValue(170, 12, 1, 10)).toBeCloseTo(1, 4);
    const T = springSettleTime(170, 12, 1);
    expect(T).toBeGreaterThan(0.1);
    expect(Math.abs(1 - springValue(170, 12, 1, T))).toBeLessThan(0.0011);
  });

  it('heavier mass / lower stiffness settles later', () => {
    expect(springSettleTime(170, 12, 4)).toBeGreaterThan(springSettleTime(170, 12, 1));
  });
});
