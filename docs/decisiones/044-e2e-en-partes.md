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

## Caché de Electron y del navegador (agregado el 2026-11-27)

Cada una de las cinco partes, y cada job del nocturno, descargaba el binario de Electron y el Chromium de
Playwright; una descarga falló con un 504 de GitHub. La acción `preparar-e2e` usa `actions/cache` (fijada
por SHA, con `restore` y `save` por separado) para:

- la caché de `@electron/get` (`~/.cache/electron`, con `electron_config_cache`), con la clave
  `electron-<sistema>-<arquitectura>-<versión exacta>`;
- la carpeta de la revisión de Chromium (`~/.cache/ms-playwright/chromium-<revisión>`), con la clave
  `chromium-<sistema>-<arquitectura>-playwright-<versión exacta>-<revisión>`. Solo esa carpeta: es la que
  tiene el hash registrado (ADR 020).

Las claves son exactas, sin `restore-keys`: una versión nueva no restaura la anterior.

### Las verificaciones no cambian

- **Electron:** antes del script de instalación, `scripts/verificar-cache-electron.mjs` compara cada archivo
  de la caché que figura en `checksums.json` del paquete `electron` (que llega por el lockfile, con su
  integridad) con su SHA-256. Si uno no coincide, falla y no se instala nada. `@electron/get` también lo
  compara, pero ante una diferencia vuelve a descargar sin avisar; acá una caché alterada es un incidente y
  frena el job.
- **Chromium:** `npm run navegador:verificar` compara la carpeta con el hash registrado, venga de la
  descarga o de la caché. Ya corría antes de los tests; ahora también inmediatamente después de instalar.
- **Qué se guarda:** si la clave no estaba, se guarda inmediatamente después de verificar, antes del build y de
  cualquier test. Así se guarda lo verificado, no lo que haya quedado al final del job.

### Riesgo de envenenamiento de la caché, y por qué es aceptable

Quien pueda escribir una entrada de la caché podría dejar un Electron o un Chromium alterados para los
jobs siguientes.

- **Quién puede escribir:** GitHub separa las cachés por rama. Un PR, aunque venga de un fork, escribe en el
  ámbito de su propia rama y puede leer las de la rama base, pero no escribir en ellas. Una entrada de
  `develop` o `main` solo la escribe un job de esa rama. Las entradas no se pisan: una clave existente
  no se vuelve a guardar.
- **Qué pasa si igual llega una alterada:** no se usa. El binario de Electron se compara con
  `checksums.json`, que no viene de la caché sino del lockfile, y Chromium con el hash del repo. Para que
  pase, habría que alterar a la vez la caché y lo versionado, y lo versionado se revisa en el PR.
- **Lo que no cubre:** es la misma confianza en el primer uso de la ADR 020. Si la primera descarga ya
  hubiera sido alterada, el hash registrado sería el alterado; la caché no cambia eso.
- **Si falla una verificación:** el job se frena. Hay que borrar esa entrada (Actions → Caches) y averiguar
  cómo llegó ahí antes de volver a correr.

## Firmas de npm y la caché de npm (agregado el 2026-11-27)

En `develop`, `npm audit signatures` falló dos veces seguidas con `EMISSINGSIGNATUREKEY`:
«enhanced-resolve@5.27.0 has attestations but no corresponding public key(s) can be found».

- **El paquete está bien.** `enhanced-resolve` 5.27.0 llega por `@tailwindcss/vite` → `@tailwindcss/node`
  (desde la actualización a Tailwind 4.3.5). Su firma del registro y su atestación de publicación usan la
  clave `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`, que el registro publica (en su API y en el
  repositorio TUF de sigstore) para firmas y para atestaciones, sin vencimiento. Con una caché vacía, npm
  10.9.3 verifica los 266 paquetes.
- **No es nuestra versión de npm.** npm 10.9.11, la última 10.9.x, busca las claves de las atestaciones de
  la misma manera; ese error sale cuando la respuesta de atestaciones no trae un `keyid` que coincida.
- **El mecanismo: una respuesta incompleta, guardada en caché.** El registro sirve las atestaciones con
  `Cache-Control: max-age=31557600` (un año). npm las guarda en su caché, y `actions/setup-node` (`cache:
npm`) la restaura en cada corrida con el mismo lockfile. Si una vez llegó una respuesta sin la atestación
  de publicación (un problema pasajero del registro), cada corrida la reusa: por eso el reintento también
  falló. Se reprodujo en local con una caché así: el mismo error y el mismo mensaje.
- **Qué se hizo, sin desactivar nada:**
  - `npm audit signatures --prefer-online`: npm revalida con el registro lo que tiene en caché, y verifica
    contra lo que el registro sirve hoy. La verificación es la misma.
  - Antes, `scripts/diagnostico-atestaciones.mjs` muestra las respuestas de atestaciones que trae la caché
    y marca las incompletas. Solo lee; con eso la próxima corrida confirma si la caché tenía la respuesta
    incompleta.
- **Si con datos frescos igual fallara,** el problema sería del registro: entonces se evalúa una excepción
  acotada a ese paquete y versión, con vencimiento y el reporte del problema, y se consulta antes.

## Cuando no corre ninguna parte

Si falla el job de calidad, las partes del E2E no corren. El reporte unificado lo dice
(«No corrió ninguna parte del E2E porque falló el job…») en vez de caerse con «Directory does not exist».
Si las partes corrieron pero ninguna subió su reporte, también lo dice.

## El nombre de las partes salteadas (decidido el 2026-11-27)

Si falla el job de calidad, las partes se saltean y GitHub las muestra como
«E2E ${{ matrix.numero }}/5 · ${{ matrix.nombre }}»: un job con matriz que se saltea por su `needs` no
expande la matriz. Se puede evitar con cinco jobs explícitos, pero **se deja así a propósito**:

- Con la matriz salteada, los checks obligatorios «E2E 1/5 · rápidos», etc. no se reportan: quedan
  **pendientes y bloquean** el merge.
- Con jobs explícitos, un job salteado se reporta como «skipped», y la protección de ramas lo cuenta como
  **exitoso**. Se prefiere que un E2E que no corrió bloquee, antes que verlo como aprobado.
- Sacar `needs: calidad` tampoco: el E2E correría paquetes antes de verificar sus firmas y sus binarios.

## Verificación

- `security-tests/e2e-etiquetas.test.ts`: etiquetas, cada test en una sola parte, y las partes del CI y
  del nocturno iguales a las de `scripts/e2e-partes.mjs`.
- `security-tests/e2e-procesos.test.ts`: la vigilancia al final de cada archivo, con control positivo.
- `security-tests/cache-ci.test.ts`: una caché de Electron o de Chromium alterada hace fallar la
  verificación, con control positivo (sin alterar, pasa).
- `security-tests/acciones-ci.test.ts`: toda acción de terceros fijada por SHA; la caché, con clave exacta,
  verificada antes de usarse y guardada recién después de verificar.
- `security-tests/atestaciones-npm.test.ts`: el diagnóstico distingue una respuesta de atestaciones completa
  de una incompleta, sobre una caché con la forma de la de npm.
- Los workflows se validaron contra el esquema de GitHub Actions.
