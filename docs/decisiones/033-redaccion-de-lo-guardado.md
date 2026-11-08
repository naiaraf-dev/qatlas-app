# 033 — Redactar lo guardado antes de la semana 7

- **Estado:** aceptada
- **Fecha:** 2026-11-07

## Contexto

Las bases de las semanas anteriores tienen URLs, detalles de hallazgos, claves sin HMAC y destinos del
monitor sin redactar. Las copias de seguridad, también.

## Decisión

**Corre al abrir la base**, es decir, al desbloquear o al restaurar una copia. Es el enganche nuevo
`alAbrir` de la bóveda, después de las migraciones de esquema. Necesita la clave maestra para abrir la
clave de cada proyecto, descifrar los campos cifrados y armar el comparador de sus credenciales.

**Proyecto por proyecto, cada uno en una transacción.** Redacta las URLs de las páginas (la corta y la
completa), los títulos, URLs y claves de los hallazgos, el detalle de cada aparición (se descifra, se
redacta y se vuelve a cifrar) y los destinos del monitor. Recalcula las claves de los mensajes como HMAC
(ADR 032). Si una aparición vieja no tiene detalle, la clave nueva es un HMAC sobre la vieja. Al final marca
`proyecto.redaccion_version`.

**Si se corta**, la transacción de ese proyecto se revierte y queda como estaba; los que ya terminaron
quedan marcados. El próximo desbloqueo retoma desde ahí. **Es idempotente**: redactar lo ya redactado no
cambia nada, y el conteo de secretos de cada aparición se suma, así una segunda pasada no borra el aviso.

**Las copias de seguridad** viejas no se tocan, porque están cifradas. Al restaurar una, se redacta antes
de usarla.

## Cómo se prueba

`apps/desktop/src/main/ejecuciones/redaccion.test.ts`:

- una base con datos como los de antes (el canario y un JWT en una URL, un detalle y un destino, y una clave
  sin HMAC) queda sin el canario, con las claves como HMAC y el proyecto marcado;
- una segunda pasada no cambia nada;
- un corte simulado en el segundo proyecto deja el primero redactado y el segundo intacto, y un desbloqueo
  posterior lo termina.

## Consecuencias

- Si un proyecto no se puede redactar (por ejemplo, un dato cifrado que no abre), queda sin marcar y se
  registra el evento técnico. Se reintenta en cada desbloqueo.
- Lo que SQLCipher haya dejado en páginas libres de la base sigue cifrado por SQLCipher: no queda en claro
  en disco.
