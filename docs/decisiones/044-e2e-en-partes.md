# 044 — E2E en partes paralelas, etiquetas y corridas nocturnas

- **Estado:** aceptada
- **Fecha:** 2026-11-25

## Contexto

La suite E2E tiene 198 tests y tarda unos 15 minutos en una máquina. Una corrida completa local se cortó
dos veces por falta de memoria, y faltan la fase 1 y otras tres: la suite va a seguir creciendo. Hacía
falta que dejara de depender de una sola máquina.

## Decisión

**Etiquetas.** Todo test lleva al menos una: `@seguridad`, `@lento`, `@ocr`, `@interfaz`, `@smoke` (con la
opción `tag` de Playwright). `security-tests/e2e-etiquetas.test.ts` lo verifica con la lista de Playwright
(`--list`), la misma que usa al correr.

**Scripts.**

- `test:e2e:smoke`: los tests `@smoke` (la app abre desde `app://`, sin Node, con sus protecciones y su
  CSP). 11 tests, unos 12 s.
- `test:e2e:area -- <patrón>`: los archivos cuyo nombre coincide con el patrón, más el smoke.
- `test:e2e:parte -- <n>`: una parte del CI.
- `test:e2e`: la suite completa, como antes.

**Partes explícitas, no solo `--shard`.** Playwright reparte `--shard` por cantidad de tests, con cada
archivo entero y en orden alfabético. Con unos pocos archivos largos quedaba muy desparejo (con los tiempos
medidos: 492 s y 201 s en dos partes; 475 s, 50 s y 168 s en tres). Tiene una variable interna para
ponderar (`PWTEST_SHARD_WEIGHTS`), pero no está documentada. Las partes se definen en
`scripts/e2e-partes.mjs`, por archivo y etiqueta:

1. **rápidos:** todo lo que no es `@lento` ni `@ocr`. Un archivo nuevo entra acá sin tocar nada.
2. **Bóveda: inactividad:** `boveda-inactividad.e2e.ts` (TS-09, esperas reales de más de un minuto).
   Se separó de `boveda.e2e.ts`: esos tests dependían del orden del archivo y no podían correr solos.
3. **contención: solo lectura:** el bloque TS-05 de `contencion.e2e.ts`, con escaneos reales.
4. **ejecuciones y escaneos.**
5. **OCR y evidencias.**

Cada test cae en exactamente una parte (lo verifica el mismo test). Una parte que crezca puede llevar
además `shard` y se reparte con `--shard`.

**CI.** Un job por parte (`E2E n/5 · nombre`), en paralelo después de `calidad`, con la preparación común
en `.github/actions/preparar-e2e`. Cada parte deja un reporte `blob` (siempre) y sus `test-results` (si
falla), y escribe su duración y la memoria de cada archivo en el resumen del job. `E2E · reporte unificado`
junta los reportes en uno HTML y falla si alguna parte falló. Los tests de crypto en Electron corren una
vez, en la parte 1.

**Nocturno** (`.github/workflows/nocturno.yml`): la suite completa con `--repeat-each=3` y
`failOnFlakyTests`, en las mismas partes, todos los días y a mano. Si falla, abre un issue con la etiqueta
`e2e-nocturno` (o comenta en el abierto), solo con la rama, el commit y el enlace a la corrida. Reemplaza
las «3 corridas seguidas» locales.

**Localmente** (CLAUDE.md): `check` siempre; del E2E, el área tocada más el smoke. La suite completa la
confirma el CI.

**Limpieza.** Cada archivo termina con `vigilarProcesos` (desde la rama anterior): sigue por PID y hora de
creación los procesos que lanzó, falla si queda alguno vivo y registra la memoria libre al empezar, la
mínima y al terminar.

## Mediciones locales

En una máquina con 15,3 GB, de a una parte por vez (sin la preparación del CI). La memoria es la libre
del sistema entero, con lo demás que estuviera abierto.

| Parte                        | Tests | Duración |           Memoria libre mínima |
| ---------------------------- | ----: | -------: | -----------------------------: |
| 1 · rápidos                  |   123 |    147 s |           4,22 GB (contención) |
| 2 · Bóveda: inactividad      |     2 |    177 s |                        4,80 GB |
| 3 · contención: solo lectura |     9 |    152 s |                        4,76 GB |
| 4 · ejecuciones y escaneos   |    43 |    310 s |              3,81 GB (escaneo) |
| 5 · OCR y evidencias         |    21 |    145 s | 4,12 GB (evidencias en la app) |

En el CI, en paralelo, la duración la marca la parte 4, más la preparación de cada job (instalar, build y
Chromium). La duración real de cada parte queda en el resumen de su job desde la primera corrida.

## Verificación

- `security-tests/e2e-etiquetas.test.ts`: etiquetas, cada test en una sola parte, y las partes del CI y
  del nocturno iguales a las de `scripts/e2e-partes.mjs`.
- `security-tests/e2e-procesos.test.ts`: la vigilancia al final de cada archivo, con control positivo.
- Los workflows se validaron contra el esquema de GitHub Actions.
