'use strict';
/**
 * El worker del OCR (tesseract.js), sin red. Antes de cargar el worker de la librería, se reemplazan
 * `fetch` y los módulos de red por funciones que fallan: si algo intentara descargar los datos del
 * idioma o el motor, la prueba falla en lugar de salir a internet. Solo para desarrollo (ADR 039).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- corre como CommonJS, en un worker
const Module = require('node:module');

const bloquear = () => {
  throw new Error('qatlas-ocr: sin red');
};
globalThis.fetch = bloquear;

const RED = /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns)$|^node-fetch$/;
const cargar = Module._load;
Module._load = function (pedido, ...resto) {
  if (RED.test(pedido)) {
    return new Proxy(bloquear, { get: () => bloquear, apply: bloquear });
  }
  return cargar.call(this, pedido, ...resto);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- el worker de la librería, como CommonJS
require(require.resolve('tesseract.js/src/worker-script/node/index.js'));
