# 028 — Login asistido: una ventana, y nada que quede

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Un segundo factor, un captcha o un enlace por correo no se pueden automatizar sin guardar algo que no se debe (una
semilla TOTP llega en la fase 2, cifrada como un secreto más). Mientras tanto, la persona entra a mano.

## Decisión

**La ventana.** El runner abre un Chromium con ventana, aparte del navegador del escaneo, con los mismos argumentos,
el sandbox de Chromium encendido y detrás del proxy de login. Un contexto en memoria, sin video, traza, HAR ni
capturas. QAtlas mira el indicador de éxito cada medio segundo, hasta 5 minutos. Si la persona cierra la ventana, el
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

- Si la persona elige «Guardar contraseña» en la ventana, Chromium la guarda en el perfil temporal, que se borra al
  cerrar. QAtlas no lo puede impedir sin una política del sistema operativo.
- En Linux sin pantalla, el asistido no se puede usar. En CI corre con `xvfb-run`.
