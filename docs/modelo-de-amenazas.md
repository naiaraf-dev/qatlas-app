# Modelo de amenazas

Versión viva del modelo de la sección 3.1 de la especificación. Se actualiza con cada
funcionalidad nueva (checklist de versión, ítem 10).

## Activos

| Activo                                          | Dónde vive                            | Sensibilidad |
| ----------------------------------------------- | ------------------------------------- | ------------ |
| Credenciales de sistemas probados               | Bóveda (cifrado de campo)             | Crítica      |
| Evidencias (capturas, video, trazas, red, logs) | Bóveda (AES-256-GCM por proyecto)     | Alta         |
| URLs y estructura de sistemas internos          | Bóveda                                | Alta         |
| Reportes de bugs                                | Bóveda y exportaciones                | Alta         |
| Clave maestra                                   | Solo en memoria del proceso principal | Crítica      |

## Límites de confianza

```
 ┌───────────────────────────── Equipo del usuario ─────────────────────────────┐
 │  [Interfaz]  ──IPC validado──►  [Proceso principal]  ──►  [Bóveda cifrada]    │
 │   no confiable                    confiable                                   │
 │                                        │                                      │
 │                                        ▼                                      │
 │                               [Runner aislado] ──► [Proxy de salida] ──┐      │
 │                                no confiable          lista permitida   │      │
 └────────────────────────────────────────────────────────────────────────┼──────┘
                                                                          ▼
                                               [Sistema probado]  (no confiable)
```

- **La interfaz se considera no confiable:** puede tener un bug de XSS. Por eso no tiene Node, no
  tiene red y el proceso principal valida todo lo que recibe de ella.
- **El contenido del sistema probado es hostil por defecto:** nunca se ejecuta en la ventana de
  QAtlas y su navegador solo sale por el proxy.
- **Los archivos de entrada son hostiles por defecto** (Excel, logs, paquetes): se procesan en un
  proceso aislado, sin claves ni red.

## Amenazas y estado de las mitigaciones (STRIDE)

| ID   | Amenaza                                                                    | Categoría              | Mitigación                                                                             | Estado                                                                             | Test                      |
| ---- | -------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| A-01 | XSS en la interfaz lee archivos o ejecuta comandos                         | Elevación              | Sandbox, sin Node, aislamiento de contexto                                             | ✅                                                                                 | TS-07, E2E                |
| A-02 | XSS en la interfaz envía datos a internet                                  | Divulgación            | CSP `connect-src 'none'` + bloqueo en el proceso principal                             | ✅                                                                                 | TS-03, TS-07, E2E         |
| A-03 | La interfaz abusa del IPC (rutas, campos extra)                            | Manipulación           | Validación de origen, entrada y salida                                                 | ✅                                                                                 | TS-08                     |
| A-04 | Un handler devuelve un secreto por error                                   | Divulgación            | Validación de la salida con esquema estricto                                           | ✅                                                                                 | TS-08                     |
| A-05 | Lectura de archivos fuera de la interfaz vía protocolo                     | Divulgación            | `app://` con protección de path traversal                                              | ✅                                                                                 | app-protocol              |
| A-06 | Navegación o ventanas hacia sitios externos                                | Suplantación           | will-navigate, setWindowOpenHandler, Auxclick                                          | ✅                                                                                 | E2E                       |
| A-07 | Electron/Chromium contacta servicios de terceros                           | Divulgación            | Corrector ortográfico desactivado, red denegada                                        | ✅ parcial                                                                         | TS-03 completo (semana 5) |
| A-08 | Datos sincronizados a la nube sin querer                                   | Divulgación            | `%LOCALAPPDATA%`, detección de carpetas sincronizadas                                  | ✅                                                                                 | data-dir                  |
| A-09 | Paquete npm malicioso ejecuta código al instalarse                         | Elevación              | `ignore-scripts` + lista permitida                                                     | ✅                                                                                 | —                         |
| A-10 | Dependencia de análisis con vulnerabilidades entra al proyecto             | Manipulación           | Electronegativity aislado vía npx                                                      | ✅                                                                                 | npm audit                 |
| A-11 | Robo del equipo o del disco                                                | Divulgación            | SQLCipher, contraseña maestra, bloqueo automático                                      | ✅ (falta TS-01, semana 7)                                                         | TS-02, TS-09              |
| A-12 | El sitio probado redirige o carga recursos de otros dominios               | Divulgación            | Proxy de salida con lista permitida                                                    | ⏳ semana 5                                                                        | TS-03, TS-04              |
| A-13 | Contraseñas o tokens en evidencias                                         | Divulgación            | Login sin grabación, redacción, detector                                               | ⏳ semanas 6-7                                                                     | TS-01, TS-06              |
| A-14 | Excel malicioso (macros, vínculos, bomba zip)                              | Elevación              | Proceso aislado, sin ejecución, límites                                                | ⏳ fase 2                                                                          | TS-12                     |
| A-15 | Inyección de fórmulas en exportaciones                                     | Manipulación           | Escapado de celdas                                                                     | ⏳ fase 2                                                                          | TS-11                     |
| A-16 | Ataque de fuerza bruta a la contraseña con una copia de la bóveda          | Divulgación            | Argon2id con piso de parámetros; parámetros autenticados                               | ✅                                                                                 | Vectores RFC 9106, crypto |
| A-17 | Alterar, reordenar, duplicar o truncar un archivo o valor cifrado          | Manipulación           | AES-256-GCM, formato STREAM, AAD con versión y propósito                               | ✅                                                                                 | crypto                    |
| A-18 | Mover un valor cifrado a otro proyecto, campo o evidencia                  | Manipulación           | Contexto en el AAD; ID en la derivación de la clave                                    | ✅                                                                                 | crypto                    |
| A-19 | Evidencias de un proyecto eliminado siguen legibles                        | Divulgación            | Borrado criptográfico; `secure_delete`; lápidas al restaurar (ADR 009)                 | ✅ parcial: una copia ya hecha conserva el proyecto; TS-10 completo en la semana 9 | TS-10, boveda             |
| A-20 | Archivo manipulado agota la memoria en el desbloqueo                       | Denegación de servicio | Techo de parámetros validado antes de derivar; bloque fijo por versión                 | ✅                                                                                 | crypto                    |
| A-21 | Un módulo nativo manipulado en el disco roba la contraseña                 | Elevación              | SHA-256 verificado antes de cargarlo (ADR 007)                                         | ✅ parcial: completo con fuses y firma, semana 10                                  | nativos-integridad        |
| A-22 | Contraseña comprometida y copia vieja de la bóveda en manos de un atacante | Divulgación            | Cambiar la contraseña no alcanza; "rotar clave maestra"                                | ⏳ pendiente, sin asignar                                                          | Test de la limitación     |
| A-23 | Claves residuales en memoria o en la paginación                            | Divulgación            | `fill(0)`, sin claves en strings; limitaciones documentadas                            | ✅ parcial                                                                         | crypto                    |
| A-24 | Un archivo sellado alterado baja el costo de Argon2id                      | Manipulación           | Mínimos al leer, parámetros autenticados (ADR 010)                                     | ✅                                                                                 | db, boveda                |
| A-25 | Un corte de luz deja la bóveda inutilizable                                | Denegación de servicio | Escritura atómica; base y sellada instaladas como unidad (ADR 010)                     | ✅                                                                                 | db, boveda                |
| A-26 | Una copia de seguridad se filtra o queda en la nube                        | Divulgación            | Cifrada; ruta en el proceso principal; aviso si está sincronizada                      | ✅ parcial: su seguridad depende de la contraseña                                  | TS-02, E2E                |
| A-27 | Prueba de contraseñas desde la interfaz                                    | Elevación              | Freno persistente (RN-BOV-02); no reemplaza a Argon2id ante una copia del archivo      | ✅                                                                                 | boveda, E2E               |
| A-28 | Un XSS lee datos o evita el bloqueo                                        | Elevación              | Canales rechazados por defecto al bloquear; inactividad medida en el proceso principal | ✅                                                                                 | TS-08, TS-09, E2E         |
| A-29 | Un dato personal de la autora llega al repo público                        | Divulgación            | Regla en CLAUDE.md y test que no imprime el valor                                      | ✅ parcial: no detecta nombres ni organizaciones                                   | privacidad-repo           |

## Limitaciones aceptadas del paquete crypto

Detalle en [`packages/crypto/README.md`](../packages/crypto/README.md):

- **Sin auditoría publicada de la librería de Argon2id** ([ADR 005](decisiones/005-argon2id.md)).
- JavaScript no permite garantizar que no queden copias de una clave en memoria.
- Por ahora solo se soporta Windows x64.
- La contraseña llega por IPC como string de JavaScript y no se puede borrar; se convierte enseguida.
- Sobrescribir las claves no garantiza que no queden copias internas de Node o de SQLite.

## Fuera del alcance

Atacante con control total del equipo mientras la bóveda está desbloqueada. Se reduce la ventana
de exposición con el bloqueo automático.
