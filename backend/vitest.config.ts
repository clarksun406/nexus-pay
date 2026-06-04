import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // Most tests are pure / mocked; DB-touching tests should opt into the
    // 'integration' tag (none of the tests in this initial batch are tagged).
  },
});
