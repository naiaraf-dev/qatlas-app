# Sistema de diseño de QAtlas — "Índigo"

Un solo sistema con **dos modos, claro y oscuro**. Entre modos cambian solo los fondos y los textos.
El acento índigo, la tipografía, las formas, los íconos y la ubicación de cada elemento son los
mismos, para que cambiar de modo no se sienta como cambiar de aplicación.

Implementación: `apps/desktop/src/renderer/src/styles.css` (tokens), `ui/components.tsx` y
`ui/Icon.tsx` (componentes), `theme.ts` (modo).

## Principios

1. **Claridad antes que decoración.** Es una herramienta de trabajo: jerarquía clara, mucho aire,
   sin degradados ni adornos.
2. **El color comunica estado, nunca solo.** Toda severidad o estado lleva su texto
   ("Crítica", "Bloqueado"); el color refuerza, no reemplaza.
3. **El acento no compite con los estados.** El índigo es la marca y las acciones; el verde es
   "correcto"; rojo, naranja y amarillo son severidades. Nunca se mezclan.
4. **Accesible por defecto.** Contraste AA (4,5:1 en texto), objetivos de al menos 44 px en
   acciones principales, foco visible y navegación completa con teclado.
5. **Nada se descarga.** Tipografías e íconos van dentro de la app (sección 3.5 de la especificación).

## Modo

- Por defecto sigue al **sistema operativo** y cambia solo si el sistema cambia.
- Selector en el menú lateral: **Sistema · Claro · Oscuro**. Al elegir uno, también se cambia el
  tema nativo de la ventana (barra de título).
- El modo efectivo se aplica como `data-theme="light|dark"` en `<html>`.
- La preferencia se guarda en la configuración cifrada de la bóveda. Por eso, las pantallas previas al
  desbloqueo (primer inicio, desbloqueo, bóveda dañada) siempre siguen al sistema operativo: al bloquear,
  el tema vuelve a "Sistema" y la preferencia se recupera al desbloquear.

## Paleta

Los nombres de token son los de Tailwind: `bg-surface`, `text-muted`, `border-border`, etc.

### Superficies y texto

| Token           | Uso                                    | Claro     | Oscuro    |
| --------------- | -------------------------------------- | --------- | --------- |
| `bg`            | Fondo de la ventana                    | `#F6F7F9` | `#0B0D12` |
| `sidebar`       | Menú lateral                           | `#FFFFFF` | `#0F1218` |
| `surface`       | Tarjetas, paneles                      | `#FFFFFF` | `#141821` |
| `surface-2`     | Hover, campos, filas internas          | `#F9FAFB` | `#1A1F2B` |
| `border`        | Bordes de tarjetas y separadores       | `#E4E7EC` | `#232836` |
| `border-strong` | Bordes de botones secundarios y campos | `#D0D5DD` | `#2B3142` |
| `text`          | Texto principal y títulos              | `#101828` | `#E7E9EE` |
| `text-2`        | Menú, texto secundario de tablas       | `#344054` | `#B4BAC8` |
| `muted`         | Descripciones, etiquetas, metadatos    | `#5B6475` | `#9AA1B2` |

### Acento índigo

| Token              | Uso                                    | Claro     | Oscuro    |
| ------------------ | -------------------------------------- | --------- | --------- |
| `accent`           | Botón principal, logo, foco            | `#5B5BD6` | `#5B5BD6` |
| `accent-hover`     | Hover del botón principal              | `#4B4BC4` | `#6D6DE3` |
| `accent-fg`        | Texto sobre `accent`                   | `#FFFFFF` | `#FFFFFF` |
| `accent-text`      | Links y texto en acento                | `#4646C2` | `#A5A8FF` |
| `accent-soft`      | Ítem activo del menú, fondos de íconos | `#EEF0FF` | `#1D2136` |
| `accent-soft-text` | Texto sobre `accent-soft`              | `#3434A8` | `#C7C9FF` |

### Estados y severidades

| Token  | Significado                   | Claro (fondo / texto) | Oscuro (fondo / texto) |
| ------ | ----------------------------- | --------------------- | ---------------------- |
| `ok`   | Correcto, protegido, aprobado | `#ECFDF3` / `#067647` | `#10261F` / `#7EE2B8`  |
| `crit` | Severidad crítica, falla      | `#FEE4E2` / `#B42318` | `#3A1518` / `#FCA5A5`  |
| `high` | Severidad alta, regresión     | `#FEF0C7` / `#B54708` | `#3A2312` / `#FDBA74`  |
| `med`  | Severidad media               | `#FEF7C3` / `#854A0E` | `#33300F` / `#FDE68A`  |
| `low`  | Severidad baja, informativo   | `#F2F4F7` / `#475467` | `#222733` / `#C3C9D6`  |

## Tipografía

- **Inter** (variable) para toda la interfaz. **JetBrains Mono** para URLs, código, IDs y logs.
- Ambas con licencia OFL, empaquetadas con `@fontsource-variable/*`.

| Estilo            | Tamaño / peso               | Uso                     |
| ----------------- | --------------------------- | ----------------------- |
| Título de página  | 28 px · 700 · tracking −2 % | `PageHeader`            |
| Título de sección | 16 px · 600                 | Título de `Card`        |
| Subtítulo         | 18 px · 600                 | Estados vacíos          |
| Cuerpo            | 14 px · 400                 | Texto general           |
| Descripción       | 15 px · 400 · `muted`       | Bajada de página        |
| Pequeño           | 13 px · 400–500             | Metadatos, ayudas       |
| Insignia          | 12 px · 600                 | Severidades, contadores |
| Mono              | 12,5–13 px                  | URLs, reglas, IDs       |

## Forma y espacio

- Radios: **10 px** en controles (botones, campos), **14 px** en tarjetas, **8 px** en ítems de
  menú, **pill** en insignias y el indicador de protecciones.
- Espaciado en múltiplos de 4 px; páginas con 32 px de margen lateral y 24 px entre bloques.
- Sombra solo en modo claro y muy sutil (`0 1px 2px` al 5 %); en oscuro las tarjetas se separan por
  borde y superficie.
- Íconos de trazo de 2 px, 18 px en el menú y 16 px en botones.

## Componentes

| Componente         | Archivo             | Notas                                                                                              |
| ------------------ | ------------------- | -------------------------------------------------------------------------------------------------- |
| `Button`           | `ui/components.tsx` | Variantes `primary`, `secondary`, `ghost`. Alto mínimo 44 px. Una sola acción `primary` por vista. |
| `Card`             | `ui/components.tsx` | Sección con título (`aria-labelledby`) y acción opcional a la derecha.                             |
| `SeverityBadge`    | `ui/components.tsx` | Siempre con el nombre de la severidad.                                                             |
| `StatusPill`       | `ui/components.tsx` | Estado global positivo (protecciones activas).                                                     |
| `PageHeader`       | `ui/components.tsx` | Título, bajada y acciones de la página.                                                            |
| `SegmentedControl` | `ui/components.tsx` | `radiogroup` accesible; usado para el modo.                                                        |
| `CheckItem`        | `ui/components.tsx` | Verificación con ícono y texto para lectores de pantalla.                                          |
| `Icon`, `Logo`     | `ui/Icon.tsx`       | Íconos decorativos (`aria-hidden`); botones solo-ícono llevan `aria-label`.                        |
| `Shell`            | `layout/Shell.tsx`  | Menú lateral fijo + barra superior + contenido con scroll propio.                                  |

## Patrones

- **Funciones que todavía no existen:** se muestran, pero deshabilitadas y con el texto de cuándo
  llegan ("Llega en: Fase 2"). Nunca datos inventados.
- **Estados vacíos:** ícono en `accent-soft`, título, explicación de qué es y la acción para empezar.
- **Errores y bloqueos:** fondo `crit` + ícono + texto que explique qué pasó.
- **Datos técnicos** (URLs, reglas, IDs): siempre en mono.

## Reglas para agregar UI

- Usar tokens, nunca colores sueltos en hexadecimal.
- Verificar el contraste en **los dos modos** antes de agregar un color nuevo.
- Todo lo clickeable es `<button>` o `<a>`, nunca un `<div>` con `onClick`.
- Cada pantalla nueva suma su caso al E2E (`e2e/`), incluido el cambio de modo si aplica.
