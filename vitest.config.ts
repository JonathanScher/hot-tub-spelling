import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'url';
import path from 'path';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      './firebase-config.js': path.resolve(rootDir, 'specs/mocks/firebase-mock.ts'),
      '../firebase-config.js': path.resolve(rootDir, 'specs/mocks/firebase-mock.ts')
    }
  },
  test: {
    include: ['specs/**/*.spec.ts'],
    environment: 'node'
  }
});
