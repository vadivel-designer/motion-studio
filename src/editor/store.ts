import { create } from 'zustand';
import { produce } from 'immer';
import { clamp, findKeyframeIndex, resolveLayer, snapToFrame, upsertKeyframe, animatableProps } from '../shared/animation';
import { DEFAULT_EASING } from '../shared/easing';
import {
  cloneWithNewIds, createEmptyProject, makeCursor, makeImage, makeShape, makeText, uid,
} from '../shared/factory';
import { applyPreset, applyStagger } from '../shared/presets';
import { layerSize } from '../shared/render';
import { localToProject } from '../shared/geometry';
import type { PresetParams, StaggerParams } from '../shared/presets';
import { ResourceLoader } from '../shared/resources';
import type { Asset, Easing, Layer, Project, Scene, ShapeLayer } from '../shared/schema';
import { applySettingsPatch } from '../shared/settings';
import type { SettingsPatch } from '../shared/settings';
import { api } from './api';

const HISTORY_LIMIT = 300;

export interface EditorState {
  project: Project;
  folder: string | null;
  past: Project[];
  future: Project[];
  txBase: Project | null;
  savedJson: string;
  selection: string[];
  activeSceneId: string | null;
  time: number;
  playing: boolean;
  loop: boolean;
  zoom: number;
  resourceVersion: number;
  missingAssets: string[];
  toast: string | null;
  dialog: null | 'open' | 'settings' | 'export';
  busy: boolean;
}

const emptyState = (project: Project): Partial<EditorState> => ({
  project,
  folder: null,
  past: [],
  future: [],
  txBase: null,
  savedJson: JSON.stringify(project),
  selection: [],
  activeSceneId: project.scenes[0]?.id ?? null,
  time: 0,
  playing: false,
  missingAssets: [],
});

export const useEditor = create<EditorState>(() => ({
  ...(emptyState(createEmptyProject()) as EditorState),
  loop: false,
  zoom: 60,
  resourceVersion: 0,
  toast: null,
  dialog: null,
  busy: false,
}));

const get = useEditor.getState;
const set = useEditor.setState;

/* ---------- resources (images / fonts) ---------- */
let loader: ResourceLoader | null = null;
let loaderName = '';
export function getResources(): ResourceLoader | null {
  return loader;
}
export function syncResources() {
  const { project } = get();
  if (!loader || loaderName !== project.name) {
    loaderName = project.name;
    loader = new ResourceLoader(api.filesUrl(project.name), () => {
      set((s) => ({ resourceVersion: s.resourceVersion + 1, missingAssets: loader?.missing ?? [] }));
    });
  }
  void loader.sync(project);
}

/* ---------- toast ---------- */
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string) {
  set({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => set({ toast: null }), 4000);
}

/* ---------- history ---------- */
function sanitize(project: Project, selection: string[], activeSceneId: string | null) {
  const ids = new Set(project.scenes.flatMap((s) => s.layers.map((l) => l.id)));
  const active = project.scenes.some((s) => s.id === activeSceneId) ? activeSceneId : project.scenes[0]?.id ?? null;
  return { selection: selection.filter((id) => ids.has(id)), activeSceneId: active };
}

/** Apply an edit. One call = one undo step, unless a transaction (beginTx/endTx) is open. */
export function edit(fn: (draft: Project) => void) {
  const s = get();
  const next = produce(s.project, fn);
  if (next === s.project) return;
  if (s.txBase) set({ project: next, ...sanitize(next, s.selection, s.activeSceneId) });
  else {
    set({
      project: next,
      past: [...s.past, s.project].slice(-HISTORY_LIMIT),
      future: [],
      ...sanitize(next, s.selection, s.activeSceneId),
    });
  }
  syncResources();
}

/** Group many edits (a drag) into ONE history step. */
export function beginTx() {
  if (!get().txBase) set({ txBase: get().project });
}
export function endTx() {
  const s = get();
  if (!s.txBase) return;
  if (s.txBase !== s.project) set({ past: [...s.past, s.txBase].slice(-HISTORY_LIMIT), future: [], txBase: null });
  else set({ txBase: null });
}

export function undo() {
  const s = get();
  if (s.txBase) endTx();
  const { past, project, future } = get();
  if (!past.length) return;
  const prev = past[past.length - 1];
  set({ project: prev, past: past.slice(0, -1), future: [project, ...future], ...sanitize(prev, s.selection, s.activeSceneId) });
  syncResources();
}
export function redo() {
  const s = get();
  if (s.txBase) endTx();
  const { future, project, past } = get();
  if (!future.length) return;
  const next = future[0];
  set({ project: next, future: future.slice(1), past: [...past, project], ...sanitize(next, s.selection, s.activeSceneId) });
  syncResources();
}

export const isDirty = (s: Pick<EditorState, 'project' | 'savedJson'>) => JSON.stringify(s.project) !== s.savedJson;

/* ---------- lookups ---------- */
export function findLayer(project: Project, id: string): { scene: Scene; layer: Layer } | null {
  for (const scene of project.scenes) {
    const layer = scene.layers.find((l) => l.id === id);
    if (layer) return { scene, layer };
  }
  return null;
}
export const activeScene = (s: Pick<EditorState, 'project' | 'activeSceneId'>) =>
  s.project.scenes.find((x) => x.id === s.activeSceneId) ?? s.project.scenes[0] ?? null;

function sceneOf(draft: Project, id: string) {
  for (const sc of draft.scenes) {
    const l = sc.layers.find((x) => x.id === id);
    if (l) return { scene: sc, layer: l };
  }
  return null;
}

/* ---------- playback / selection ---------- */
/** Last frame that is actually exported (frame N-1). */
export const lastFrameTime = (p: Project) => Math.max(0, Math.round(p.settings.durationSec * p.settings.fps) - 1) / p.settings.fps;
export const setTime = (t: number) => {
  const { project } = get();
  set({ time: clamp(snapToFrame(t, project.settings.fps), 0, lastFrameTime(project)) });
};
export const setTimeExact = (t: number) => set({ time: clamp(t, 0, get().project.settings.durationSec) });
export const stepFrame = (n: number) => {
  const { time, project } = get();
  set({ playing: false });
  setTime((Math.round(time * project.settings.fps) + n) / project.settings.fps);
};
export const togglePlay = () => {
  const s = get();
  if (!s.playing && s.time >= lastFrameTime(s.project) - 1e-6) set({ time: 0 });
  set({ playing: !s.playing });
};
export const replay = () => set({ time: 0, playing: true });

export function select(ids: string[], additive = false) {
  const s = get();
  const next = additive ? [...new Set([...s.selection, ...ids])] : ids;
  set({ selection: next });
  const f = next[0] ? findLayer(s.project, next[0]) : null;
  if (f) set({ activeSceneId: f.scene.id });
}
export function toggleSelect(id: string) {
  const s = get();
  select(s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id]);
}

/* ---------- scenes ---------- */
/** New scenes are appended after the last one; the project grows to fit (nothing is ever cut). */
export function addScene() {
  const id = uid('scene');
  edit((p) => {
    const start = p.scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    const duration = 5;
    p.scenes.push({ id, name: `Scene ${p.scenes.length + 1}`, start, duration, layers: [] });
    p.settings.durationSec = Math.max(p.settings.durationSec, start + duration);
  });
  set({ activeSceneId: id, selection: [] });
}
export function duplicateScene(sceneId: string) {
  const id = uid('scene');
  edit((p) => {
    const i = p.scenes.findIndex((s) => s.id === sceneId);
    if (i < 0) return;
    const src = p.scenes[i];
    const end = p.scenes.reduce((m, s) => Math.max(m, s.start + s.duration), 0);
    p.scenes.splice(i + 1, 0, {
      ...JSON.parse(JSON.stringify(src)), id, name: `${src.name} copy`, start: end,
      layers: src.layers.map((l) => cloneWithNewIds(l)),
    });
    p.settings.durationSec = Math.max(p.settings.durationSec, end + src.duration);
  });
  set({ activeSceneId: id });
}
export function renameScene(id: string, name: string) {
  edit((p) => { const s = p.scenes.find((x) => x.id === id); if (s) s.name = name; });
}
export function deleteScene(id: string) {
  edit((p) => { p.scenes = p.scenes.filter((s) => s.id !== id); });
}
/** Reordering re-packs scenes back-to-back in the new order. */
export function moveScene(id: string, dir: -1 | 1) {
  edit((p) => {
    const i = p.scenes.findIndex((s) => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= p.scenes.length) return;
    const origin = Math.min(...p.scenes.map((s) => s.start));
    [p.scenes[i], p.scenes[j]] = [p.scenes[j], p.scenes[i]];
    let t = origin;
    for (const s of p.scenes) { s.start = t; t += s.duration; }
  });
}
export function setActiveScene(id: string) {
  const s = get();
  const sc = s.project.scenes.find((x) => x.id === id);
  if (!sc) return;
  set({ activeSceneId: id, selection: [] });
  if (s.time < sc.start || s.time >= sc.start + sc.duration) setTime(sc.start);
}

/* ---------- layers ---------- */
function placement(scene: Scene, t: number, fps: number) {
  const rel = snapToFrame(t - scene.start, fps);
  const start = rel > 0 && rel < scene.duration - 0.2 ? rel : 0;
  return { start, duration: scene.duration - start };
}

export type NewLayer = { kind: 'text' } | { kind: 'cursor' } | { kind: 'shape'; shape: ShapeLayer['shape'] } | { kind: 'image'; assetId: string; at?: { x: number; y: number } };

export function addLayer(spec: NewLayer): string | null {
  let s = get();
  if (!s.project.scenes.length) { addScene(); s = get(); }
  const scene = activeScene(s)!;
  const place = placement(scene, s.time, s.project.settings.fps);
  let made: Layer | null = null;
  const sceneId = scene.id;
  edit((p) => {
    const sc = p.scenes.find((x) => x.id === sceneId)!;
    if (spec.kind === 'text') made = makeText(p, sc, place);
    else if (spec.kind === 'cursor') made = makeCursor(p, sc, place);
    else if (spec.kind === 'shape') made = makeShape(p, sc, place, spec.shape);
    else {
      const asset = p.assets.find((a) => a.id === spec.assetId);
      if (!asset || asset.type !== 'image') return;
      made = makeImage(p, sc, place, asset, spec.at);
    }
    sc.layers.push(made);
  });
  const l = made as Layer | null;
  if (l) set({ selection: [l.id], activeSceneId: sceneId });
  return l ? l.id : null;
}

export function deleteLayers(ids: string[]) {
  edit((p) => { for (const sc of p.scenes) sc.layers = sc.layers.filter((l) => !ids.includes(l.id)); });
}
export function duplicateLayers(ids: string[]) {
  const created: string[] = [];
  edit((p) => {
    for (const sc of p.scenes) {
      const add: Layer[] = [];
      for (const l of sc.layers) if (ids.includes(l.id)) {
        const c = cloneWithNewIds(l);
        c.name = `${l.name} copy`;
        if (c.type !== 'cursor') { c.x += p.settings.width * 0.03; c.y += p.settings.width * 0.03; }
        add.push(c);
        created.push(c.id);
      }
      sc.layers.push(...add);
    }
  });
  set({ selection: created });
}
export function renameLayer(id: string, name: string) {
  edit((p) => { const f = sceneOf(p, id); if (f) f.layer.name = name; });
}
export function toggleLayerFlag(id: string, flag: 'visible' | 'locked') {
  edit((p) => { const f = sceneOf(p, id); if (f) f.layer[flag] = !f.layer[flag]; });
}
/** dir +1 = towards the top (end of array). */
export function moveLayer(id: string, dir: 'up' | 'down' | 'top' | 'bottom') {
  edit((p) => {
    const f = sceneOf(p, id);
    if (!f) return;
    const arr = f.scene.layers, i = arr.indexOf(f.layer);
    const j = dir === 'up' ? i + 1 : dir === 'down' ? i - 1 : dir === 'top' ? arr.length - 1 : 0;
    if (j < 0 || j >= arr.length || j === i) return;
    arr.splice(i, 1);
    arr.splice(j, 0, f.layer);
  });
}
export function reorderLayerTo(id: string, targetId: string) {
  edit((p) => {
    const f = sceneOf(p, id), t = sceneOf(p, targetId);
    if (!f || !t || f.scene !== t.scene || id === targetId) return;
    const arr = f.scene.layers;
    const to = arr.indexOf(t.layer);
    arr.splice(arr.indexOf(f.layer), 1);
    arr.splice(to, 0, f.layer);
  });
}

/* ---------- property editing (auto-key) ---------- */
export function localTime(project: Project, scene: Scene, layer: Layer, t: number) {
  return t - scene.start - layer.start;
}

/**
 * Set a property on every given layer. A property that already has keyframes is
 * keyed at the playhead (auto-key); a plain property just changes its static value.
 */
export function setProps(ids: string[], updates: Record<string, number | string | boolean>) {
  const { time, project } = get();
  const tol = 0.5 / project.settings.fps;
  edit((p) => {
    for (const id of ids) {
      const f = sceneOf(p, id);
      if (!f) continue;
      const tl = clamp(localTime(p, f.scene, f.layer, time), 0, f.layer.duration);
      for (const [prop, value] of Object.entries(updates)) {
        const list = f.layer.keyframes[prop];
        if (list && list.length && (typeof value === 'number' || typeof value === 'string')) {
          const idx = findKeyframeIndex(list, tl, tol);
          upsertKeyframe(list, idx >= 0 ? list[idx].time : snapToFrame(tl, p.settings.fps), value, undefined, tol);
        } else (f.layer as any)[prop] = value;
      }
    }
  });
}

export function toggleKeyframe(ids: string[], prop: string) {
  const { time, project } = get();
  const tol = 0.5 / project.settings.fps;
  const first = ids.map((id) => findLayer(project, id)).find(Boolean);
  if (!first) return;
  const addMode = findKeyframeIndex(first.layer.keyframes[prop], localTime(project, first.scene, first.layer, time), tol) < 0;
  edit((p) => {
    for (const id of ids) {
      const f = sceneOf(p, id);
      if (!f || !animatableProps(f.layer.type).includes(prop)) continue;
      const tl = localTime(p, f.scene, f.layer, time);
      if (tl < -tol || tl > f.layer.duration + tol) continue;
      const t = clamp(snapToFrame(tl, p.settings.fps), 0, f.layer.duration);
      const list = (f.layer.keyframes[prop] ??= []);
      const idx = findKeyframeIndex(list, t, tol);
      if (addMode && idx < 0) {
        const value = (resolveLayer(f.layer, t) as any)[prop];
        upsertKeyframe(list, t, value, DEFAULT_EASING, tol);
      } else if (!addMode && idx >= 0) {
        if (list.length === 1) (f.layer as any)[prop] = list[0].value;
        list.splice(idx, 1);
      }
      if (list.length === 0) delete f.layer.keyframes[prop];
    }
  });
}

export function setKeyframeEasing(layerId: string, prop: string, time: number, easing: Easing) {
  edit((p) => {
    const f = sceneOf(p, layerId);
    const list = f?.layer.keyframes[prop];
    const i = findKeyframeIndex(list, time, 1e-4);
    if (list && i >= 0) list[i].easing = easing;
  });
}

export function clearKeyframes(layerId: string, prop: string) {
  edit((p) => {
    const f = sceneOf(p, layerId);
    if (!f) return;
    const list = f.layer.keyframes[prop];
    if (list?.length) (f.layer as any)[prop] = resolveLayer(f.layer, localTime(p, f.scene, f.layer, get().time))[prop as keyof Layer];
    delete f.layer.keyframes[prop];
  });
}

/** Absolute (idempotent) keyframe move used while dragging: restarts from the drag-start snapshot. */
export function dragKeyframes(layerId: string, props: string[], fromTime: number, toTime: number, snapshot: Layer['keyframes']) {
  edit((p) => {
    const f = sceneOf(p, layerId);
    if (!f) return;
    const kfs: Layer['keyframes'] = JSON.parse(JSON.stringify(snapshot));
    const to = clamp(snapToFrame(toTime, p.settings.fps), 0, f.layer.duration);
    for (const prop of props) {
      const list = kfs[prop];
      const i = findKeyframeIndex(list, fromTime, 1e-4);
      if (!list || i < 0) continue;
      const moved = list[i];
      const others = list.filter((k, idx) => idx !== i && Math.abs(k.time - to) > 1e-6);
      moved.time = to;
      kfs[prop] = [...others, moved].sort((a, b) => a.time - b.time);
    }
    f.layer.keyframes = kfs;
  });
}

export function setLayerTiming(layerId: string, start: number, duration: number) {
  edit((p) => {
    const f = sceneOf(p, layerId);
    if (!f) return;
    f.layer.start = Math.max(0, start);
    f.layer.duration = Math.max(1 / p.settings.fps, duration);
  });
}

/** Cursor-layer helpers */
export function updateCursor(layerId: string, fn: (l: Extract<Layer, { type: 'cursor' }>) => void) {
  edit((p) => { const f = sceneOf(p, layerId); if (f && f.layer.type === 'cursor') fn(f.layer); });
}

/* ---------- scenes timing ---------- */
export function setScenesTiming(updates: { id: string; start: number; duration: number }[]) {
  edit((p) => {
    const min = 1 / p.settings.fps;
    for (const u of updates) {
      const sc = p.scenes.find((x) => x.id === u.id);
      if (sc) { sc.start = Math.max(0, u.start); sc.duration = Math.max(min, u.duration); }
    }
  });
}

/** Move the pivot without moving the layer on screen. */
export function setAnchor(id: string, ax: number, ay: number) {
  const { time } = get();
  edit((p) => {
    const f = sceneOf(p, id);
    if (!f || f.layer.type === 'cursor') return;
    const tl = clamp(localTime(p, f.scene, f.layer, time), 0, f.layer.duration);
    const r = resolveLayer(f.layer, tl);
    const size = layerSize(r, measureCtxForStore());
    const pos = localToProject(r, size, { x: ax * size.w, y: ay * size.h });
    f.layer.anchor = { x: ax, y: ay };
    for (const [prop, v] of [['x', pos.x], ['y', pos.y]] as const) {
      const list = f.layer.keyframes[prop];
      if (list?.length) for (const k of list) { /* animated: shift every key by the same delta */ k.value = (k.value as number) + (v - (r as any)[prop]); }
      else (f.layer as any)[prop] = Math.round(v * 100) / 100;
    }
  });
}
let _sctx: CanvasRenderingContext2D | null = null;
function measureCtxForStore() {
  if (!_sctx) _sctx = document.createElement('canvas').getContext('2d')!;
  return _sctx;
}

/* ---------- presets / stagger ---------- */
export function applyPresetTo(ids: string[], params: PresetParams) {
  edit((p) => { for (const id of ids) { const f = sceneOf(p, id); if (f) applyPreset(f.layer, params); } });
}
export function applyStaggerTo(ids: string[], params: StaggerParams) {
  edit((p) => {
    for (const sc of p.scenes) {
      const layers = sc.layers.filter((l) => ids.includes(l.id));
      applyStagger(layers, params);
    }
  });
}

/* ---------- settings ---------- */
export function updateSettings(patch: SettingsPatch) {
  edit((p) => applySettingsPatch(p, patch));
  const { time, project } = get();
  if (time > lastFrameTime(project)) setTime(lastFrameTime(project));
}

/* ---------- project lifecycle ---------- */
function load(project: Project, folder: string | null) {
  set({ ...(emptyState(project) as EditorState), folder });
  loader = null;
  syncResources();
}

export async function newProject() {
  const name = await api.nextName('Untitled');
  load(createEmptyProject(name), null);
}

export async function openProject(name: string) {
  try {
    const { project, folder } = await api.open(name);
    load(project, folder);
    set({ dialog: null });
  } catch (e) {
    toast(`Could not open "${name}": ${(e as Error).message}`);
  }
}

export async function saveProject(): Promise<boolean> {
  const { project } = get();
  set({ busy: true });
  try {
    const r = await api.save(project.name, project);
    set({ savedJson: JSON.stringify(project), folder: r.folder });
    return true;
  } catch (e) {
    toast(`Save failed: ${(e as Error).message}`);
    return false;
  } finally {
    set({ busy: false });
  }
}

export async function renameProject(raw: string) {
  const { project } = get();
  const to = raw.trim().replace(/[^A-Za-z0-9 _.-]/g, '').slice(0, 60);
  if (!to || to === project.name) return;
  try {
    await api.rename(project.name, to);
  } catch (e) {
    toast((e as Error).message);
    return;
  }
  // not an undoable edit; the project.json on disk was renamed by the server
  const wasDirty = isDirty(get());
  const renamed = produce(project, (d) => { d.name = to; });
  set({ project: renamed, past: get().past.map((q) => produce(q, (d) => { d.name = to; })), future: get().future.map((q) => produce(q, (d) => { d.name = to; })) });
  if (!wasDirty) set({ savedJson: JSON.stringify(renamed) });
  loader = null;
  syncResources();
}

export async function importFiles(files: File[], placeAt?: { x: number; y: number }) {
  const IMAGE = /\.(png|jpe?g|webp|svg)$/i, FONT = /\.(ttf|otf|woff2)$/i;
  for (const file of files) {
    const type = IMAGE.test(file.name) ? 'image' : FONT.test(file.name) ? 'font' : null;
    if (!type) { toast(`"${file.name}" is not supported. Use PNG, JPG, WebP, SVG, TTF, OTF or WOFF2.`); continue; }
    try {
      const id = uid('asset');
      const { relativePath, hash } = await api.uploadAsset(get().project.name, id, file, file.name);
      const asset: Asset = { id, originalName: file.name, relativePath, type, hash };
      if (type === 'font') asset.family = file.name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9 _-]/g, '');
      else {
        const dim = await measureImage(file);
        if (dim) { asset.width = dim.w; asset.height = dim.h; }
      }
      edit((p) => { p.assets.push(asset); });
      if (placeAt && type === 'image') addLayer({ kind: 'image', assetId: id, at: placeAt });
    } catch (e) {
      toast(`Import failed: ${(e as Error).message}`);
    }
  }
}

function measureImage(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth || 512, h: img.naturalHeight || 512 }); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

export async function relinkAsset(assetId: string, file: File) {
  try {
    const { relativePath, hash } = await api.uploadAsset(get().project.name, uid('asset'), file, file.name);
    const dim = await measureImage(file);
    edit((p) => {
      const a = p.assets.find((x) => x.id === assetId);
      if (!a) return;
      a.relativePath = relativePath;
      a.hash = hash;
      a.originalName = file.name;
      if (dim && a.type === 'image') { a.width = dim.w; a.height = dim.h; }
    });
  } catch (e) {
    toast(`Relink failed: ${(e as Error).message}`);
  }
}

export function removeAsset(assetId: string) {
  edit((p) => {
    const used = p.scenes.some((s) => s.layers.some((l) => l.type === 'image' && l.assetId === assetId));
    if (used) return;
    p.assets = p.assets.filter((a) => a.id !== assetId);
  });
}

/** For tests / debugging. */
if (typeof window !== 'undefined') (window as any).__editor = {
  store: useEditor,
  getProject: () => get().project,
  resourcesReady: () => !!loader && loader.missing.length === 0 && get().project.assets.every((a) => a.type === 'font' || !!loader!.getImage(a.id)),
  missing: () => get().missingAssets,
};
