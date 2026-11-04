import path from 'node:path';
import { startServer } from './app';

const port = Number(process.env.PORT ?? 5173);
const projectsDir = path.resolve(process.env.MOTION_PROJECTS_DIR ?? 'projects');
startServer({ port, projectsDir }).catch((e) => {
  console.error(e);
  process.exit(1);
});
