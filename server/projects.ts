import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { parseProject } from '../src/shared/schema';
import type { Project } from '../src/shared/schema';

export const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,59}$/;

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[^A-Za-z0-9 _.-]/g, '').replace(/^[ .-]+/, '').replace(/[ .]+$/, '').slice(0, 60);
  return s || 'Untitled';
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export class ProjectStore {
  constructor(public root: string) {}

  folder(name: string): string {
    if (!NAME_RE.test(name)) throw new HttpError(400, `Invalid project name "${name}"`);
    return path.join(this.root, `${name}.motion`);
  }

  async ensureRoot() { await fs.mkdir(this.root, { recursive: true }); }

  private async exists(p: string) {
    try { await fs.access(p); return true; } catch { return false; }
  }

  async list(): Promise<{ name: string; modified: number }[]> {
    await this.ensureRoot();
    const out: { name: string; modified: number }[] = [];
    for (const e of await fs.readdir(this.root, { withFileTypes: true })) {
      if (!e.isDirectory() || !e.name.endsWith('.motion')) continue;
      try {
        const st = await fs.stat(path.join(this.root, e.name, 'project.json'));
        out.push({ name: e.name.slice(0, -'.motion'.length), modified: st.mtimeMs });
      } catch { /* folder without project.json: not a saved project yet */ }
    }
    return out.sort((a, b) => b.modified - a.modified);
  }

  /** First free name: a folder that doesn't exist or has no project.json yet. */
  async nextName(base: string): Promise<string> {
    base = sanitizeName(base);
    for (let i = 1; i < 10000; i++) {
      const name = i === 1 ? base : `${base} ${i}`;
      if (!(await this.exists(path.join(this.folder(name), 'project.json')))) return name;
    }
    throw new HttpError(500, 'No free project name');
  }

  async read(name: string): Promise<Project> {
    const file = path.join(this.folder(name), 'project.json');
    let text: string;
    try { text = await fs.readFile(file, 'utf8'); }
    catch { throw new HttpError(404, `Project "${name}" not found`); }
    try { return parseProject(JSON.parse(text)); }
    catch (e) { throw new HttpError(422, e instanceof Error ? e.message : 'Invalid project.json'); }
  }

  async write(name: string, data: unknown): Promise<Project> {
    let project: Project;
    try { project = parseProject(data); }
    catch (e) { throw new HttpError(422, e instanceof Error ? e.message : 'Invalid project'); }
    project.name = name;
    const dir = this.folder(name);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    const tmp = path.join(dir, 'project.json.tmp');
    await fs.writeFile(tmp, JSON.stringify(project, null, 2));
    await fs.rename(tmp, path.join(dir, 'project.json'));
    return project;
  }

  async rename(from: string, to: string): Promise<void> {
    const a = this.folder(from), b = this.folder(to);
    if (from === to) return;
    if (await this.exists(path.join(b, 'project.json'))) throw new HttpError(409, `A project named "${to}" already exists`);
    if (await this.exists(b)) await fs.rm(b, { recursive: true, force: true });
    if (!(await this.exists(a))) return;
    await fs.rename(a, b);
    const pj = path.join(b, 'project.json');
    if (await this.exists(pj)) {
      const p = JSON.parse(await fs.readFile(pj, 'utf8'));
      p.name = to;
      await fs.writeFile(pj, JSON.stringify(p, null, 2));
    }
  }

  /** Copies the original bytes untouched into <project>.motion/assets. */
  async saveAsset(name: string, id: string, originalName: string, bytes: Buffer) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new HttpError(400, 'Invalid asset id');
    const safe = originalName.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file';
    const rel = `assets/${id}-${safe}`;
    const dir = path.join(this.folder(name), 'assets');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}-${safe}`), bytes);
    return { relativePath: rel, hash: createHash('sha256').update(bytes).digest('hex') };
  }

  async zip(name: string): Promise<Buffer> {
    const dir = this.folder(name);
    await this.read(name); // 404 / validation
    const zip = new JSZip();
    const root = zip.folder(`${name}.motion`)!;
    const walk = async (d: string, rel: string) => {
      for (const e of await fs.readdir(d, { withFileTypes: true })) {
        if (e.name === 'exports' || e.name.endsWith('.tmp')) continue;
        const full = path.join(d, e.name);
        if (e.isDirectory()) await walk(full, `${rel}${e.name}/`);
        else root.file(`${rel}${e.name}`, await fs.readFile(full), { binary: true });
      }
    };
    await walk(dir, '');
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  }

  /** Imports a project zip into a new, uniquely-named folder. Rejects path traversal. */
  async importZip(buf: Buffer, hintName?: string): Promise<string> {
    const zip = await JSZip.loadAsync(buf);
    const entries = Object.values(zip.files).filter((f) => !f.dir);
    const norm = (n: string) => n.replace(/\\/g, '/');
    for (const f of entries) {
      const n = norm(f.name);
      if (n.startsWith('/') || n.split('/').includes('..') || /^[A-Za-z]:/.test(n)) {
        throw new HttpError(400, `Unsafe path in zip: ${f.name}`);
      }
    }
    const pj = entries.find((f) => /(^|\/)project\.json$/.test(norm(f.name)));
    if (!pj) throw new HttpError(400, 'Zip does not contain project.json');
    const prefix = norm(pj.name).slice(0, -'project.json'.length);
    let project: Project;
    try { project = parseProject(JSON.parse(await pj.async('string'))); }
    catch (e) { throw new HttpError(422, e instanceof Error ? e.message : 'Invalid project.json'); }
    const name = await this.nextName(hintName || project.name);
    const dir = this.folder(name);
    await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
    for (const f of entries) {
      const n = norm(f.name);
      if (!n.startsWith(prefix)) continue;
      const rel = n.slice(prefix.length);
      if (rel !== 'project.json' && !rel.startsWith('assets/')) continue;
      const target = path.join(dir, rel);
      if (!target.startsWith(dir + path.sep)) throw new HttpError(400, `Unsafe path in zip: ${f.name}`);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, await f.async('nodebuffer'));
    }
    project.name = name;
    await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project, null, 2));
    return name;
  }
}
