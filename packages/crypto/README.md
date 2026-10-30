# @qatlas/crypto

Esquema de claves de la bóveda, cifrado de archivos (evidencias) y cifrado de campos (credenciales).
Node puro: no importa `electron` y se prueba con Vitest. Especificación: sección 3.4.

Todavía no está integrado a la app: la bóveda, SQLCipher y las pantallas son de la semana 3.

## Esquema de claves

```
 contraseña maestra (nunca se guarda)
        │  Argon2id: 64 MiB, 3 iteraciones, 4 carriles, salt aleatorio de 16 bytes
        ▼
       KEK ──── envuelve (AES-256-GCM) ───► clave maestra envuelta          [disco]
                                                  │
                                                  ▼
                             clave maestra (256 bits aleatorios)            [solo memoria]
                                                  │ HKDF-SHA-256
                     ┌────────────────────────────┴───────────────┐
                     ▼                                            ▼
              clave de SQLCipher                     subclave de envoltura de proyectos
                                                                  │ envuelve (AES-256-GCM)
                                                                  ▼
                                                     clave de proyecto envuelta [disco]
                                                                  │
                                                                  ▼
                                       clave de proyecto (256 bits aleatorios)  [solo memoria]
                                                                  │ HKDF-SHA-256
                                                  ┌───────────────┴────────┐
                                                  ▼                        ▼
                                          subclave de archivos     subclave de campos
                                                  │ HKDF (salt + ID)       │ AES-256-GCM
                                                  ▼                        ▼
                                          clave de cada archivo    secretos de credenciales
                                                  │ AES-256-GCM
                                                  ▼
                                          bloques del archivo
```

Toda clave tiene un solo uso. Cada salida de HKDF se separa por `info`: `qatlas/v1/sqlcipher`,
`qatlas/v1/envoltura-proyectos`, `qatlas/v1/archivos`, `qatlas/v1/campos` y
`qatlas/v1/archivo/<id>`.

## API

| Función                                                       | Para qué                                              |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `contrasenaABuffer(string)`                                   | Pasa la contraseña a bytes, normalizada a NFC         |
| `crearBoveda(contraseña, opciones?)`                          | Genera la clave maestra y devuelve lo que se guarda   |
| `abrirBoveda(contraseña, sellada)`                            | Devuelve la clave maestra                             |
| `cambiarContrasena(actual, nueva, sellada, opciones?)`        | Vuelve a envolver la clave maestra; no toca nada más  |
| `crearClaveProyecto(maestra, id)` / `abrirClaveProyecto(...)` | Clave por proyecto, envuelta y atada a su ID          |
| `derivarClaveSqlcipher(maestra)`                              | Clave de la base (semana 3)                           |
| `cifrarCampo(clave, contexto, texto)` / `descifrarCampo(...)` | Secretos a nivel de campo                             |
| `crearCifradorArchivo(clave, id)` / `crearDescifradorArchivo` | Streams `Transform` para archivos de cualquier tamaño |
| `borrar(...buffers)` / `igualesEnTiempoConstante(a, b)`       | Higiene de memoria y comparación segura               |

Toda clave que devuelve una función queda a cargo de quien la recibe, que debe llamar a `borrar`.

Los errores son `ErrorCripto`, con un código (`AUTENTICACION`, `FORMATO`, `VERSION`, `PARAMETROS`) y
un mensaje fijo. Nunca incluyen datos ni el error original. Contraseña incorrecta y dato alterado dan
el mismo error.

## Formatos

### Valor sellado (envolturas y campos)

```
versión (1) | propósito (1) | nonce (12) | texto cifrado | tag (16)
AAD = "qatlas.sellado" | versión | propósito | contexto
```

El nonce es aleatorio. El contexto no se guarda: quien abre debe conocerlo, así un valor movido a otro
lugar no se autentica. Es el ID del proyecto en las envolturas, un identificador del campo en los
secretos, y los parámetros de la KDF más el salt en la clave maestra.

### Archivo (versión 1)

```
cabecera (44): "QATF" (4) | versión (1) | salt (32) | prefijo de nonce (7)
bloque:        texto cifrado (hasta 64 KiB) | tag (16)
nonce (12):    prefijo (7) | contador big-endian (4) | último (1)
AAD:           cabecera completa
clave:         HKDF(subclave de archivos, salt, "qatlas/v1/archivo/<id>")
```

| Ataque                  | Por qué se detecta                                                  |
| ----------------------- | ------------------------------------------------------------------- |
| Bloque reordenado       | El contador forma parte del nonce                                   |
| Bloque duplicado        | Ídem: el contador ya no coincide                                    |
| Truncado                | El último bloque lleva otra marca en el nonce; sin él, falla el tag |
| Cabecera alterada       | La cabecera es el AAD de cada bloque, y el salt determina la clave  |
| Bloques de otro archivo | Cada archivo tiene su propia clave                                  |
| Archivo intercambiado   | El ID de la evidencia entra en la derivación de la clave            |
| Versión desconocida     | Se rechaza antes de usar ningún otro campo                          |

El máximo es de 2³² bloques (unos 256 TiB); al llegar falla cerrado. El nonce vive en la cabecera,
así que la columna `evidencia.nonce` de la sección 5 de la especificación deja de hacer falta.

## Decisiones

- **Argon2id con la implementación de referencia en C:** ver
  [ADR 005](../../docs/decisiones/005-argon2id.md). Queda detrás de `ImplementacionArgon2id`, y solo
  `kdf-argon2.ts` conoce a la librería.
- **AES-GCM y HKDF del módulo `crypto` de Node:** primitivas estándar, sin dependencias.
- **Subclave para envolver proyectos:** la clave maestra ya se usa como entrada de HKDF. Usarla además
  para cifrar rompería la regla de un solo uso por clave.
- **Formato de archivo:** no es un modo propio. Es la construcción STREAM (Hoang, Reyhanitabar,
  Rogaway y Vizár, 2015), con la misma disposición que AES-GCM-HKDF streaming de Tink. Se eligió
  porque GCM no se puede usar en un solo paso sobre un archivo grande sin entregar datos sin verificar.
  Tamaño de bloque fijo por versión: un valor leído del archivo podría agotar la memoria.
- **Parámetros de la KDF:** se guardan autenticados en el AAD. Antes de derivar se validan contra un
  piso (la rebaja se rechaza) y un techo (2 GiB, 64 iteraciones, 16 carriles).
- **4 carriles:** es la segunda recomendación de RFC 9106 (sección 4), con la memoria de la
  especificación.

### Rendimiento de Argon2id

Medido el 2026-10-30 en Electron 45.1.0, con una CPU de escritorio de 8 núcleos, 7 corridas de 64 MiB y
3 iteraciones:

| Carriles        | Mínimo | Mediana | Máximo |
| --------------- | ------ | ------- | ------ |
| 1               | 123 ms | 125 ms  | 133 ms |
| 4 (por defecto) | 57 ms  | 60 ms   | 72 ms  |

Holgado frente a los 3 segundos de RNF-03: hay margen para subir los parámetros más adelante.

## Limitaciones

### Plataformas

Por ahora solo se soporta **Windows x64**. Faltan binarios precompilados de `argon2` para `win32-arm64`
y `darwin-x64`, que quedan para los instaladores (semana 10). El CI corre en Linux x64 solo para probar.

### Módulo nativo fuera del asar

Al empaquetar, el `.node` de `argon2` queda fuera del asar y de la validación de integridad del
fuse `EnableEmbeddedAsarIntegrityValidation`. Se resuelve en la **semana 3**, junto con SQLCipher, que
tiene el mismo problema.

### Memoria en JavaScript

`borrar` sobrescribe el `Buffer`, lo que acorta la ventana de exposición, pero JavaScript no garantiza
que no queden copias:

- Node copia las claves dentro de los objetos nativos de cifrado, y esas copias no se pueden borrar
  desde JS. Se liberan cuando actúa el recolector de basura.
- Los strings son inmutables y no se pueden borrar. La contraseña que llegue por IPC en la semana 3
  será un string: hay que convertirla enseguida y no guardarla.
- `Buffer.from(string)` y `Buffer.concat` pueden usar el pool compartido de Node. Por eso las claves
  y los textos descifrados usan `Buffer.alloc`.
- No hay `mlock`: el sistema operativo puede mandar la memoria a la paginación o a la hibernación.
- Un atacante con control del equipo y la bóveda desbloqueada está fuera del alcance (3.1).

### Cambio de contraseña

No rota la clave maestra: solo la vuelve a envolver, como pide la sección 3.4. **Una copia vieja de la
bóveda sigue abriéndose con la contraseña vieja**, así que cambiarla no protege si esa contraseña se
vio comprometida y alguien ya copió la bóveda. Hay un test que deja esto a la vista.

### Borrado criptográfico

Destruir la clave de un proyecto deja ilegibles sus datos solo si **no queda ninguna copia de la clave
envuelta**, por ejemplo en respaldos, en el WAL o en páginas libres de SQLite. Esta semana se prueba
la parte criptográfica; también hay un test que deja este límite a la vista.

## Pendientes

- **Rotar la clave maestra:** una opción que genere una clave maestra nueva y vuelva a cifrar todo (base
  de datos y claves de proyecto), para cuando la contraseña se haya visto comprometida. Sin asignar a
  una semana todavía.
- **Reglas para la semana 3:**
  - **Una evidencia se verifica completa antes de mostrarse.** El descifrador entrega bloques ya
    autenticados, pero un truncamiento o un bloque alterado pueden detectarse recién al final, así que
    no se muestra nada hasta que el stream termine sin error.
  - **Nunca se escribe texto plano parcial a disco.** Tampoco en temporales. Si el stream falla, lo
    recibido se descarta y se borra de memoria.
  - Resolver el módulo nativo fuera del asar (ver arriba).
  - Quitar `evidencia.nonce` del modelo de datos.
  - Destruir todas las copias de la clave envuelta al eliminar un proyecto.

## Tests

```bash
npm run test:coverage         # unitarios con cobertura (mínimo 80 %, RNF-11)
npm run test:crypto:electron  # la misma suite dentro del runtime real de Electron
```

La segunda es necesaria porque Electron usa BoringSSL: `crypto.argon2` existe y aun así falla ahí, y
ningún test en Node lo habría detectado. Forma parte de `npm run test:e2e`.

El test de archivo grande usa 1 GiB en local y 64 MiB en CI. Verifica que lo generado y todavía no
recibido nunca supere los 16 MiB, un control válido para cualquier tamaño.
