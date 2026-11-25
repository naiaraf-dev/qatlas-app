# 036 — Video y capturas: en memoria, cifrados en el proceso principal

- **Estado:** aceptada
- **Fecha:** 2026-11-08

## Contexto

Nada del usuario puede quedar en claro en el disco, tampoco temporales. Medido con Playwright 1.64.1:

- `recordVideo` usa ffmpeg y escribe un `.webm` en disco mientras graba. Además suma un binario.
- `page.screencast.start({ onFrame })`, una API pública de esta versión, entrega fotogramas JPEG en
  memoria, sin ffmpeg y sin archivos.
- `page.screenshot()` sin ruta devuelve los bytes.

## Decisión

**El runner nunca escribe evidencias.** Manda los fotogramas y las capturas al proceso principal por
mensajes. El principal es el único que tiene claves: cifra en streaming (STREAM, formato v2, ADR 035) a
un archivo con nombre aleatorio en `<carpeta de datos>/evidencias`, una carpeta plana.

**Video por tramos (EVI-07).** Un tramo es una página del crawler. Su video se conserva si en ella
apareció un hallazgo de severidad media o mayor, o hubo un error de navegación. Si la ejecución termina
por un error del navegador (el runner o el proxy se cayeron, o el navegador no arrancó), también se
conserva el tramo abierto. Los demás se descartan: su archivo se borra y su semilla nunca llegó a la base.

**El contenedor del video** es propio: fotograma JPEG con su momento, y huecos. No es un `.webm`. El visor
lo reproduce fotograma a fotograma; la exportación a un formato de video se decide en la semana 9 y se
codifica en memoria.

**Fotogramas perdidos (f5).** El runner tiene como mucho 20 fotogramas sin confirmar. Si el principal se
atrasa, los siguientes se descartan y se cuentan, y el próximo que sale dice cuántos se perdieron antes.
El video guarda cada hueco con su momento, la evidencia la cantidad, y el visor muestra «se perdieron N
fotogramas» donde ocurrió, para que un hueco no se lea como un salto real. **Las capturas nunca se
descartan:** esperan su turno en la cola del principal.

**Capturas (EVI-02).** De cada página con hallazgos, antes de los clics del crawler, con `mask` de
Playwright sobre:

- los campos de contraseña;
- los selectores sensibles del proyecto;
- con el modo datos sensibles, todos los campos de formulario (EVI-05);
- **los elementos con un secreto a la vista (EVI-04).** Antes de capturar, el runner junta el texto
  visible de cada elemento en un mundo aislado y se lo manda al principal. El principal lo pasa por la
  misma redacción de todo lo demás (patrones y las credenciales del proyecto, por su HMAC) y responde qué
  índices tapar. El runner los tapa por XPath, sin tocar el DOM. Si no hay respuesta en 5 segundos o un
  selector no se puede aplicar, no hay captura: nunca una sin tapar.

**Límite del enmascarado.** Tapa campos, selectores y secretos con formato reconocible o de las
credenciales. No tapa texto suelto sin formato: un documento escrito en un párrafo queda visible si no
está en un selector sensible. La interfaz lo dice junto a cada captura.

**Topes por ejecución:** 200 capturas y 200 MB de video. Al llegar, se deja de guardar ese tipo y el
resumen de la ejecución lo informa.

**El visor (3.7)** recibe bytes por `evidencias:obtenerVista` y `evidencias:obtenerFotograma`. El principal
valida la firma (solo PNG y JPEG; nunca SVG) y un tamaño máximo. La interfaz los dibuja con
`createImageBitmap` en un canvas, que no depende de la CSP. Por eso **la CSP se cierra**: `img-src 'self'`,
sin `data:` ni `blob:`, y `media-src 'none'`. El build tampoco incrusta archivos como `data:`
(`assetsInlineLimit: 0`): una fuente chica quedaba incrustada y la CSP la bloqueaba.

## Alternativas descartadas

- `recordVideo` en la carpeta de la ejecución, cifrado al terminar: deja la grabación entera legible
  durante toda la ejecución, y suma ffmpeg.
- `app://` para las imágenes: cualquier código de la interfaz pediría evidencias por URL sin pasar por el
  contrato, y Chromium podría cachear la imagen descifrada en disco.
- `data:` o `blob:` en `img-src`: no hacen falta con un canvas.

## Límites

- Lo que Chromium tiene en memoria lo puede paginar el sistema operativo (ADR 018).
- El video no se puede redactar (EXP-02): queda marcado «puede contener datos sensibles».

## Verificación

- `packages/runner/src/motor/grabacion.test.ts`: los huecos, que las capturas salen igual, las máscaras y
  que sin respuesta del principal no hay captura.
- `apps/desktop/src/main/evidencias/*.test.ts`: tramos, topes, firmas y nada en claro en el disco.
- `security-tests/runner-aislamiento.test.ts`: nunca `recordVideo`, `tracing` ni `recordHar`; solo
  `grabacion.ts` captura la pantalla, sin archivos; el login no conoce la grabación.
- `security-tests/ts-07-electron-config.test.ts`: la CSP nueva y el build sin `data:`.
- `e2e/evidencias.e2e.ts`: TS-06 con OCR; el enmascarado con su control; mientras corre una ejecución,
  ningún archivo de la carpeta de datos, del perfil ni del temporal tiene contenido de la página en claro
  (con un control que sí lo encuentra en la traza de Playwright).
- `e2e/evidencias-app.e2e.ts`: el visor en la app real, sin violaciones de la CSP.
