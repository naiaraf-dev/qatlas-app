# 035 — Formato de archivo v2: una semilla por evidencia

- **Estado:** aceptada
- **Fecha:** 2026-11-08

## Contexto

La retención (EVI-06) y el modo datos sensibles (f6) eliminan evidencias sueltas con borrado
criptográfico. En el formato v1, la clave de cada archivo salía de la subclave de archivos del proyecto
más el salt de la cabecera. Borrar el archivo no destruía su clave: una copia recuperada del disco (un SSD
conserva restos) se descifraba mientras viviera el proyecto. El borrado criptográfico existía solo por
proyecto (TS-10).

## Decisión

**Versión 2 del formato.** Cada evidencia tiene una **semilla aleatoria de 32 bytes**, que se guarda solo
en su fila de la base (SQLCipher, con `secure_delete`), nunca junto al archivo:

```
clave = HKDF(HKDF(subclave de archivos, semilla, "qatlas/v2/evidencia/<id>"), salt, "qatlas/v2/archivo/<id>")
```

- Para descifrar hacen falta las dos: la clave del proyecto y la semilla.
- **Borrar la fila** es el borrado criptográfico de esa evidencia, aunque el proyecto siga vivo.
- **Eliminar el proyecto** lo sigue siendo de todas.
- La v1 nunca guardó evidencias: se rechaza por su versión (`VERSION`).
- La semilla llega a la base recién cuando la evidencia se conserva. Un tramo de video descartado nunca
  la guardó: lo que quede de su archivo es ilegible desde el primer byte.

Es la misma construcción (HKDF, sin criptografía propia). La semilla en la sal del primer HKDF hace que la
clave intermedia sea un HMAC con clave secreta; sin la semilla, sin la subclave o sin las dos, la salida
no se puede calcular.

## Consecuencias

- `crearCifradorArchivo` y `crearDescifradorArchivo` reciben la semilla; `crearSemillaEvidencia` la crea.
- La columna `evidencia.nonce` de la especificación sigue sin hacer falta: el nonce está en la cabecera.
- Una copia de seguridad conserva las semillas que tenía al crearse: el mismo límite de la ADR 009.

## Verificación

`packages/crypto/src/archivos.test.ts` (otra semilla no descifra; la v1 se rechaza) y
`security-tests/ts-10-evidencias.test.ts`: borrada la semilla, una copia del archivo no se descifra con la
clave del proyecto viva; eliminado el proyecto, tampoco con la semilla copiada. Los dos con control
positivo.
