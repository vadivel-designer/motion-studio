import { describe, expect, it } from 'vitest';
import { evalKeyframes } from '../../src/shared/animation';
import { createEmptyProject, makeShape, makeText } from '../../src/shared/factory';
import { applyPreset, applyStagger, DEFAULT_PRESET, staggerRanks } from '../../src/shared/presets';
import type { PresetParams } from '../../src/shared/presets';

const mk = () => {
  const p = createEmptyProject();
  return { p, l: makeText(p, p.scenes[0], { start: 0, duration: 6 }) };
};
const P = (o: Partial<PresetParams>): PresetParams => ({ ...DEFAULT_PRESET, ...o });

describe('presets generate ordinary keyframes', () => {
  it('fade in', () => {
    const { l } = mk();
    applyPreset(l, P({ kind: 'fade', phase: 'in', delay: 0.5, duration: 1, easing: { type: 'linear' } }));
    const k = l.keyframes.opacity;
    expect(k.map((x) => [x.time, x.value])).toEqual([[0.5, 0], [1.5, 1]]);
    expect(evalKeyframes(k, 1, 1)).toBeCloseTo(0.5);
    expect(k[0].preset).toBe('in:fade');
  });
  it('slide in from each direction ends at the rest position', () => {
    for (const [dir, prop, sign] of [['left', 'x', -1], ['right', 'x', 1], ['up', 'y', -1], ['down', 'y', 1]] as const) {
      const { l } = mk();
      const rest = l[prop];
      applyPreset(l, P({ kind: 'slide', direction: dir, distance: 200 }));
      const k = l.keyframes[prop];
      expect(k[0].value).toBe(rest + sign * 200);
      expect(k[1].value).toBe(rest);
    }
  });
  it('scale out ends hidden at the layer end (minus delay)', () => {
    const { l } = mk();
    applyPreset(l, P({ kind: 'scale', phase: 'out', delay: 0.5, duration: 1, scaleFrom: 0 }));
    const k = l.keyframes.scale;
    expect(k.map((x) => [x.time, x.value])).toEqual([[4.5, 1], [5.5, 0]]);
  });
  it('re-applying replaces the previous keyframes of the same kind+phase only', () => {
    const { l } = mk();
    applyPreset(l, P({ kind: 'fade', phase: 'in', duration: 1 }));
    applyPreset(l, P({ kind: 'fade', phase: 'out', duration: 1 }));
    applyPreset(l, P({ kind: 'fade', phase: 'in', duration: 2, delay: 1 }));
    const k = l.keyframes.opacity;
    expect(k).toHaveLength(4);
    expect(k.filter((x) => x.preset === 'in:fade').map((x) => x.time)).toEqual([1, 3]);
    expect(k.filter((x) => x.preset === 'out:fade')).toHaveLength(2);
  });
  it('changing slide direction removes the old axis', () => {
    const { l } = mk();
    applyPreset(l, P({ kind: 'slide', direction: 'left' }));
    applyPreset(l, P({ kind: 'slide', direction: 'up' }));
    expect(l.keyframes.x).toBeUndefined();
    expect(l.keyframes.y).toHaveLength(2);
  });
  it('can stack fade + slide', () => {
    const { l } = mk();
    applyPreset(l, P({ kind: 'fade' }));
    applyPreset(l, P({ kind: 'slide' }));
    expect(Object.keys(l.keyframes).sort()).toEqual(['opacity', 'x']);
  });
});

describe('stagger', () => {
  const layers = () => {
    const p = createEmptyProject();
    return Array.from({ length: 5 }, () => makeShape(p, p.scenes[0], { start: 1, duration: 4 }, 'rect'));
  };
  it('forward / reverse offset start times by the interval', () => {
    const f = layers();
    applyStagger(f, { order: 'forward', interval: 0.25, seed: 1 });
    expect(f.map((l) => l.start)).toEqual([1, 1.25, 1.5, 1.75, 2]);
    const r = layers();
    applyStagger(r, { order: 'reverse', interval: 0.5, seed: 1 });
    expect(r.map((l) => l.start)).toEqual([3, 2.5, 2, 1.5, 1]);
  });
  it('seeded random is reproducible, a permutation, and seed-dependent', () => {
    const a = staggerRanks(8, 'random', 42), b = staggerRanks(8, 'random', 42), c = staggerRanks(8, 'random', 43);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(a).not.toEqual(c);
  });
  it('is idempotent when re-applied', () => {
    const l = layers();
    applyStagger(l, { order: 'random', interval: 0.3, seed: 7 });
    const once = l.map((x) => x.start);
    applyStagger(l, { order: 'random', interval: 0.3, seed: 7 });
    expect(l.map((x) => x.start)).toEqual(once);
  });
});
