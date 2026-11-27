---
name: semana-qatlas
description: Encarar una funcionalidad nueva de QAtlas (una semana del plan o una rama feat/), desde la rama hasta el resumen del PR. Usala cuando la autora pida empezar una semana, un módulo o una funcionalidad.
---

# Funcionalidad nueva en QAtlas

Este es el proceso con el que se construye QAtlas. Las reglas de `CLAUDE.md` siguen valiendo siempre; esta skill las ordena en pasos. Si algo de acá contradice `CLAUDE.md`, gana `CLAUDE.md` y avisás.

## 0. Antes de empezar

- La autora actualiza `develop` (`git pull`). Vos nunca hacés `push`, `pull`, `fetch`, `merge` a `develop`/`main`, `force push` ni `git config`.
- Rama nueva desde `develop`: `feat/<funcionalidad-modulo>`. Nunca commits en `develop` ni en `main`.
- Si el pedido trae partes cortadas o ambiguas, preguntá antes de suponer.

## 1. Leer

- Las secciones de `docs/especificacion-qatlas.md` que nombre el pedido, siempre la 3 (seguridad) y el anexo C (trazabilidad).
- Los ADR relacionados en `docs/decisiones/`, sobre todo los que dejaron algo "para esta semana".
- `docs/modelo-de-amenazas.md` y los pendientes de `CLAUDE.md`.

## 2. Medir y consultar ANTES de implementar

- Prototipos y pruebas sueltas van en `.artefactos/` (ignorada por git). Se borran solo con `node scripts/borrar-temporal.mjs <ruta>`.
- Medí lo que puedas antes de proponer: una propuesta con datos vale más que una suposición.
- Presentá las decisiones como a), b), c)…, con tu recomendación en la primera línea de cada una y sus alternativas.
- Agregá siempre "Lo que no cierra en la especificación": huecos, contradicciones y riesgos que viste.
- Por cada dependencia nueva: para qué, licencia, alternativas, tamaño, script de instalación, mantenimiento y fecha de publicación (ver la skill `revision-dependencias`).
- Esperá la respuesta. No implementes una decisión de seguridad sin aprobación.

## 3. Implementar

- Seguridad primero: cada control nuevo tiene su test en `security-tests/` o en `e2e/`, **con control positivo** (la misma prueba sin el control tiene que detectar el problema).
- Toda aserción negativa ("X no aparece") tiene que demostrar que podía encontrar X. Con OCR, el testigo tiene que leerse en cada imagen.
- Fallar cerrado: si un control no se puede aplicar, no se ejecuta nada. Nunca relajar un control para que algo funcione.
- Datos 100 % ficticios (dominios `.test`/`example.com`, usuario `ana`). Nunca rutas, nombres ni datos de esta máquina o del trabajo de la autora.
- Reutilizá lo que existe: `opcionesChromium` para todo navegador, `EntradaSensible` para campos sensibles, `TextoRedactado` y `registrar()` para lo que se guarda o se loguea, el contrato IPC con esquemas `.strict()` (y sus casos en TS-08), los componentes de `renderer/src/ui/` y los tokens del sistema Índigo.
- Interfaz: accesible con teclado y lector de pantalla, en los dos modos, y lo que no existe todavía se muestra deshabilitado con "Llega en: …".
- Base: toda tabla nueva con `proyecto_id` va en `TABLAS_DE_PROYECTO`. IPC: todo canal nuevo queda bloqueado con la bóveda bloqueada, salvo que se agregue a `CANALES_SIN_BOVEDA` (los dos los verifica un test).
- Evidencias: nunca la grabación de Playwright (`recordVideo`, `tracing`, `recordHar`), que escribe en claro en disco. Las capturas y los fotogramas pasan por `grabacion.ts` y se cifran en el proceso principal.
- `packages/runner/src/motor` no importa red, `child_process` ni `electron` (un test lo verifica).
- Lo que dependa de `crypto` se prueba también dentro de Electron, que usa BoringSSL: `npm run test:crypto:electron`.
- La auditoría guarda solo IDs y nombres de campos, nunca valores (ADR 015).

## 4. Higiene de los tests (errores que ya cometimos)

Revisá cada test nuevo contra esta lista:

- Actuar después de una **señal determinística**, nunca después de un tiempo fijo.
- Buscar cada fila, conexión o ejecución **por su identidad**, nunca "la última" o "la primera".
- ¿Puede pasar por la razón equivocada? Si sí, falta un control positivo.
- La limpieza termina **antes** de declarar "terminado".
- Toda operación de Playwright con límite de tiempo propio.
- Navegador siempre con `opcionesChromium`; los controles (`control.*`) solo en tests.
- Lo que un test cambia del entorno (`process.env`, archivos, estado global) se restaura en un `finally`.
- Fuentes empaquetadas en lo que lee el OCR; nada que dependa de la GPU, de las fuentes o de la pantalla del sistema.
- Cada archivo E2E termina con `vigilarProcesos` y cada test tiene etiqueta (`@seguridad`, `@lento`, `@ocr`, `@interfaz`, `@smoke`); los `@lento`/`@ocr` nuevos se asignan a una parte en `scripts/e2e-partes.mjs`.

## 5. Verificar

- `npm run check` siempre (incluye formato, módulos nativos y la suite de seguridad).
- Si Electronegativity (dentro de `check`) reporta algo nuevo, se corrige o se documenta con su justificación en `docs/seguridad/electronegativity.md`.
- Si tocaste algo que dependa de `crypto`: `npm run test:crypto:electron`.
- `npm run build`.
- E2E local: `npm run test:e2e:smoke` y `npm run test:e2e:area -- <patrón>` del área que tocaste. La suite completa la confirma el CI; las corridas repetidas, el nocturno.
- Si algo falla, diagnosticá antes de corregir (skill `diagnostico-ci`).

## 6. Documentar

- Un ADR por decisión en `docs/decisiones/`.
- Especificación, modelo de amenazas, `CLAUDE.md` (estado y pendientes), `README` (tabla de controles) y `THIRD_PARTY_NOTICES` si hay dependencias.

## 7. Resumen para la autora

- Sin tablas (salvo la de dependencias de la plantilla del PR), en texto corrido y con líneas cortas.
- Secciones: verificación (qué corriste y qué no), lo que encontraron las pruebas, decisiones aplicadas, límites, pendientes.
- Separá lo comprobado de lo supuesto.
- Al final, el título y la descripción del PR sobre `.github/pull_request_template.md`.
- Nunca rutas locales ni datos de la máquina.

## Nunca

- `push`, `pull`, `fetch`, `merge` a ramas protegidas, `force push`, `git config`.
- Cerrar procesos por nombre (solo por PID de los que lanzaste).
- `rm -rf` o `Remove-Item -Recurse` con rutas armadas desde variables.
- Borrar nada fuera del repo. Lo temporal, solo con `node scripts/borrar-temporal.mjs <ruta>`; un archivo versionado se borra con `git rm`, en un commit.
