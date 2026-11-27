# 046 — La huella de un hallazgo

- **Estado:** aceptada
- **Fecha:** 2026-11-27

## Contexto

La especificación (5.1) pide reconocer el mismo problema entre ejecuciones con una **huella**, calculada a
partir del tipo, la URL normalizada y el mensaje normalizado. Hasta la semana 7 cada aparición era un
hallazgo, sin huella (ADR 023). La huella no puede guardar texto de la página en claro, y tiene que ser estable
ante cambios menores (números, fechas, IDs) sin unir problemas distintos.

## Decisión

**huella = HMAC-SHA-256(subclave de huellas del proyecto, versión · tipo · alcance · clave)**

- **Un HMAC, no un hash.** Con una subclave del proyecto (HKDF, uso `huella-hallazgo`), como la clave de los
  mensajes (ADR 032): sin la clave del proyecto no se pueden probar candidatos. La 5.1 dice «hash»; la ADR 032
  ya mostró por qué un hash sin clave no alcanza. Es única por proyecto (índice único en la base).
- **El alcance depende del tipo** (`ALCANCE_POR_TIPO`):
  - **sitio** (el origen): `cookie-insegura`, `recurso-externo-bloqueado` y `secreto-en-almacenamiento`. Una
    cookie es del sitio, no de cada página.
  - **destino:** un `link-roto` es la URL rota, no cada página que la enlaza.
  - **forma de la página**, para el resto: la URL sin query, con los segmentos que tienen dígitos como `#`
    (como las trampas de la ADR 022). El mismo error en `/producto/12` y en `/producto/98` es un hallazgo
    con dos ocurrencias.
- **La clave** es la de la ADR 023 (regla de axe, código HTTP, cookie, host, parámetro), o el HMAC del mensaje
  redactado y normalizado. La ruta de un `recurso-con-error` va por su forma, como la página.
- **Afuera:** el título, la severidad, los selectores, el rol y el detalle. Un selector cambia con cada build
  (clases con hash); va en el detalle cifrado de cada ocurrencia.

### Normalización v2 de los mensajes

Medido con mensajes inventados: la v1 (números y UUID) era estable ante números de línea, fechas y la pila, pero
**un hash de bundle (`main.3f9ac2be.js`) o un ID hexadecimal corto cambiaban la clave**: el mismo error salía
como nuevo después de cada deploy. La v2 además:

- reemplaza los tokens hexadecimales de 6 o más caracteres con letras y dígitos por `<id>`;
- **conserva un código de estado HTTP nombrado como tal** («status code 404» y «status code 500» son
  problemas distintos).

La versión se guarda en cada hallazgo (`version_normalizacion`): si cambia, lo guardado se recalcula al
desbloquear (ADR 047).

### Si cambia la URL o el selector

- El selector nunca entra: un cambio de selector no cambia la huella.
- Si cambia la URL (otra forma), es otro hallazgo. El anterior queda abierto, porque su página ya no se
  recorre, y la bandeja lo marca «sin cobertura». La persona lo resuelve o lo descarta. Fusionar dos hallazgos
  a mano queda para más adelante.

## Límites

- Un identificador de más de 12 caracteres que mezcla letras y dígitos sin ser hexadecimal (por ejemplo, base64)
  no se reemplaza: unirlos uniría también nombres de funciones distintos (`renderStep2Header`,
  `validateStep2Form`).
- Dos problemas distintos de la misma forma de página y la misma regla de axe son un hallazgo: la regla no dice
  qué elemento. El detalle de cada ocurrencia sí.

## Verificación

- `apps/desktop/src/main/hallazgos/huella.test.ts`: pares que se unen y pares parecidos que **no** (otra variable,
  otra propiedad, otro estado HTTP, otro token, otro tipo de error); alcance por tipo; la huella cambia con otra
  subclave, otra clave, otro tipo u otra forma, y el separador evita colisiones. Corre también dentro de
  Electron (`test:crypto:electron`).
- `apps/desktop/src/main/ejecuciones/ejecuciones.test.ts`: el mismo problema en dos ejecuciones es un hallazgo;
  otra clave u otra forma, otro; un mensaje con otro hash de bundle, el mismo.
