import { parseProject } from '../shared/schema';
import type { Project } from '../shared/schema';

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(body.error || `Request failed (${res.status})`);
    err.code = body.code;
    err.cliCommand = body.cliCommand;
    throw err;
  }
  return body as T;
}

const enc = encodeURIComponent;

export const api = {
  health: () => fetch('/api/health').then((r) => json<{ ffmpeg: { found: boolean; version?: string }; projectsDir: string }>(r)),
  list: () => fetch('/api/projects').then((r) => json<{ name: string; modified: number }[]>(r)),
  nextName: (base = 'Untitled') => fetch(`/api/projects-next-name?base=${enc(base)}`).then((r) => json<{ name: string }>(r)).then((r) => r.name),
  async open(name: string): Promise<{ project: Project; folder: string }> {
    const r = await json<{ project: unknown; folder: string }>(await fetch(`/api/projects/${enc(name)}`));
    return { project: parseProject(r.project), folder: r.folder };
  },
  save: (name: string, project: Project) =>
    fetch(`/api/projects/${enc(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(project) })
      .then((r) => json<{ folder: string }>(r)),
  rename: (from: string, to: string) =>
    fetch(`/api/projects/${enc(from)}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) }).then((r) => json(r)),
  uploadAsset: (name: string, id: string, file: File | Blob, fileName: string) =>
    fetch(`/api/projects/${enc(name)}/assets`, {
      method: 'POST',
      headers: { 'x-asset-id': id, 'x-file-name': enc(fileName), 'Content-Type': 'application/octet-stream' },
      body: file,
    }).then((r) => json<{ relativePath: string; hash: string }>(r)),
  importZip: (file: File) => fetch('/api/import-zip', { method: 'POST', body: file }).then((r) => json<{ name: string }>(r)),
  startExport: (name: string) =>
    fetch('/api/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      .then((r) => json<{ jobId: string; cliCommand: string }>(r)),
  exportStatus: (id: string) => fetch(`/api/export/${id}`).then((r) => json<{ status: 'running' | 'done' | 'error' | 'cancelled'; frame: number; total: number; error?: string }>(r)),
  cancelExport: (id: string) => fetch(`/api/export/${id}/cancel`, { method: 'POST' }),
  filesUrl: (name: string) => `/api/projects/${enc(name)}/files`,
  zipUrl: (name: string) => `/api/projects/${enc(name)}/zip`,
  downloadUrl: (id: string) => `/api/export/${id}/download`,
};
