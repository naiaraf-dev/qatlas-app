# 006 — SQLCipher con el binario precompilado del paquete

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

La especificación (3.4) pide SQLite cifrada completa con SQLCipher, mediante
`better-sqlite3-multiple-ciphers`. Había que decidir cómo se compila el módulo nativo para Electron,
si suma scripts de instalación a la lista permitida y cómo corre en CI.

## Verificación previa

Con la versión 13.0.3, en una carpeta temporal y con Electron 45.1.0:

- El tarball trae binarios en `prebuilds/` para 8 plataformas, y no declara script de instalación.
- Usa la API estable de Node (`node-addon-api`), así que no depende del ABI de Electron: el binario
  cargó en Node 22 y en Electron sin compilar.
- Con el cifrador `sqlcipher` (`legacy=4`), el archivo no tiene cabecera de SQLite ni texto plano, y no
  abre sin clave ni con una clave incorrecta.

## Decisión

Usar el binario precompilado del paquete, con la versión exacta fija.

- **Sin compilación:** no hace falta `@electron/rebuild`.
- **Sin scripts:** no se agrega nada a `scripts/allowed-install-scripts.mjs`.
- **CI:** usa el mismo binario de Linux x64. `npm run test:crypto:electron` corre los tests de la base
  y TS-02 dentro del runtime real de Electron.

La clave se pasa cruda (`x'…'`, sin el PBKDF2 de SQLCipher, porque ya sale de HKDF) con `db.key(Buffer)`,
armada byte a byte: no pasa por un string de JavaScript, que no se podría borrar. TS-02 verifica que
también abra con la forma estándar `PRAGMA key`.

## Dependencias

| Paquete                                  | Para qué                   | Alternativas                             | Script de instalación | Mantenimiento                                     |
| ---------------------------------------- | -------------------------- | ---------------------------------------- | --------------------- | ------------------------------------------------- |
| `better-sqlite3-multiple-ciphers` 13.0.3 | SQLite con SQLCipher       | `@journeyapps/sqlcipher` (API asíncrona) | No                    | Un mantenedor principal; publica procedencia SLSA |
| `drizzle-orm` 0.45.4                     | Esquema y consultas        | SQL a mano; Kysely                       | No                    | Publicación frecuente                             |
| `node-addon-api` (ya estaba)             | Dependencia de la anterior | —                                        | No                    | Proyecto de Node.js                               |

`drizzle-kit` queda afuera: suma `esbuild`, con su script de instalación, y `tsx`. Las migraciones son
SQL escrito a mano, en `packages/db/src/migraciones.ts`, y un test compara sus columnas con el esquema.

El driver de Drizzle importa `better-sqlite3`, que no está instalado: se resuelve con un alias al
paquete cifrado en `electron.vite.config.ts` y `vitest.config.ts`. Así nunca puede cargarse por error
una variante sin cifrado.

## Consecuencias

- **Tradeoff aceptado:** se confía en un binario publicado por un solo mantenedor. La procedencia indica
  cómo se generó, pero no reemplaza una revisión del código.
- **Pendiente para la semana 10:** compilar SQLCipher desde fuente, en CI, para los instaladores.
- La integridad del `.node` en disco se trata en la [ADR 007](007-integridad-modulos-nativos.md).
- Al actualizar el paquete hay que volver a correr TS-02 en Electron y revisar esta ADR.
