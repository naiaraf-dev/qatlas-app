# 043 — Barra lateral colapsable

- **Estado:** aceptada
- **Fecha:** 2026-11-25

## Decisión

- La barra lateral se colapsa a 76 px (solo íconos) y se expande a 256 px, con un botón arriba
  (`aria-expanded`, `aria-controls`, `aria-keyshortcuts`) y con **Ctrl + B**, que no actúa con el foco en
  un campo editable. No choca con Ctrl + Mayús + L (bloquear) ni con atajos de Chromium.
- Colapsada, cada ítem conserva su nombre accesible (texto oculto) y lo muestra en una ayuda emergente al
  pasar el mouse o al enfocar con el teclado. El activo se marca con `aria-current`, fondo y una barra.
- **La preferencia es un dato del usuario:** va en la configuración cifrada (`configuracion.barra_lateral`,
  migración 9), como el modo, por el canal `appearance:setBarraLateral` (contrato `.strict()`, rechazado con
  la bóveda bloqueada). Con la bóveda bloqueada se usa el valor por defecto, expandida. Nada de
  `localStorage`.
- Animación de 200 ms en el ancho, apagada con `prefers-reduced-motion`.

## Verificación

- `packages/db/src/db.test.ts`: una bóveda de la versión 8 migra a expandida y guarda colapsada.
- `security-tests/ts-08-ipc.test.ts`: el canal acepta solo los dos valores, sin campos extra, y se rechaza
  con la bóveda bloqueada.
- `e2e/barra-lateral.e2e.ts`: colapsar, expandir, la ayuda con mouse y teclado, el ítem activo, Ctrl + B
  (y que no actúa escribiendo), que se recuerda al desbloquear y es «expandida» con la bóveda bloqueada,
  `prefers-reduced-motion`, el ancho del contenido, axe y capturas en los dos modos y los dos estados, y
  la CSP sin violaciones.
