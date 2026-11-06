# 024 — Criterios de los chequeos del escaneo

- **Estado:** aceptada
- **Fecha:** 2026-11-05

La severidad sale de la tabla de 6.3. Lo que la especificación no definía, se define acá. El oráculo
(`apps/sandbox-site/hallazgos-esperados.json`) lo comprueba en un navegador real.

## Errores HTTP

- La página responde 5xx: crítica.
- 404 o 410 al seguir un link: link roto, media, con la página donde estaba el link.
- Otro 4xx de la página, o un 404 sin link de origen: error HTTP, media.
- Un recurso con 4xx o 5xx, o una request fallida: media.
- **No cuenta lo que cortamos nosotros:** el proxy marca sus 403 con `x-qatlas-bloqueado`, y la segunda capa anota lo
  que bloquea. Tampoco una navegación abortada ni el contenido mixto, que es su propio hallazgo.

## console.error

Cuenta cada mensaje de tipo error, con severidad baja, salvo:

- «Failed to load resource»: lo cubren los chequeos de HTTP.
- «Mixed Content»: es su propio hallazgo.
- Los que nombran una URL o un host que bloqueamos nosotros: ya se informan como recurso bloqueado, y no son un
  error del sitio.

Las excepciones de JavaScript no capturadas van aparte, con severidad alta.

## Cookies de sesión

- **Es de sesión** si no vence (sin `Expires` ni `Max-Age`) o si un **segmento** de su nombre lo sugiere: `sess`,
  `sesion`, `session`, `sessid`, `sessionid`, `phpsessid`, `jsessionid`, `sid`, `ssid`, `auth`, `token`, `jwt` o
  `login`. Los segmentos se separan por `_`, `-`, `.` y por un cambio de minúscula a mayúscula: «ses» no atrapa
  «preferences» ni «classes».
- **Anti-CSRF** (`XSRF-TOKEN`, `csrftoken`, `_csrf`, `__RequestVerificationToken`): tiene que ser legible por JavaScript,
  así que sin HttpOnly no es un hallazgo. Secure sí se controla en HTTPS.
- **Le falta HttpOnly:** se marca, alta, salvo en una anti-CSRF.
- **Le falta Secure:** solo en HTTPS. En HTTP el problema es el login sin cifrar, que tiene su hallazgo.
- Se guardan el nombre y lo que le falta, nunca el valor.

## Login sobre HTTP

Una página con un campo de contraseña que no es un contexto seguro, según el navegador. Así no salta en `localhost` ni
en `127.0.0.1`, que el navegador considera seguros y son el caso típico de desarrollo, y sí en `.test` y en hosts
reales.

## Contenido mixto

Una página HTTPS que pide recursos por HTTP: Chromium lo informa en la consola como «Mixed Content». Uno por página.

## Rendimiento

Severidad baja. En la interfaz llevan «medición orientativa, tomada en este equipo»: es una medición de laboratorio,
sin GPU, por el proxy y con el límite de requests por segundo, en un perfil vacío.

- **Carga:** 3 segundos o más hasta el evento `load`.
- **LCP:** más de 4 segundos, el «malo» de Core Web Vitals. Chromium no cuenta para el LCP una imagen de baja entropía,
  como un rectángulo de un solo color.
- **Request lenta:** un recurso que tarda más de 2 segundos. La página misma no cuenta: ya es la carga.
- **Peso:** más de 3 MB con todos sus recursos.

## Recursos bloqueados

Un recurso de otro dominio, o de un puerto no declarado, bloqueado por la segunda capa o por el proxy: informativo,
uno por host y página.

## La segunda capa decide también por puerto

Antes decidía solo por el nombre. Ahora aplica la misma regla de puertos que el proxy, para que un bloqueo por puerto
también se vea en el navegador y no aparezca como un 403 del sitio.
