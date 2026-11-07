# 028 — Login asistido: una ventana, y nada que quede

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Un segundo factor, un captcha o un enlace por correo no se pueden automatizar sin guardar algo que no se debe (una
semilla TOTP llega en la fase 2, cifrada como un secreto más). Mientras tanto, la persona entra a mano.

## Decisión

**La ventana.** El runner abre un Chromium con ventana, aparte del navegador del escaneo, con los mismos argumentos,
el sandbox de Chromium encendido y detrás del proxy de login. Sin video, traza, HAR ni capturas.

**Sin «Guardar contraseña».** La ventana usa un perfil propio (`launchPersistentContext`), creado dentro de la
carpeta de la ejecución en la carpeta de datos (`perfiles/<ejecución>/asistido-…`, ADR 018), nunca en el temporal del
sistema. Se borra al cerrar la ventana; si algo lo corta, se va con la carpeta de la ejecución al terminar, y al
arrancar con la limpieza de perfiles huérfanos. El runner recibe esa carpeta explícita (su directorio de trabajo,
que fija el proceso principal), no la deduce de `TEMP`. El gestor de contraseñas está apagado en sus preferencias:
`credentials_enable_service`, `credentials_enable_autosignin`, `profile.password_manager_enabled` y
`profile.password_manager_leak_detection` en falso. No hay un argumento de Chromium para esto, y los contextos de
`launch` son de incógnito, así que las preferencias no se pueden poner ahí. Una sonda con
`chrome://password-manager-internals` mostró la diferencia. Con el perfil de siempre, al enviar el login decide «ASK
the user» y «Show password prompt». Con estas preferencias, decide «Saving disabled» y «DROP the password».
`e2e/ts-06-login-asistido.e2e.ts` lo comprueba así, con el control positivo, y comprueba que el perfil de la ventana
existe mientras está abierta y desaparece al cerrar. QAtlas mira el indicador de éxito cada medio segundo, hasta 5 minutos. Si la persona cierra la ventana, el
login se cancela («ventana-cerrada»); a mitad del escaneo, la ejecución se pausa (ADR 027).

**Lo que se escribe no queda.** Mientras la ventana está abierta, QAtlas toma lo que hay en los campos de contraseña
(desde el mundo de Playwright, no el de la página) y los valores de los formularios que se envían con un nombre de
contraseña. Solo en la memoria del runner, para sacarlo del estado de sesión (ADR 026). Si el sitio la guardó en el
navegador, es un hallazgo (ADR 029).

**La actividad en esa ventana no cuenta como actividad de QAtlas.** El bloqueo por inactividad sigue corriendo, y
bloquear cancela la ejecución. La interfaz lo avisa al elegir la credencial y mientras espera.

**TS-06 de verdad.** El sandbox tiene una pantalla de login que guarda la contraseña en localStorage al enviar. En el
E2E, Playwright escribe el canario como contraseña en la ventana, y el test comprueba que no queda en el estado de
sesión (descifrado), en el perfil del navegador (con la ventana abierta y después), en la base (descifrada, tabla
por tabla, y sus archivos) ni en los logs. Para eso el test corre los servicios reales y el runner real en su propio
proceso (`crearRunner`): en la app, el runner es un `utilityProcess` y la ventana no tiene un puerto por donde
manejarla, a propósito. La app no tiene ningún comportamiento especial para tests. El E2E de la app real usa una
pantalla del sandbox que solo pide el segundo factor, y el test lo aprueba cuando el sandbox lo pidió.

**Detalles de la prueba.** Los E2E cargan con su propio `tsconfig.e2e.json`: el de la base mapea `better-sqlite3` a sus
tipos, y Playwright aplicaría ese mapeo al ejecutar. El driver de Drizzle importa `better-sqlite3`; en el test, como en
Vitest y en electron-vite, se resuelve a la variante con SQLCipher con `registerHooks` de Node (22.15 o más nuevo).

## Consecuencias

- El perfil de la ventana se escribe en la carpeta de datos mientras está abierta, como el de cualquier contexto de
  Chromium: lo que el sitio guarda (cookies, almacenamiento) está ahí hasta que se cierra y se borra.
- En Linux sin pantalla, el asistido no se puede usar. En CI corre con `xvfb-run`.
