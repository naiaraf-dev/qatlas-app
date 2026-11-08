# 034 — Logs técnicos, sin datos

- **Estado:** aceptada
- **Fecha:** 2026-11-07

## Contexto

La especificación pide logs locales, con la redacción de EVI-03 y EVI-04 y con rotación (3.13). Hasta ahora,
el proceso principal escribía solo a la consola, con detalles de Chromium; el runner y el proxy corren sin
salida (`stdio: 'ignore'`). Los logs se escriben también con la bóveda bloqueada, así que no se pueden
cifrar con sus claves.

## Decisión

**Logs solo técnicos.** `registrar(evento, campos)` (`apps/desktop/src/main/registro.ts`) es el único camino;
un test prohíbe `console.*` en el proceso principal fuera de ahí. Un evento lleva:

- un nombre con forma de código (`ejecucion.navegador-no-disponible`);
- campos con números, booleanos, IDs (UUID) o códigos de una **lista cerrada**: motivos y estados de las
  ejecuciones, códigos de error y canales del contrato de IPC, causas de un navegador que no arrancó.

**Nada de URLs, hosts, nombres de proyectos, credenciales ni contenido de páginas.** Un valor que no es de la
lista se rechaza, aunque esté redactado: una URL o un host redactados siguen diciendo a dónde se fue. El
campo no se escribe, y queda un evento `registro.campo-rechazado` con la cantidad. Lo que tiene datos va a la
base cifrada: por ejemplo, las líneas de error de Chromium van, redactadas, al `diagnostico` del resumen
de la ejecución.

**Dónde y cuánto:** `<carpeta de datos>/logs/qatlas.log`, en líneas JSON. Al pasar de 5 MB rota
(`qatlas.1.log` …), hasta 10 archivos, unos 50 MB. Al iniciar se borran los de más de 7 días. También van a
la consola del proceso principal, para el CI y el desarrollo.

**El runner y el proxy** siguen sin salida: lo que tengan que contar llega al proceso principal por
mensajes, y pasa por la redacción.

## Consecuencias

- Diagnosticar un problema desde el log da qué pasó y cuándo, no con qué datos. Para eso está la base.
- Un código nuevo que se quiera registrar tiene que entrar en `CODIGOS_PERMITIDOS`.
- TS-01 revisa también estos archivos.
