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

| ID   | Amenaza                                                        | Categoría    | Mitigación                                                 | Estado         | Test                      |
| ---- | -------------------------------------------------------------- | ------------ | ---------------------------------------------------------- | -------------- | ------------------------- |
| A-01 | XSS en la interfaz lee archivos o ejecuta comandos             | Elevación    | Sandbox, sin Node, aislamiento de contexto                 | ✅             | TS-07, E2E                |
| A-02 | XSS en la interfaz envía datos a internet                      | Divulgación  | CSP `connect-src 'none'` + bloqueo en el proceso principal | ✅             | TS-03, TS-07, E2E         |
| A-03 | La interfaz abusa del IPC (rutas, campos extra)                | Manipulación | Validación de origen, entrada y salida                     | ✅             | TS-08                     |
| A-04 | Un handler devuelve un secreto por error                       | Divulgación  | Validación de la salida con esquema estricto               | ✅             | TS-08                     |
| A-05 | Lectura de archivos fuera de la interfaz vía protocolo         | Divulgación  | `app://` con protección de path traversal                  | ✅             | app-protocol              |
| A-06 | Navegación o ventanas hacia sitios externos                    | Suplantación | will-navigate, setWindowOpenHandler, Auxclick              | ✅             | E2E                       |
| A-07 | Electron/Chromium contacta servicios de terceros               | Divulgación  | Corrector ortográfico desactivado, red denegada            | ✅ parcial     | TS-03 completo (semana 5) |
| A-08 | Datos sincronizados a la nube sin querer                       | Divulgación  | `%LOCALAPPDATA%`, detección de carpetas sincronizadas      | ✅             | data-dir                  |
| A-09 | Paquete npm malicioso ejecuta código al instalarse             | Elevación    | `ignore-scripts` + lista permitida                         | ✅             | —                         |
| A-10 | Dependencia de análisis con vulnerabilidades entra al proyecto | Manipulación | Electronegativity aislado vía npx                          | ✅             | npm audit                 |
| A-11 | Robo del equipo o del disco                                    | Divulgación  | Bóveda cifrada, contraseña maestra, bloqueo                | ⏳ semanas 2-3 | TS-02, TS-09              |
| A-12 | El sitio probado redirige o carga recursos de otros dominios   | Divulgación  | Proxy de salida con lista permitida                        | ⏳ semana 5    | TS-03, TS-04              |
| A-13 | Contraseñas o tokens en evidencias                             | Divulgación  | Login sin grabación, redacción, detector                   | ⏳ semanas 6-7 | TS-01, TS-06              |
| A-14 | Excel malicioso (macros, vínculos, bomba zip)                  | Elevación    | Proceso aislado, sin ejecución, límites                    | ⏳ fase 2      | TS-12                     |
| A-15 | Inyección de fórmulas en exportaciones                         | Manipulación | Escapado de celdas                                         | ⏳ fase 2      | TS-11                     |

## Fuera del alcance

Atacante con control total del equipo mientras la bóveda está desbloqueada. Se reduce la ventana
de exposición con el bloqueo automático (semana 3).
