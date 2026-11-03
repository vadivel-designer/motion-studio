import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer as createVite } from 'vite';
import { HttpError, ProjectStore } from './projects';
import { checkFfmpeg, FFMPEG_INSTALL_HELP, renderToMp4, RenderError } from './render';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export interface ServerOptions {
  port: number;
  projectsDir: string;
  /** CLI mode: also serve one arbitrary project folder at /render-src */
  renderSrc?: string;
  quiet?: boolean;
}

interface Job {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  frame: number;
  total: number;
  error?: string;
  code?: string;
  outPath: string;
  controller: AbortController;
}

const h = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

export async function startServer(opts: ServerOptions) {
  const store = new ProjectStore(opts.projectsDir);
  await store.ensureRoot();
  const app: Express = express();
  const jobs = new Map<string, Job>();
  const raw = express.raw({ type: () => true, limit: '1gb' });

  app.get('/api/health', (_req, res) => res.json({ ok: true, ffmpeg: checkFfmpeg(), projectsDir: store.root }));
  app.get('/api/projects', h(async (_q, res) => res.json(await store.list())));
  app.get('/api/projects-next-name', h(async (req, res) => res.json({ name: await store.nextName(String(req.query.base ?? 'Untitled')) })));
  app.get('/api/projects/:name', h(async (req, res) => res.json({ project: await store.read(req.params.name), folder: store.folder(req.params.name) })));
  app.put('/api/projects/:name', express.json({ limit: '50mb' }), h(async (req, res) => {
    const p = await store.write(req.params.name, req.body);
    res.json({ ok: true, project: p, folder: store.folder(req.params.name) });
  }));
  app.post('/api/projects/:name/rename', express.json(), h(async (req, res) => {
    await store.rename(req.params.name, String(req.body?.to ?? ''));
    res.json({ ok: true });
  }));
  app.post('/api/projects/:name/assets', raw, h(async (req, res) => {
    const id = String(req.header('x-asset-id') ?? '');
    const fileName = decodeURIComponent(String(req.header('x-file-name') ?? 'file'));
    res.json(await store.saveAsset(req.params.name, id, fileName, Buffer.from(req.body)));
  }));
  app.use('/api/projects/:name/files', (req, res, next) => {
    const dir = store.folder(req.params.name);
    res.setHeader('Cache-Control', 'no-cache');
    express.static(dir, { fallthrough: false })(req, res, next);
  });
  app.get('/api/projects/:name/zip', h(async (req, res) => {
    const buf = await store.zip(req.params.name);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}.motion.zip"`);
    res.send(buf);
  }));
  app.post('/api/import-zip', raw, h(async (req, res) => {
    const name = await store.importZip(Buffer.from(req.body), req.query.name ? String(req.query.name) : undefined);
    res.json({ name });
  }));

  /* ----- export ----- */
  app.post('/api/export', express.json(), h(async (req, res) => {
    const name = String(req.body?.name ?? '');
    const folder = store.folder(name);
    const project = await store.read(name);
    const cli = `npm run render -- "${folder}" "${name}.mp4"`;
    const ff = checkFfmpeg();
    if (!ff.found) return res.status(424).json({ error: FFMPEG_INSTALL_HELP, code: 'FFMPEG_NOT_FOUND', cliCommand: cli });
    if ([...jobs.values()].some((j) => j.status === 'running')) throw new HttpError(409, 'An export is already running');
    fs.mkdirSync(path.join(folder, 'exports'), { recursive: true });
    const job: Job = {
      id: randomUUID(), name, status: 'running', frame: 0,
      total: Math.max(1, Math.round(project.settings.durationSec * project.settings.fps)),
      outPath: path.join(folder, 'exports', `${name}.mp4`), controller: new AbortController(),
    };
    jobs.set(job.id, job);
    const base = `http://localhost:${(server.address() as any).port}`;
    renderToMp4({
      pageUrl: `${base}/render.html?src=${encodeURIComponent(`/api/projects/${encodeURIComponent(name)}/files`)}`,
      outPath: job.outPath, signal: job.controller.signal,
      onProgress: (f, t) => { job.frame = f; job.total = t; },
    }).then(
      () => { job.status = 'done'; },
      (e) => {
        job.status = e instanceof RenderError && e.code === 'CANCELLED' ? 'cancelled' : 'error';
        job.error = e instanceof Error ? e.message : String(e);
        job.code = e instanceof RenderError ? e.code : undefined;
      },
    );
    res.json({ jobId: job.id, cliCommand: cli });
  }));
  const jobView = (j: Job) => ({ id: j.id, status: j.status, frame: j.frame, total: j.total, error: j.error, code: j.code });
  app.get('/api/export/:id', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Unknown export job' });
    res.json(jobView(j));
  });
  app.post('/api/export/:id/cancel', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return res.status(404).json({ error: 'Unknown export job' });
    j.controller.abort();
    res.json(jobView(j));
  });
  app.get('/api/export/:id/download', (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j || j.status !== 'done') return res.status(404).json({ error: 'No finished export' });
    res.download(j.outPath, `${j.name}.mp4`);
  });

  if (opts.renderSrc) app.use('/render-src', express.static(opts.renderSrc));

  /* ----- front-end: Vite middleware (dev / CLI) or built dist ----- */
  const prod = process.env.NODE_ENV === 'production' && fs.existsSync(path.join(ROOT, 'dist/index.html'));
  const server = http.createServer(app);
  if (prod) {
    app.use(express.static(path.join(ROOT, 'dist')));
  } else {
    const vite = await createVite({
      root: ROOT,
      appType: 'mpa',
      logLevel: 'warn',
      server: { middlewareMode: true, hmr: opts.renderSrc ? false : { server } },
    });
    app.use(vite.middlewares);
    server.on('close', () => { void vite.close(); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : (err as any)?.status === 404 ? 404 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const port = (server.address() as any).port as number;
  if (!opts.quiet) console.log(`Motion Studio running at http://localhost:${port}  (projects: ${store.root})`);
  return { server, port, store, close: () => new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); }) };
}
