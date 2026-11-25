# 040 — Versión de npm fijada

- **Estado:** aceptada
- **Fecha:** 2026-11-25

## Contexto

En una copia de trabajo, `package-lock.json` apareció con `"hasInstallScript": true` en
`better-sqlite3-multiple-ciphers` sin que nadie lo cambiara. npm 10.9.3 no genera esa línea (respeta el
`"gypfile": false` del paquete) y el registro tampoco la marca: la escribió otra versión de npm, que no se
pudo identificar. El lockfile cambiaba según quién instalara, y un cambio así en el lockfile tapa los que
sí importan, como un script de instalación nuevo (ADR 006, `CONTRIBUTING.md`).

## Decisión

- `"packageManager": "npm@10.9.3"`: la versión con la que se genera el lockfile. Es informativa (Corepack
  no está activo), pero queda escrita.
- `"engines": { "npm": ">=10.9.3 <11" }`: con `engine-strict=true` en `.npmrc`, `npm install` y `npm ci`
  fallan con otra versión mayor de npm. Se admiten los parches de la 10.9, que es lo que trae Node 22 en el
  CI.
- Pasar a npm 11 es una decisión aparte: instalar con la versión nueva, revisar el diff del lockfile línea
  por línea y actualizar esta ADR.

## Consecuencias

- Quien tenga npm 11 instalado necesita la 10.9 para instalar dependencias (`npx npm@10.9.3 ci`, o la que
  trae Node 22).
- No cambia nada de lo que se ejecuta al instalar: `ignore-scripts=true` sigue siendo el control
  (`security-tests/scripts-de-instalacion.test.ts`).
