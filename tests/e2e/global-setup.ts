import fs from 'node:fs';
import { resolve } from 'node:path';

export default function globalSetup() {
  fs.rmSync(resolve('.e2e-projects'), { recursive: true, force: true });
  fs.mkdirSync(resolve('.e2e-projects'), { recursive: true });
}
