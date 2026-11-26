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

| Componente         | Archivo             | Notas                                                                                                                                |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`           | `ui/components.tsx` | Variantes `primary`, `secondary`, `ghost` y `danger` (lo que no se deshace). Alto mínimo 44 px. Una sola acción `primary` por vista. |
| `Card`             | `ui/components.tsx` | Sección con título (`aria-labelledby`) y acción opcional a la derecha.                                                               |
| `SeverityBadge`    | `ui/components.tsx` | Siempre con el nombre de la severidad.                                                                                               |
| `StatusPill`       | `ui/components.tsx` | Estado global positivo (protecciones activas).                                                                                       |
| `PageHeader`       | `ui/components.tsx` | Título, bajada y acciones de la página.                                                                                              |
| `SegmentedControl` | `ui/components.tsx` | Radio group de React Aria; usado para el modo. Ver «Controles».                                                                      |
| `CheckItem`        | `ui/components.tsx` | Verificación con ícono y texto para lectores de pantalla.                                                                            |
| `Icon`, `Logo`     | `ui/Icon.tsx`       | Íconos decorativos (`aria-hidden`); `Logo` es el isotipo (ver «Marca»).                                                              |
| `Shell`            | `layout/Shell.tsx`  | Barra lateral colapsable + barra superior + contenido con scroll propio. Ver «Shell».                                                |

## Shell y barra lateral

La barra lateral se colapsa y se expande (ADR 043), como la de Claude.

- **Botón** arriba, al lado del logo: «Contraer la barra lateral» o «Expandir la barra lateral», con
  `aria-expanded`, `aria-controls` (la barra) y `aria-keyshortcuts="Control+B"`. Su ayuda emergente dice el atajo.
- **Atajo: Ctrl + B.** No actúa con el foco en un campo editable. Ctrl + Mayús + L sigue siendo bloquear.
- **Colapsada (76 px):** solo íconos. El nombre de cada ítem sigue en el árbol accesible (texto oculto) y
  aparece en una ayuda emergente (`Ayuda`) al pasar el mouse o al enfocar con el teclado. Bloquear y el
  selector de modo también quedan en íconos, con nombre.
- **El ítem activo** lleva `aria-current="page"`, el fondo `accent-soft` y una barra de 3 px a la
  izquierda: la forma acompaña al color.
- **Animación:** 200 ms en el ancho; con `prefers-reduced-motion` no hay animación.
- **La preferencia** se guarda en la configuración cifrada, como el modo. Con la bóveda bloqueada se usa
  el valor por defecto (expandida). Nunca `localStorage`.
- **El contenido** ocupa el ancho que la barra libera.

## Controles

Controles propios en lugar de los nativos del navegador (ADR 042), sobre **react-aria-components**: el
patrón de WAI-ARIA Authoring Practices de cada uno (roles, estados, teclado y foco) lo pone la librería; el
aspecto, los tokens, en los dos modos. Los textos y los anuncios para lector de pantalla salen en español
(`I18nProvider` con `es-AR`). Un test (`security-tests/ui-controles-nativos.test.ts`) avisa si aparece un control
nativo fuera de `ui/`.

**Lo que no cambia.** Los diálogos de archivos del sistema los abre el proceso principal (son parte del
límite de seguridad). Los campos sensibles siguen con `EntradaSensible`: no controlado, sin reflejarse en el
HTML. Ningún control de `ui/controles.tsx` guarda un secreto en el estado de React. Los campos de texto y los
`<textarea>` siguen siendo nativos, con los tokens.

### Selector (`Selector`)

- **Cuándo:** elegir una opción de una lista cerrada (forma de login, tipo de indicador, credencial).
- **Estados:** cerrado, abierto, opción enfocada (`accent-soft`), elegida (negrita y tilde), deshabilitada
  (visible, con «llega en: …»), inválido.
- **Accesibilidad:** patrón listbox con botón. Enter, Espacio o flecha abajo abren; las flechas recorren
  y saltean las deshabilitadas; Enter elige; Escape cierra; el foco vuelve al botón. La etiqueta puede
  ser propia o externa (`aria-labelledby`, dentro de `Campo`).

### Casilla (`Casilla`)

- **Cuándo:** una opción que se marca o se desmarca dentro de un formulario que se guarda después
  (declaraciones, opciones del proyecto).
- **Estados:** sin marcar, marcada (`accent` con tilde), foco visible en la caja, deshabilitada.
- **Accesibilidad:** un `<input type="checkbox">` real dentro de la etiqueta, que la cubre entera y es
  invisible: el área de clic es toda la etiqueta. Espacio marca. La ayuda es su descripción
  (`aria-describedby`), no parte del nombre.

### Selector de modo (`SegmentedControl`)

- **Cuándo:** pocas opciones excluyentes, siempre visibles (el modo de la interfaz).
- **Accesibilidad:** radio group: Tab entra al grupo, las flechas cambian la opción. En la barra
  colapsada va en vertical, con íconos y el nombre oculto.

### Campo numérico (`CampoNumerico`)

- **Cuándo:** un número entero (límites del escaneo, minutos de bloqueo, días de retención).
- **Estados:** normal, foco (contorno `accent`), inválido.
- **Accesibilidad:** las flechas suben y bajan; los botones − y + están fuera del orden de tabulación
  y tienen nombre («Reducir …», «Aumentar …»). Sin separador de miles. No recorta al rango: la app
  valida y muestra su error, como antes; el rango va en la ayuda.

### Deslizador (`Deslizador`)

- **Cuándo:** recorrer un valor continuo con una posición (el fotograma del video).
- **Accesibilidad:** patrón slider. Flechas, Inicio y Fin; `aria-valuetext` dice el valor completo
  («Fotograma 3 de 40 · 0:02»).

### Desplegable (`Desplegable`)

- **Cuándo:** contenido secundario que se abre a pedido (detalle de un hallazgo, una evidencia,
  restaurar una copia).
- **Accesibilidad:** patrón disclosure: un botón con `aria-expanded` dentro de un encabezado; Enter o
  Espacio lo abren. Puede avisar al abrirse, para cargar el contenido recién entonces.

### Ayuda emergente (`Ayuda`)

- **Cuándo:** solo para repetir a la vista un nombre que el control ya tiene (íconos solos). Nunca lleva
  información que no esté en el nombre accesible. Reemplaza al atributo `title`, que no se usa.
- **Accesibilidad:** patrón tooltip. Aparece al pasar el mouse (300 ms) o al enfocar con el teclado, y
  Escape la cierra.

### Diálogo de confirmación (`DialogoConfirmacion`)

- **Cuándo:** antes de algo que no se puede deshacer (eliminar evidencias con borrado criptográfico).
- **Accesibilidad:** `alertdialog` modal: el foco queda adentro, empieza en «Cancelar» (lo seguro) y vuelve al
  botón que lo abrió. Escape cancela. La acción usa `Button` `danger` y dice qué hace.

### Aviso pasajero (`useAvisos`, `ui/avisos.tsx`)

- **Cuándo:** confirmar algo que salió bien (copia creada). Los errores no: van en línea con
  `role="alert"`.
- **Accesibilidad:** una región `role="status"` siempre presente: el lector anuncia sin mover el foco. Se
  cierra solo a los 6 s, salvo con el mouse o el foco encima, y tiene «Cerrar aviso». Hecho a mano: en la
  versión 1.22 de la librería es `UNSTABLE_`.

### Barras de scroll

Finas, con `border-strong` sobre transparente (`scrollbar-color`), en los dos modos. Solo CSS.

## Patrones

- **Funciones que todavía no existen:** se muestran, pero deshabilitadas y con el texto de cuándo
  llegan ("Llega en: Fase 2"). Nunca datos inventados.
- **Estados vacíos:** ícono en `accent-soft`, título, explicación de qué es y la acción para empezar.
- **Errores y bloqueos:** fondo `crit` + ícono + texto que explique qué pasó.
- **Datos técnicos** (URLs, reglas, IDs): siempre en mono.

## Marca

Los archivos fuente son los SVG de [`docs/marca/`](../marca/README.md), con el concepto y la tabla de colores.
El símbolo es un escaneo: el círculo es la aplicación que se prueba; la línea, el escaneo que la recorre.

**Uso.**

- En la interfaz va el **isotipo** (`Logo`, en `ui/Icon.tsx`), siempre al lado del nombre «QAtlas» en Inter.
  Toma los colores de los tokens `--qa-brand` (símbolo) y `--qa-brand-scan` (línea de escaneo), que cambian
  con el modo. Por debajo de 32 px usa la geometría chica (trazos más gruesos, menos barras).
- El **logo completo** (símbolo y nombre en Sora) va en el README, la documentación y el instalador: la
  variante clara sobre fondos claros y la oscura sobre fondos oscuros.
- El **ícono de la aplicación** (ventana, barra de tareas, instalador) está en `apps/desktop/resources/`
  y se genera desde los SVG con `node scripts/marca.mjs --generar`: `icon.ico` (16, 24, 32, 48, 64 y 256 px;
  hasta 32 px con la versión chica), `icon.png` (1024 px) e `icon-512.png`.

**Tamaños mínimos.**

- El logo con nombre: 24 px de alto.
- El isotipo en la interfaz: 16 px; por debajo de 32 px, la geometría chica.
- El ícono de la aplicación: 16 px es el mínimo que genera Windows. A ese tamaño se leen el cuadrado y la
  media esfera, pero la línea de escaneo se funde con la esfera: falta una versión dibujada para 16 px.
- Área libre alrededor del logo: al menos la altura de la «Q» del nombre.

**Fondos permitidos.**

- Las superficies de la interfaz (`bg`, `surface`, `sidebar`) en sus dos modos, con los tokens del modo.
  Contraste del símbolo: 5,4:1 en claro y 4,4:1 en oscuro. La línea de escaneo en modo claro queda en
  2,5:1: es un detalle decorativo de la marca (los logotipos están exentos del contraste mínimo), y el
  nombre al lado lleva el significado.
- Sobre `accent` u otro color fuerte, solo las versiones de un color (`-blanco` o `-negro`).
- Nunca sobre fotos, degradados o tramas que le bajen el contraste.

**Lo que no se hace.**

- Deformarlo: estirarlo, cambiarle la proporción o recortarlo.
- Cambiarle los colores fuera de la tabla de `docs/marca/` y de los tokens, o agregarle sombras, degradados
  o contornos.
- Rotarlo, animarlo fuera de `isotipo-animado.svg` o rearmar el símbolo con otra geometría.
- Usar la variante clara en modo oscuro, o la oscura en modo claro.
- Versionar una imagen con metadatos: `node scripts/marca.mjs --limpiar` los quita, y
  `security-tests/privacidad-repo.test.ts` lo verifica.

## Reglas para agregar UI

- Usar tokens, nunca colores sueltos en hexadecimal.
- Verificar el contraste en **los dos modos** antes de agregar un color nuevo.
- Todo lo clickeable es `<button>` o `<a>`, nunca un `<div>` con `onClick`.
- Cada pantalla nueva suma su caso al E2E (`e2e/`), incluido el cambio de modo si aplica.
- Nada de controles nativos fuera de `ui/`: `<select>`, casillas, números, deslizadores, `<details>`,
  `<dialog>`, `title`, `confirm()`. Un control nuevo va en `ui/`, sobre React Aria, con su sección acá y su
  E2E con teclado.
