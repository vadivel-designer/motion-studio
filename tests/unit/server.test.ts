import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../../src/shared/factory';
import { ProjectStore } from '../../server/projects';
import { checkFfmpeg, FFMPEG_INSTALL_HELP, renderToMp4, RenderError } from '../../server/render';

let dir: string, store: ProjectStore;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-test-')); store = new ProjectStore(dir); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('project store', () => {
  it('copies assets byte-for-byte and records the sha-256', async () => {
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31) % 256));
    const r = await store.saveAsset('Demo', 'asset_1', 'my pic (1).png', bytes);
    expect(fs.readFileSync(path.join(dir, 'Demo.motion', r.relativePath)).equals(bytes)).toBe(true);
    expect(r.hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(r.relativePath).toBe('assets/asset_1-my_pic__1_.png');
  });
  it('writes valid projects atomically, lists only saved ones, rejects invalid data', async () => {
    await store.saveAsset('Ghost', 'a1', 'x.png', Buffer.from('x')); // folder without project.json
    await store.write('Real', createEmptyProject('Real'));
    expect((await store.list()).map((p) => p.name)).toEqual(['Real']);
    expect((await store.read('Real')).name).toBe('Real');
    await expect(store.write('Bad', { version: 1 })).rejects.toThrow(/Invalid/);
    expect(await store.nextName('Real')).toBe('Real 2');
    expect(await store.nextName('Ghost')).toBe('Ghost');
  });
  it('rejects path traversal in names', () => {
    expect(() => store.folder('../evil')).toThrow();
    expect(() => store.folder('a/b')).toThrow();
  });
  it('zip export → import roundtrip keeps project.json and asset bytes', async () => {
    const p = createEmptyProject('Zipme');
    const bytes = Buffer.from('hello-asset');
    const a = await store.saveAsset('Zipme', 'as1', 'a.png', bytes);
    p.assets.push({ id: 'as1', originalName: 'a.png', relativePath: a.relativePath, type: 'image', hash: a.hash });
    await store.write('Zipme', p);
    const zip = await store.zip('Zipme');
    const name = await store.importZip(zip);
    expect(name).toBe('Zipme 2');
    const imported = await store.read(name);
    expect(imported.assets).toEqual(p.assets);
    expect(fs.readFileSync(path.join(dir, `${name}.motion`, a.relativePath)).equals(bytes)).toBe(true);
  });
  it('never writes outside the projects folder, even for hostile entry names', async () => {
    const z = new JSZip();
    z.file('project.json', JSON.stringify(createEmptyProject('X')));
    z.file('assets/../../../../evil.txt', 'boom');
    z.file('assets/ok.png', 'fine');
    // (JSZip itself normalises "..", so also exercise the guard directly via a patched name)
    (z.files as any)['assets/..\\..\\evil2.txt'] = Object.assign(z.file('tmp', 'x')!.files['tmp'], { name: 'assets/..\\..\\evil2.txt' });
    const buf = await z.generateAsync({ type: 'nodebuffer' });
    let name: string | undefined;
    try { name = await store.importZip(buf); } catch (e) { expect(String(e)).toMatch(/Unsafe path/); }
    const parent = path.dirname(dir);
    expect(fs.existsSync(path.join(parent, 'evil.txt'))).toBe(false);
    expect(fs.existsSync(path.join(parent, 'evil2.txt'))).toBe(false);
    if (name) expect(fs.existsSync(path.join(dir, `${name}.motion`, 'assets', 'ok.png'))).toBe(true);
  });
  it('refuses zips without project.json', async () => {
    const z = new JSZip();
    z.file('readme.txt', 'x');
    await expect(store.importZip(await z.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/project.json/);
  });
});

describe('ffmpeg handling', () => {
  it('reports a missing ffmpeg and gives install instructions', async () => {
    expect(checkFfmpeg('definitely-not-ffmpeg-xyz').found).toBe(false);
    await expect(renderToMp4({ pageUrl: 'http://localhost:1/x', outPath: path.join(dir, 'o.mp4'), ffmpegPath: 'definitely-not-ffmpeg-xyz' }))
      .rejects.toMatchObject({ code: 'FFMPEG_NOT_FOUND', message: FFMPEG_INSTALL_HELP });
    expect(FFMPEG_INSTALL_HELP).toMatch(/winget install/);
  });
  it('finds the real ffmpeg when present', () => {
    expect(checkFfmpeg().found).toBe(true);
  });
  it('RenderError carries a code', () => {
    expect(new RenderError('x', 'CANCELLED').code).toBe('CANCELLED');
  });
});
