# 002 — TypeScript 6 (no 7)

- **Estado:** aceptada (revisar cuando typescript-eslint soporte TS 7)
- **Fecha:** 2026-10-28

## Contexto

La última versión de TypeScript es la 7.0. typescript-eslint, que aplica las reglas de lint con
información de tipos (incluidas varias de seguridad), declara compatibilidad con TypeScript
`>=4.8.4 <6.1.0`.

## Decisión

Usar TypeScript `~6.0.3`.

## Consecuencias

- Lint con información de tipos completo (`strictTypeChecked`).
- Dependabot propondrá TS 7: no aceptarlo hasta que typescript-eslint lo soporte.
