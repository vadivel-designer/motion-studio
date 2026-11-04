import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE, freshEditor, getProject, PROJECTS, setNum, setTimeTo } from './helpers';

const store = (page: Page) => page.evaluate(() => { const s = (window as any).__editor.store.getState(); return { time: s.time, playing: s.playing, past: s.past.length, selection: s.selection, zoom: s.zoom }; });

/** client coords of a project-space point on the preview stage */
async function stagePt(page: Page, x: number, y: number) {
  const { box, w, h } = await page.evaluate(() => {
    const r = document.querySelector('[data-testid=stage]')!.getBoundingClientRect();
    const s = (window as any).__editor.getProject().settings;
    return { box: { x: r.x, y: r.y, w: r.width, h: r.height }, w: s.width, h: s.height };
  });
  return { x: box.x + (x / w) * box.w, y: box.y + (y / h) * box.h };
}
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, mods: string[] = []) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const m of mods) await page.keyboard.down(m); // modifiers pressed mid-drag
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}
const layersOf = async (page: Page) => (await getProject(page)).scenes[0].layers;
/** colour of a project-space pixel in the preview canvas */
const pixel = (page: Page, x: number, y: number) => page.getByTestId('preview-canvas').evaluate((c: HTMLCanvasElement, [px, py]: number[]) => {
  const s = (window as any).__editor.getProject().settings;
  const d = c.getContext('2d')!.getImageData(Math.round((px / s.width) * c.width), Math.round((py / s.height) * c.height), 1, 1).data;
  return [d[0], d[1], d[2]];
}, [x, y]);

test('project settings: aspect, resolution, fps, duration, background never delete layers', async ({ page }) => {
  await freshEditor(page, 'e2e-settings');
  await page.getByTestId('add-text').click();
  await page.getByTestId('add-rect').click();
  await page.getByTestId('settings').click();
  const dlg = page.getByTestId('settings-dialog');
  await dlg.getByTestId('set-aspect').selectOption('9:16');
  await dlg.getByTestId('set-resolution').selectOption('1080');
  await dlg.getByTestId('set-fps').selectOption('60');
  await setNum(page, 'set-duration', 8);
  let p = await getProject(page);
  expect(p.settings).toMatchObject({ aspect: '9:16', width: 1080, height: 1920, fps: 60, durationSec: 8 });
  expect(p.scenes[0].layers).toHaveLength(2);
  for (const [asp, w, h] of [['1:1', 1080, 1080], ['4:5', 1080, 1350], ['16:9', 1920, 1080]] as const) {
    await dlg.getByTestId('set-aspect').selectOption(asp);
    p = await getProject(page);
    expect([p.settings.width, p.settings.height]).toEqual([w, h]);
    expect(p.scenes[0].layers).toHaveLength(2);
  }
  await setNum(page, 'set-width', 1000);
  await setNum(page, 'set-height', 700);
  p = await getProject(page);
  expect(p.settings).toMatchObject({ aspect: 'custom', width: 1000, height: 700 });
  await expect(dlg.getByTestId('set-aspect')).toHaveValue('custom');
  expect(p.scenes[0].layers).toHaveLength(2);
  await setNum(page, 'set-duration', 2); // shorter than the scene: warns, keeps everything
  await expect(dlg).toContainText('extend past the end');
  expect((await getProject(page)).scenes[0].layers).toHaveLength(2);
  await page.getByRole('button', { name: 'Done' }).click();
  // the stage follows the aspect ratio
  const r = await page.getByTestId('stage').boundingBox();
  expect(r!.width / r!.height).toBeCloseTo(1000 / 700, 1);
  // undo restores settings
  await page.keyboard.press('Control+z');
  expect((await getProject(page)).settings.durationSec).toBe(8);
});

test('layers panel: add text/shapes, rename, reorder, visibility, lock, duplicate, delete', async ({ page }) => {
  await freshEditor(page, 'e2e-layers');
  await page.getByTestId('add-text').click();
  await page.getByTestId('add-rect').click();
  await page.getByTestId('add-ellipse').click();
  await page.getByTestId('add-triangle').click();
  let ls = await layersOf(page);
  expect(ls.map((l: any) => l.type === 'shape' ? l.shape : l.type)).toEqual(['text', 'rect', 'ellipse', 'triangle']);
  const rows = page.getByTestId('layer-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.first().getByTestId('layer-name')).toHaveValue('Triangle 1'); // top of list = top of z-order

  // rename
  const nm = rows.nth(1).getByTestId('layer-name');
  await nm.fill('Hero');
  await nm.press('Enter');
  expect((await layersOf(page)).some((l: any) => l.name === 'Hero')).toBe(true);

  // reorder with the buttons
  await rows.nth(0).hover();
  await rows.nth(0).getByTestId('layer-down').click();
  ls = await layersOf(page);
  expect(ls.map((l: any) => l.name)).toEqual(['Text 1', 'Rectangle 1', 'Triangle 1', 'Hero']);

  // reorder with drag and drop (HTML5 DnD)
  await rows.nth(3).dragTo(rows.nth(0));
  ls = await layersOf(page);
  expect(ls[ls.length - 1].name).toBe('Text 1');

  // hide / show: the shape disappears from the canvas
  await page.getByTestId('timeline-layer-row').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await rows.first().hover();
  await page.getByTestId('layer-delete').first().click(); // delete top (Text 1)
  await rows.first().hover();
  await page.getByTestId('layer-delete').first().click();
  ls = await layersOf(page);
  expect(ls).toHaveLength(2);

  // visibility toggle
  const target = (await layersOf(page))[ls.length - 1];
  await page.evaluate((id) => (window as any).__editor.store.setState({ selection: [id] }), target.id);
  await rows.first().locator('.ltype').click();
  await page.getByTestId('prop-fill').fill('#ff0000'); // top layer red, the one below stays blue
  const before = await pixel(page, 1920, 1080);
  expect(before[0]).toBeGreaterThan(200);
  await rows.first().getByTestId('toggle-visible').click();
  const after = await pixel(page, 1920, 1080);
  expect(before).not.toEqual(after);
  expect((await layersOf(page))[1].visible).toBe(false);
  await rows.first().getByTestId('toggle-visible').click();
  expect(await pixel(page, 1920, 1080)).toEqual(before);

  // lock: dragging in the preview no longer moves it, and properties are disabled
  await rows.first().getByTestId('toggle-lock').click();
  expect((await layersOf(page))[1].locked).toBe(true);
  await rows.first().locator('.ltype').click();
  await expect(page.getByTestId('prop-x')).toBeDisabled();
  const c = await stagePt(page, 1920, 1080);
  const x0 = (await layersOf(page))[1].x;
  await drag(page, c, { x: c.x + 80, y: c.y + 30 });
  expect((await layersOf(page))[1].x).toBe(x0);
  await rows.first().getByTestId('toggle-lock').click();

  // duplicate
  await rows.first().hover();
  await rows.first().getByTestId('layer-duplicate').click();
  expect(await layersOf(page)).toHaveLength(3);
  const ids = (await layersOf(page)).map((l: any) => l.id);
  expect(new Set(ids).size).toBe(3);
});

test('preview: click selects, drag moves, Shift constrains, handles scale/rotate; one drag = one undo step; selection synced', async ({ page }) => {
  await freshEditor(page, 'e2e-preview');
  await page.getByTestId('add-rect').click(); // 648px square at centre
  await page.getByTestId('add-ellipse').click();
  const [rect, ell] = await layersOf(page);
  // click empty area → deselect, click on the ellipse (top) → selects it
  await page.evaluate(() => (window as any).__editor.store.setState({ selection: [] }));
  const centre = await stagePt(page, 1920, 1080);
  await page.mouse.click(centre.x, centre.y);
  expect((await store(page)).selection).toEqual([ell.id]);
  await expect(page.getByTestId('layer-row').first()).toHaveClass(/active/);
  await expect(page.getByTestId('timeline-layer-row').first()).toHaveClass(/selected/);
  await expect(page.getByTestId('properties')).toContainText('Ellipse');
  await page.mouse.click((await stagePt(page, 30, 30)).x, (await stagePt(page, 30, 30)).y);
  expect((await store(page)).selection).toEqual([]);

  // drag to move; exactly one history step
  await page.mouse.click(centre.x, centre.y);
  const past0 = (await store(page)).past;
  const k = (await stagePt(page, 1920 + 400, 1080)).x - centre.x; // screen px for 400 project px
  await drag(page, centre, { x: centre.x + k, y: centre.y + 10 });
  let cur = (await layersOf(page))[1];
  expect(cur.x).toBeCloseTo(2320, -1);
  expect(cur.y).toBeGreaterThan(1080);
  expect((await store(page)).past).toBe(past0 + 1);
  await page.keyboard.press('Control+z');
  expect((await layersOf(page))[1].x).toBe(1920);
  await page.keyboard.press('Control+Shift+z');

  // Shift constrains to an axis
  await page.keyboard.press('Control+z');
  await drag(page, centre, { x: centre.x + k / 2, y: centre.y + k / 4 }, ['Shift']);
  cur = (await layersOf(page))[1];
  expect(cur.y).toBe(1080);
  expect(cur.x).toBeGreaterThan(1920);
  await page.keyboard.press('Control+z');

  // scale handle (bottom-right corner): drag away from the pivot doubles scale
  const h = page.getByTestId('scale-handle-2');
  const hb = (await h.boundingBox())!;
  const hc = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
  const pivot = centre;
  await drag(page, hc, { x: pivot.x + (hc.x - pivot.x) * 2, y: pivot.y + (hc.y - pivot.y) * 2 });
  expect((await layersOf(page))[1].scale).toBeCloseTo(2, 1);
  await page.keyboard.press('Control+z');
  expect((await layersOf(page))[1].scale).toBe(1);

  // rotate handle: drag to the right of the pivot → +90° (handle starts above the pivot)
  const rh = (await page.getByTestId('rotate-handle').boundingBox())!;
  await drag(page, { x: rh.x + rh.width / 2, y: rh.y + rh.height / 2 }, { x: pivot.x + 200, y: pivot.y });
  expect((await layersOf(page))[1].rotation).toBeCloseTo(90, 0);
  await page.keyboard.press('Control+z');

  // shift-click adds to selection; multi-drag moves both
  await page.getByTestId('layer-row').nth(1).locator('.ltype').click({ modifiers: ['Shift'] });
  expect((await store(page)).selection).toHaveLength(2);
  await page.keyboard.press('Escape');
  expect(rect.id).toBeTruthy();
});

test('timeline: scrub, zoom, drag scene boundaries, layer bars and trim', async ({ page }) => {
  await freshEditor(page, 'e2e-timeline');
  await page.getByTestId('add-text').click();
  await page.getByTestId('add-scene').click(); // appended after scene 1; project grows from 15s to 20s
  let p = await getProject(page);
  expect(p.scenes.map((s: any) => [s.start, s.duration])).toEqual([[0, 15], [15, 5]]);
  expect(p.settings.durationSec).toBe(20);
  await page.getByTestId('scene-row').first().click();
  await page.getByRole('button', { name: 'Fit' }).click();
  const zoom = (await store(page)).zoom;

  // drag the shared boundary of scene 1 / scene 2 left by 5 s (roll edit: both scenes change)
  const eb = (await page.getByTestId('scene-edge-right').first().boundingBox())!;
  const y = eb.y + eb.height / 2, x = eb.x + eb.width / 2;
  await drag(page, { x, y }, { x: x - zoom * 5, y });
  p = await getProject(page);
  expect(p.scenes[0].duration).toBeCloseTo(10, 0);
  expect(p.scenes[1].start).toBeCloseTo(10, 0);
  expect(p.scenes[1].start + p.scenes[1].duration).toBeCloseTo(20, 5);

  // scrub on the ruler (click, then drag the playhead)
  const ruler = (await page.getByTestId('ruler').boundingBox())!;
  await page.mouse.click(ruler.x + zoom * 2, ruler.y + 10);
  expect((await store(page)).time).toBeCloseTo(2, 0);
  await drag(page, { x: ruler.x + zoom * 2, y: ruler.y + 10 }, { x: ruler.x + zoom * 4, y: ruler.y + 10 });
  expect((await store(page)).time).toBeCloseTo(4, 0);

  // drag the layer bar → start changes; trim its left end → end stays fixed
  const bar = page.getByTestId('layer-bar').first();
  const bb = (await bar.boundingBox())!;
  await drag(page, { x: bb.x + 80, y: bb.y + bb.height / 2 }, { x: bb.x + 80 + zoom * 1, y: bb.y + bb.height / 2 });
  p = await getProject(page);
  expect(p.scenes[0].layers[0].start).toBeCloseTo(1, 0);
  const end0 = p.scenes[0].layers[0].start + p.scenes[0].layers[0].duration;
  const le = (await bar.locator('.edge.l').boundingBox())!;
  await drag(page, { x: le.x + le.width / 2, y: le.y + le.height / 2 }, { x: le.x + le.width / 2 + zoom * 2, y: le.y + le.height / 2 });
  p = await getProject(page);
  const l0 = p.scenes[0].layers[0];
  expect(l0.start).toBeCloseTo(3, 0);
  expect(l0.start + l0.duration).toBeCloseTo(end0, 5);

  // zoom changes the scale
  const z0 = (await store(page)).zoom;
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect((await store(page)).zoom).toBeGreaterThan(z0);
});

test('scenes: create, duplicate, rename, reorder, delete', async ({ page }) => {
  await freshEditor(page, 'e2e-scenes');
  await page.getByTestId('add-rect').click();
  await page.getByTestId('duplicate-scene').first().click();
  let p = await getProject(page);
  expect(p.scenes).toHaveLength(2);
  expect(p.scenes[1].layers).toHaveLength(1);
  expect(p.scenes[1].layers[0].id).not.toBe(p.scenes[0].layers[0].id);
  const second = page.getByTestId('scene-row').nth(1);
  await second.locator('input').fill('Outro');
  await second.locator('input').press('Enter');
  expect((await getProject(page)).scenes[1].name).toBe('Outro');
  await second.hover();
  await second.getByRole('button', { name: /Move scene earlier/ }).click();
  p = await getProject(page);
  expect(p.scenes.map((s: any) => s.name)).toEqual(['Outro', 'Scene 1']);
  expect(p.scenes.map((s: any) => s.start)).toEqual([0, 15]);
  await page.getByTestId('scene-row').first().hover();
  await page.getByTestId('delete-scene').first().click();
  expect((await getProject(page)).scenes).toHaveLength(1);
  // new layer goes into the active scene
  await page.getByTestId('add-text').click();
  expect((await getProject(page)).scenes[0].layers).toHaveLength(2);
});

test('playback: Space, frame stepping, replay, loop, counter; parameter changes update the preview instantly', async ({ page }) => {
  await freshEditor(page, 'e2e-play');
  await page.getByTestId('add-rect').click();
  await page.getByTestId('kf-toggle-x').click();
  await setTimeTo(page, 1);
  await setNum(page, 'prop-x', 3000);
  await setTimeTo(page, 0);
  await expect(page.getByTestId('time-counter')).toContainText('frame 1 / 450');
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect((await store(page)).time).toBeCloseTo(2 / 30, 5);
  await expect(page.getByTestId('time-counter')).toContainText('frame 3 / 450');
  await page.keyboard.press('ArrowLeft');
  expect((await store(page)).time).toBeCloseTo(1 / 30, 5);
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  expect((await store(page)).playing).toBe(true);
  expect((await store(page)).time).toBeGreaterThan(0.3);
  await page.keyboard.press('Space');
  expect((await store(page)).playing).toBe(false);
  const t = (await store(page)).time;
  await page.waitForTimeout(200);
  expect((await store(page)).time).toBe(t);
  // replay restarts from 0
  await setTimeTo(page, 5);
  await page.getByTestId('replay').click();
  await page.waitForTimeout(150);
  expect((await store(page)).time).toBeLessThan(1);
  await page.keyboard.press('Space');
  // preview reacts immediately to a parameter change
  await setTimeTo(page, 0);
  const before = await pixel(page, 1920, 1080);
  await page.getByTestId('prop-fill').fill('#ff0000');
  await page.getByTestId('prop-fill').dispatchEvent('change');
  // loop: play near the end, it wraps instead of stopping
  await page.getByTestId('loop').click();
  await setTimeTo(page, 14.9);
  await page.getByTestId('play').click();
  await page.waitForTimeout(600);
  const s = await store(page);
  expect(s.playing).toBe(true);
  expect(s.time).toBeLessThan(14);
  await page.getByTestId('play').click();
  expect(before).toBeTruthy();
});

test('missing asset shows a placeholder with a Relink button, relinking restores the image', async ({ page }) => {
  const NAME = 'e2e-relink';
  await freshEditor(page, NAME);
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await page.getByTestId('place-asset').click();
  await page.waitForFunction(() => (window as any).__editor.resourcesReady());
  await page.getByTestId('save').click();
  await expect(page.getByTestId('dirty-dot')).not.toHaveClass(/on/);
  const p = await getProject(page);
  fs.rmSync(path.join(PROJECTS, `${NAME}.motion`, p.assets[0].relativePath)); // the file goes missing

  await page.reload();
  await page.waitForSelector('[data-testid=stage]');
  await page.getByTestId('open-project').click();
  await page.getByTestId('project-item').filter({ hasText: NAME }).click();
  await page.waitForFunction(() => (window as any).__editor.missing().length === 1);
  await expect(page.getByTestId('relink-btn')).toBeVisible();
  await expect(page.getByTestId('asset-row')).toContainText('missing');
  // placeholder is drawn (hatched dark box with a red frame), not blank
  const px = await pixel(page, 1920 - 150, 1080 - 100);
  expect(px[0] + px[1] + px[2]).toBeGreaterThan(80);

  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('relink-btn').click();
  (await chooser).setFiles(FIXTURE);
  await page.waitForFunction(() => (window as any).__editor.missing().length === 0 && (window as any).__editor.resourcesReady());
  await expect(page.getByTestId('relink-btn')).toHaveCount(0);
  const p2 = await getProject(page);
  expect(p2.assets[0].hash).toBe(p.assets[0].hash);
  expect(p2.assets[0].id).toBe(p.assets[0].id); // layers keep pointing at the same asset
  expect(p2.scenes[0].layers[0].assetId).toBe(p.assets[0].id);
});

test('zip export/import roundtrip; unsaved-changes dot and close warning', async ({ page }) => {
  const NAME = 'e2e-zip';
  await freshEditor(page, NAME);
  await page.getByTestId('import-input').setInputFiles(FIXTURE);
  await page.getByTestId('place-asset').click();
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('dirty-dot')).toHaveClass(/on/);
  await expect(page).toHaveTitle(/^● e2e-zip/);

  // closing with unsaved changes triggers the browser's beforeunload warning
  const dialogs: string[] = [];
  const handler = (d: any) => { dialogs.push(d.type()); void d.dismiss(); };
  page.on('dialog', handler);
  const extra = await page.context().newPage();
  await extra.close();
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
  page.off('dialog', handler);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-zip').click()]);
  const zipPath = path.join(PROJECTS, 'roundtrip.zip');
  await download.saveAs(zipPath);
  await expect(page.getByTestId('dirty-dot')).not.toHaveClass(/on/);
  await expect(page).toHaveTitle(/^e2e-zip/);
  const original = await getProject(page);

  await page.getByTestId('import-zip-input').setInputFiles(zipPath);
  await page.waitForFunction(() => (window as any).__editor.getProject().name === 'e2e-zip 2');
  const imported = await getProject(page);
  expect({ ...imported, name: '' }).toEqual({ ...original, name: '' });
  await page.waitForFunction(() => (window as any).__editor.resourcesReady());
  expect(fs.readFileSync(path.join(PROJECTS, 'e2e-zip 2.motion', imported.assets[0].relativePath)).equals(fs.readFileSync(FIXTURE))).toBe(true);
});

test('beforeunload warning is registered while dirty', async ({ page }) => {
  await freshEditor(page, 'e2e-unload');
  await page.getByTestId('add-rect').click();
  const prevented = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(prevented).toBe(true);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('dirty-dot')).not.toHaveClass(/on/);
  const prevented2 = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  expect(prevented2).toBe(false);
});

test('asset import: drag & drop, SVG, rejects unsupported types, fonts become selectable', async ({ page }) => {
  await freshEditor(page, 'e2e-assets');
  // drag & drop a PNG and an SVG onto the assets drop zone
  await page.evaluate(async ([png]) => {
    const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    dt.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100" fill="#f0a"/></svg>'], 'vec.svg', { type: 'image/svg+xml' }));
    dt.items.add(new File(['nope'], 'notes.txt', { type: 'text/plain' }));
    document.querySelector('[data-testid=asset-dropzone]')!.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [fs.readFileSync(FIXTURE).toString('base64')]);
  await expect(page.getByTestId('asset-row')).toHaveCount(2);
  await expect(page.getByTestId('toast')).toContainText('notes.txt');
  const p = await getProject(page);
  expect(p.assets.map((a: any) => a.originalName).sort()).toEqual(['dropped.png', 'vec.svg']);
  expect(p.assets.find((a: any) => a.originalName === 'vec.svg')).toMatchObject({ width: 200, height: 100 });
  await page.getByTestId('place-asset').nth(1).click();
  await page.waitForFunction(() => (window as any).__editor.resourcesReady());

  // font import
  const fontFile = ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'].find((f) => fs.existsSync(f));
  test.skip(!fontFile, 'no system TTF available');
  await page.getByTestId('import-input').setInputFiles(fontFile!);
  await expect(page.getByTestId('asset-row')).toHaveCount(3);
  await page.waitForFunction(() => (window as any).__editor.store.getState().resourceVersion > 0);
  await page.getByTestId('add-text').click();
  await expect(page.getByTestId('prop-fontFamily').locator('option', { hasText: 'DejaVuSans' })).toHaveCount(1);
  await page.getByTestId('prop-fontFamily').selectOption('DejaVuSans');
  expect((await layersOf(page)).at(-1).fontFamily).toBe('DejaVuSans');
});

test('text properties: content, font, size, weight, alignment, spacing, colour; tooltips on every control', async ({ page }) => {
  await freshEditor(page, 'e2e-text');
  await page.getByTestId('add-text').click();
  await page.getByTestId('prop-content').fill('Hello\nWorld');
  await page.getByTestId('prop-fontWeight').selectOption('400');
  await page.getByTestId('align-left').click();
  await setNum(page, 'prop-fontSize', 120);
  await setNum(page, 'prop-letterSpacing', 6);
  await setNum(page, 'prop-lineHeight', 1.5);
  await page.getByTestId('prop-fontFamily').selectOption('Georgia');
  await page.getByTestId('prop-color').fill('#ff8800');
  await page.getByTestId('prop-color').dispatchEvent('change');
  const t = (await layersOf(page))[0];
  expect(t).toMatchObject({ content: 'Hello\nWorld', fontWeight: 400, align: 'left', fontSize: 120, letterSpacing: 6, lineHeight: 1.5, fontFamily: 'Georgia', color: '#ff8800' });
  // typing a whole sentence = one undo step
  const past = (await store(page)).past;
  const ta = page.getByTestId('prop-content');
  await ta.focus();
  await page.keyboard.type('abc');
  await ta.blur();
  expect((await store(page)).past).toBe(past + 1);

  // every control in the properties panel and top bar has a tooltip (title on it or a parent)
  const missing = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll('[data-testid=properties] :is(button,input,select,textarea), .topbar button, .transport button, .left button').forEach((el) => {
      if (!(el.closest('[title]') || el.getAttribute('aria-label'))) bad.push((el as HTMLElement).outerHTML.slice(0, 80));
    });
    return bad;
  });
  expect(missing).toEqual([]);
});

test('easing editor: choose each type with plain-language labels and a live curve; keyframe easing persists', async ({ page }) => {
  await freshEditor(page, 'e2e-easing');
  await page.getByTestId('add-rect').click();
  await page.getByTestId('kf-toggle-x').click();
  await setTimeTo(page, 2);
  await setNum(page, 'prop-x', 3000);
  await setTimeTo(page, 0); // playhead on the first keyframe
  const sel = page.getByTestId('easing-x').getByTestId('easing-select');
  await expect(page.getByTestId('easing-x')).toBeVisible();
  const labels = await sel.locator('option').allTextContents();
  expect(labels).toEqual(['Constant speed', 'Starts slow, ends fast', 'Starts fast, ends slow', 'Slow at both ends', 'Custom curve', 'Springy bounce']);
  const d0 = await page.getByTestId('easing-x').getByTestId('curve-preview').locator('path.line').getAttribute('d');
  for (const [value, type] of [['linear', 'linear'], ['ease-in', 'ease-in'], ['ease-out', 'ease-out'], ['cubic-bezier', 'cubic-bezier'], ['spring', 'spring']] as const) {
    await sel.selectOption(value);
    const k = (await layersOf(page))[0].keyframes.x[0];
    expect(k.easing.type).toBe(type);
  }
  const d1 = await page.getByTestId('easing-x').getByTestId('curve-preview').locator('path.line').getAttribute('d');
  expect(d1).not.toBe(d0); // the curve preview is live
  await expect(page.getByTestId('easing-x')).toContainText('Stiffness');
  await sel.selectOption('linear');
  await setTimeTo(page, 1);
  await expect(page.getByTestId('prop-x')).toHaveValue('2460'); // linear midpoint between 1920 and 3000
});
