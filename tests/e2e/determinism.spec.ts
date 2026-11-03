import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { createEmptyProject, makeShape, makeText } from '../../src/shared/factory';
import { applySettingsPatch } from '../../src/shared/settings';
import { produce } from 'immer';
import type { Project } from '../../src/shared/schema';

function project(name: string): Project {
  const p = createEmptyProject(name); // 3840x2160 default
  p.settings.durationSec = 4;
  const sc = p.scenes[0];
  sc.duration = 4;
  const t = makeText(p, sc, { start: 0, duration: 4 });
  t.content = 'Crisp at 4K\nSecond line';
  t.keyframes.x = [{ time: 0, value: 1000, easing: { type: 'ease-in-out' } }, { time: 3, value: 2800, easing: { type: 'linear' } }];
  t.keyframes.rotation = [{ time: 0, value: 0, easing: { type: 'spring', stiffness: 120, damping: 9, mass: 1 } }, { time: 3, value: 20, easing: { type: 'linear' } }];
  const r = makeShape(p, sc, { start: 0, duration: 4 }, 'ellipse');
  r.keyframes.opacity = [{ time: 0, value: 0.2, easing: { type: 'cubic-bezier', x1: 0.2, y1: -0.4, x2: 0.6, y2: 1.4 } }, { time: 2, value: 1, easing: { type: 'linear' } }];
  sc.layers.push(r, t);
  return p;
}

async function install(page: Page, p: Project) {
  const res = await page.request.put(`/api/projects/${encodeURIComponent(p.name)}`, { data: p });
  expect(res.ok()).toBeTruthy();
}
async function open(page: Page, name: string) {
  await page.goto(`/render.html?src=${encodeURIComponent(`/api/projects/${name}/files`)}`);
  await page.waitForFunction(() => (window as any).__motionReady || (window as any).__motionError);
  expect(await page.evaluate(() => (window as any).__motionError)).toBeFalsy();
}
const frame = (page: Page, t: number): Promise<string> => page.evaluate((x) => (window as any).__motion.renderAt(x), t);

test('renderFrame is deterministic: same t twice (and in any order) gives identical pixels', async ({ page, browser }) => {
  await install(page, project('e2e-det'));
  await open(page, 'e2e-det');
  const a = await frame(page, 1.2);
  const b = await frame(page, 1.2);
  expect(a === b).toBe(true);
  // order independence: seek around, come back
  await frame(page, 3.1); await frame(page, 0); await frame(page, 2.5);
  expect((await frame(page, 1.2)) === a).toBe(true);
  // different times differ
  expect((await frame(page, 2.4)) === a).toBe(false);
  // a completely fresh browser page produces the same pixels
  const other = await browser.newPage();
  await open(other, 'e2e-det');
  expect((await frame(other, 1.2)) === a).toBe(true);
  await other.close();
});

test('4K frames are rendered natively at 3840×2160 and match a native 1080p render when downsampled', async ({ page }) => {
  const p4 = project('e2e-4k');
  const p1 = produce(project('e2e-1080'), (d) => applySettingsPatch(d, { short: 1080 }));
  await install(page, p4);
  await install(page, p1);
  await open(page, 'e2e-4k');
  const big = PNG.sync.read(Buffer.from(await frame(page, 1.5), 'base64'));
  await open(page, 'e2e-1080');
  const small = PNG.sync.read(Buffer.from(await frame(page, 1.5), 'base64'));
  expect([big.width, big.height]).toEqual([3840, 2160]);
  expect([small.width, small.height]).toEqual([1920, 1080]);
  let sum = 0;
  for (let y = 0; y < 1080; y++) for (let x = 0; x < 1920; x++) {
    for (let c = 0; c < 3; c++) {
      const avg = (big.data[((2 * y) * 3840 + 2 * x) * 4 + c] + big.data[((2 * y) * 3840 + 2 * x + 1) * 4 + c] + big.data[((2 * y + 1) * 3840 + 2 * x) * 4 + c] + big.data[((2 * y + 1) * 3840 + 2 * x + 1) * 4 + c]) / 4;
      sum += Math.abs(avg - small.data[(y * 1920 + x) * 4 + c]);
    }
  }
  const mean = sum / (1920 * 1080 * 3);
  console.log('4K↓ vs 1080p mean abs diff', mean.toFixed(3));
  expect(mean).toBeLessThan(2); // vector content re-rendered at target size, not a scaled bitmap
});
