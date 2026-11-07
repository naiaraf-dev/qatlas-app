# 029 — Parámetros sensibles en la URL y contraseñas guardadas por el sitio

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Dos chequeos nuevos de seguridad observable (6.3), con los mismos principios que el ADR 024: el nombre, nunca el
valor, y el oráculo del sandbox los comprueba.

## Parámetro sensible en la URL

Un token o una clave en la URL queda en el historial, en los logs de los servidores y en el `Referer`.

- Se mira cada página visitada, con su query.
- Un parámetro es sensible si un **segmento** de su nombre (como en las cookies) es `token`, `code`, `session`,
  `sessionid`, `sid`, `jwt`, `apikey`, `password`, `passwd`, `secret`, `auth`, `clave`, `contrasena` u `otp`, o si
  el nombre entero, sin separadores, es uno de ellos (`apiKey`, `api_key`). `tokenizer` y `authors` no.
- **Media.** Un `code` junto a un `state` es la vuelta de OAuth u OpenID Connect, con un código de un solo uso y de
  vida corta: **informativa**.
- Se guarda el nombre del parámetro en la clave y en el título. El valor no sale del runner, y la URL guardada de la
  página va sin query (la completa, cifrada, como siempre).
- La URL de login y las de los dominios de autenticación nunca se visitan en el escaneo: el enlace con token de una
  credencial no se reporta contra sí mismo.

## Contraseña guardada por el sitio

Al tomar el estado de sesión (ADR 026), una cookie o una entrada de localStorage que contiene el secreto se saca, y
se reporta: **alta**, en la URL de login, con la clave `cookie:<nombre>` o `localStorage:<nombre>`. Sin el valor. Se
reporta una vez por ejecución aunque se vuelva a entrar.
