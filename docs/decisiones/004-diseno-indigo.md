# 004 — Sistema de diseño "Índigo" con modo claro y oscuro

- **Estado:** aceptada
- **Fecha:** 2026-10-28

## Contexto

Se exploraron tres direcciones visuales (grafito e índigo, claro verde azulado, bosque técnico). La
preferencia fue el modo claro de una y el modo oscuro de otra, pero dos sistemas distintos hacen
que cambiar de modo se sienta como cambiar de aplicación.

## Decisión

Un solo sistema, "Índigo", con dos modos. Tipografía Inter y JetBrains Mono. Por defecto sigue al
sistema operativo, con selector manual (Sistema · Claro · Oscuro).

## Motivos

- El índigo no se confunde con los colores de estado: verde = correcto; rojo, naranja y amarillo =
  severidades. Un acento verde azulado competía con el verde de "correcto".
- Mantiene buen contraste sobre blanco y sobre grafito sin cambiar de tono.

## Implementación

- Tokens como variables CSS expuestas a Tailwind (`styles.css`); modo efectivo en
  `data-theme` sobre `<html>` (`theme.ts`).
- Al elegir un modo a mano se cambia también `nativeTheme.themeSource` (barra de título nativa).
  No se depende de que Chromium actualice `prefers-color-scheme` al cambiar `themeSource`, porque
  en Linux no lo hizo de forma consistente: la interfaz aplica el modo por su cuenta.
- Tipografías con `@fontsource-variable/inter` y `@fontsource-variable/jetbrains-mono`: licencia
  OFL, sin scripts de instalación, empaquetadas en la app (sin conexiones salientes).
- La preferencia de modo dura la sesión hasta que exista la configuración cifrada (semana 3).
