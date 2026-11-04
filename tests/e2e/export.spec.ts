import { expect, test } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { createEmptyProject, makeImage, makeShape, makeText } from '../../src/shared/factory';
import type { Project } from '../../src/shared/schema';
import { FIXTURE, PROJECTS } from './helpers';

const ease = (type: any) => ({ type }) as any;

/** 3-second 1080p project exercising text, shape (spring + rotation), image (scale) and colour keyframes. */
async function buildProject(request: APIRequestContext, name: string, seconds = 3): Promise<Project> {
  const p = createEmptyProject(name);
  Object.assign(p.settings, { durationSec: seconds, width: 1920, height: 1080, fps: 30, background: '#1b2040' });
  const sc = p.scenes[0];
  sc.duration = seconds;
  const up = await request.post(`/api/projects/${name}/assets`, {
    headers: { 'x-asset-id': 'asset_fx', 'x-file-name': 'fixture.png', 'Content-Type': 'application/octet-stream' },
    data: fs.readFileSync(FIXTURE),
  });
  const { relativePath, hash } = await up.json();
  p.assets.push({ id: 'asset_fx', originalName: 'fixture.png', relativePath, type: 'image', hash, width: 320, height: 200 });

  const full = { start: 0, duration: seconds };
  const img = makeImage(p, sc, full, p.assets[0]);
  img.x = 500; img.y = 700;
  img.keyframes.scale = [{ time: 0, value: 0.6, easing: ease('ease-out') }, { time: seconds, value: 1.2, easing: ease('linear') }];
  const text = makeText(p, sc, full);
  text.content = 'Motion\nStudio';
  text.x = 1300; text.y = 400;
  text.keyframes.x = [{ time: 0, value: 1000, easing: ease('ease-in-out') }, { time: 1.5, value: 1500, easing: ease('linear') }];
  text.keyframes.color = [{ time: 0, value: '#ffffff', easing: ease('linear') }, { time: seconds, value: '#ffcc00', easing: ease('linear') }];
  const rect = makeShape(p, sc, { start: 0.5, duration: seconds - 0.5 }, 'rect');
  rect.x = 1300; rect.y = 800; rect.width = 300; rect.height = 160;
  rect.keyframes.rotation = [
    { time: 0, value: 0, easing: { type: 'spring', stiffness: 170, damping: 12, mass: 1 } },
    { time: 2, value: 45, easing: ease('linear') },
  ];
  rect.keyframes.opacity = [{ time: 0, value: 0, easing: ease('linear') }, { time: 1, value: 1, easing: ease('linear') }];
  sc.layers.push(img, text, rect);
  const put = await request.put(`/api/projects/${name}`, { data: p });
  expect(put.ok()).toBeTruthy();
  return p;
}

function frameFromMp4(mp4: string, n: number, out: string) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', mp4, '-vf', `select=eq(n\\,${n})`, '-vsync', '0', '-frames:v', '1', out]);
  return PNG.sync.read(fs.readFileSync(out));
}

async function referenceFrame(page: Page, name: string, frame: number, fps = 30) {
  await page.goto(`/render.html?src=${encodeURIComponent(`/api/projects/${name}/files`)}`);
  await page.waitForFunction(() => (window as any).__motionReady || (window as any).__motionError);
  expect(await page.evaluate(() => (window as any).__motionError)).toBeFalsy();
  const b64: string = await page.evaluate((t) => (window as any).__motion.renderAt(t), frame / fps);
  return PNG.sync.read(Buffer.from(b64, 'base64'));
}

function diff(a: PNG, b: PNG) {
  expect([a.width, a.height]).toEqual([b.width, b.height]);
  let sum = 0, bad = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const d = [0, 1, 2].map((c) => Math.abs(a.data[i * 4 + c] - b.data[i * 4 + c]));
    sum += d[0] + d[1] + d[2];
    if (Math.max(...d) > 48) bad++;
  }
  return { mean: sum / (n * 3), badFraction: bad / n };
}

function probe(file: string) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height,pix_fmt,nb_frames,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(out).streams[0];
}

test.describe.configure({ mode: 'serial' });

test('Export MP4 from the UI: first / middle / last frame match renderFrame output', async ({ page, browser }) => {
  const NAME = 'e2e-export';
  await buildProject(page.request, NAME);

  await page.goto('/');
  await page.waitForSelector('[data-testid=stage]');
  await page.getByTestId('open-project').click();
  await page.getByTestId('project-item').filter({ hasText: NAME }).click();
  await page.waitForFunction((n) => (window as any).__editor.getProject().name === n, NAME);
  await page.getByTestId('export-mp4').click();
  await expect(page.getByTestId('export-dialog')).toBeVisible();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 150_000 });
  await expect(page.getByTestId('export-download')).toHaveAttribute('href', /\/api\/export\/.+\/download/);

  const mp4 = path.join(PROJECTS, `${NAME}.motion`, 'exports', `${NAME}.mp4`);
  expect(fs.existsSync(mp4)).toBe(true);
  const info = probe(mp4);
  expect(info).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p', r_frame_rate: '30/1' });
  expect(Number(info.nb_frames)).toBe(90);
  // +faststart: the moov atom comes before the media data
  const head = fs.readFileSync(mp4).subarray(0, 4096).toString('latin1');
  expect(head.indexOf('moov')).toBeGreaterThan(-1);
  expect(head.indexOf('moov')).toBeLessThan(head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat'));

  const tmp = fs.mkdtempSync(path.join(PROJECTS, 'frames-'));
  const refPage = await browser.newPage();
  for (const f of [0, 45, 89]) {
    const decoded = frameFromMp4(mp4, f, path.join(tmp, `f${f}.png`));
    const ref = await referenceFrame(refPage, NAME, f);
    const d = diff(decoded, ref);
    console.log(`frame ${f}: mean abs diff ${d.mean.toFixed(3)}, pixels off by >48: ${(d.badFraction * 100).toFixed(3)}%`);
    expect(d.mean).toBeLessThan(2.5);
    expect(d.badFraction).toBeLessThan(0.01);
    // sanity: the frames really differ over time (animation is exported, not a static frame)
    if (f === 45) {
      const first = frameFromMp4(mp4, 0, path.join(tmp, 'again0.png'));
      expect(diff(decoded, first).mean).toBeGreaterThan(0.2);
    }
  }
  await refPage.close();
});

test('CLI: npm run render -- <projectFolder> <out.mp4> produces the same video', async () => {
  const NAME = 'e2e-export';
  const out = path.join(PROJECTS, 'cli-out.mp4');
  const folder = path.join(PROJECTS, `${NAME}.motion`);
  execFileSync('npx', ['tsx', 'server/cli.ts', folder, out], { encoding: 'utf8', timeout: 170_000 });
  expect(probe(out)).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
  const a = frameFromMp4(out, 60, path.join(PROJECTS, 'cli-60.png'));
  const b = frameFromMp4(path.join(folder, 'exports', `${NAME}.mp4`), 60, path.join(PROJECTS, 'ui-60.png'));
  expect(diff(a, b).mean).toBeLessThan(0.5); // same pipeline → near-identical encodes
});

test('CLI fails clearly on a bad folder', () => {
  let msg = '';
  try { execFileSync('npx', ['tsx', 'server/cli.ts', path.join(PROJECTS, 'nope.motion'), path.join(PROJECTS, 'x.mp4')], { encoding: 'utf8', stdio: 'pipe' }); }
  catch (e: any) { msg = String(e.stderr); }
  expect(msg).toMatch(/No project\.json/);
});

test('export can be cancelled; partial file is removed', async ({ request }) => {
  const NAME = 'e2e-cancel';
  await buildProject(request, NAME, 20);
  const start = await request.post('/api/export', { data: { name: NAME } });
  expect(start.ok()).toBeTruthy();
  const { jobId, cliCommand } = await start.json();
  expect(cliCommand).toContain('npm run render --');
  await expect.poll(async () => (await (await request.get(`/api/export/${jobId}`)).json()).frame, { timeout: 60_000 }).toBeGreaterThan(2);
  await request.post(`/api/export/${jobId}/cancel`);
  await expect.poll(async () => (await (await request.get(`/api/export/${jobId}`)).json()).status, { timeout: 30_000 }).toBe('cancelled');
  expect(fs.existsSync(path.join(PROJECTS, `${NAME}.motion`, 'exports', `${NAME}.mp4`))).toBe(false);
});

test('missing ffmpeg: clear error with install step and the exact CLI command', async ({ browser }) => {
  const dir = fs.mkdtempSync(path.join(PROJECTS, 'noffmpeg-'));
  const srv = spawn('npx', ['tsx', 'server/index.ts'], { env: { ...process.env, PORT: '5198', MOTION_PROJECTS_DIR: dir, FFMPEG_PATH: 'ffmpeg-does-not-exist' }, stdio: 'pipe' });
  try {
    await expect.poll(async () => { try { return (await fetch('http://localhost:5198/api/health')).ok; } catch { return false; } }, { timeout: 30_000 }).toBe(true);
    const ctx = await browser.newContext({ baseURL: 'http://localhost:5198' });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.waitForSelector('[data-testid=stage]');
    await page.getByTestId('export-mp4').click();
    const missing = page.getByTestId('ffmpeg-missing');
    await expect(missing).toBeVisible();
    await expect(missing).toContainText('winget install');
    await expect(missing).toContainText('npm run render --');
    await page.getByTestId('export-start').click();
    const err = page.getByTestId('export-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('ffmpeg was not found');
    await expect(err).toContainText('npm run render --');
    await ctx.close();
  } finally {
    srv.kill('SIGKILL');
  }
});
