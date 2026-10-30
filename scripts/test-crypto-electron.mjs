/**
 * Corre los tests de crypto y de la base dentro del runtime real de Electron.
 *
 * Electron usa BoringSSL, no OpenSSL: `crypto.argon2` existe y aun así falla ahí, sin
 * que ningún test en Node lo detecte. Por eso los vectores y las pruebas de formato
 * también corren acá, con el binario de Electron como intérprete. El test
 * `runtime-electron` verifica que realmente se esté en Electron.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(raiz, 'apps/desktop/package.json'));
const electron = require('electron');
const vitest = path.join(raiz, 'node_modules/vitest/vitest.mjs');

const { status, error } = spawnSync(
  electron,
  [
    vitest,
    'run',
    'packages/crypto',
    'packages/db',
    'security-tests/ts-01',
    'security-tests/ts-02',
    'security-tests/ts-09',
    'security-tests/ts-10',
  ],
  {
    cwd: raiz,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', QATLAS_TEST_EN_ELECTRON: '1' },
  },
);

if (error) throw error;
process.exit(status ?? 1);
