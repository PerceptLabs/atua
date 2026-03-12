import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/*/src/**/*.test.ts', 'spike/**/*.test.ts'],
    exclude: ['**/*.browser.test.ts', '**/node_modules/**'],
    environment: 'node',
    passWithNoTests: true,
  },
});
