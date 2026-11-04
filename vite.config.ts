import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['index.html', 'render.html'] },
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), render: resolve(__dirname, 'render.html') },
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
} as any);
