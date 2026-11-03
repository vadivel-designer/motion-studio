import { resolveLayer } from './animation';
import { layerActive, layerSize, sceneActive } from './render';
import type { Size } from './render';
import type { Layer, Project, Scene } from './schema';
import type { Pt } from './cursor';
import { cursorPosition } from './cursor';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Local box coordinate (0..w, 0..h) -> scene/project coordinates for a resolved layer. */
export function localToProject(l: Layer, size: Size, p: Pt): Pt {
  const dx = (p.x - l.anchor.x * size.w) * l.scale;
  const dy = (p.y - l.anchor.y * size.h) * l.scale;
  const r = (l.rotation * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return { x: l.x + dx * c - dy * s, y: l.y + dx * s + dy * c };
}

export function projectToLocal(l: Layer, size: Size, p: Pt): Pt {
  const r = (-l.rotation * Math.PI) / 180;
  const c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - l.x, dy = p.y - l.y;
  const rx = (dx * c - dy * s) / (l.scale || 1e-9);
  const ry = (dx * s + dy * c) / (l.scale || 1e-9);
  return { x: rx + l.anchor.x * size.w, y: ry + l.anchor.y * size.h };
}

export function layerCorners(l: Layer, size: Size): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: size.w, y: 0 },
    { x: size.w, y: size.h },
    { x: 0, y: size.h },
  ].map((p) => localToProject(l, size, p));
}

export interface ActiveLayer {
  scene: Scene;
  layer: Layer;
  resolved: Layer;
  size: Size;
  localT: number;
}

/** All layers visible at project time t, bottom → top. */
export function activeLayers(project: Project, t: number, ctx: Ctx): ActiveLayer[] {
  const out: ActiveLayer[] = [];
  for (const scene of project.scenes) {
    if (!sceneActive(scene, t)) continue;
    const st = t - scene.start;
    for (const layer of scene.layers) {
      if (!layerActive(layer, st)) continue;
      const localT = st - layer.start;
      const resolved = resolveLayer(layer, localT);
      out.push({ scene, layer, resolved, size: layerSize(resolved, ctx), localT });
    }
  }
  return out;
}

/** Top-most unlocked layer under a project-space point. `tol` = hit radius for cursors (project px). */
export function hitTest(project: Project, t: number, ctx: Ctx, pt: Pt, tol: number): ActiveLayer | null {
  const list = activeLayers(project, t, ctx);
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (a.layer.locked) continue;
    if (a.resolved.type === 'cursor') {
      const pos = cursorPosition(a.resolved.points, a.localT, a.resolved.smoothing);
      if (pos && Math.hypot(pos.x - pt.x, pos.y - pt.y) < tol * 1.6) return a;
      continue;
    }
    const lp = projectToLocal(a.resolved, a.size, pt);
    if (lp.x >= 0 && lp.y >= 0 && lp.x <= a.size.w && lp.y <= a.size.h) return a;
  }
  return null;
}
