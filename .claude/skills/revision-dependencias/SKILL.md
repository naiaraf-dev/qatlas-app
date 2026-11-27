---
name: revision-dependencias
description: Revisar una dependencia nueva, una actualización o un PR de Dependabot de QAtlas, y las alertas de seguridad de dependencias. Usala antes de agregar o actualizar cualquier paquete de npm, acción de GitHub o navegador.
---

# Revisión de dependencias

Ninguna actualización se mergea "porque es una actualización". Que el CI esté en verde es la condición mínima, no la revisión.

## 1. Qué cambia

- Versión de origen y de destino, notas de versión y changelog.
- Paquetes transitivos que entran, salen o cambian (`npm ls <paquete>`, el diff del lockfile).
- Licencia de cada uno, tamaño y fecha de publicación.

## 2. Clasificar el riesgo

- **Módulo nativo** (`.node`, `binding.gyp`): comparar los binarios de cada plataforma registrada con los anteriores y registrar los hashes nuevos en `scripts/nativos-hashes.json` (ADR 007), con la comparación en el mensaje del commit.
- **SQLCipher**: además, que abran las bóvedas de formatos anteriores (los fixtures nunca se regeneran ni se borran; ADR 006).
- **Criptografía** (argon2 y similares): leer qué cambió y si afecta cómo la usamos.
- **Playwright**: trae otro Chromium, cuyo hash se registra (`verificar-navegador --calcular`, ADR 020). Revisar el diff de su `--disable-features` y de sus argumentos por defecto (ADR 041) y correr el test de ruido. `playwright-core` y `@playwright/test` van siempre en la misma versión.
- **Electron**: el último parche de su línea; revisar si cambia el ABI, utilityProcess, protocolos o valores por defecto de seguridad.
- **Listas de datos** (sufijos públicos, diccionarios de contraseñas, reglas de axe): las revisan sus tests (oráculo, medidor). Se pueden mergear por Dependabot si quedan en verde.
- **Herramientas de desarrollo**: bajo riesgo, pero mirar avisos nuevos de lint y cambios de configuración.
- **Acciones de GitHub**: siempre fijadas por SHA, verificado en dos fuentes.

## 3. Reglas

- Versión exacta, sin `^` ni `~`.
- `ignore-scripts=true` siempre. Si el paquete tiene script de instalación o `binding.gyp`, que figure en la revisión de `security-tests/scripts-de-instalacion.test.ts`. La lista permitida es solo `electron`.
- **Paquetes nativos nuevos**, aunque sean opcionales o de desarrollo: esperan al menos 30 días desde su publicación, salvo urgencia de seguridad.
- La versión de npm está fijada (`packageManager` y `engines`, ADR 040). Instalar siempre con `npm ci`; `npm install` solo para agregar una dependencia a propósito.
- `npm audit signatures` nunca se desactiva ni se pasa a advertencia.
- Toda dependencia de la app y todo dato de terceros va a `THIRD_PARTY_NOTICES.md`.
- Nada que cambie la CSP (por ejemplo, un `<style>` inyectado) o que necesite código en el mundo de la página.

## 4. PRs de Dependabot

- Si el PR cambia un binario nativo, el navegador, Electron o SQLCipher: **no se mergea tal cual**. Se hace en una rama `feat/actualizar-<paquete>` con sus registros y tests, y la autora cierra el PR como reemplazado.
- Grupos que mezclan riesgos: se separan.
- Conflictos en el lockfile: `@dependabot rebase` (o `recreate`), de a un PR por vez. Nunca editar el lockfile a mano ni la rama de Dependabot.
- Si fallan con `EBADENGINE`, es la versión de npm fijada: no se fuerza.

## 5. Alertas de seguridad

- `npm ls <paquete>` y `npm ls <paquete> --omit=dev`: ¿llega a la app o solo a desarrollo?
- ¿Recibe entradas que puedan venir de afuera?
- Si se puede, `overrides` en el `package.json` con un comentario de por qué y cuándo sacarlo, probando que todo siga funcionando.
- Si no, documentarlo en `docs/seguridad/dependencias.md` para que la autora cierre la alerta con esa justificación.

## 6. Entregar

Propuesta antes de cambiar nada (salvo que la autora ya haya aprobado), con la recomendación primero. Al final, la fila de la tabla de dependencias del PR y la lista de PRs de Dependabot que la autora tiene que cerrar.
