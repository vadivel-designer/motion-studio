import { describe, expect, it } from 'vitest';
import { evalKeyframes, findKeyframeIndex, lerpColor, resolveLayer, upsertKeyframe, snapToFrame } from '../../src/shared/animation';
import { createEmptyProject, makeShape, makeText } from '../../src/shared/factory';
import type { Keyframe } from '../../src/shared/schema';
import { cursorPosition } from '../../src/shared/cursor';

const lin = { type: 'linear' } as const;
const kf = (time: number, value: number | string, easing: Keyframe['easing'] = lin): Keyframe => ({ time, value, easing });

describe('keyframe interpolation', () => {
  it('returns the base value without keyframes', () => {
    expect(evalKeyframes(undefined, 1, 42)).toBe(42);
    expect(evalKeyframes([], 1, 42)).toBe(42);
  });
  it('clamps before the first and after the last keyframe', () => {
    const k = [kf(1, 10), kf(2, 20)];
    expect(evalKeyframes(k, 0, 0)).toBe(10);
    expect(evalKeyframes(k, 5, 0)).toBe(20);
    expect(evalKeyframes([kf(1, 7)], 3, 0)).toBe(7);
  });
  it('linearly interpolates between keyframes', () => {
    const k = [kf(0, 0), kf(2, 100)];
    expect(evalKeyframes(k, 0.5, 0)).toBeCloseTo(25);
    expect(evalKeyframes(k, 1, 0)).toBeCloseTo(50);
    expect(evalKeyframes(k, 2, 0)).toBe(100);
  });
  it('uses the easing of the segment’s starting keyframe', () => {
    const k = [kf(0, 0, { type: 'ease-in' }), kf(1, 100, lin), kf(2, 200, lin)];
    expect(evalKeyframes(k, 0.25, 0) as number).toBeLessThan(25); // eased segment
    expect(evalKeyframes(k, 1.5, 0)).toBeCloseTo(150); // linear segment
  });
  it('picks the right segment among many', () => {
    const k = [kf(0, 0), kf(1, 10), kf(2, 0), kf(3, 30)];
    expect(evalKeyframes(k, 0.5, 0)).toBeCloseTo(5);
    expect(evalKeyframes(k, 1.5, 0)).toBeCloseTo(5);
    expect(evalKeyframes(k, 2.5, 0)).toBeCloseTo(15);
  });
  it('interpolates colors in RGB and keeps alpha', () => {
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(lerpColor('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(lerpColor('#ffffff', '#ffffff00', 0.5)).toBe('#ffffff80');
    expect(evalKeyframes([kf(0, '#000000'), kf(1, '#ffffff')], 0.5, '#123456')).toBe('#808080');
  });
  it('spring easing hits the end value exactly', () => {
    const k = [kf(0, 0, { type: 'spring', stiffness: 170, damping: 12, mass: 1 }), kf(1, 100)];
    expect(evalKeyframes(k, 1, 0)).toBe(100);
    expect(evalKeyframes(k, 0.4, 0) as number).toBeGreaterThan(50);
  });
  it('is a pure function of (keyframes, t)', () => {
    const k = [kf(0, 0, { type: 'ease-in-out' }), kf(1, 100)];
    expect(evalKeyframes(k, 0.37, 0)).toBe(evalKeyframes(k, 0.37, 0));
  });
});

describe('keyframe editing helpers', () => {
  it('upsert inserts sorted and replaces at the same time', () => {
    const l: Keyframe[] = [];
    upsertKeyframe(l, 2, 20); upsertKeyframe(l, 1, 10); upsertKeyframe(l, 3, 30); upsertKeyframe(l, 2, 99);
    expect(l.map((k) => [k.time, k.value])).toEqual([[1, 10], [2, 99], [3, 30]]);
    expect(findKeyframeIndex(l, 2.0000001, 1e-3)).toBe(1);
    expect(findKeyframeIndex(l, 2.5, 1e-3)).toBe(-1);
  });
  it('snaps to frames', () => {
    expect(snapToFrame(1.0123, 30)).toBeCloseTo(1 + 0 / 30, 1);
    expect(snapToFrame(0.5, 30)).toBeCloseTo(0.5);
  });
});

describe('resolveLayer', () => {
  it('overrides animated props only', () => {
    const p = createEmptyProject();
    const t = makeText(p, p.scenes[0], { start: 0, duration: 5 });
    t.keyframes = { x: [kf(0, 0), kf(2, 200)], color: [kf(0, '#000000'), kf(2, '#ffffff')] };
    const r = resolveLayer(t, 1);
    expect(r.x).toBeCloseTo(100);
    expect(r.color).toBe('#808080');
    expect(r.y).toBe(t.y);
    expect(t.x).not.toBe(r.x); // original untouched
    expect(resolveLayer(makeShape(p, p.scenes[0], { start: 0, duration: 1 }, 'rect'), 0.5).opacity).toBe(1);
  });
});

describe('cursor path', () => {
  const pts = [
    { id: 'a', x: 0, y: 0, time: 0 },
    { id: 'b', x: 100, y: 0, time: 1 },
    { id: 'c', x: 100, y: 100, time: 2 },
  ];
  it('hits the points at their times and clamps outside', () => {
    expect(cursorPosition(pts, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(cursorPosition(pts, 1, 0.5)!.x).toBeCloseTo(100);
    expect(cursorPosition(pts, 9, 0)).toEqual({ x: 100, y: 100 });
    expect(cursorPosition([], 1, 0)).toBeNull();
  });
  it('smoothing bends the path away from the straight segment', () => {
    const straight = cursorPosition(pts, 1.5, 0)!;
    const smooth = cursorPosition(pts, 1.5, 1)!;
    expect(smooth.x === straight.x && smooth.y === straight.y).toBe(false);
    expect(cursorPosition(pts, 1.5, 0)).toEqual(cursorPosition(pts, 1.5, 0));
  });
});
