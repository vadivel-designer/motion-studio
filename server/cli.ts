import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseProject } from '../src/shared/schema';
import { startServer } from './app';
import { renderToMp4, RenderError } from './render';

/** npm run render -- <projectFolder> <out.mp4> */
async function main() {
  const [folderArg, outArg] = process.argv.slice(2);
  if (!folderArg || !outArg) {
    console.error('Usage: npm run render -- <projectFolder> <out.mp4>');
    process.exit(2);
  }
  const folder = path.resolve(folderArg);
  const pj = path.join(folder, 'project.json');
  if (!fs.existsSync(pj)) {
    console.error(`No project.json in ${folder}`);
    process.exit(2);
  }
  try { parseProject(JSON.parse(fs.readFileSync(pj, 'utf8'))); }
  catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(2); }

  const out = path.resolve(outArg);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const srv = await startServer({ port: 0, projectsDir: fs.mkdtempSync(path.join(os.tmpdir(), 'motion-cli-')), renderSrc: folder, quiet: true });
  try {
    const { frames } = await renderToMp4({
      pageUrl: `http://localhost:${srv.port}/render.html?src=/render-src`,
      outPath: out,
      onProgress: (f, t) => process.stdout.write(`\rRendering frame ${f}/${t}`),
    });
    console.log(`\nDone: ${out} (${frames} frames)`);
  } catch (e) {
    console.error(`\n${e instanceof RenderError || e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    await srv.close();
    process.exit(process.exitCode ?? 0);
  }
}
main();
