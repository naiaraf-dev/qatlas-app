import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'electron-vite';

// Los paquetes del monorepo se incluyen en el bundle (no se externalizan),
// así la app empaquetada no depende de node_modules del workspace.
const WORKSPACE_PACKAGES = [
  '@qatlas/shared',
  '@qatlas/shared/contrasena',
  '@qatlas/shared/dominios',
  '@qatlas/crypto',
  '@qatlas/db',
];

const require = createRequire(import.meta.url);

/** SHA-256 de los módulos nativos de esta plataforma, verificados al iniciar (ADR 007). */
function manifiestoNativos(): { paquete: string; archivo: string; sha256: string }[] {
  const plataforma = `${process.platform}-${process.arch}`;
  const carpeta = (paquete: string) => dirname(require.resolve(`${paquete}/package.json`));
  const candidatos = [
    {
      paquete: 'better-sqlite3-multiple-ciphers',
      archivos: [`prebuilds/${plataforma}.node`],
    },
    {
      paquete: 'argon2',
      archivos: readdirSync(join(carpeta('argon2'), 'prebuilds', plataforma)).map(
        (nombre) => `prebuilds/${plataforma}/${nombre}`,
      ),
    },
  ];
  return candidatos.flatMap(({ paquete, archivos }) =>
    archivos.map((archivo) => {
      const ruta = join(carpeta(paquete), archivo);
      // Fallar cerrado también en el build: sin el binario no hay qué verificar.
      if (!existsSync(ruta)) throw new Error(`Falta el módulo nativo de ${paquete}`);
      return {
        paquete,
        archivo,
        sha256: createHash('sha256').update(readFileSync(ruta)).digest('hex'),
      };
    }),
  );
}

export default defineConfig({
  main: {
    // El driver de Drizzle importa 'better-sqlite3'; acá se usa la variante con SQLCipher (ADR 006).
    resolve: { alias: { 'better-sqlite3': 'better-sqlite3-multiple-ciphers' } },
    define: { __QATLAS_NATIVOS__: JSON.stringify(manifiestoNativos()) },
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
