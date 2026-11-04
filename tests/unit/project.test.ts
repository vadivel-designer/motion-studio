import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { createEmptyProject, makeShape, makeText } from '../../src/shared/factory';
import { parseProject } from '../../src/shared/schema';
import { applySettingsPatch, dimensionsFor, scenesBeyondEnd } from '../../src/shared/settings';

const withLayers = () => {
  const p = createEmptyProject();
  const s = p.scenes[0];
  s.layers.push(makeText(p, s, { start: 0, duration: 15 }), makeShape(p, s, { start: 2, duration: 5 }, 'ellipse'));
  s.layers[0].keyframes.x = [{ time: 0, value: 100, easing: { type: 'linear' } }, { time: 1, value: 1920, easing: { type: 'linear' } }];
  return p;
};

describe('schema', () => {
  it('validates a fresh project and a roundtrip through JSON', () => {
    const p = withLayers();
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('rejects bad data with a readable message', () => {
    expect(() => parseProject({ version: 1 })).toThrow(/Invalid project.json/);
    const bad: any = JSON.parse(JSON.stringify(withLayers()));
    bad.scenes[0].layers[0].opacity = 3;
    expect(() => parseProject(bad)).toThrow(/opacity/);
  });
  it('defaults match the spec', () => {
    const s = createEmptyProject().settings;
    expect([s.durationSec, s.aspect, s.width, s.height, s.fps]).toEqual([15, '16:9', 3840, 2160, 30]);
  });
});

describe('project settings', () => {
  it('computes dimensions per aspect ratio', () => {
    expect(dimensionsFor('16:9', 1080)).toEqual({ width: 1920, height: 1080 });
    expect(dimensionsFor('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(dimensionsFor('1:1', 1080)).toEqual({ width: 1080, height: 1080 });
    expect(dimensionsFor('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
  });
  it('changing aspect, resolution, fps and duration never deletes layers', () => {
    let p = withLayers();
    const n = p.scenes[0].layers.length;
    for (const patch of [{ aspect: '9:16' as const }, { aspect: '1:1' as const }, { aspect: '4:5' as const }, { short: 720 }, { fps: 60 }, { durationSec: 3 }, { width: 1000, height: 777 }, { durationSec: 40 }]) {
      p = produce(p, (d) => applySettingsPatch(d, patch));
      expect(p.scenes).toHaveLength(1);
      expect(p.scenes[0].layers).toHaveLength(n);
      parseProject(p); // still valid
    }
  });
  it('rescales positions proportionally (incl. keyframes) on resolution change', () => {
    const p = produce(withLayers(), (d) => applySettingsPatch(d, { short: 1080 }));
    expect(p.settings.width).toBe(1920);
    const t = p.scenes[0].layers[0];
    expect(t.x).toBeCloseTo(960);
    expect(t.keyframes.x[1].value).toBeCloseTo(960);
    expect((t as any).fontSize).toBeCloseTo(Math.round(2160 * 0.09) / 2);
  });
  it('custom size switches aspect to custom; shorter duration only flags overflow', () => {
    let p = produce(withLayers(), (d) => applySettingsPatch(d, { width: 1000, height: 600 }));
    expect(p.settings.aspect).toBe('custom');
    p = produce(p, (d) => applySettingsPatch(d, { durationSec: 5 }));
    expect(scenesBeyondEnd(p)).toBe(1);
    expect(p.scenes[0].duration).toBe(15);
  });
  it('a longer duration extends scenes/layers that ran to the end', () => {
    const p = produce(withLayers(), (d) => applySettingsPatch(d, { durationSec: 20 }));
    expect(p.scenes[0].duration).toBe(20);
    expect(p.scenes[0].layers[0].duration).toBe(20);
    expect(p.scenes[0].layers[1].duration).toBe(5);
  });
});
