# 041 — Una sola forma de lanzar el navegador, y un solo `--disable-features`

- **Estado:** aceptada
- **Fecha:** 2026-11-25

## Contexto

El E2E del CI de Linux vio una conexión de Chromium a `www.google.com:443`. El proxy la bloqueó (no hubo
fuga), pero apareció en el monitor y rompió tres tests de contención. Con el net-log de Chromium:

- Venía del navegador **de la app** (`abrirNavegador`), no de un test.
- Playwright apaga con su propio `--disable-features` varios servicios que se conectan solos, entre ellos
  la elegibilidad de AI Mode (`www.google.com/async/folae`), la hora de red (`clients2.google.com`), las
  sugerencias de optimización y la traducción, y también `HttpsUpgrades`.
- `ARGUMENTOS_CHROMIUM` agregaba un segundo `--disable-features=PreconnectToSearch,AutofillServerCommunication`.
  **Chromium se queda solo con el último**, así que todo lo que Playwright apagaba volvía a encenderse.
- Los tests lanzaban el navegador cada uno a su manera, con argumentos parecidos pero no iguales.

## Decisión

- **`opcionesChromium`** (`packages/runner/src/motor/opciones-chromium.ts`) arma las opciones de `launch` y
  `launchPersistentContext`: `channel: 'chromium'` (ADR 020), el sandbox encendido, los argumentos de red y
  **un solo `--disable-features`** con la lista de Playwright más la de QAtlas. La usan el runner, la ventana
  del asistido, todos los E2E y los scripts.
- Una función nueva para apagar va en `funcionesApagadas`; pasar `--disable-features` o `--enable-features`
  como argumento suelto tira un error.
- Los controles positivos de los tests sacan un freno con `control` (sin sandbox, sin los argumentos de red,
  con una función encendida). El código de la app nunca lo usa.
- La lista de Playwright se repite en el código. Al subir Playwright, un E2E compara la línea de comandos
  real (`chrome://version`) y falla si Playwright pide apagar algo que la app no apaga.

## Lo que queda, y cómo se ve

Chromium 156 intenta dos conexiones más que no se pueden apagar por línea de comando:

- `accounts.google.com` (`ListAccounts`, el reconciliador de cuentas);
- `update.googleapis.com` (la instalación a pedido del manifiesto de modelos locales; la actualización de
  fondo sí la apaga `--disable-component-update`, que Playwright ya pasa).

Se probó apagarlas con `BuiltInAIEagerInit`, las APIs de IA integradas (`AIPromptAPI`, `AIWriterAPI` y
otras), `OptimizationGuideModelExecution`, `OnDeviceModelBackgroundDownload`, `OptimizationGuideManifestBroker`,
`ChromiumAccountReconcilorDiceCookieUpgrade`, `--disable-optimization-guide-model-downloads-for-benchmarking`,
`--disable-delta-updates`, `--disable-updater-scheduler` y `--allow-browser-signin=false`. Ninguna sirvió.
Cuando los instaladores lleven su Chromium (semana 10), se puede revisar apagarlas con políticas del perfil.

Salen por contextos que no tienen la credencial del proxy: el proxy responde 407, nunca decide un destino y
no abre ninguna conexión.

**El monitor las muestra igual.** La promesa es que el monitor muestra todo lo que se intenta. Chromium
manda el primer pedido de cada contexto sin credencial y reintenta enseguida con ella, así que un 407 solo no
es un bloqueo. El proxy anota cada 407 sin credencial y espera `GRACIA_SIN_CREDENCIAL_MS` (1,5 s) el
reintento al mismo destino. Si no llega, lo registra como **bloqueado, con la regla
`servicio-interno-navegador`**. Al cerrar, registra lo que todavía esperaba.

- **Privacidad y conexiones** las muestra como cualquier otra conexión bloqueada.
- **El resumen de la ejecución** no las cuenta como bloqueos del sitio ni las lista. Dice aparte cuántas
  fueron y que están en Privacidad y conexiones.
- **Límite:** el proceso del proxy termina con `kill`. Un intento en el último segundo y medio de una
  ejecución puede no llegar a registrarse; nunca sale, porque el proxy ya lo rechazó.

El test de ruido las admite solo así: bloqueadas, sin credencial y con esa regla. Si alguna mandara la
credencial, o apareciera otra, falla.

## Verificación

- `packages/runner/src/motor/opciones-chromium.test.ts`: un solo `--disable-features`, con las dos listas, y
  los controles.
- `security-tests/navegador-verificado.test.ts`: todo `launch` usa `opcionesChromium` sin pisar lo que arma, y
  la app nunca usa `control`.
- `packages/runner/src/red/proxy.test.ts`: un 407 que vuelve con credencial no se registra; uno que no vuelve
  queda como `servicio-interno-navegador`, sin resolver ni conectar; al cerrar se registra lo pendiente.
- `apps/desktop/src/main/ejecuciones/ejecuciones.test.ts`: se guarda y se ve en el monitor, sin sumar al
  resumen.
- `e2e/navegador-ruido.e2e.ts`: la línea de comandos efectiva; con el Chromium completo y el proxy real, el
  net-log no tiene nada fuera de lo conocido, y todo lo que Chromium intentó está en el registro del proxy. Control: con AI Mode y la hora
  de red encendidas, el net-log las ve.
- `e2e/ejecuciones.e2e.ts`: el monitor de la app real, sin destinos de Google ni ajenos al recorrido.
- Los tests de contención buscan cada conexión por su destino, nunca «la última».
