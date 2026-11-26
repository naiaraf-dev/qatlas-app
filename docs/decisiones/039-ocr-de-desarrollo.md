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
- **Lo que se lee no depende del sistema** (2026-11-25). El CI de Linux no leyó la nota de la ficha que
  Windows sí leía: un `<input>` no hereda la fuente de la página y usaba la del sistema, y el OCR dejaba
  de leerla con otras fuentes (Courier New, Times) o a 16 px. Además, el texto pegado al borde oscuro de un
  campo no se leía con ninguna. Ahora el sandbox sirve su propia fuente (JetBrains Mono, la de la interfaz,
  `apps/sandbox-site/src/fuente.mjs`) en las páginas que leen los tests, también en los campos, a 28 px,
  con relleno y borde claro, y cada dato en su línea. Se probó con el render de Windows y con uno sin hinting
  ni texto LCD, como el de Linux. EVI-02 suma el control de EVI-05: sin el modo datos sensibles, el valor de
  un campo del formulario se lee.
- **Siempre el Chromium verificado** (ADR 020), también para el OCR: `channel: 'chromium'`.
  `security-tests/navegador-verificado.test.ts` lo exige en todo `launch`.
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

## Testigo en cada «no aparece» (2026-11-26)

El control positivo de TS-01 falló una vez en el CI y pasó al reintentar: el OCR no vio el canario que
estaba. Eso pone en duda los «no aparece»: si a veces el OCR no lee, un TS-01 o un TS-06 podría pasar sin
haber leído nada.

- **Testigo.** Toda página HTML del sandbox muestra un texto fijo, no secreto (`TESTIGO_OCR`, en
  `apps/sandbox-site/src/testigo.mjs`): arriba a la derecha, fijo, negro sobre blanco, 28 px, con la fuente
  empaquetada y `font-display: swap`. Cada captura o fotograma que revisa una aserción negativa
  (`esperarSinSecretos`, en `e2e/ocr.ts`) tiene que mostrarlo leído por el OCR. Una imagen de un solo
  color (una página en blanco mientras navega) no puede tener texto y no cuenta. Si una imagen con algo
  dibujado no muestra el testigo, o ninguna se pudo comprobar, la aserción falla como «no se pudo
  comprobar». La lógica está en `e2e/ocr-texto.ts` y la prueba `security-tests/ocr-testigo.test.ts`.
  Se aplica a TS-01, TS-06, EVI-02 y EVI-05.
- **Lo que encontró en la primera corrida.** El testigo, dibujado con un borde negro pegado al texto, no se
  leía en dos imágenes, aunque se veía perfecto. Sin borde, sí. Es el mismo efecto que con los campos de
  formulario: el OCR depende de cómo está dibujado el texto. Antes, esa clase de imagen pasaba como «sin
  el secreto».
- **Captura recién pintada.** Antes de cada captura, la grabación espera en el mundo aislado las fuentes
  cargadas y dos cuadros pintados (`EXPRESION_ESPERAR_PINTADO`, en `grabacion.ts`). Playwright ya espera
  las fuentes al capturar; esto agrega el pintado. Si la señal no llega, captura igual, y el testigo dice
  si se leía.
- **Diagnóstico en el CI.** Si un control positivo no encuentra el canario, o una aserción negativa no se
  puede comprobar, el test escribe las imágenes y lo que leyó el OCR en su carpeta de `test-results`, que
  el CI sube cuando falla.
- **La causa de la falla del CI no se reprodujo.** Pasó 10 de 10 en local, también con la máquina
  cargada. Las posibles (una captura sin pintar, una página sin captura porque el proceso principal tardó
  más de 5 s en decir qué tapar, una lectura que falla) quedan cubiertas: la primera por la espera, las
  otras porque ya no pueden pasar en silencio.

## Mantenimiento

Subir tesseract.js revisando su script de instalación y que siga sin red. El `errorHandler` de la versión
7 no rechaza `createWorker` cuando falla la carga: `e2e/ocr.ts` lo resuelve con una carrera contra el
error.
