# 025 — Estrategias de login, roles y proxy de login

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Hasta la semana 6a, una credencial era un formulario: usuario, secreto, URL de login y pasos. Los sistemas reales
entran de otras formas: un proveedor de identidad en otro dominio, un enlace de un portal, un segundo factor que
solo una persona puede completar, o la autenticación básica del servidor. El catálogo completo, con las fases de
las que llegan después, está en la especificación (6.2.1).

## Decisión

**Cinco estrategias en el contrato:** formulario, SSO con redirección, enlace con token, login asistido y HTTP básica.
Las cuatro primeras se usan en la fase 1; **la básica llega en la fase 2** (ver «La fuga de la básica»). Ninguna tiene
un campo de texto libre para un valor secreto: el contrato no sabe de estrategias, y es el proceso principal el que
valida lo que cada una exige.

- **SSO:** los pasos se hacen en la pantalla del proveedor. El proveedor va en los **dominios de autenticación**.
- **Enlace con token:** el secreto es el enlace completo, cifrado. La URL de login sale de él, sin la query: el token
  nunca queda en claro. El enlace se valida como una URL de login (alcance más dominios de autenticación, http solo
  con la opción).
- **Asistido:** no guarda ningún secreto. Ver ADR 028.
- **Básica (fase 2):** la contraseña viajaría al runner en el login y quedaría en su memoria todo el escaneo, porque
  va en cada pedido. Hoy no se puede crear ni usar.

**Dominios de autenticación:** por proyecto, aparte de los dominios del alcance. Son parte del alcance autorizado:
aparecen en la declaración, y cambiarlos invalida la autorización y queda en la auditoría. Se usan solo durante el
login; el escaneo nunca los visita.

**Proxy de login aparte.** El login corre en un contexto propio de Chromium con su propio proxy, que el proceso
principal levanta solo mientras dura el login, con el alcance más los dominios de autenticación. El proxy del
escaneo no conoce esos dominios: si una página del escaneo redirige al proveedor, se corta, y eso es la señal de que
la sesión venció (ADR 027). Una sonda mostró que en Chromium cada contexto usa el proxy que se le da.

**La básica la pondría QAtlas, no Playwright.** Cuando el proxy tiene usuario, Playwright reemplaza las
`httpCredentials` del contexto por las del proxy (lo dice su código), así que las nuestras nunca llegan: una sonda
dio 401 con y sin `origin`, con y sin rutas. QAtlas agrega el encabezado `Authorization` en una ruta del contexto
(`ponerBasica`), y cada pedido se decide con `llevaBasica`: solo al origen exacto de la URL base (esquema, host y
puerto) y, en http, solo con «Permitir login sin cifrar», sin la excepción de los equipos locales y `.test` que tiene
la URL de login. Esa ruta se registra antes de las protecciones, así que corre después de ellas: un pedido bloqueado
nunca la lleva.

## La fuga de la básica, y por qué espera a la fase 2

Un test con Chromium real (`e2e/basica-encabezado.e2e.ts`) encontró la fuga: **si el origen base responde con una
redirección a otro origen, Chromium manda el `Authorization` también al destino.** Pasa con otro host del alcance,
con otro puerto y con https que baja a http.

**Cómo se reproduce.** Dos servidores locales, uno https y otro http; `localhost` y `127.0.0.1` son orígenes
distintos sobre el mismo servidor. El contexto lleva `ponerBasica` para `https://localhost:<puerto>`, y se abre
`/redirigir?a=https://127.0.0.1:<puerto>/destino`: el servidor recibe el encabezado en `/destino`. El último test
del archivo lo reproduce con `test.fail`: si un día deja de fugar, falla y hay que volver acá. Una sonda aparte
(una ruta que registra todo lo que ve) mostró la causa: **la ruta nunca ve el pedido que sigue a una redirección.**
Chromium la sigue por dentro y le aplica los encabezados que la ruta le puso al pedido anterior. No se puede sacar el
encabezado desde la ruta, porque ese pedido no pasa por ella. Lo demás se cumple, y tiene su test: sin la opción nunca va
sobre http, y nunca va a otro origen sin redirección (un recurso de la página, otro host, otro puerto).

**Mientras tanto, falla cerrado.** El proceso principal no deja crear una credencial básica
(`estrategia-no-disponible`). Una que ya existe (de antes o de una copia) se ve y se puede editar, pero no se prueba
ni se lanza, y la interfaz dice por qué. La opción se ve en el formulario, deshabilitada, con «Llega en: fase 2» y el
motivo. El runner conserva `ponerBasica` y `llevaBasica`, con sus tests, para retomarlo.

**Alternativas descartadas, para retomar en la fase 2:**

- **`route.fetch` sin seguir redirecciones, y `route.fulfill`.** Es la vía que documenta Playwright: cada
  redirección vuelve al navegador como respuesta y el pedido siguiente pasa por la ruta. Se descartó porque esas
  respuestas se leerían en el proceso Node del runner, fuera del sandbox de Chromium, con el cuerpo entero en memoria,
  y el TLS lo validaría Node con sus propias autoridades. El sitio probado es lo no confiable (3.5): su respuesta se
  procesa en el sandbox.
- **Cortar las redirecciones por CDP**, en la etapa de respuesta, con una sesión por página. Todo queda en Chromium,
  pero cubre solo las páginas: no los iframes que corren en otro proceso ni los workers. No es una garantía completa.

Para la fase 2 queda por evaluar, entre otras, la autenticación nativa de Chromium (responder al desafío 401 desde
el protocolo de DevTools, sin que Playwright le dé las credenciales del proxy), que no arrastra el encabezado a otro
origen.

**Roles.** Cada credencial tiene un rol, único en el proyecto sin distinguir mayúsculas. Al lanzar un escaneo se
elige con qué credencial, o ninguna. La ejecución guarda la credencial y el rol. Comparar lo que ve cada rol llega en
la fase 4; la estructura ya está.

**La estrategia no se cambia.** El secreto guardado es de una forma: una contraseña no es un enlace, y pasar a
asistido dejaría un secreto que no se usa. Para otra estrategia se crea otra credencial.

**Migración 6.** SQLite no deja sacar el NOT NULL del secreto: la tabla de credenciales se reconstruye. Lo existente
queda como formulario, con el secreto intacto y el nombre como rol (con un número si dos tenían el mismo nombre).
Un test fabrica una copia con el esquema 5, comprueba que es igual a una base migrada hasta ahí, la restaura y
verifica las credenciales.

## Consecuencias

- Un login que no se puede automatizar (captcha, segundo factor) igual se puede escanear: con el asistido.
- El proxy de login es un proceso más, por poco tiempo.
- Hasta la fase 2, un sistema que solo entra con la básica no se puede escanear autenticado.
