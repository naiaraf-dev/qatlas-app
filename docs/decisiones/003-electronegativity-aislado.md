# 003 — Electronegativity se ejecuta aislado, fuera de las dependencias

- **Estado:** aceptada
- **Fecha:** 2026-10-28

## Contexto

Al agregar `@doyensec/electronegativity` como dependencia de desarrollo, `npm audit` reportó
3 vulnerabilidades (2 altas, 1 crítica) en dependencias transitivas antiguas (`tar`,
`@mapbox/node-pre-gyp`). La versión sin esas dependencias es más vieja y menos completa.

## Decisión

No incluirlo en `devDependencies`. Se ejecuta con `npx --yes @doyensec/electronegativity@1.10.3`
(versión fijada), en un job de CI separado que no instala el resto del proyecto.

## Motivos

- El lockfile del proyecto queda sin vulnerabilidades conocidas y `npm audit` puede bloquear el CI.
- La herramienta solo lee el código fuente y escribe un reporte SARIF: no se distribuye con la app.

## Consecuencias

- Ejecutarlo localmente descarga el paquete la primera vez.
- Si aparece un reemplazo mantenido, reevaluar.
