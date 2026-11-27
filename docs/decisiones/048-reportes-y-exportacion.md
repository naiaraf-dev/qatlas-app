# 048 — Reportes de bug y exportación guiada

- **Estado:** aceptada
- **Fecha:** 2026-11-27

## Contexto

La 3.9 hace de la exportación la única salida de datos por decisión de la persona, y la 6.5 pide reportes de bug
en PDF, Markdown, captura anotada y ZIP. Medimos antes de decidir:

- `printToPDF` deja en `/Info` el software de origen (`Skia/PDF`, `Chromium`), el `<title>` y las fechas. Sin
  fuentes propias, incrusta las del sistema (Arial en Windows), y una página puede intentar pedir recursos.
- Un PNG del canvas o de `nativeImage` lleva solo IHDR, IDAT e IEND, pero el de una captura vieja o el de otra
  herramienta puede traer `tEXt`, `iTXt`, `eXIf` o `tIME`.
- La interfaz tiene denegados todos los permisos: no puede usar el portapapeles.
- `.qatlas` ya es la extensión de la copia de seguridad.

La semana se dividió en dos: la **9a** (esta ADR) y la **9b** (reporte de ejecución con gráficos, paquete cifrado
`.qatlas-paquete` e importación, traza y HAR).

## Decisión

### El reporte de bug

- Se crea desde uno o varios hallazgos **del mismo proyecto**, nunca desde uno descartado o resuelto. El borrador
  sale de los hallazgos y de sus apariciones: título `[ruta] título`, pasos (un link roto empieza en la página que
  lo tiene), esperado según el tipo, obtenido con el detalle redactado, y un entorno sin datos del equipo
  (navegador y ventana fijos, la URL, la fecha y la ejecución). Los hallazgos pasan a **«reportado»** (auditado).
- Todo lo que la persona escribe pasa por la redacción y el detector, con los secretos de las credenciales del
  proyecto, y vuelve redactado a la interfaz: la persona ve qué se tapó. Lo que el detector encontró queda como
  alertas del reporte.
- `reporte_bug` guarda el contenido cifrado con la clave del proyecto (contexto `reporte:<proyecto>:<reporte>`),
  `reporte_hallazgo` los pares y `exportacion` qué salió: formato, nivel, IDs de las evidencias, si el destino
  parecía sincronizado y si se confirmaron alertas. **Nunca la ruta.** La auditoría guarda solo IDs, nombres de
  campos y cantidades.
- **RN-REP-01, actualizada:** la evidencia puede ser una captura o el **detalle redactado de una aparición**
  (consola, error HTTP…), que ya existe cifrado. No se bloquea el reporte por no tener captura; si no hay, el
  reporte lo dice. Sin ninguna evidencia elegida, no se exporta.
- **EVI-06:** las evidencias de las apariciones de un hallazgo incluido en un reporte no vencen.

### La exportación guiada

1. **Vista previa:** exactamente lo que sale (el texto, los nombres de los archivos y si está cifrado).
2. **Selección:** captura y detalle, marcados por defecto. Video, traza, HAR y snapshot se ven deshabilitados,
   con «Llega en: semana 9b» (van solo en el paquete cifrado, y el video nunca por defecto: EXP-02).
3. **Revisión (RN-REP-03):** con secretos redactados, apariciones con revisión pendiente o alertas del detector,
   exportar pide una casilla explícita; el proceso principal lo vuelve a verificar.
4. **Formato:** PDF, Markdown (solo texto), ZIP sin cifrar (Markdown con las capturas) y captura anotada (PNG).
5. **Destino:** el diálogo lo abre el proceso principal; la interfaz nunca manda ni recibe una ruta. Una carpeta
   que parece sincronizada avisa que el archivo **no está cifrado**; cancelar no escribe nada.
6. **Registro:** `exportacion` y la auditoría.

### PDF (EXP-03, TS-14)

- Una ventana oculta con `SECURE_WEB_PREFERENCES`, **sin JavaScript**, en una sesión propia **en memoria** que se
  descarta al terminar. El documento lo sirve el protocolo `app://` de esa sesión, desde memoria. Todo otro pedido
  se cancela y se cuenta: si hubo alguno, no hay PDF. El HTML tiene CSP (`default-src 'none'`, imágenes y fuentes
  solo `data:`) y escapa todo texto.
- **Título genérico** («Reporte de QAtlas») y **solo las fuentes empaquetadas** (Inter y JetBrains Mono, como
  `data:`, sin familias genéricas de respaldo).
- Después, los valores de `/Info` (Producer, Creator, Title, Author, Subject, Keywords y las fechas) **se borran
  en el lugar**, con espacios del mismo largo: no cambia ningún offset del xref. Si el PDF tiene otra forma (XMP,
  `/Metadata`, `/ObjStm`, xref en stream, `/Encrypt`, más de un trailer, un valor con escapes), **no sale**.
- Se verifican las fuentes del PDF. Chromium incrusta las variables como **Type 3**, sin `/BaseFont`: el nombre
  se lee del `/FontDescriptor`. Sin fuentes identificables, o con una que no es la nuestra, **no sale**.
- Se descartó una dependencia para escribir PDF (pdf-lib y similares): sumaba código de terceros para algo que
  Chromium ya hace, y la limpieza en el lugar es chica y probada.

### ZIP (EXP-06) e imágenes

- **Sin cifrar, escrito por QAtlas** (`zip.ts`, sin dependencias): nombres por ID con un formato cerrado, fecha
  fija (1980-01-01), sin comentarios ni campos extra. La vista previa dice **«Este archivo no está cifrado»** y
  ofrece el paquete cifrado; el ZIP lleva además un `leeme.txt` que lo dice. El cifrado AES de ZIP no es estándar
  (cada herramienta lo implementa distinto): la evidencia cifrada va en el paquete.
- Toda captura que sale se decodifica y se vuelve a codificar con solo **IHDR, IDAT e IEND** (`png.ts`).
- Markdown: las imágenes solo dentro del ZIP, referidas por su nombre.

### Captura anotada

- Recuadro, flecha, texto y **tapar**. Tapar destruye: pinta negro opaco, nunca desenfoca (un desenfoque se puede
  revertir en parte).
- La interfaz dibuja en un canvas y manda la imagen y los recuadros a tapar. El proceso principal verifica que la
  captura sea del reporte y que la imagen tenga su tamaño, **vuelve a tapar** los recuadros (aunque la interfaz
  fallara) y la codifica sin metadatos. La imagen original nunca sale.
- Con teclado: los recuadros se agregan con campos numéricos, sin arrastrar.

### Portapapeles

- La interfaz copia por el proceso principal, que vuelve a pasar el texto por la redacción: un secreto nunca se
  copia en claro. Lo sensible (pedido así o con algo del detector) se limpia a los 30 segundos y al bloquear,
  **solo si el portapapeles todavía tiene ese texto**. En Electron 45 leer y escribir son asíncronas; si no se
  puede leer, se limpia igual.

### Paquete cifrado (para la 9b)

- Extensión **`.qatlas-paquete`**, distinta de la copia (`.qatlas`). «De un solo uso» significa **una contraseña
  nueva por paquete**.

## Consecuencias

- TS-01 cubre las exportaciones: el secreto de una credencial escrito en el reporte no sale en el Markdown ni en
  el ZIP, con un testigo en el mismo campo como control. En el PDF el texto va en glifos de un subconjunto, así
  que la búsqueda de bytes no prueba nada: lo cubre el HTML que se imprime (unitario), que sale del mismo
  contenido redactado.
- TS-10 incluye los reportes y sus exportaciones.
- TS-14: el PDF real sin software de origen, fechas ni título y con nuestras fuentes; control, el `printToPDF`
  crudo dice Skia y usa una fuente del sistema. ZIP y PNG sin metadatos.
- El OCR no lee lo tapado en la captura exportada, que sí muestra el testigo; control, la misma captura sin tapar.
- Lo exportado está en claro por decisión de la persona, fuera de la bóveda: QAtlas ya no lo controla.

## Lo que no cerraba

- **RN-REP-01 contra EVI-07:** la captura es opcional y la regla pedía evidencia. Se resolvió con el detalle de la
  aparición como evidencia (arriba).
- **EXP-06** pedía ZIP cifrado: se reemplaza por el ZIP sin cifrar más el paquete.
- **`.qatlas`** chocaba con la copia de seguridad.
