# 010 — `boveda.sellada` y formato de la copia de seguridad

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

La especificación ponía `salt_kdf`, `parametros_kdf` y `clave_maestra_cifrada` en la tabla `boveda_meta`.
Eso no puede funcionar: esos datos hacen falta para obtener la clave que abre la base donde estarían.

## Decisión

### Archivo sellado

`boveda.sellada`, junto a `boveda.db`, guarda en JSON el salt, los parámetros de la KDF y la clave
maestra envuelta. No contiene nada en claro. En `boveda_meta` quedan `version_esquema` y
`recordar_en_equipo`.

- **Mínimos al leer:** si los parámetros de Argon2id están por debajo de los mínimos (o por encima de
  los máximos), se rechaza y no se abre, sin derivar nada. Además están autenticados en la envoltura.
- **Escritura atómica:** temporal en la misma carpeta, `fsync` y `rename`. Un archivo a medio escribir
  nunca reemplaza al bueno, y los temporales se borran al iniciar.
- **Nunca se pisa:** si falta o está dañado uno de los dos archivos, la bóveda queda "dañada", nunca
  "sin bóveda", así que el asistente no puede crear una encima.

### Base y sellada como una unidad

Los dos archivos deben corresponderse. Crear y restaurar escriben las versiones `.nueva`, después una
marca (el punto de no retorno) y recién entonces renombran. Al iniciar, con marca se completa la
instalación; sin marca se descartan los restos.

### Copia de seguridad

```
"QATB" (4) | versión (1) | largo de la sellada (4, big-endian) | sellada | base
```

La base sale de **`VACUUM INTO` con la base abierta**, así que no hace falta bloquear la bóveda. Conserva
el cifrado y la clave, y no copia las páginas libres. `db.backup()` no sirve: falla con una base cifrada
y un destino nuevo. La copia se escribe de forma atómica y su archivo temporal, ya cifrado, se borra.

Al restaurar se valida la estructura, el tamaño (1 GiB como máximo) y que la base no esté en texto
plano; después se abre con la contraseña de la copia y se verifica con `integrity_check`. Cualquier
fallo deja la bóveda actual intacta.

## Consecuencias

- Las páginas de SQLCipher están autenticadas con HMAC y la sellada con AES-GCM: alterar la copia hace
  fallar la restauración. El formato no autentica la copia como un todo, porque no lo necesita.
- `VACUUM INTO` escribe en la carpeta de datos, no en el destino: si el destino falla, no quedan
  restos allí.
- La copia se arma en memoria. Alcanza para la base, pero las evidencias (semana 7) van a necesitar
  ampliar el formato, en streaming, con una versión nueva.
- La sellada queda fuera de la base: el cambio de contraseña, todavía pendiente, va a poder reemplazarla
  de forma atómica sin tocar la base. Una copia vieja sigue abriendo con la contraseña vieja
  (`packages/crypto/README.md`).
