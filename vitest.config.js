import { defineConfig } from 'vitest/config';

if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.js', 'apps/api/tests/**/*.test.js', 'apps/web/**/*.test.js']
  }
});
