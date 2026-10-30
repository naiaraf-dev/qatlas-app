import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // RNF-11: mínimo de 80 % en los paquetes críticos.
    coverage: {
      provider: 'v8',
      include: ['packages/crypto/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
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
