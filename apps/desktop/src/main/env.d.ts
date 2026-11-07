/// <reference types="electron-vite/node" />

/**
 * Lo define electron.vite.config.ts en el build: true solo con `electron-vite dev`. Un build de
 * producción no lo puede cambiar con una variable de entorno: es una constante del bundle.
 */
declare const __QATLAS_DESARROLLO__: boolean;
