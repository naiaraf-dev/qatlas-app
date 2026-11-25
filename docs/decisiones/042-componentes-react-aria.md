# 042 — Controles propios sobre react-aria-components

- **Estado:** aceptada
- **Fecha:** 2026-11-25

## Contexto

La interfaz usaba controles nativos del navegador (`<select>`, casillas, números, un deslizador,
`<details>`, un `title` como tooltip). Se ven distintos en cada sistema, no siguen el sistema Índigo y
algunos no siguen bien su patrón de accesibilidad (el selector de modo era un `radiogroup` sin flechas).

## Opciones evaluadas

- **A mano:** sin dependencias, pero mucho código delicado (listbox con búsqueda por tipeo, popovers,
  foco atrapado, deslizador) y más riesgo de errores de accesibilidad propios.
- **Radix:** MIT, 49 paquetes para el conjunto. Dialog y Select usan `react-remove-scroll`, que inyecta un
  `<style>`: con la CSP de producción (`style-src 'self'`) haría falta un nonce, y eso relaja un control.
- **react-aria-components 1.22.1 (Adobe):** Apache-2.0, 13 paquetes (8 Apache-2.0, 4 MIT, 1 0BSD),
  ninguno con script de instalación. Sigue las APG y sale probado con lectores de pantalla.

## Decisión

**react-aria-components 1.22.1, versión exacta**, solo en `apps/desktop/src/renderer/src/ui/`:
`Selector`, `Casilla`, `CampoNumerico`, `Deslizador`, `Desplegable`, `Ayuda`, `DialogoConfirmacion` y el
`SegmentedControl`. Los textos y anuncios, en español (`I18nProvider` con `es-AR`).

- **La CSP no cambia.** React Aria posiciona los popovers por CSSOM, que la CSP permite. Hay un solo
  `<style>` que inyectaría: `usePress` (de `react-aria`) agrega `#react-aria-pressable-style` con una regla
  de `touch-action`, salvo que ya exista un elemento con ese id. La regla va en `styles.css` y un
  `<template id="react-aria-pressable-style">` vacío en `index.html` evita la inyección. Depende de un
  detalle interno: el E2E de la CSP (`e2e/componentes.e2e.ts`) falla si una versión nueva lo cambia.
  La evaluación previa a esta ADR solo había revisado el paquete `react-aria-components` y no lo vio; se
  encontró con el E2E.
- **El input real cubre la etiqueta** en la casilla y el radio (clase `qa-entrada-cubre`): React Aria lo
  deja en 1×1 px y la etiqueta lo tapa. Invisible y del tamaño de la etiqueta, el clic cae en el control
  de verdad y el área es más grande. El lector de pantalla no cambia.
- **Toast, a mano** (`ui/avisos.tsx`): en 1.22 es `UNSTABLE_`. Es una región `role="status"`.
- **Sin Switch ni Tabs:** hoy no hay un ajuste que se aplique al instante ni pestañas. Se agregan cuando
  haya un caso.
- **`CampoNumerico` no recorta al rango** (React Aria lo haría al salir del campo): la app deja escribir
  y valida, como con el campo nativo.
- **Sensibles:** `EntradaSensible` no cambia. Ningún control de la librería envuelve un secreto.
- **Lo que no se reemplaza:** los diálogos de archivos del sistema (proceso principal), los campos de
  texto y los `<textarea>`.

## Tamaño

Medido sobre el build, solo con los componentes importados:

- JavaScript de la interfaz: de 414 KB (123 KB con gzip) a 671 KB (201 KB con gzip). Son +257 KB (+78 KB con
  gzip), con los componentes propios incluidos.
- CSS: de 19,9 KB a 26,8 KB (+1,3 KB con gzip).
- Incluye las traducciones de los 34 idiomas de React Aria. El plugin oficial
  `@react-aria/optimize-locales-plugin` dejaría solo el español; es una dependencia nueva de desarrollo y
  queda a consulta.

## Verificación

- `security-tests/scripts-de-instalacion.test.ts`: versión exacta, y los 13 paquetes sin script ni
  `binding.gyp`.
- `security-tests/ui-controles-nativos.test.ts`: ningún control nativo fuera de `ui/`, y la contraseña solo
  en `EntradaSensible`. Con control positivo.
- `e2e/componentes.e2e.ts`: cada componente solo con teclado, axe (WCAG 2 A y AA, contraste incluido) y
  capturas en los dos modos; la CSP sin violaciones con cada uno abierto; un `<style>` inyectado a
  propósito se detecta.
- `e2e/evidencias-app.e2e.ts`: el deslizador y el diálogo de confirmación, con teclado y sin violaciones.
- `THIRD_PARTY_NOTICES.md`: la librería y sus paquetes.

## Mantenimiento

Al subirla: revisar el árbol (el test exige 13 paquetes), buscar `<style>` inyectados también en
`react-aria` (no solo en `react-aria-components`), correr el E2E de la CSP y actualizar esta ADR y los
avisos.
