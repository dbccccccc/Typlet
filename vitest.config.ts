import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The extensions and integration packages import the package by name.
    alias: {
      'typlet/mathml': fileURLToPath(new URL('./src/mathml.ts', import.meta.url)),
      typlet: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'packages/*/test.ts'],
  },
});
