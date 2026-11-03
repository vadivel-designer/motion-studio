import type { Layer, Project, Settings } from './schema';

export const ASPECT_RATIOS: Record<string, [number, number]> = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
export const RESOLUTION_PRESETS = [
  { label: '4K (2160)', short: 2160 },
  { label: '1440p', short: 1440 },
  { label: '1080p', short: 1080 },
  { label: '720p', short: 720 },
] as const;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Width/height for an aspect ratio given the length of its shorter side. */
export function dimensionsFor(aspect: string, short: number): { width: number; height: number } {
  const [aw, ah] = ASPECT_RATIOS[aspect] ?? [16, 9];
  return aw >= ah
    ? { width: even((short * aw) / ah), height: even(short) }
    : { width: even(short), height: even((short * ah) / aw) };
}

export function shortSide(s: Pick<Settings, 'width' | 'height'>) {
  return Math.min(s.width, s.height);
}

const SIZE_PROPS = ['fontSize', 'letterSpacing', 'width', 'height', 'cornerRadius', 'strokeWidth'];

function rescaleLayer(l: Layer, rx: number, ry: number) {
  const k = Math.min(rx, ry);
  const a = l as any;
  if (l.type !== 'cursor') { a.x *= rx; a.y *= ry; }
  else {
    l.points.forEach((p) => { p.x *= rx; p.y *= ry; });
    a.scale *= k;
  }
  for (const p of SIZE_PROPS) if (typeof a[p] === 'number') a[p] *= k;
  for (const [prop, list] of Object.entries(l.keyframes)) {
    for (const kf of list) {
      if (typeof kf.value !== 'number') continue;
      if (prop === 'x' && l.type !== 'cursor') kf.value *= rx;
      else if (prop === 'y' && l.type !== 'cursor') kf.value *= ry;
      else if (SIZE_PROPS.includes(prop) || (prop === 'scale' && l.type === 'cursor')) kf.value *= k;
    }
  }
}

export interface SettingsPatch {
  durationSec?: number;
  aspect?: Settings['aspect'];
  /** shorter side in px, used with a non-custom aspect */
  short?: number;
  width?: number;
  height?: number;
  fps?: number;
  background?: string;
}

/**
 * Applies a settings change to an (immer draft of a) project.
 * Layers and scenes are NEVER deleted: a resolution change rescales them, a shorter
 * duration just leaves content past the end un-exported.
 */
export function applySettingsPatch(project: Project, patch: SettingsPatch): void {
  const s = project.settings;
  const oldW = s.width, oldH = s.height, oldDur = s.durationSec;
  if (patch.fps !== undefined) s.fps = patch.fps;
  if (patch.background !== undefined) s.background = patch.background;
  if (patch.aspect !== undefined) s.aspect = patch.aspect;
  if (patch.width !== undefined || patch.height !== undefined) {
    if (patch.width !== undefined) s.width = even(patch.width);
    if (patch.height !== undefined) s.height = even(patch.height);
    s.aspect = 'custom';
  } else if (patch.aspect !== undefined || patch.short !== undefined) {
    if (s.aspect !== 'custom') {
      const d = dimensionsFor(s.aspect, patch.short ?? shortSide(s));
      s.width = d.width;
      s.height = d.height;
    }
  }
  if (s.width !== oldW || s.height !== oldH) {
    const rx = s.width / oldW, ry = s.height / oldH;
    for (const sc of project.scenes) for (const l of sc.layers) rescaleLayer(l, rx, ry);
  }
  if (patch.durationSec !== undefined && patch.durationSec !== oldDur) {
    const newDur = Math.max(0.1, patch.durationSec);
    const delta = newDur - oldDur;
    if (delta > 0) {
      // scenes (and full-length layers) that ran to the old end follow the new end
      for (const sc of project.scenes) {
        if (Math.abs(sc.start + sc.duration - oldDur) > 1e-6) continue;
        const oldScDur = sc.duration;
        sc.duration += delta;
        for (const l of sc.layers) if (Math.abs(l.start + l.duration - oldScDur) < 1e-6) l.duration += delta;
      }
    }
    s.durationSec = newDur;
  }
}

/** Scenes that start after, or run past, the project end (they are cut off on export). */
export function scenesBeyondEnd(project: Project): number {
  return project.scenes.filter((sc) => sc.start + sc.duration > project.settings.durationSec + 1e-6).length;
}
