# 037 — Traza propia, HAR y snapshot del DOM como texto

- **Estado:** aceptada. Cambia EXP-05 de la especificación.
- **Fecha:** 2026-11-08

## Contexto

La especificación pedía la traza de Playwright (EXP-05). Medido con la 1.64.1: la traza escribe en su
carpeta, mientras graba, el texto de la página y hasta el valor que se tipeó con `fill`, en claro. Y no lo
borra ni al parar ni al cerrar el navegador. Su HAR (`recordHar`) también escribe en disco.

Lo que tiene la traza de Playwright:

- `trace.trace`: las acciones con sus parámetros, la consola y snapshots del DOM serializados, con texto,
  atributos y valores de los campos.
- `trace.network`: encabezados, cookies y cuerpos de las solicitudes.
- `resources/`: el cuerpo de cada respuesta y los fotogramas.

Se pueden redactar de verdad las URLs, los encabezados, las cookies, los formularios, los JSON, la consola
y el texto. No se pueden redactar las imágenes, los cuerpos arbitrarios (JavaScript minificado,
binarios), los datos personales sin formato reconocible, ni los selectores sensibles sobre un DOM ya
serializado.

## Decisión

**Una traza propia, armada en memoria.** El runner manda eventos al principal:

- navegaciones;
- clics del crawler;
- red: método, URL, tipo, estado, encabezados, cuerpo de la solicitud (hasta 64 KB) y tiempos;
- consola y excepciones.

El principal **redacta campo por campo** (encabezados, URL, cuerpo según su tipo, texto) y la escribe
cifrada en líneas JSON versionadas (`qatlas-traza`, versión 1).

- No lleva imágenes: las capturas y el video son evidencias aparte.
- No lleva cuerpos de respuesta (EVI-03).
- Las redacciones quedan en el registro (`redaccion`), y una traza con secretos redactados queda con
  revisión pendiente para la exportación (RN-REP-03).

**El HAR sale de los mismos eventos de red:** HAR 1.2, sin cuerpos de respuesta, redactado y cifrado.

**El snapshot del DOM es su propia evidencia, como texto.**

- Se arma en un mundo aislado, donde los selectores funcionan sobre el DOM vivo.
- Se vacían los valores de las contraseñas, de los campos ocultos y de los selectores sensibles (con el
  modo datos sensibles, todos los campos), y su texto se reemplaza por `[ENMASCARADO]`.
- Se omiten el contenido de los scripts y de los estilos, los comentarios y los manejadores `on*`.
- Un selector que no es CSS válido no se puede aplicar: entonces no hay snapshot (falla cerrado).
- El principal lo redacta. Se corta en 1 MB.
- Solo de las páginas con hallazgos, y nunca con el modo datos sensibles.
- Es una evidencia aparte para poder eliminarla sola (f6). En la traza queda solo su ID.

**El visor es propio y nada se renderiza:** línea de tiempo de la traza, lista del HAR y el snapshot en un
`<pre>`. El visor de Playwright es una app web que renderiza los snapshots en iframes; correrlo aislado
pedía un protocolo con service workers, una sesión sin red y una CSP propia para un código grande de
terceros, y además no lee este formato.

**Cambio de EXP-05:** la traza de QAtlas no es la de Playwright. Qué se exporta y en qué formato se decide
en la semana 9. No se promete un conversor al formato de Playwright.

## Verificación

- `apps/desktop/src/main/evidencias/formatos.test.ts`: la redacción de cada campo y un HAR sin cuerpos.
- `e2e/ts-01-canario.e2e.ts`: el canario no está en la traza, el HAR ni los snapshots descifrados. Con la
  redacción apagada, sí.
- `e2e/evidencias.e2e.ts`: el snapshot, con lo sensible vaciado.
