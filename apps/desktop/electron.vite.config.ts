import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';
import { manifiestoRegistrado } from '../../scripts/nativos.mjs';

// Los paquetes del monorepo se incluyen en el bundle (no se externalizan),
// así la app empaquetada no depende de node_modules del workspace.
const WORKSPACE_PACKAGES = [
  '@qatlas/shared',
  '@qatlas/shared/contrasena',
  '@qatlas/shared/dominios',
  '@qatlas/crypto',
  '@qatlas/redaction',
  '@qatlas/db',
  '@qatlas/runner',
];

/**
 * Los módulos nativos de esta plataforma, con el SHA-256 REGISTRADO y revisado (ADR 007), no el que
 * tenga el disco. Antes, lo instalado de todas las plataformas se compara con el registro: si algo no
 * coincide, o esta plataforma no está registrada, el build falla.
 */
const manifiestoNativos = () =>
  manifiestoRegistrado(
    resolve(import.meta.dirname, '../..'),
    `${process.platform}-${process.arch}`,
  );

// `mode` es development solo con `electron-vite dev`: las herramientas de desarrollo y el menú por
// defecto existen solo ahí (especificación 3.6), también en un build sin empaquetar.
export default defineConfig(({ mode }) => ({
  main: {
    // El driver de Drizzle importa 'better-sqlite3'; acá se usa la variante con SQLCipher (ADR 006).
    resolve: { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } },
    define: {
      __QATLAS_NATIVOS__: JSON.stringify(manifiestoNativos()),
      __QATLAS_DESARROLLO__: JSON.stringify(mode === 'development'),
    },
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rolldownOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/main/index.ts'),
          // Procesos aparte (ADR 016 y 017): no importan ni la base ni las claves.
          'proceso-proxy': resolve(
            import.meta.dirname,
            '../../packages/runner/src/red/entrada-proxy.ts',
          ),
          'proceso-runner': resolve(
            import.meta.dirname,
            '../../packages/runner/src/motor/entrada-runner.ts',
          ),
        },
      },
    },
  },
  preload: {
    build: {
      // Con sandbox: true, el preload debe ser un único archivo CommonJS sin
      // dependencias externas (Electron no permite require de node_modules).
      externalizeDeps: false,
      isolatedEntries: true,
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, 'src/renderer'),
    plugins: [react(), tailwindcss()],
    build: {
      rolldownOptions: {
        input: { index: resolve(import.meta.dirname, 'src/renderer/index.html') },
      },
      // Sin mapas de código en producción: no exponen el código fuente.
      sourcemap: false,
      minify: true,
    },
  },
}));
