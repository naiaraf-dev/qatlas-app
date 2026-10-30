/**
 * Evita que `npm run test:crypto:electron` pase sin estar realmente en Electron: los
 * tests de este paquete deben correr también sobre BoringSSL (docs/decisiones/005).
 */
import { describe, expect, it } from 'vitest';

describe.runIf(process.env.QATLAS_TEST_EN_ELECTRON)('Runtime de Electron', () => {
  it('estos tests corren en Electron, no en Node', () => {
    expect(process.versions.electron).toBeTruthy();
  });
});
