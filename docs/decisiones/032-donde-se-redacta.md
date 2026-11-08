# 032 — Dónde se redacta, y la clave de un hallazgo

- **Estado:** aceptada
- **Fecha:** 2026-11-07

## Contexto

El texto del sitio llega del runner y del proxy al proceso principal, que lo guarda en la base, lo manda a
la interfaz y, antes de esta semana, lo escribía en la consola. Hacía falta un lugar que garantice que nada
llega sin redactar a disco, a la interfaz o a un log.

## Decisión

**El proceso principal es el único punto que garantiza** (`ejecuciones/redaccion.ts` y `servicio.ts`). Todo
texto libre que llega del runner o del proxy pasa por la redacción antes de guardarse, mostrarse o
registrarse: la URL de cada página (la corta y la completa, cifrada), el título, las URLs, la clave y el
detalle de cada hallazgo, el destino de cada conexión del monitor y el diagnóstico de una falla del
navegador. Es también el único que conoce los secretos de las credenciales (por su HMAC, ADR 031).

**El runner redacta antes, como primera capa**: los patrones genéricos, sobre lo que manda (páginas y
hallazgos), recortado a los largos del protocolo. No es la garantía: no conoce las credenciales.

**`TextoRedactado`**: un tipo que solo producen las funciones de `packages/redaction`. Las columnas de la base
con texto del sitio lo exigen (`$type<TextoRedactado>()` en Drizzle), así que el compilador no deja guardar
texto sin redactar. Un test de seguridad verifica que nadie fuera del paquete lo fabrique con un cast.

**La interfaz recibe lo que está en la base**, que ya está redactado, y el progreso en vivo (la página
actual, redactada). Cada hallazgo con secretos redactados muestra «Se redactaron N secretos», sin el
valor, y queda marcado con revisión pendiente para la exportación de la semana 9 (RN-REP-03). El registro de
redacciones (`redaccion`: origen, regla, tipo y cantidad) dice qué se redactó y dónde.

**La clave de un hallazgo de consola o de una excepción** era un SHA-256 truncado, sin clave, del mensaje: un
secreto corto con un formato conocido se podía recuperar por fuerza bruta. Ahora es un **HMAC-SHA-256 con
una subclave del proyecto** (HKDF, uso `clave-hallazgo`), sobre el mensaje ya redactado y normalizado. Sigue
siendo determinístico dentro del proyecto, para deduplicar en la semana 8; sin la clave del proyecto no se
puede probar candidatos. La subclave vive en memoria durante la ejecución y se borra al terminar.

## Consecuencias

- Un campo nuevo con texto del sitio tiene que ser `TextoRedactado`: el compilador lo pide.
- Si el control positivo de TS-01 inyecta un redactor que no redacta, el canario aparece: es la prueba de
  que la garantía es esta y no otra.
