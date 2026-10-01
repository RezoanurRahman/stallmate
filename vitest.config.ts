import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Keeps the gate green on a clean checkout that has no test files yet.
    passWithNoTests: true,
  },
});
