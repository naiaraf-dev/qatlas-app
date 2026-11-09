# 039 — OCR para TS-06 y TS-01, solo en desarrollo

- **Estado:** aceptada
- **Fecha:** 2026-11-08

## Contexto

TS-06 pide que la contraseña no aparezca en ningún fotograma del video, y TS-01 que el canario no
aparezca en las capturas. Un valor dibujado en píxeles no se encuentra buscando texto: hace falta OCR.

## Decisión

**tesseract.js, como dependencia de desarrollo.** Nunca entra en la app: un E2E revisa las dependencias de
`apps/desktop` y todo el build.

- **Sin descargas.** Los datos del idioma salen de `@tesseract.js-data/eng`, con versión exacta y su hash
  SHA-512 en el lockfile. Se leen del disco (`langPath` local, `cacheMethod: 'none'`).
- **El worker corre sin red** (`e2e/fixtures/ocr-sin-red.cjs`): `fetch` y los módulos de red se
  reemplazan por funciones que fallan. Un E2E prueba que, sin los datos locales, el OCR intenta descargar
  y falla.
- **Que lea de verdad.** Un E2E lee un texto conocido de una captura de Chromium. Cada test que exige «no
  aparece» tiene un control que sí aparece, leído por el mismo OCR:
  - TS-06: un video grabado con el canario a la vista; además, la pantalla del login asistido, donde el
    canario está escrito.
  - TS-01: con la redacción apagada, una captura lo muestra.
  - EVI-02: sin selectores sensibles, el documento se lee.
- **La comparación** normaliza las confusiones típicas (O y 0, I, L y 1, S y 5, B y 8) y tolera dos
  caracteres. Eso hace que encuentre más, nunca menos: un falso positivo hace fallar el test.
- **Para que TS-06 pruebe algo,** el sandbox muestra la contraseña como texto en el login («mostrar
  contraseña», grande) y el token en la primera vista después de entrar con el enlace. Un campo de tipo
  password solo muestra puntos: sin esto, el OCR no la vería aunque el login se grabara.

## Dependencias (solo desarrollo)

| Paquete                        | Para qué          | Script de instalación                                                         | Tamaño | Licencia                                                                                                                                                                       |
| ------------------------------ | ----------------- | ----------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tesseract.js` 7.0.0           | OCR               | `postinstall` (opencollective): bloqueado por `ignore-scripts`, no hace falta | 1,6 MB | Apache-2.0                                                                                                                                                                     |
| `tesseract.js-core` 7.0.0      | El motor, en WASM | No                                                                            | 44 MB  | Apache-2.0                                                                                                                                                                     |
| `@tesseract.js-data/eng` 1.0.0 | Datos del inglés  | No                                                                            | 14 MB  | El paquete dice MIT y no trae licencia; su repositorio (naptha/tessdata) es Apache-2.0, y los datos salen de tesseract-ocr/tessdata_best, Apache-2.0. Se trata como Apache-2.0 |

Transitivas, todas chicas: bmp-js, idb-keyval, is-url, node-fetch (con whatwg-url, tr46 y
webidl-conversions), opencollective-postinstall, regenerator-runtime, wasm-feature-detect y zlibjs.
Licencias MIT, Apache-2.0 y BSD-2-Clause. Ninguna llega a la app.

Alternativas: el binario de Tesseract del sistema (no es reproducible entre Windows y el CI), modelos ONNX
o Python (mucho más pesados) o no hacer OCR (no prueba EVI-01 en los fotogramas).

## Mantenimiento

Subir tesseract.js revisando su script de instalación y que siga sin red. El `errorHandler` de la versión
7 no rechaza `createWorker` cuando falla la carga: `e2e/ocr.ts` lo resuelve con una carrera contra el
error.
