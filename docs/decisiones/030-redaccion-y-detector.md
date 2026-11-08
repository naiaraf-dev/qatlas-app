# 030 — Redacción de red y detector de secretos

- **Estado:** aceptada
- **Fecha:** 2026-11-07

## Contexto

La especificación pide redactar los encabezados y campos sensibles en la red (EVI-03) y detectar secretos
en la consola, la red, el DOM y los reportes (EVI-04). Hasta la semana 6b, el detalle de los hallazgos se
guardaba cifrado pero sin redactar (ADR 023), y las URLs se guardaban tal cual.

## Decisión

**Un paquete propio, `packages/redaction`, sin dependencias**, con funciones puras: `redactarTexto`,
`redactarUrl`, `redactarEncabezados`, `redactarFormulario`, `redactarJson`, `redactarCuerpo` y
`redactarSecuencia`. Cada redacción deja `[REDACTADO:tipo]` y un registro de regla, tipo y cantidad.
**Nunca el valor**, ni en el texto ni en el registro.

**Qué detecta:**

- **Formatos conocidos, de alta precisión** (`patrones.ts`): claves privadas PEM, JWT, claves de AWS,
  tokens de GitHub, GitLab, Slack, npm, claves de Stripe, Google, Anthropic, OpenAI y SendGrid, `Bearer` y
  `Basic`, y usuario y contraseña dentro de una URL. Algunos se adaptaron de las reglas de gitleaks
  (licencia MIT): cada uno lo dice en su campo `origen`, y el aviso está en el archivo y en
  `THIRD_PARTY_NOTICES.md`. Trufflehog no, por su licencia AGPL-3.0.
- **Nombres sensibles, por segmentos** (como el chequeo de la 6b, que ahora usa la misma lista): el valor
  de `password=`, `"apiKey": …`, `X-Auth-Token` o `access_token` se redacta siempre. `tokenizer` y
  `authors`, no. Un segmento, o hasta tres seguidos unidos (`X-API-Key` → «apikey»).
- **Entropía, solo en contextos sospechosos**: un nombre que contiene `key`, `token`, `secret`, `pass`,
  `auth`, `cred`, `sig`, `priv`, `sess` o `cookie`, con un valor de 20 caracteres o más y 3,5 bits por
  carácter o más. Fuera de contexto, la entropía no redacta nada.
- **El valor exacto de los secretos de las credenciales**, sin guardarlo (ADR 031).

**Falsos positivos excluidos**, con sus casos en los tests: UUID, hashes en nombres de assets, `nonce` e
`integrity`, SHA de git y hashes hexadecimales, colores, números, y valores como `code: 404` o
`token: null`.

**Encabezados** (EVI-03): Authorization, Proxy-Authorization, Cookie y Set-Cookie siempre; los de nombre
sensible también; el resto, por el detector. **El cuerpo de una respuesta no se guarda**: `redactarCuerpo`
devuelve solo la marca. Hoy QAtlas no guarda encabezados ni cuerpos; las funciones quedan listas para las
evidencias de la semana 7b (HAR y traza).

**Mantenimiento.** Un patrón nuevo entra con un ejemplo positivo y uno negativo, inventados y armados por
partes, para que ningún escáner de secretos los confunda con uno real. La lista se revisa cuando gitleaks
publica reglas nuevas para servicios que el equipo use. Cobertura del paquete: más de 90 %.

## Consecuencias

- Un secreto con un formato que no está en la lista, y que no va con un nombre sensible ni es una
  credencial del proyecto, no se detecta. Es el límite de cualquier detector por patrones.
- Una marca puede ser más larga que el valor que reemplaza: `recortar` corta al largo del protocolo o de
  la base, sin dejar ver nada.
