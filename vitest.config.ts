import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'security',
          include: ['security-tests/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
