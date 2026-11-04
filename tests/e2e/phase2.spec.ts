import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { freshEditor, getProject, setNum, setTimeTo } from './helpers';

const layersOf = async (page: Page) => (await getProject(page)).scenes[0].layers;
const past = (page: Page) => page.evaluate(() => (window as any).__editor.store.getState().past.length);
async function stagePt(page: Page, x: number, y: number) {
  const { box, w, h } = await page.evaluate(() => {
    const r = document.querySelector('[data-testid=stage]')!.getBoundingClientRect();
    const s = (window as any).__editor.getProject().settings;
    return { box: { x: r.x, y: r.y, w: r.width, h: r.height }, w: s.width, h: s.height };
  });
  return { x: box.x + (x / w) * box.w, y: box.y + (y / h) * box.h };
}

test('animation presets: generate editable keyframes, re-apply replaces, undo reverts', async ({ page }) => {
  await freshEditor(page, 'e2e-presets');
  await page.getByTestId('add-rect').click();
  const rest = (await layersOf(page))[0];

  // slide in from the left, 400px, delay 0.5s, duration 1s
  await page.getByTestId('preset-kind').selectOption('slide');
  await page.getByTestId('preset-direction').selectOption('left');
  await setNum(page, 'preset-distance', 400);
  await setNum(page, 'preset-delay', 0.5);
  await setNum(page, 'preset-duration', 1);
  await page.getByTestId('preset-apply').click();
  let l = (await layersOf(page))[0];
  expect(l.keyframes.x.map((k: any) => [k.time, k.value])).toEqual([[0.5, rest.x - 400], [1.5, rest.x]]);
  expect(l.keyframes.x[0].preset).toBe('in:slide');

  // they are ordinary keyframes: visible in the timeline and the value follows them
  await expect(page.getByTestId('timeline-layer-row').getByTestId('kf-diamond')).toHaveCount(2);
  await setTimeTo(page, 0.5);
  await expect(page.getByTestId('prop-x')).toHaveValue(String(rest.x - 400));
  await setTimeTo(page, 2);
  await expect(page.getByTestId('prop-x')).toHaveValue(String(rest.x));

  // stack a fade in and a scale out, then re-apply the slide with other settings → replaced, others untouched
  await page.getByTestId('preset-kind').selectOption('fade');
  await page.getByTestId('preset-apply').click();
  await page.getByTestId('preset-kind').selectOption('scale');
  await page.getByTestId('preset-phase-out').click();
  await page.getByTestId('preset-apply').click();
  l = (await layersOf(page))[0];
  expect(Object.keys(l.keyframes).sort()).toEqual(['opacity', 'scale', 'x']);
  expect(l.keyframes.scale.map((k: any) => k.preset)).toEqual(['out:scale', 'out:scale']);
  expect(l.keyframes.scale[1].time).toBeCloseTo(l.duration - 0.5, 5); // delay 0.5s is still set

  await page.getByTestId('preset-kind').selectOption('slide');
  await page.getByTestId('preset-phase-in').click();
  await page.getByTestId('preset-direction').selectOption('down');
  await setNum(page, 'preset-delay', 0);
  await page.getByTestId('preset-apply').click();
  l = (await layersOf(page))[0];
  expect(l.keyframes.x).toBeUndefined(); // old left-slide gone
  expect(l.keyframes.y.map((k: any) => [k.time, k.value])).toEqual([[0, rest.y + 400], [1, rest.y]]);
  expect(l.keyframes.opacity).toHaveLength(2);

  // undo the last apply = exactly one step, restores the earlier keyframes
  const n = await past(page);
  await page.locator('body').click({ position: { x: 5, y: 500 } });
  await page.keyboard.press('Control+z');
  expect(await past(page)).toBe(n - 1);
  l = (await layersOf(page))[0];
  expect(l.keyframes.x).toHaveLength(2);
  expect(l.keyframes.y).toBeUndefined();

  // preset keyframes can be hand-edited (easing) and the layer renders them
  await setTimeTo(page, 0.5);
  await expect(page.getByTestId('easing-x')).toBeVisible();
});

test('stagger: forward / reverse / seeded random offset start times; undo reverts', async ({ page }) => {
  await freshEditor(page, 'e2e-stagger');
  for (let i = 0; i < 4; i++) await page.getByTestId('add-rect').click();
  await expect(page.getByTestId('stagger-apply')).toHaveCount(0); // needs a multi-selection
  const ids: string[] = (await layersOf(page)).map((l: any) => l.id);
  await page.evaluate((i) => (window as any).__editor.store.setState({ selection: i }), ids);
  await expect(page.getByTestId('stagger-apply')).toBeVisible();
  await setNum(page, 'stagger-interval', 0.25);
  await page.getByTestId('stagger-apply').click();
  expect((await layersOf(page)).map((l: any) => l.start)).toEqual([0, 0.25, 0.5, 0.75]);
  await page.getByTestId('stagger-order').selectOption('reverse');
  await page.getByTestId('stagger-apply').click();
  expect((await layersOf(page)).map((l: any) => l.start)).toEqual([0.75, 0.5, 0.25, 0]);
  await page.getByTestId('stagger-order').selectOption('random');
  await setNum(page, 'stagger-seed', 42);
  await page.getByTestId('stagger-apply').click();
  const a = (await layersOf(page)).map((l: any) => l.start);
  expect([...a].sort()).toEqual([0, 0.25, 0.5, 0.75]);
  await page.getByTestId('stagger-apply').click();
  expect((await layersOf(page)).map((l: any) => l.start)).toEqual(a); // same seed → same order
  await page.locator('body').click({ position: { x: 5, y: 500 } });
  await page.keyboard.press('Control+z'); // the repeated identical apply was a no-op (no history step), so this undoes the random apply
  expect((await layersOf(page)).map((l: any) => l.start)).toEqual([0.75, 0.5, 0.25, 0]);
});

test('cursor layer: draggable path points, editable click times, ripple, smoothing', async ({ page }) => {
  await freshEditor(page, 'e2e-cursor');
  await page.getByTestId('add-cursor').click();
  let c = (await layersOf(page))[0];
  expect(c.type).toBe('cursor');
  expect(c.points).toHaveLength(3);
  expect(c.clicks).toHaveLength(1);

  // path points show in the preview and can be dragged (one drag = one undo step)
  const pt = page.getByTestId('cursor-point-1');
  await expect(pt).toBeVisible();
  const bb = (await pt.boundingBox())!;
  const from = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  const n = await past(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 20, { steps: 5 });
  await page.mouse.move(from.x + 80, from.y + 40, { steps: 5 });
  await page.mouse.up();
  const after = (await layersOf(page))[0];
  const sorted = [...after.points].sort((x: any, y: any) => x.time - y.time);
  expect(sorted[1].x).toBeGreaterThan(c.points[1].x + 100);
  expect(sorted[1].y).toBeGreaterThan(c.points[1].y + 50);
  expect(await past(page)).toBe(n + 1);
  await page.keyboard.press('Control+z');
  expect((await layersOf(page))[0].points.find((p: any) => p.id === sorted[1].id).x).toBe(c.points[1].x);

  // numeric editing of point + click times
  const row = page.getByTestId('cursor-point-row').nth(2);
  await row.locator('input').nth(2).fill('1.8');
  await row.locator('input').nth(2).press('Enter');
  await page.getByTestId('cursor-click-row').first().locator('input').fill('0.9');
  await page.getByTestId('cursor-click-row').first().locator('input').press('Enter');
  c = (await layersOf(page))[0];
  expect(c.clicks[0].time).toBeCloseTo(0.9);
  expect(Math.max(...c.points.map((p: any) => p.time))).toBeCloseTo(1.8);

  // add / remove points and clicks
  await page.getByTestId('cursor-add-point').click();
  expect((await layersOf(page))[0].points).toHaveLength(4);
  await setTimeTo(page, 0.2);
  await page.getByTestId('cursor-add-click').click();
  expect((await layersOf(page))[0].clicks.map((k: any) => k.time).sort()).toEqual([0.2, 0.9]);
  await page.getByTestId('cursor-click-row').first().getByRole('button', { name: 'Remove click' }).click();
  expect((await layersOf(page))[0].clicks).toHaveLength(1);

  // smoothing
  await setNum(page, 'cursor-smoothing', 1);
  expect((await layersOf(page))[0].smoothing).toBe(1);

  // the ripple is drawn at the click time and gone well after it; the arrow moves along the path
  const canvasHash = (t: number) => page.evaluate(async (tt) => {
    (window as any).__editor.store.setState({ time: tt });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = document.querySelector('[data-testid=preview-canvas]') as HTMLCanvasElement;
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    let h = 0;
    for (let i = 0; i < d.length; i += 4 * 53) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
    return h;
  }, t);
  await page.getByTestId('cursor-click-row').first().locator('input').fill('1');
  await page.getByTestId('cursor-click-row').first().locator('input').press('Enter');
  const during = await canvasHash(1.1), later = await canvasHash(1.1 + 0.9);
  expect(during).not.toBe(later);
  // deselect: path overlay disappears but the cursor stays
  await page.evaluate(() => (window as any).__editor.store.setState({ selection: [] }));
  await expect(page.getByTestId('cursor-point-1')).toHaveCount(0);
});
