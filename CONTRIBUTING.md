# Cómo contribuir

QAtlas tiene una sola responsable, que revisa y mergea todo. Antes de cambiar código, leé la
[sección 3 de la especificación](docs/especificacion-qatlas.md) (Seguridad y privacidad).

## Modelo de ramas

| Rama             | Para qué                                          | Quién escribe            |
| ---------------- | ------------------------------------------------- | ------------------------ |
| `main`           | Versiones publicadas                              | Solo PR desde `develop`  |
| `develop`        | Integración: lo próximo a publicar                | Solo PR desde `feat/...` |
| `feat/[función]` | Una funcionalidad o tarea, creada desde `develop` | Commits directos         |

El nombre sigue el formato `feat/[funcionalidad-modulo]`: `feat/boveda-db`, `feat/escaneo-runner`,
`feat/importacion-excel`.

Nunca se commitea directamente en `main` ni en `develop`.

## Formato de commits

- En español, con la primera línea breve y descriptiva: `Cifrado de archivos por bloques en streaming`.
- Commits chicos: un cambio por commit.
- Si hace falta explicar el motivo, va en el cuerpo, separado por una línea en blanco.

## Cómo abrir un PR

1. Crear la rama desde un `develop` actualizado.
2. Antes de abrir el PR, correr:

   ```bash
   npm run check
   npm run build && npm run test:e2e
   ```

3. Abrir el PR **contra `develop`** y completar la
   [plantilla](.github/pull_request_template.md): el checklist ítem por ítem y la tabla de dependencias
   nuevas. Cada dependencia nueva requiere justificación (especificación, sección 3.11).
4. Esperar el CI en verde. Sus jobs son obligatorios para mergear:
   - `Lint, tipos, tests y seguridad`
   - `Análisis de configuración de Electron`
   - `E2E de la app (Electron real)`

   **No hay que renombrar estos jobs sin actualizar a la vez la protección de ramas en GitHub**: un
   check obligatorio que cambia de nombre deja de reportarse y bloquea los PR.

## Cómo publicar una versión

1. Abrir un PR de `develop` a `main`, con los cambios de la versión.
2. Completar el [checklist de seguridad por versión](docs/especificacion-qatlas.md) (anexo B).
3. Con el CI en verde, mergear.
4. Crear el tag sobre `main`, con formato `vX.Y.Z`, y publicar el release con las notas de la versión,
   incluidos los cambios de seguridad.

Los instaladores firmados, el SBOM y los checksums se generan solo en CI (especificación, sección 3.11).
Ese proceso llega en la semana 10.

## Cómo revisar un PR de Dependabot

Dependabot propone; las actualizaciones se revisan a mano (sección 3.11). Un PR con el CI en verde
no alcanza para mergear.

1. **Base:** confirmar que el PR apunta a `develop`.
2. **Alcance:** leer las notas de la versión, sobre todo si es mayor.
3. **Lockfile:** revisar en `package-lock.json` si aparecen paquetes nuevos o `hasInstallScript`. Con
   `ignore-scripts` no se ejecutan, pero un script nuevo merece una explicación.
4. **Controles críticos:** prestar más atención si toca una de estas dependencias:
   - `electron`: un parche de seguridad crítico se adopta en menos de 2 semanas (sección 3.6). Puede
     cambiar la versión de Node o BoringSSL.
   - `argon2`: tiene la versión fija a propósito. Hay que confirmar que siga pasando el vector de RFC
     9106 en Electron y actualizar la [ADR 005](docs/decisiones/005-argon2id.md).
5. **CI:** debe estar en verde. El job de E2E corre también los tests de crypto dentro de Electron.

### Cuándo cerrarlo

Se cierra sin mergear si la actualización es incompatible con una decisión del proyecto, aunque el CI
pase:

| Ejemplo          | Por qué se cierra                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `@types/node` 26 | Debe coincidir con la versión mínima de Node (hoy 22): los tipos aceptarían APIs que no existen en ella |
| `typescript` 7   | typescript-eslint todavía no lo soporta ([ADR 002](docs/decisiones/002-typescript-6.md))                |

Al cerrarlo, si no está ya, hay que agregar la regla en `ignore` de
[`dependabot.yml`](.github/dependabot.yml) con un comentario que explique el motivo, para que no vuelva
a proponerse. Si llegó dentro de un grupo, hay que cerrar el grupo: Dependabot lo vuelve a crear sin ese
paquete una vez agregada la regla.

Para subir la versión mínima de Node, hay que cambiar juntos `engines` en `package.json`, la versión
del CI y `@types/node`.
