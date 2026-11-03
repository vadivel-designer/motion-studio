import type { Asset, CursorLayer, ImageLayer, Layer, Project, Scene, ShapeLayer, TextLayer } from './schema';

export const uid = (prefix: string) =>
  `${prefix}_${(globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2) + Date.now().toString(16)).replace(/-/g, '').slice(0, 10)}`;

export function createEmptyProject(name = 'Untitled'): Project {
  return {
    version: 1,
    name,
    settings: { durationSec: 15, aspect: '16:9', width: 3840, height: 2160, fps: 30, background: '#111114' },
    scenes: [{ id: uid('scene'), name: 'Scene 1', start: 0, duration: 15, layers: [] }],
    assets: [],
  };
}

export const FONT_FAMILIES = ['Arial', 'Helvetica', 'Segoe UI', 'Verdana', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'sans-serif', 'serif', 'monospace'];
export const FONT_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

interface Placement { start: number; duration: number }

function base(project: Project, scene: Scene, type: Layer['type'], label: string, p: Placement) {
  const n = scene.layers.filter((l) => l.type === type && l.name.startsWith(`${label} `)).length + 1;
  return {
    id: uid('layer'),
    name: `${label} ${n}`,
    visible: true,
    locked: false,
    start: p.start,
    duration: p.duration,
    anchor: { x: 0.5, y: 0.5 },
    x: project.settings.width / 2,
    y: project.settings.height / 2,
    scale: 1,
    rotation: 0,
    opacity: 1,
    keyframes: {},
  };
}

export function makeText(project: Project, scene: Scene, p: Placement): TextLayer {
  return {
    ...base(project, scene, 'text', 'Text', p),
    type: 'text',
    content: 'Your text',
    fontFamily: 'Arial',
    fontSize: Math.round(project.settings.height * 0.09),
    fontWeight: 700,
    lineHeight: 1.2,
    letterSpacing: 0,
    align: 'center',
    color: '#ffffff',
  };
}

export function makeShape(project: Project, scene: Scene, p: Placement, shape: ShapeLayer['shape']): ShapeLayer {
  const s = Math.round(Math.min(project.settings.width, project.settings.height) * 0.3);
  return {
    ...base(project, scene, 'shape', shape === 'rect' ? 'Rectangle' : shape === 'ellipse' ? 'Ellipse' : 'Triangle', p),
    type: 'shape',
    shape,
    width: s,
    height: s,
    fill: '#4f7cff',
    stroke: '#ffffff',
    strokeWidth: 0,
    cornerRadius: shape === 'rect' ? Math.round(s * 0.08) : 0,
  };
}

export function makeImage(project: Project, scene: Scene, p: Placement, asset: Asset, at?: { x: number; y: number }): ImageLayer {
  const nw = asset.width || 512, nh = asset.height || 512;
  const k = Math.min((project.settings.width * 0.5) / nw, (project.settings.height * 0.5) / nh);
  const l: ImageLayer = {
    ...base(project, scene, 'image', 'Image', p),
    type: 'image',
    assetId: asset.id,
    width: Math.round(nw * k),
    height: Math.round(nh * k),
  };
  l.name = asset.originalName.replace(/\.[^.]+$/, '') || l.name;
  if (at) { l.x = at.x; l.y = at.y; }
  return l;
}

export function makeCursor(project: Project, scene: Scene, p: Placement): CursorLayer {
  const { width: W, height: H } = project.settings;
  const d = Math.min(p.duration, 2);
  return {
    ...base(project, scene, 'cursor', 'Cursor', p),
    type: 'cursor',
    x: 0,
    y: 0,
    anchor: { x: 0, y: 0 },
    scale: Math.max(1, H / 1080),
    color: '#ffffff',
    rippleColor: '#4f7cff',
    smoothing: 0.6,
    points: [
      { id: uid('pt'), x: W * 0.25, y: H * 0.7, time: 0 },
      { id: uid('pt'), x: W * 0.55, y: H * 0.4, time: d * 0.6 },
      { id: uid('pt'), x: W * 0.7, y: H * 0.6, time: d },
    ],
    clicks: [{ id: uid('clk'), time: d * 0.6 }],
  };
}

export function cloneWithNewIds<L extends Layer>(layer: L): L {
  const c: any = JSON.parse(JSON.stringify(layer));
  c.id = uid('layer');
  if (c.type === 'cursor') {
    c.points.forEach((p: any) => (p.id = uid('pt')));
    c.clicks.forEach((p: any) => (p.id = uid('clk')));
  }
  return c;
}
