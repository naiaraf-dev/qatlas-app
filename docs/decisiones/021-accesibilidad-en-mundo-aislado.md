# 021 — Accesibilidad con axe-core, en un mundo aislado

- **Estado:** aceptada
- **Fecha:** 2026-11-05

## Contexto

6.3 pide accesibilidad WCAG 2.1 A y AA con axe-core. Hay que inyectarlo en la página probada sin afectarla y sin
que la página pueda verlo ni alterarlo: el sitio probado es hostil por defecto.

## Opciones

| Opción                      | Motivo                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- |
| **axe-core, mundo aislado** | **Elegida.** La página no ve a axe ni puede tocar sus variables, y su CSP no lo bloquea |
| `@axe-core/playwright`      | Inyecta en el mundo de la página: el sitio ve `window.axe` y puede manipularlo          |
| Pa11y, Lighthouse           | Usan axe por debajo y suman mucho más                                                   |
| Reglas propias              | No tiene sentido rehacer axe                                                            |

## Decisión

- **Un mundo aislado por CDP** (`Page.createIsolatedWorld`), por cada página. Comparte el DOM con la página, pero
  no sus variables ni sus prototipos.
- **Medido:** contra una página con CSP `script-src 'self'` que además rompe `Array.prototype.map` en su mundo,
  axe corrió igual, encontró las violaciones esperadas en unos 100 ms y la página nunca vio `window.axe`.
- **Solo WCAG 2.1 A y AA** (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`), solo violaciones.
- **Un hallazgo por regla y página.** Severidad: critical, alta; serious, media; moderate y minor, baja.
- **Lo que viaja:** el ID de la regla, su ayuda y hasta 10 selectores, que van al detalle cifrado (ADR 023).
- El mismo mundo aislado se usa para medir el rendimiento y para leer los links y botones.

## Dependencias

| Paquete           | Para qué                | Script de instalación | Tamaño instalado           | Licencia | Mantenimiento                         |
| ----------------- | ----------------------- | --------------------- | -------------------------- | -------- | ------------------------------------- |
| `axe-core` 4.14.0 | Reglas de accesibilidad | No                    | 3,4 MB; se inyectan 650 KB | MPL-2.0  | Deque; versiones cada uno o dos meses |

Sin dependencias propias. La MPL-2.0 va a los avisos de terceros del instalador (semana 10); ya está en
`THIRD_PARTY_NOTICES.md`.

## Límites

- **Solo el marco principal.** Un iframe del mismo origen no se analiza todavía.
- **El mundo aislado es de Chromium.** Firefox y WebKit van a necesitar otra forma.
- axe analiza el DOM en el momento: lo que aparece después de un clic no se ve en solo lectura.

## Verificación

`security-tests/runner-aislamiento.test.ts` (se inyecta por CDP y nunca en el mundo de la página) y el oráculo
(`e2e/escaneo-oraculo.e2e.ts`, `e2e/escaneo.e2e.ts`), que encuentra las cuatro reglas plantadas y ninguna más.
