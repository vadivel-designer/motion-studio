/**
 * Render-only page: NO editor UI. Loaded by headless Chromium for export.
 * Exposes window.__motion.renderAt(t) -> base64 PNG of the frame at full project resolution.
 */
import { parseProject } from '../shared/schema';
import { renderFrame } from '../shared/render';
import { ResourceLoader } from '../shared/resources';

declare global {
  interface Window {
    __motionReady?: boolean;
    __motionError?: string;
    __motion?: {
      width: number;
      height: number;
      fps: number;
      frameCount: number;
      renderAt(t: number): string;
    };
  }
}

async function main() {
  const src = new URLSearchParams(location.search).get('src');
  if (!src) throw new Error('Missing ?src= parameter');
  const res = await fetch(`${src}/project.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Cannot read project.json (${res.status})`);
  const project = parseProject(await res.json());

  const loader = new ResourceLoader(src);
  await loader.sync(project);
  await document.fonts.ready;
  if (loader.missing.length) {
    const names = project.assets.filter((a) => loader.failed.has(a.id)).map((a) => a.originalName);
    throw new Error(`Missing asset files: ${names.join(', ')}. Relink them in the editor first.`);
  }

  const { width, height, fps, durationSec } = project.settings;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;

  window.__motion = {
    width,
    height,
    fps,
    frameCount: Math.max(1, Math.round(durationSec * fps)),
    renderAt(t: number) {
      renderFrame(project, t, ctx, 1, loader);
      return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
    },
  };
  window.__motionReady = true;
}

main().catch((e) => {
  window.__motionError = e instanceof Error ? e.message : String(e);
});
