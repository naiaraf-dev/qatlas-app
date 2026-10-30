import { defineConfig } from 'vitest/config';

// El driver de Drizzle importa 'better-sqlite3'; acá se usa la variante con SQLCipher (ADR 006).
// Drizzle se procesa con Vite para que el alias también valga dentro de su código.
const resolve = { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } };
const server = { deps: { inline: ['drizzle-orm'] } };

export default defineConfig({
  test: {
    // RNF-11: mínimo de 80 % en los paquetes críticos.
    coverage: {
      provider: 'v8',
      include: [
        'packages/crypto/src/**/*.ts',
        'packages/db/src/**/*.ts',
        'packages/shared/src/dominios.ts',
        'packages/shared/src/declaracion.ts',
        'apps/desktop/src/main/boveda/**/*.ts',
        'apps/desktop/src/main/proyectos/**/*.ts',
      ],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
    projects: [
      {
        resolve,
        test: {
          name: 'unit',
          server,
          include: ['packages/*/src/**/*.test.ts', 'apps/desktop/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve,
        test: {
          name: 'security',
          server,
          include: ['security-tests/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
