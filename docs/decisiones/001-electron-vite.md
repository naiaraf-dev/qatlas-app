# 001 — electron-vite para compilar; empaquetado se decide en la semana 10

- **Estado:** aceptada
- **Fecha:** 2026-10-28

## Contexto

La especificación (sección 4.1) propone Electron Forge para el empaquetado. Para desarrollar y
compilar hay que bundlear tres destinos con requisitos distintos: proceso principal (Node), preload
(CommonJS en un solo archivo, requisito del sandbox) e interfaz (React).

## Decisión

Usar **electron-vite** para desarrollo y compilación. La herramienta de empaquetado e instaladores
(Electron Forge o electron-builder) se elige en la semana 10, cuando se armen los instaladores
firmados y se apliquen los fuses (`@electron/fuses`).

## Motivos

- electron-vite resuelve los tres destinos con una sola configuración y recarga en caliente.
- Permite incluir los paquetes del monorepo dentro del bundle, así la app empaquetada no depende
  de `node_modules` del workspace (fuente frecuente de problemas al empaquetar monorepos).
- El empaquetado es independiente: ambas opciones consumen la carpeta `out/` ya compilada.

## Consecuencias

- La especificación debe actualizarse en la sección 4.1 cuando se decida el empaquetado.
- Los fuses se verifican en el binario final (checklist de versión, ítem 4), no en desarrollo.
