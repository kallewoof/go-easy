import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // No excludes — we want all source files measured so any new
      // unexpercised code (including in bin/ and auth-server.ts) is caught.
      thresholds: {
        statements: 66,
        branches: 69,
        functions: 85,
        lines: 66,
      },
    },
  },
});
