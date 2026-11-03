import { beforeEach, describe, expect, it } from 'vitest';
import { findKeyframeIndex } from '../../src/shared/animation';
import { createEmptyProject } from '../../src/shared/factory';

// minimal DOM stubs so the editor store can be exercised in node
(globalThis as any).window = (globalThis as any).window ?? {};

const S = await import('../../src/editor/store');

const reset = () => {
  const p = createEmptyProject('T');
  S.useEditor.setState({ project: p, past: [], future: [], txBase: null, savedJson: JSON.stringify(p), selection: [], activeSceneId: p.scenes[0].id, time: 0, playing: false });
};
const layers = () => S.useEditor.getState().project.scenes[0].layers;

beforeEach(reset);

describe('history', () => {
  it('undo / redo restore exact state', () => {
    S.addLayer({ kind: 'text' });
    const id = layers()[0].id;
    S.setProps([id], { x: 111 });
    expect((layers()[0] as any).x).toBe(111);
    S.undo();
    expect((layers()[0] as any).x).toBe(1920);
    S.redo();
    expect((layers()[0] as any).x).toBe(111);
    S.undo(); S.undo();
    expect(layers()).toHaveLength(0);
    expect(S.useEditor.getState().future).toHaveLength(2);
  });
  it('a new edit clears the redo stack', () => {
    S.addLayer({ kind: 'text' });
    S.undo();
    S.addLayer({ kind: 'text' });
    expect(S.useEditor.getState().future).toHaveLength(0);
  });
  it('one drag (transaction) = one history step', () => {
    S.addLayer({ kind: 'text' });
    const id = layers()[0].id;
    const before = S.useEditor.getState().past.length;
    S.beginTx();
    for (let i = 1; i <= 25; i++) S.setProps([id], { x: 1000 + i });
    S.endTx();
    expect(S.useEditor.getState().past.length).toBe(before + 1);
    S.undo();
    expect((layers()[0] as any).x).toBe(1920);
  });
  it('an empty transaction adds no history', () => {
    const n = S.useEditor.getState().past.length;
    S.beginTx(); S.endTx();
    expect(S.useEditor.getState().past.length).toBe(n);
  });
  it('dirty flag follows the saved snapshot', () => {
    expect(S.isDirty(S.useEditor.getState())).toBe(false);
    S.addLayer({ kind: 'text' });
    expect(S.isDirty(S.useEditor.getState())).toBe(true);
    S.undo();
    expect(S.isDirty(S.useEditor.getState())).toBe(false);
  });
});

describe('keyframes + auto-key', () => {
  it('toggle adds/removes a keyframe at the playhead and keeps the value', () => {
    S.addLayer({ kind: 'text' });
    const id = layers()[0].id;
    S.toggleKeyframe([id], 'x');
    expect(layers()[0].keyframes.x).toHaveLength(1);
    S.toggleKeyframe([id], 'x');
    expect(layers()[0].keyframes.x).toBeUndefined();
    expect((layers()[0] as any).x).toBe(1920);
  });
  it('editing an animated property at another time auto-creates a keyframe', () => {
    S.addLayer({ kind: 'text' });
    const id = layers()[0].id;
    S.toggleKeyframe([id], 'x');
    S.setTime(2);
    S.setProps([id], { x: 500 });
    const k = layers()[0].keyframes.x;
    expect(k.map((q) => [q.time, q.value])).toEqual([[0, 1920], [2, 500]]);
    S.undo();
    expect(layers()[0].keyframes.x).toHaveLength(1);
  });
  it('dragKeyframes is idempotent from a snapshot and sorts', () => {
    S.addLayer({ kind: 'text' });
    const id = layers()[0].id;
    S.toggleKeyframe([id], 'x'); S.setTime(1); S.setProps([id], { x: 5 }); S.setTime(2); S.setProps([id], { x: 9 });
    const snap = JSON.parse(JSON.stringify(layers()[0].keyframes));
    S.dragKeyframes(id, ['x'], 1, 3, snap);
    S.dragKeyframes(id, ['x'], 1, 2.5, snap);
    expect(layers()[0].keyframes.x.map((q) => q.time)).toEqual([0, 2, 2.5]);
    S.dragKeyframes(id, ['x'], 1, 2, snap); // collides with the keyframe at 2 -> replaced
    expect(layers()[0].keyframes.x.map((q) => q.time)).toEqual([0, 2]);
    S.dragKeyframes(id, ['x'], 1, 1, snap);
    expect(findKeyframeIndex(layers()[0].keyframes.x, 1)).toBe(1);
  });
});

describe('scenes & layers', () => {
  it('scene duplicate clones layers with fresh ids; delete/reorder work', () => {
    S.addLayer({ kind: 'text' });
    const origId = layers()[0].id;
    S.duplicateScene(S.useEditor.getState().project.scenes[0].id);
    const sc = S.useEditor.getState().project.scenes;
    expect(sc).toHaveLength(2);
    expect(sc[1].layers[0].id).not.toBe(origId);
    expect(sc[1].start).toBe(15);
    S.moveScene(sc[1].id, -1);
    expect(S.useEditor.getState().project.scenes.map((s) => s.start)).toEqual([0, 15]);
    S.deleteScene(sc[1].id);
    expect(S.useEditor.getState().project.scenes).toHaveLength(1);
  });
  it('layer reorder / duplicate / delete', () => {
    S.addLayer({ kind: 'text' }); S.addLayer({ kind: 'shape', shape: 'rect' }); S.addLayer({ kind: 'shape', shape: 'ellipse' });
    const [a, b, c] = layers().map((l) => l.id);
    S.moveLayer(a, 'top');
    expect(layers().map((l) => l.id)).toEqual([b, c, a]);
    S.moveLayer(a, 'down');
    expect(layers().map((l) => l.id)).toEqual([b, a, c]);
    S.reorderLayerTo(c, b);
    expect(layers().map((l) => l.id)).toEqual([c, b, a]);
    S.duplicateLayers([a]);
    expect(layers()).toHaveLength(4);
    S.deleteLayers([a]);
    expect(layers()).toHaveLength(3);
  });
});
