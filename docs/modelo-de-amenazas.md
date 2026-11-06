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
 │                               [Runner] ─ pipe ─► [Chromium, en sandbox]        │
 │                                código propio        no confiable       │      │
 │                                                     [Proxy de salida] ─┐      │
 │                                                      lista permitida   │      │
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

## Qué protege cada capa de una ejecución

El runner y el proxy son **código propio**. Lo no confiable es el **sitio probado**, que corre en el
sandbox de Chromium. Las capas de abajo apuntan a eso, y no a código malicioso dentro de nuestros procesos.

- **Sandbox de Chromium:** contra un sitio hostil que explote el motor de renderizado. Es lo único que lo
  separa del sistema, y por eso nunca se apaga. Playwright lo trae apagado: se enciende de forma explícita y
  un test mira la línea de comando real del renderer.
- **Proxy de salida:** contra un sitio que quiera sacar datos o llegar a otra cosa: otro dominio, otro puerto
  local, un DNS que apunta a la red interna. Decide por host y puerto, y nunca ve el contenido de HTTPS.
- **Segunda capa (`context.route`, service workers bloqueados):** contra un error del proxy, y para frenar
  escrituras en modo solo lectura, que el proxy no puede ver dentro de un túnel.
- **Proceso del runner, sin claves:** contra un error propio o de una dependencia que filtre datos, y para
  que un fallo del motor de pruebas no alcance la memoria del proceso principal. **No es un sandbox:** puede
  leer y escribir los archivos del usuario y lanzar procesos. Si alguien ejecutara código ahí, leería la
  bóveda cifrada, sin poder abrirla, y cualquier secreto que el runner tenga en ese momento.
- **Agente de red de Node:** contra un error nuestro o una dependencia que quiera salir. Es cooperativo: no
  frena a código malicioso dentro del proceso, y `electron.net` no pasa por él. Por eso un test estático
  prohíbe importar red, `electron.net` y `child_process` en el código del motor.

**Pendiente, fase 3:** los `.spec.ts` importados son código de terceros: ahí esta suposición deja de valer.
Necesitan aislamiento a nivel del sistema operativo, no alcanza con otro `utilityProcess`.

**Pendiente:** correr el E2E del CI de Linux dentro de un network namespace sin salida, para probar a nivel
del sistema operativo que la app no abre conexiones no autorizadas. Hoy TS-03 observa los sockets del proceso
principal y lo que le llega al servidor de prueba: no es una captura del sistema.

## Amenazas y estado de las mitigaciones (STRIDE)

| ID   | Amenaza                                                                        | Categoría              | Mitigación                                                                                           | Estado                                                                             | Test                      |
| ---- | ------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| A-01 | XSS en la interfaz lee archivos o ejecuta comandos                             | Elevación              | Sandbox, sin Node, aislamiento de contexto                                                           | ✅                                                                                 | TS-07, E2E                |
| A-02 | XSS en la interfaz envía datos a internet                                      | Divulgación            | CSP `connect-src 'none'` + bloqueo en el proceso principal                                           | ✅                                                                                 | TS-03, TS-07, E2E         |
| A-03 | La interfaz abusa del IPC (rutas, campos extra)                                | Manipulación           | Validación de origen, entrada y salida                                                               | ✅                                                                                 | TS-08                     |
| A-04 | Un handler devuelve un secreto por error                                       | Divulgación            | Validación de la salida con esquema estricto                                                         | ✅                                                                                 | TS-08                     |
| A-05 | Lectura de archivos fuera de la interfaz vía protocolo                         | Divulgación            | `app://` con protección de path traversal                                                            | ✅                                                                                 | app-protocol              |
| A-06 | Navegación o ventanas hacia sitios externos                                    | Suplantación           | will-navigate, setWindowOpenHandler, Auxclick                                                        | ✅                                                                                 | E2E                       |
| A-07 | Electron/Chromium contacta servicios de terceros                               | Divulgación            | Corrector ortográfico desactivado, red denegada                                                      | ✅ parcial                                                                         | TS-03 completo (semana 5) |
| A-08 | Datos sincronizados a la nube sin querer                                       | Divulgación            | `%LOCALAPPDATA%`, detección de carpetas sincronizadas                                                | ✅                                                                                 | data-dir                  |
| A-09 | Paquete npm malicioso ejecuta código al instalarse                             | Elevación              | `ignore-scripts` + lista permitida                                                                   | ✅                                                                                 | —                         |
| A-10 | Dependencia de análisis con vulnerabilidades entra al proyecto                 | Manipulación           | Electronegativity aislado vía npx                                                                    | ✅                                                                                 | npm audit                 |
| A-11 | Robo del equipo o del disco                                                    | Divulgación            | SQLCipher, contraseña maestra, bloqueo automático                                                    | ✅ (falta TS-01, semana 7)                                                         | TS-02, TS-09              |
| A-12 | El sitio probado redirige o carga recursos de otros dominios                   | Divulgación            | Proxy de salida con lista permitida                                                                  | ⏳ semana 5                                                                        | TS-03, TS-04              |
| A-13 | Contraseñas o tokens en evidencias                                             | Divulgación            | Login sin grabación, redacción, detector                                                             | ⏳ semanas 6-7                                                                     | TS-01, TS-06              |
| A-14 | Excel malicioso (macros, vínculos, bomba zip)                                  | Elevación              | Proceso aislado, sin ejecución, límites                                                              | ⏳ fase 2                                                                          | TS-12                     |
| A-15 | Inyección de fórmulas en exportaciones                                         | Manipulación           | Escapado de celdas                                                                                   | ⏳ fase 2                                                                          | TS-11                     |
| A-16 | Ataque de fuerza bruta a la contraseña con una copia de la bóveda              | Divulgación            | Argon2id con piso de parámetros; parámetros autenticados                                             | ✅                                                                                 | Vectores RFC 9106, crypto |
| A-17 | Alterar, reordenar, duplicar o truncar un archivo o valor cifrado              | Manipulación           | AES-256-GCM, formato STREAM, AAD con versión y propósito                                             | ✅                                                                                 | crypto                    |
| A-18 | Mover un valor cifrado a otro proyecto, campo o evidencia                      | Manipulación           | Contexto en el AAD; ID en la derivación de la clave                                                  | ✅                                                                                 | crypto                    |
| A-19 | Evidencias de un proyecto eliminado siguen legibles                            | Divulgación            | Borrado criptográfico; `secure_delete`; lápidas al restaurar (ADR 009)                               | ✅ parcial: una copia ya hecha conserva el proyecto; TS-10 completo en la semana 9 | TS-10, boveda             |
| A-20 | Archivo manipulado agota la memoria en el desbloqueo                           | Denegación de servicio | Techo de parámetros validado antes de derivar; bloque fijo por versión                               | ✅                                                                                 | crypto                    |
| A-21 | Un módulo nativo manipulado en el disco roba la contraseña                     | Elevación              | SHA-256 verificado antes de cargarlo (ADR 007)                                                       | ✅ parcial: completo con fuses y firma, semana 10                                  | nativos-integridad        |
| A-22 | Contraseña comprometida y copia vieja de la bóveda en manos de un atacante     | Divulgación            | Cambiar la contraseña no alcanza; "rotar clave maestra"                                              | ⏳ pendiente, sin asignar                                                          | Test de la limitación     |
| A-23 | Claves residuales en memoria o en la paginación                                | Divulgación            | `fill(0)`, sin claves en strings; limitaciones documentadas                                          | ✅ parcial                                                                         | crypto                    |
| A-24 | Un archivo sellado alterado baja el costo de Argon2id                          | Manipulación           | Mínimos al leer, parámetros autenticados (ADR 010)                                                   | ✅                                                                                 | db, boveda                |
| A-25 | Un corte de luz deja la bóveda inutilizable                                    | Denegación de servicio | Escritura atómica; base y sellada instaladas como unidad (ADR 010)                                   | ✅                                                                                 | db, boveda                |
| A-26 | Una copia de seguridad se filtra o queda en la nube                            | Divulgación            | Cifrada; ruta en el proceso principal; aviso si está sincronizada                                    | ✅ parcial: su seguridad depende de la contraseña                                  | TS-02, E2E                |
| A-27 | Prueba de contraseñas desde la interfaz                                        | Elevación              | Freno persistente (RN-BOV-02); no reemplaza a Argon2id ante una copia del archivo                    | ✅                                                                                 | boveda, E2E               |
| A-28 | Un XSS lee datos o evita el bloqueo                                            | Elevación              | Canales rechazados por defecto al bloquear; inactividad medida en el proceso principal               | ✅                                                                                 | TS-08, TS-09, E2E         |
| A-29 | Un dato personal de la autora llega al repo público                            | Divulgación            | Regla en CLAUDE.md y test que no imprime el valor                                                    | ✅ parcial: no detecta nombres ni organizaciones                                   | privacidad-repo           |
| A-30 | Un comodín amplio o un dominio parecido amplía el alcance                      | Elevación              | Lista de sufijos públicos, pertenencia por etiquetas, forma canónica de IP (ADR 011)                 |
| A-31 | El escáner llega a metadatos de la nube o a una IP pública escrita como número | Elevación              | IPs rechazadas siempre, aun con Sistema interno; el proxy es la segunda capa (semana 5)              |
| A-32 | Se ejecuta contra un sistema sin autorización o con el alcance cambiado        | Repudio                | Declaración versionada; el texto aceptado se compara y se guarda; el chequeo falla cerrado (ADR 014) |
| A-33 | El secreto de una credencial se lee o se mueve a otra credencial               | Divulgación            | Campo cifrado con AAD; ningún canal lo devuelve; sin indicios; test con canario (ADR 013)            |
| A-34 | El secreto se envía a otro sitio o sin cifrar                                  | Divulgación            | URL de login dentro de los dominios; http con opción explícita y auditada (ADR 011 y 013)            |
| A-35 | Una contraseña queda escrita en los pasos del login                            | Divulgación            | Pasos tipados, sin campo de valor; un selector sigue siendo texto libre (ADR 013)                    |
| A-36 | La auditoría conserva datos de un proyecto eliminado                           | Divulgación            | Solo IDs y nombres de campos (ADR 015)                                                               |
| A-37 | Un borrado de proyecto se corta a mitad                                        | Divulgación            | Transacción; se completa al desbloquear (ADR 015)                                                    |
| A-38 | Un intento de fuga de la app de prueba llega a un dominio real                 | Divulgación            | Solo dominios reservados mapeados a 127.0.0.1, con test sobre el manifiesto (ADR 012)                |

### Amenazas de una ejecución

| ID   | Amenaza                                                                | Categoría    | Mitigación                                                                                           | Estado   |
| ---- | ---------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| E-01 | Un sitio saca datos a otro dominio (script, imagen, fetch, WebSocket)  | Divulgación  | Proxy con lista permitida, y segunda capa. TS-04, con control positivo                               | Mitigada |
| E-02 | Una redirección saca el navegador del alcance                          | Elevación    | El proxy no sigue redirecciones: cada salto se decide                                                | Mitigada |
| E-03 | DNS rebinding: un dominio público apunta a la red interna o a loopback | Elevación    | Una sola resolución, todas las IPs validadas, conexión a la IP validada                              | Mitigada |
| E-04 | El sitio llega a otro servicio local del equipo                        | Elevación    | Solo los puertos locales declarados, que forman parte del alcance autorizado                         | Mitigada |
| E-05 | El sitio llega al servicio de metadatos de la nube                     | Divulgación  | 169.254/16 rechazada siempre, aun con Sistema interno                                                | Mitigada |
| E-06 | Otro programa del equipo usa el proxy                                  | Elevación    | Solo en 127.0.0.1, puerto aleatorio, credencial por ejecución                                        | Mitigada |
| E-07 | El proxy se cae y el navegador sale en directo                         | Divulgación  | Chromium no sale sin su proxy, y la ejecución se aborta. Probado matándolo                           | Mitigada |
| E-08 | Un service worker sale por su cuenta o sobrevive a la ejecución        | Divulgación  | Bloqueados; si uno se registrara, igual sale por el proxy. Perfil efímero                            | Mitigada |
| E-09 | Un exploit del renderer sale del navegador                             | Elevación    | Sandbox de Chromium encendido y verificado                                                           | Mitigada |
| E-10 | Datos del sitio quedan en disco sin cifrar                             | Divulgación  | Perfil en memoria, borrado al terminar y al arrancar. Ver la excepción, ADR 018                      | Parcial  |
| E-11 | El secreto queda en memoria del runner o de Chromium                   | Divulgación  | Un proceso por ejecución, que termina. Un string no se puede borrar (ADR 017)                        | Parcial  |
| E-12 | El contenido de la página vuelve a la app por la prueba de login       | Divulgación  | Esquema estricto: solo un resultado y un motivo de una lista cerrada                                 | Mitigada |
| E-13 | Una contraseña mala se informa como buena                              | Manipulación | Indicador exigido, falso antes de enviar y verdadero después                                         | Mitigada |
| E-14 | Domain fronting: dentro de un túnel permitido se habla con otro host   | Divulgación  | **Sin mitigar:** decidir por el host del CONNECT no ve el SNI ni el Host interno                     | Aceptada |
| E-15 | Tráfico UDP fuera del proxy (WebRTC, QUIC), o una IP local expuesta    | Divulgación  | Apagados por argumento. E2E con receptor UDP y control positivo (ADR 016)                            | Mitigada |
| E-16 | Navegador alterado en disco                                            | Manipulación | En desarrollo y CI, hash de la primera descarga. Instalador firmado, semana 10                       | Parcial  |
| E-17 | Las pruebas de login bloquean la cuenta en el sistema probado          | Denegación   | Aviso antes de probar y hasta 3 intentos cada 15 minutos, por credencial (ADR 017)                   | Mitigada |
| E-18 | El sitio probado altera o ve los chequeos y falsea el resultado        | Manipulación | axe y las mediciones en un mundo aislado: la página no los ve ni toca sus variables (ADR 021)        | Mitigada |
| E-19 | Escritura por WebSocket en modo solo lectura                           | Manipulación | Los mensajes salientes de la página se descartan y se cuentan (ADR 022)                              | Mitigada |
| E-20 | Un mensaje de consola o un selector con datos del sitio queda en claro | Divulgación  | Detalle cifrado con la clave del proyecto hasta la redacción de la semana 7 (ADR 023)                | Parcial  |
| E-21 | El crawler escribe al tocar un botón                                   | Manipulación | En solo lectura, ningún clic; sin solo lectura, nunca un botón de formulario ni uno excluido (TS-05) | Mitigada |
| E-22 | Una trampa de URLs infinitas agota el escaneo                          | Denegación   | Normalización, límites por ruta y por forma, y tiempo máximo (ADR 022)                               | Mitigada |

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
