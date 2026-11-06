# 027 — Sesión vencida: confirmar, volver a entrar, y cuándo parar

- **Estado:** aceptada
- **Fecha:** 2026-11-06

En un escaneo largo la sesión vence. Si no se detecta, el escaneo sigue sobre la pantalla de login y llena el
resultado de hallazgos que no son del sistema. Si se detecta mal, entra una y otra vez, y un sistema real bloquea la
cuenta.

## Decisión

**Sospecha, no certeza.** Una página levanta sospecha si:

- terminó en la URL de login (sin query), o en un dominio de autenticación;
- su navegación principal se cortó yendo a un dominio de autenticación (el proxy del escaneo no lo conoce, ADR 025);
- respondió 401, o un 403 que no puso nuestro proxy;
- tiene en pantalla el campo de contraseña del login (el selector del paso del secreto, o cualquier contraseña).

**Se confirma** abriendo, en el mismo contexto, la página donde se confirmó el login, y mirando el indicador de éxito.
Si la sesión sigue, la página se analiza como siempre: un 403 por rol es un hallazgo más, y una pantalla de «cambiar
contraseña» también. Si venció, la página **vuelve adelante de la cola sin analizarse**, el runner pide un login, y
sigue con un contexto nuevo. Nunca hay hallazgos de la pantalla de login. La básica no tiene sesión que vencer: no se
sospecha.

**El escaneo autenticado** nunca encola la URL de login y suma solas las exclusiones de cierre (logout, salir, cerrar
sesión y parecidas). La URL de la básica no es una pantalla de login: se recorre.

**Límites, en el proceso principal:**

- Como mucho **3 logins por sesión vencida** en una ejecución. El cuarto se niega y el escaneo se detiene con lo
  recorrido («limite-logins»). Un login que funciona y vuelve a dar sesión vencida enseguida cuenta: es el bucle que
  el tope corta.
- Las **renovaciones planificadas** (por la duración máxima) no cuentan para ese tope, pero sí para el límite de
  **3 cada 15 minutos por credencial**, que vale para todo login automático. Una renovación que ese límite niega no
  detiene el escaneo: sigue con la sesión que tiene, hasta que venza de verdad.
- El **login asistido** no entra en el límite por credencial: lo hace una persona.

**Pausa.** Cuando hace falta la persona (venció la sesión de un asistido, o el enlace del portal ya no sirve), la
ejecución queda **pausada**: lo avisa en la interfaz y sigue con «Reanudar». Pausada cuenta como activa (retiene la
cola). A los 15 minutos sin reanudar, se cancela. Un enlace nuevo se carga reemplazando el secreto de la credencial,
nunca por el canal de reanudar.

**El tiempo de los logins y de las pausas no cuenta** para el tiempo máximo del escaneo.

## Cómo se prueba

- Los tres casos del tope, con reloj controlado, y la pausa con temporizadores falsos: `ejecuciones.test.ts`.
- La renovación planificada y el tiempo fuera, con un navegador de mentira: `gestor-sesion.test.ts`.
- El vencimiento real, sin depender del tiempo: el sandbox vence la sesión a las N páginas
  (`escaneo-autenticado.e2e.ts`), con formulario, SSO y enlace.

## Consecuencias

- Confirmar cuesta un pedido más por sospecha. Una página con un formulario de contraseña legítimo lo paga cada vez.
- Sin indicador de éxito no hay forma de confirmar: una credencial sin indicador no se puede usar para escanear
  (salvo la básica).
