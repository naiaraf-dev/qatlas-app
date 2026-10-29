import type { QatlasApi } from '@qatlas/shared';

declare global {
  interface Window {
    /** API expuesta por el preload. Es la única vía de comunicación con el sistema. */
    readonly qatlas: QatlasApi;
  }
}

export {};
