import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';

// Los paquetes del monorepo se incluyen en el bundle (no se externalizan),
// así la app empaquetada no depende de node_modules del workspace.
const WORKSPACE_PACKAGES = ['@qatlas/shared'];

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
      rolldownOptions: { input: { index: resolve(import.meta.dirname, 'src/main/index.ts') } },
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
});
