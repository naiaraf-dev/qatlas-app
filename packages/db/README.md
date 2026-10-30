# @qatlas/db

Base SQLite cifrada con SQLCipher, esquema con Drizzle, migraciones versionadas, archivo sellado y copia
de seguridad. Node puro: no importa `electron` y se prueba con Vitest. Especificación: secciones 3.4,
3.10 y 5.

## Archivos en disco

| Archivo            | Contenido                                                             | Cifrado               |
| ------------------ | --------------------------------------------------------------------- | --------------------- |
| `boveda.db`        | Base de datos                                                         | SQLCipher, completa   |
| `boveda.sellada`   | Salt, parámetros de Argon2id y clave maestra envuelta                 | La clave, con AES-GCM |
| `*.nueva`, `*.tmp` | Restos de una instalación o escritura en curso; se limpian al iniciar | Igual que su archivo  |

`boveda.sellada` existe porque esos datos hacen falta antes de poder abrir la base
([ADR 010](../../docs/decisiones/010-boveda-sellada.md)).

## Reglas

- **SQLCipher siempre:** `abrirBaseCifrada` es la única forma de abrir una base. Falla cerrado.
- **Temporales en memoria** (`temp_store=MEMORY`) y `secure_delete=ON`.
- **Clave cruda en bytes:** nunca pasa por un string de JavaScript.
- **Migraciones:** en `migraciones.ts`, solo se agregan al final. La versión es `user_version`, cada
  aplicación es una transacción, y una base más nueva que la app se rechaza sin tocarla.
- **Tablas de proyecto:** cada tabla nueva con `proyecto_id` se agrega a `TABLAS_DE_PROYECTO`, para que
  la purga por lápidas la alcance ([ADR 009](../../docs/decisiones/009-copias-y-borrado-criptografico.md)).

## Tests

```bash
npm run test:coverage         # incluye este paquete, con un mínimo de 80 %
npm run test:crypto:electron  # también dentro del runtime real de Electron
```

La seguridad de punta a punta está en `security-tests/ts-02-base-cifrada.test.ts`.
