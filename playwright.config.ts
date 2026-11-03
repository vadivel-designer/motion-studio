import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const projectsDir = resolve('.e2e-projects');
export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199', viewport: { width: 1600, height: 950 } },
  webServer: {
    command: 'npx tsx server/index.ts',
    url: 'http://localhost:5199/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
    env: { PORT: '5199', MOTION_PROJECTS_DIR: projectsDir },
  },
});
