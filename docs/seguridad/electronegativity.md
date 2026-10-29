# Triage de Electronegativity

[Electronegativity](https://github.com/doyensec/electronegativity) analiza el código de Electron en
busca de configuraciones inseguras. Corre en CI y sube sus resultados a la pestaña _Security_ de
GitHub. Todo hallazgo nuevo se corrige o se documenta acá.

> Se ejecuta aislado con `npx` (no está en `devDependencies`) porque sus propias dependencias tienen
> vulnerabilidades conocidas. Ver `docs/decisiones/003-electronegativity-aislado.md`.

## Hallazgos corregidos

| Regla                                                                   | Qué marcaba                                             | Corrección                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------- |
| CONTEXT_ISOLATION_JS_CHECK, NODE_INTEGRATION_JS_CHECK, SANDBOX_JS_CHECK | No podía ver los valores porque venían de una constante | Se escriben de forma explícita al crear la ventana (además de la constante) |
| AUXCLICK_JS_CHECK                                                       | El clic del medio puede abrir navegación                | `disableBlinkFeatures: 'Auxclick'`                                          |

## Hallazgos aceptados (falsos positivos o informativos)

| Regla                  | Ubicación           | Justificación                                                                                                                       | Revisado   |
| ---------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CSP_GLOBAL_CHECK       | `main/hardening.ts` | La CSP se construye con `buildCsp()` y la herramienta no puede evaluarla. TS-07 verifica cada directiva de la CSP de producción.    | 2026-10-28 |
| REMOTE_MODULE_JS_CHECK | `main/index.ts`     | El módulo `remote` fue eliminado de Electron en la versión 14; la opción `enableRemoteModule` ya no existe.                         | 2026-10-28 |
| PRELOAD_JS_CHECK       | `main/index.ts`     | Informativo: pide revisar el preload. Revisado: expone solo funciones específicas, sin `ipcRenderer`, y solo importa tipos (TS-07). | 2026-10-28 |
