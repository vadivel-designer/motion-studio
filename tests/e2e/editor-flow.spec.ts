import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE, freshEditor, getProject, PROJECTS, setNum, setTimeTo } from './helpers';

test('new project → import → place → keyframes → move keyframe → scrub → undo/redo → save → reload → open → identical', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const NAME = 'e2e-flow';
  await freshEditor(page, NAME);

  // starts empty: one empty scene, no layers, no assets
  let p = await getProject(page);
  expect(p.scenes).toHaveLength(1);
  expect(p.scenes[0].layers).toHaveLength(0);
  expect(p.assets).toHaveLength(0);

  // import the fixture image, place it
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await expect(page.getByTestId('asset-row')).toHaveCount(1);
  await page.getByTestId('place-asset').click();
  await expect(page.getByTestId('layer-row')).toHaveCount(1);
  await page.waitForFunction(() => (window as any).__editor.resourcesReady());
  p = await getProject(page);
  const layer0 = p.scenes[0].layers[0];
  expect(layer0.type).toBe('image');
  expect(p.assets[0].originalName).toBe('fixture.png');
  expect(p.assets[0].hash).toMatch(/^[0-9a-f]{64}$/);

  // keyframes at t=0 on x and opacity (toggle button)
  await page.getByTestId('kf-toggle-x').click();
  await page.getByTestId('kf-toggle-opacity').click();
  // at t=2s change both values → auto-keyframes
  await setTimeTo(page, 2);
  await setNum(page, 'prop-x', 500);
  await setNum(page, 'prop-opacity', 20);
  p = await getProject(page);
  const kfs = p.scenes[0].layers[0].keyframes;
  expect(kfs.x.map((k: any) => [k.time, k.value])).toEqual([[0, 1920], [2, 500]]);
  expect(kfs.opacity.map((k: any) => [k.time, k.value])).toEqual([[0, 1], [2, 0.2]]);

  // timeline shows two diamonds on the layer row; drag the second from 2s to 3s
  const row = page.getByTestId('timeline-layer-row');
  const diamonds = row.getByTestId('kf-diamond');
  await expect(diamonds).toHaveCount(2);
  const box = (await diamonds.nth(1).boundingBox())!;
  const zoom = await page.evaluate(() => (window as any).__editor.store.getState().zoom);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const pastBefore = await page.evaluate(() => (window as any).__editor.store.getState().past.length);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + zoom * 0.5, cy, { steps: 6 });
  await page.mouse.move(cx + zoom * 1, cy, { steps: 6 });
  await page.mouse.up();
  p = await getProject(page);
  const k2 = p.scenes[0].layers[0].keyframes;
  expect(k2.x.map((k: any) => k.time)).toEqual([0, 3]);
  expect(k2.opacity.map((k: any) => k.time)).toEqual([0, 3]);
  // the whole drag was ONE undo step
  expect(await page.evaluate(() => (window as any).__editor.store.getState().past.length)).toBe(pastBefore + 1);

  // scrub to the midpoint (1.5s): ease-in-out is symmetric, so values are the averages
  await setTimeTo(page, 1.5);
  await expect(page.getByTestId('prop-x')).toHaveValue('1210');
  await expect(page.getByTestId('prop-opacity')).toHaveValue('60');
  await page.waitForTimeout(150);
  const shot = await page.getByTestId('preview-canvas').screenshot({ path: path.join('test-results', 'midpoint.png') });
  expect(shot.length).toBeGreaterThan(2000);
  // the image is drawn (not the placeholder, not blank): canvas has non-background pixels
  const painted = await page.getByTestId('preview-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const bg = [d[0], d[1], d[2]];
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 37) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 30) n++;
    return n;
  });
  expect(painted).toBeGreaterThan(50);

  // edit at midpoint, undo (value reverts), redo
  await setNum(page, 'prop-x', 700);
  await expect(page.getByTestId('prop-x')).toHaveValue('700');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('prop-x')).toHaveValue('1210');
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId('prop-x')).toHaveValue('700');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('prop-x')).toHaveValue('1210');

  // save
  await expect(page.getByTestId('dirty-dot')).toHaveClass(/on/);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('dirty-dot')).not.toHaveClass(/on/);
  const beforeReload = await getProject(page);
  const onDisk = JSON.parse(fs.readFileSync(path.join(PROJECTS, `${NAME}.motion`, 'project.json'), 'utf8'));
  expect(onDisk).toEqual(beforeReload);

  // reload the app, open the project, deep-compare everything
  await page.reload();
  await page.waitForSelector('[data-testid=stage]');
  await page.getByTestId('open-project').click();
  await page.getByTestId('project-item').filter({ hasText: NAME }).click();
  await page.waitForFunction((n) => (window as any).__editor.getProject().name === n, NAME);
  const reopened = await getProject(page);
  expect(reopened).toEqual(onDisk);
  expect(reopened.settings).toEqual(beforeReload.settings);
  expect(reopened.scenes).toEqual(beforeReload.scenes);
  expect(reopened.assets).toEqual(beforeReload.assets);

  // assets load again, bytes on disk are identical to the original
  await page.waitForFunction(() => (window as any).__editor.resourcesReady());
  expect(await page.evaluate(() => (window as any).__editor.missing())).toEqual([]);
  const assetPath = path.join(PROJECTS, `${NAME}.motion`, reopened.assets[0].relativePath);
  expect(fs.readFileSync(assetPath).equals(fs.readFileSync(FIXTURE))).toBe(true);
  const served = await page.request.get(`/api/projects/${NAME}/files/${reopened.assets[0].relativePath}`);
  expect(served.status()).toBe(200);
  expect((await served.body()).equals(fs.readFileSync(FIXTURE))).toBe(true);
  expect(errors).toEqual([]);
});
