import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

export const ffmpegBin = () => process.env.FFMPEG_PATH || 'ffmpeg';

export interface FfmpegStatus { found: boolean; version?: string; error?: string }

export function checkFfmpeg(bin = ffmpegBin()): FfmpegStatus {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return { found: false, error: r.error?.message ?? `exit code ${r.status}` };
  return { found: true, version: r.stdout.split('\n')[0] };
}

export const FFMPEG_INSTALL_HELP =
  'ffmpeg was not found in PATH. Install it (Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Linux: `sudo apt install ffmpeg`), ' +
  'open a new terminal so PATH refreshes, then try again.';

export class RenderError extends Error {
  constructor(message: string, public code: 'FFMPEG_NOT_FOUND' | 'RENDER_FAILED' | 'CANCELLED' = 'RENDER_FAILED') { super(message); }
}

export interface RenderOptions {
  /** URL of the render page, e.g. http://localhost:5173/render.html?src=/render-src */
  pageUrl: string;
  outPath: string;
  signal?: AbortSignal;
  onProgress?: (frame: number, total: number) => void;
  ffmpegPath?: string;
}

/**
 * Export pipeline: headless Chromium (render-only page, no editor UI) → renderAt(t) for every frame
 * → PNG frames piped (lossless) into ffmpeg → libx264 / yuv420p / CRF 16 / +faststart.
 */
export async function renderToMp4(o: RenderOptions): Promise<{ frames: number }> {
  const bin = o.ffmpegPath ?? ffmpegBin();
  const st = checkFfmpeg(bin);
  if (!st.found) throw new RenderError(FFMPEG_INSTALL_HELP, 'FFMPEG_NOT_FOUND');

  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  const browser = await chromium.launch({ args: ['--force-color-profile=srgb', ...(root ? ['--no-sandbox'] : [])] });
  let ff: ReturnType<typeof spawn> | null = null;
  let ffErr = '';
  const cleanup = async () => {
    try { ff?.stdin?.destroy(); ff?.kill('SIGKILL'); } catch { /* ignore */ }
    await browser.close().catch(() => {});
  };
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 }, deviceScaleFactor: 1 });
    await page.goto(o.pageUrl);
    await page.waitForFunction(() => (window as any).__motionReady || (window as any).__motionError, undefined, { timeout: 120_000 });
    const err = await page.evaluate(() => (window as any).__motionError as string | undefined);
    if (err) throw new RenderError(err);
    const info = await page.evaluate(() => {
      const m = (window as any).__motion;
      return { width: m.width as number, height: m.height as number, fps: m.fps as number, frameCount: m.frameCount as number };
    });

    const odd = info.width % 2 || info.height % 2;
    const args = [
      '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(info.fps), '-c:v', 'png', '-i', '-',
      ...(odd ? ['-vf', 'crop=trunc(iw/2)*2:trunc(ih/2)*2'] : []),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      o.outPath,
    ];
    ff = spawn(bin, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    ff.stderr!.on('data', (d) => { ffErr += d.toString(); });
    const exited = new Promise<number>((res) => ff!.on('close', (c) => res(c ?? -1)));
    let ffDead = false;
    ff.on('error', (e) => { ffErr += String(e); ffDead = true; });
    ff.stdin!.on('error', () => { ffDead = true; });

    for (let i = 0; i < info.frameCount; i++) {
      if (o.signal?.aborted) throw new RenderError('Export cancelled', 'CANCELLED');
      if (ffDead) break;
      const b64: string = await page.evaluate((t) => (window as any).__motion.renderAt(t), i / info.fps);
      const ok = ff.stdin!.write(Buffer.from(b64, 'base64'));
      if (!ok) await new Promise<void>((res) => { ff!.stdin!.once('drain', () => res()); ff!.stdin!.once('close', () => res()); });
      o.onProgress?.(i + 1, info.frameCount);
    }
    ff.stdin!.end();
    const code = await exited;
    if (o.signal?.aborted) throw new RenderError('Export cancelled', 'CANCELLED');
    if (code !== 0) throw new RenderError(`ffmpeg failed (exit ${code}): ${ffErr.trim().slice(-600)}`);
    return { frames: info.frameCount };
  } catch (e) {
    await cleanup();
    fs.rmSync(o.outPath, { force: true });
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}
