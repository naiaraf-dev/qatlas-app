# 018 — Perfil del navegador en memoria, dentro de la carpeta de datos

- **Estado:** aceptada, como excepción aprobada
- **Fecha:** 2026-11-01

## Contexto

La sección 3.7 pedía una carpeta temporal cifrada o en memoria, y CLAUDE.md prohíbe escribir datos del usuario sin
cifrar. Chromium no ofrece una carpeta de perfil cifrada.

## Decisión

- **`launch` más `newContext`:** un contexto off-the-record, con cookies, almacenamiento y caché en memoria.
- **La carpeta del perfil va en la carpeta de datos** (`perfiles/<ejecución>`), no en el temporal del sistema. Se logra
  pasándole al runner `TEMP`, `TMP` y `TMPDIR` apuntando ahí.
- **El nombre es corto:** el comienzo del ID de la ejecución. En Linux y macOS, Chromium crea un socket Unix dentro de
  `TMPDIR`, y esa ruta no puede pasar de 107 bytes. Con una carpeta de datos más larga, la ejecución falla sin abrir nada,
  y el log dice por qué.
- **Se borra al terminar,** y al arrancar se borra cualquier carpeta de una ejecución cortada.
- **Descargas bloqueadas.** El estado de sesión del login cifrado llega en la semana 6.

## Medido

Con una cookie persistente, `localStorage` y `sessionStorage` con un canario, el canario no apareció en ningún archivo
del perfil mientras el navegador corría. Lo verifica `e2e/contencion.e2e.ts`.

## Límites

- **Es una excepción:** el perfil no está cifrado. Lo que Chromium escriba en él por su cuenta, sin datos del sitio,
  queda en claro hasta terminar la ejecución.
- **El canario es un caso simple.** IndexedDB, caché de código o un archivo descargado por el sitio no están probados.
- **El sistema operativo** puede paginar la memoria de Chromium al disco. QAtlas no lo controla.
- Si la carpeta de datos estuviera sincronizada, el perfil también. El primer inicio ya avisa de eso.

## Verificación

`e2e/contencion.e2e.ts` (canario) y `e2e/ejecuciones.e2e.ts` (dentro de la carpeta de datos, borrado al terminar, al
cancelar, al bloquear y al arrancar).
