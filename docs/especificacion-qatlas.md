**QAtlas**

Aplicación de escritorio para testing de aplicaciones web

**Local-first · Cifrada · Sin telemetría**

**Especificación funcional, técnica y de seguridad**

| **Campo** | **Valor**                                                                         |
|-----------|-----------------------------------------------------------------------------------|
| Producto  | QAtlas (nombre provisorio)                                                        |
| Documento | Especificación funcional, técnica y de seguridad — todas las fases                |
| Versión   | 0.3 — Borrador                                                                    |
| Autora    | ana (nombre ficticio)                                                             |
| Fecha     | Octubre 2026                                                                      |
| Stack     | Electron · React + TypeScript · Node.js · Playwright · SQLite cifrada (SQLCipher) |

# Índice

Si el índice aparece vacío: clic derecho sobre él → Actualizar campo →
Actualizar toda la tabla.

# 1. Introducción

## 1.1 Propósito del documento

Este documento especifica QAtlas, una **aplicación de escritorio** para
probar aplicaciones web: permite registrar un sistema a partir de su
URL, ejecutar pruebas automáticas genéricas, crear casos de prueba
propios sin escribir código y obtener reportes de bugs con evidencia.

La **seguridad de los datos** es el requisito central del producto.
QAtlas maneja información sensible por naturaleza: URLs de sistemas
internos, credenciales de prueba, capturas de pantalla, tráfico de red y
datos que aparecen en las aplicaciones probadas. Por eso el diseño
completo parte de un principio: **ningún dato sale del equipo del
usuario salvo por una acción explícita suya**.

## 1.2 Historial de versiones

| **Versión** | **Cambios principales**                                                                                                                                                                                                      |
|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 0.1         | Primera versión como aplicación web con servidor (PostgreSQL, API REST, multiusuario).                                                                                                                                       |
| 0.2         | Pasa a aplicación de escritorio local-first, con SQLite cifrada y la seguridad como eje del diseño.                                                                                                                          |
| 0.3         | Agrega importación de casos desde Excel, ejecución manual y UAT con acta de conformidad, monitor de logs, nuevos formatos de reporte (Excel, video, HTML, JUnit) y controles de seguridad para archivos de entrada y salida. |

### Cambios de la versión 0.2 respecto de la 0.1

| **Aspecto**   | **Versión 0.1 (web)**       | **Versión 0.2 (escritorio)**                                                     |
|---------------|-----------------------------|----------------------------------------------------------------------------------|
| Plataforma    | Aplicación web con servidor | Aplicación de escritorio (Windows, macOS, Linux)                                 |
| Base de datos | PostgreSQL en servidor      | SQLite cifrada con SQLCipher, archivo local                                      |
| Backend       | API REST con Fastify        | Proceso principal de Electron con IPC tipado; sin puertos abiertos               |
| Usuarios      | Multiusuario con roles      | Uso individual, protegido con contraseña maestra                                 |
| Red           | Cliente-servidor            | Sin conexiones salvo el sistema probado e integraciones activadas por el usuario |
| Grabador      | Extensión de Chrome         | Integrado en la aplicación                                                       |
| Colaboración  | Compartida en el servidor   | Mediante exportaciones revisadas y, opcionalmente, cifradas                      |

## 1.3 Problema que resuelve

En el trabajo diario de QA se repite el mismo patrón: se reporta un bug,
se corrige, y al recibir la corrección algo que funcionaba deja de
funcionar. Además:

- Las pruebas manuales de regresión son lentas y no se repiten siempre
  igual.

- Los frameworks de automatización requieren programar y no tienen
  interfaz.

- Los reportes de bugs se arman a mano y muchas veces llegan
  incompletos.

- Errores comunes (links rotos, errores de JavaScript, accesibilidad) se
  detectan tarde.

- Las herramientas de testing en la nube obligan a subir URLs,
  credenciales y capturas de sistemas internos a servidores de terceros.

- Los casos de prueba y los scripts de UAT suelen vivir en planillas de
  Excel, desconectados de las herramientas de automatización: pasar de
  uno a otro es reescribir todo.

## 1.4 Alcance

**Incluido:** aplicaciones web accesibles por URL desde el equipo del
usuario (incluidos entornos locales e internos), en Chromium, Firefox y
WebKit.

**No incluido:** aplicaciones móviles nativas, pruebas de carga masiva y
pruebas de penetración. QAtlas no es una herramienta de ataque: solo
realiza las acciones que haría un usuario o un tester autorizado.

## 1.5 Glosario

| **Término**               | **Definición**                                                                                                                                |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Bóveda                    | Conjunto de datos cifrados de QAtlas en el equipo: base de datos y archivos de evidencia.                                                     |
| Contraseña maestra        | Contraseña del usuario que desbloquea la bóveda. Nunca se guarda.                                                                             |
| Proyecto                  | Sistema a probar, identificado por una URL base y sus dominios permitidos.                                                                    |
| Escaneo                   | Prueba automática genérica que recorre el sitio y detecta problemas.                                                                          |
| Caso de prueba            | Secuencia de pasos con verificaciones, definida por el usuario.                                                                               |
| Suite                     | Conjunto de casos de prueba que se ejecutan juntos.                                                                                           |
| Ejecución                 | Una corrida concreta de un escaneo, suite o caso.                                                                                             |
| Hallazgo                  | Problema detectado en una ejecución.                                                                                                          |
| Evidencia                 | Screenshot, video, traza de Playwright, logs de consola y de red que respaldan un hallazgo.                                                   |
| Redacción                 | Ocultamiento automático de datos sensibles (contraseñas, tokens) en evidencias y exportaciones.                                               |
| Lista de salida permitida | Dominios con los que QAtlas tiene permitido comunicarse. Todo lo demás se bloquea.                                                            |
| Regresión                 | Hallazgo que estaba resuelto y vuelve a aparecer.                                                                                             |
| Caso manual               | Caso de prueba que ejecuta una persona siguiendo los pasos, con QAtlas como guía y registro de resultados.                                    |
| UAT                       | Pruebas de aceptación de usuario: las ejecutan usuarios del negocio para validar que el sistema cumple lo pedido antes de pasar a producción. |
| Acta de UAT               | Documento que resume una ronda de UAT y registra la conformidad (o no) de los responsables.                                                   |
| Plantilla de importación  | Configuración guardada que indica qué columna de un Excel corresponde a cada dato de un caso de prueba.                                       |
| Fuente de log             | Archivo de log o contenedor del sistema probado que QAtlas lee durante una ejecución.                                                         |
| Runner                    | Proceso aislado que ejecuta las pruebas con Playwright.                                                                                       |
| IPC                       | Comunicación interna entre los procesos de la aplicación, sin pasar por la red.                                                               |

# 2. Visión general del producto

## 2.1 Qué es QAtlas

Una aplicación de escritorio con tres capacidades centrales:

1.  **Escanear** cualquier aplicación autorizada y detectar problemas
    genéricos automáticamente.

2.  **Probar** flujos concretos con casos de prueba creados sin código,
    grabados o importados desde Playwright.

3.  **Reportar** cada falla como un bug con evidencia, con seguimiento
    de estado y detección de regresiones.

Además, QAtlas se integra con la forma en que hoy trabajan muchos
equipos de QA: **importa los casos de prueba y los scripts de UAT desde
Excel**, permite ejecutarlos de forma manual o automatizada y devuelve
los resultados en el mismo formato.

## 2.2 Usuario

QAtlas es de **uso individual**: cada instalación pertenece a una
persona y sus datos viven solo en ese equipo, protegidos por su
contraseña maestra. No hay cuentas en la nube ni registro en servidores.
Para trabajar en equipo, los reportes se comparten como archivos
exportados (PDF, Markdown o paquete cifrado), siempre después de una
revisión de qué se incluye.

## 2.3 Principios de diseño

- **Local-first.** Todo se procesa y guarda en el equipo del usuario.

- **Cero telemetría.** Sin analíticas, sin reportes de errores
  automáticos, sin "llamar a casa".

- **Denegar por defecto.** Ninguna conexión de red está permitida salvo
  las explícitamente autorizadas.

- **Cifrado siempre.** Ningún dato del usuario se escribe en disco sin
  cifrar.

- **Uso autorizado por diseño.** No se puede probar nada sin una
  autorización registrada.

- **Evidencia sin exposición.** Las evidencias se capturan con los datos
  sensibles redactados.

- **Transparencia.** El usuario puede ver cada conexión que hizo la
  aplicación y cada dato que va a exportar.

## 2.4 Flujo de uso típico

1.  En el primer inicio, el usuario crea su contraseña maestra y QAtlas
    inicializa la bóveda cifrada.

2.  Crea un proyecto con la URL de la aplicación y declara que tiene
    autorización para probarla.

3.  Carga las credenciales de un usuario de prueba, que se guardan
    cifradas.

4.  Lanza un escaneo: QAtlas recorre el sitio sin salir de los dominios
    permitidos y detecta problemas.

5.  Revisa los hallazgos, descarta falsos positivos y confirma los
    reales.

6.  Importa sus casos de prueba y scripts de UAT desde Excel, o crea y
    graba casos nuevos, y los agrupa en suites.

7.  Ejecuta los casos manuales con la guía paso a paso y automatiza
    progresivamente los que se repiten.

8.  Ejecuta las suites con cada nueva versión del sistema.

9.  Genera reportes de bug, revisa qué datos incluyen y los exporta o
    envía a GitHub o Jira (si activó esa integración).

10. Cuando un bug resuelto reaparece, QAtlas lo marca como
    **regresión**.

# 3. Seguridad y privacidad

> **Alcance de esta sección:** ningún software puede garantizar que
> nunca habrá una fuga de datos. Lo que sí se garantiza por diseño es
> que la superficie de riesgo sea mínima, que cada salida de datos sea
> explícita, controlada y registrada, y que cada control tenga un test
> automatizado que lo verifique en cada versión.

## 3.1 Modelo de amenazas

Qué se protege:

- Credenciales de los sistemas probados.

- URLs y estructura de sistemas internos.

- Evidencias: capturas, videos, trazas y tráfico de red que pueden
  mostrar datos reales de esos sistemas.

- Reportes de bugs, que describen vulnerabilidades o fallas no públicas.

| **Amenaza**                           | **Ejemplo**                                                                             | **Mitigación principal**                                                                       |
|---------------------------------------|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| Fuga por red                          | Telemetría, CDN, dependencia que envía datos, sitio probado que redirige a otro dominio | Denegar por defecto, proxy de salida con lista permitida, cero telemetría (3.5)                |
| Robo o pérdida del equipo             | Notebook robada, disco extraído                                                         | Bóveda cifrada, contraseña maestra, bloqueo automático (3.4)                                   |
| Otro usuario del mismo equipo         | Cuenta compartida, acceso a la carpeta de datos                                         | Cifrado en reposo; permisos restrictivos de archivos (3.4)                                     |
| Sincronización involuntaria a la nube | Carpeta de datos dentro de OneDrive, Dropbox o perfil móvil de Windows                  | Datos en almacenamiento local no sincronizado y detección de carpetas sincronizadas (3.10)     |
| Contenido malicioso del sitio probado | JavaScript del sitio que intenta acceder a la app o al sistema                          | Navegador de pruebas aislado; el contenido nunca se ejecuta en la ventana de QAtlas (3.6, 3.7) |
| Datos sensibles en evidencias         | Contraseña en una traza, token en un log de red                                         | Login fuera de la grabación, redacción automática, detector de secretos (3.8)                  |
| Exportación descuidada                | Reporte con video que muestra datos de clientes reales                                  | Revisión previa a exportar, exclusiones, paquete cifrado (3.9)                                 |
| Cadena de suministro                  | Paquete npm comprometido, instalador alterado                                           | Dependencias mínimas y auditadas, builds firmados, SBOM (3.11)                                 |
| Actualización maliciosa               | Servidor de actualizaciones comprometido                                                | Actualizaciones opcionales, firmadas y verificadas (3.12)                                      |
| Logs y archivos temporales            | Secretos en logs, temporales sin cifrar                                                 | Logs con redacción; temporales cifrados o en memoria (3.13)                                    |
| Archivo de entrada malicioso          | Excel con macros, vínculos externos o "bomba zip"; paquete .qatlas manipulado           | Procesamiento aislado, sin macros ni fórmulas, límites de tamaño, validación estricta (3.15)   |
| Logs del sistema probado              | Log de backend con tokens o datos personales                                            | Lectura opcional y de solo lectura, redacción y detector de secretos (3.15)                    |
| Archivos exportados peligrosos        | Inyección de fórmulas en Excel, video con datos sensibles                               | Escapado de celdas, advertencia y exclusión de video en modo datos sensibles (3.9)             |

**Fuera del alcance:** un atacante con control total del equipo mientras
la bóveda está desbloqueada (malware con privilegios de administrador,
keyloggers). Ninguna aplicación de escritorio puede defenderse
completamente de eso; QAtlas reduce la ventana de exposición con el
bloqueo automático.

## 3.2 Uso autorizado

| **ID** | **Control**                                                                                                                                         | **Fase** |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| SEG-01 | Al crear un proyecto, el usuario acepta una declaración de autorización. Se registra fecha, texto y versión. Sin esto, el proyecto no ejecuta nada. | 1        |
| SEG-02 | Lista de dominios permitidos por proyecto. Toda navegación o request a otro dominio se bloquea y se registra.                                       | 1        |
| SEG-03 | Límite de velocidad configurable (requests por segundo y páginas por escaneo).                                                                      | 1        |
| SEG-04 | Modo solo lectura por defecto en escaneos: se bloquean POST, PUT, PATCH y DELETE excepto el login configurado.                                      | 1        |
| SEG-05 | Lista de exclusión (logout, eliminar, borrar, delete, pagar, comprar, enviar…) que el crawler nunca visita ni clickea.                              | 1        |
| SEG-06 | Verificación opcional de propiedad del dominio para sistemas públicos.                                                                              | 4        |
| SEG-07 | Registro de auditoría local de todas las ejecuciones: qué, cuándo y contra qué URL.                                                                 | 1        |

## 3.3 Principios de seguridad aplicados

- **Mínimo privilegio:** cada proceso tiene solo los permisos que
  necesita. La interfaz no tiene acceso a Node, al disco ni a la red.

- **Defensa en profundidad:** cada control crítico tiene al menos dos
  capas (por ejemplo, proxy de salida y bloqueo de rutas en el
  navegador).

- **Seguro por defecto:** la configuración inicial es la más
  restrictiva; el usuario relaja controles de forma explícita y queda
  registrado.

- **Fallar cerrado:** si un control no puede aplicarse (por ejemplo, el
  proxy no arranca), la ejecución no se inicia.

- **Verificable:** cada control tiene un test automatizado en la suite
  de seguridad (sección 3.15).

## 3.4 Cifrado y gestión de claves

### Esquema de claves

1.  El usuario define una **contraseña maestra** (mínimo 12 caracteres,
    con medidor de fortaleza y verificación contra contraseñas comunes).

2.  De la contraseña se deriva una **clave de cifrado de claves (KEK)**
    con **Argon2id** (parámetros: 64 MiB de memoria, 3 iteraciones, salt
    aleatorio de 16 bytes). La contraseña nunca se guarda.

3.  Al crear la bóveda se genera una **clave de datos maestra**
    aleatoria de 256 bits, que se guarda únicamente cifrada con la KEK
    (AES-256-GCM).

4.  La base de datos SQLite se cifra completa con **SQLCipher** usando
    una clave derivada de la clave de datos maestra.

5.  Cada proyecto tiene su propia **clave de proyecto** aleatoria,
    guardada cifrada con la clave maestra. Las evidencias del proyecto
    se cifran con ella, archivo por archivo, con AES-256-GCM.

6.  Las credenciales de los sistemas probados tienen además **cifrado a
    nivel de campo**: aun con la base abierta, el secreto solo se
    descifra en el momento de usarlo.

### Reglas

- Las claves descifradas viven solo en memoria del proceso principal,
  nunca en la interfaz ni en disco, y se sobrescriben al bloquear.

- **Bloqueo automático** tras inactividad configurable (por defecto, 15
  minutos), al suspender o bloquear el sistema operativo, y al cerrar la
  aplicación.

- Opción **"Recordar en este equipo"** desactivada por defecto. Si el
  usuario la activa, la clave se guarda con el almacén seguro del
  sistema operativo (Windows DPAPI, llavero de macOS, libsecret en
  Linux) mediante safeStorage de Electron.

- **No hay recuperación de contraseña:** si se pierde, los datos son
  irrecuperables. Por eso QAtlas ofrece una copia de seguridad cifrada y
  la sugiere en el primer inicio.

- Cambiar la contraseña maestra solo vuelve a cifrar la clave maestra
  (operación instantánea); no hace falta recifrar todos los datos.

- Archivos de la bóveda creados con permisos solo para el usuario
  actual.

- **Borrado criptográfico:** al eliminar un proyecto se destruye su
  clave. Así sus evidencias quedan ilegibles aunque el disco
  (especialmente un SSD) conserve restos de los archivos.

## 3.5 Red: denegar por defecto

QAtlas solo se comunica con tres tipos de destino: el sistema probado
(dentro de sus dominios permitidos), las integraciones que el usuario
activó explícitamente y el servidor de actualizaciones, si el usuario
activó las actualizaciones. Todo lo demás está bloqueado.

| **Capa**             | **Control**                                                                                                                                                                                                                                                                                             |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Interfaz de QAtlas   | Se carga solo desde archivos empaquetados en la aplicación, con un protocolo propio (app://). Content Security Policy estricta: default-src 'self'; connect-src 'none'; script-src 'self'; object-src 'none'; frame-src 'none'. Toda request de red desde la interfaz se cancela en session.webRequest. |
| Recursos             | Sin CDNs ni fuentes remotas: tipografías, íconos y librerías van empaquetados.                                                                                                                                                                                                                          |
| Navegador de pruebas | Todo el tráfico pasa por un **proxy de salida local** que solo permite los dominios del proyecto (incluidos WebSockets y redirecciones). Segunda capa: bloqueo de rutas en Playwright (context.route) y service workers bloqueados.                                                                     |
| Proceso runner       | Las conexiones de Node pasan por un agente HTTP que valida cada destino contra la lista permitida.                                                                                                                                                                                                      |
| Integraciones        | Cada integración declara sus dominios exactos (por ejemplo, api.github.com), que se agregan a la lista solo mientras está activa.                                                                                                                                                                       |
| Telemetría           | Ninguna. Sin analíticas, sin envío automático de errores, sin comprobaciones de licencia.                                                                                                                                                                                                               |
| Puertos              | QAtlas no abre puertos de escucha. El proxy interno escucha solo en 127.0.0.1, en un puerto aleatorio y con autenticación de un solo uso por ejecución.                                                                                                                                                 |

### Monitor de conexiones

Una pantalla muestra **cada conexión saliente** de la aplicación: fecha,
destino, proceso que la originó, si fue permitida o bloqueada y por qué
regla. Así el usuario puede verificar por sí mismo que no hay
comunicaciones inesperadas. Las conexiones bloqueadas durante una
ejecución aparecen además en su resumen, porque pueden indicar
redirecciones o scripts de terceros en el sistema probado.

## 3.6 Endurecimiento de Electron

Se sigue la guía oficial de seguridad de Electron. Cada punto se
verifica automáticamente en CI (sección 3.15).

| **Control**             | **Configuración**                                                                                                                                                                        |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Aislamiento de contexto | contextIsolation: true                                                                                                                                                                   |
| Sandbox del renderer    | sandbox: true en todas las ventanas                                                                                                                                                      |
| Sin Node en la interfaz | nodeIntegration: false, nodeIntegrationInWorker: false                                                                                                                                   |
| Seguridad web           | webSecurity: true; allowRunningInsecureContent: false                                                                                                                                    |
| Puente mínimo           | El preload expone por contextBridge solo funciones tipadas y específicas (nunca ipcRenderer completo).                                                                                   |
| Validación de IPC       | Cada mensaje se valida con Zod y se verifica el origen (event.senderFrame) antes de procesarlo.                                                                                          |
| Navegación              | Se bloquea toda navegación de la ventana (will-navigate) y la apertura de ventanas nuevas (setWindowOpenHandler → deny).                                                                 |
| Permisos                | Se deniegan todos los permisos del navegador (cámara, micrófono, ubicación, notificaciones) con setPermissionRequestHandler.                                                             |
| Links externos          | shell.openExternal solo para HTTPS, con confirmación que muestra la URL completa.                                                                                                        |
| Webviews                | Deshabilitadas.                                                                                                                                                                          |
| Electron Fuses          | RunAsNode off, EnableNodeOptionsEnvironmentVariable off, EnableNodeCliInspectArguments off, EnableCookieEncryption on, EnableEmbeddedAsarIntegrityValidation on, OnlyLoadAppFromAsar on. |
| Versión                 | Electron en una versión con soporte de seguridad vigente; actualización dentro de las 2 semanas de un parche crítico.                                                                    |
| DevTools                | Deshabilitadas en builds de producción.                                                                                                                                                  |

## 3.7 Aislamiento del motor de pruebas

- Playwright corre en un **proceso utilitario separado**
  (utilityProcess), sin acceso a la clave maestra. Para cada ejecución
  recibe solo lo necesario: configuración del proyecto y, si
  corresponde, el secreto descifrado de la credencial, que se borra de
  memoria al terminar.

- Cada ejecución usa un **perfil de navegador efímero** en una carpeta
  temporal cifrada o en memoria, que se elimina al terminar. No se
  reutilizan cookies ni almacenamiento entre ejecuciones salvo el estado
  de sesión del login, que también se guarda cifrado.

- Las **descargas** que dispare el sitio probado se bloquean por
  defecto; si se habilitan, quedan en cuarentena cifrada y nunca se
  abren automáticamente.

- El contenido del sitio probado **nunca se renderiza en la ventana de
  QAtlas**. Las evidencias se muestran como imágenes, y el visor de
  trazas corre en una ventana aislada sin red.

- Los navegadores de Playwright se descargan solo durante la instalación
  o actualización, verificando su integridad, y nunca durante una
  ejecución.

- Los tests importados (.spec.ts) corren en otro proceso aislado, con
  variables de entorno mínimas (sin claves), con el mismo proxy de
  salida y con límites de tiempo y memoria.

## 3.8 Datos sensibles en las evidencias

Las evidencias son el principal riesgo de exposición porque muestran lo
que había en pantalla y en la red. Controles:

| **ID** | **Control**                                                                                                                                                                                                                                                                  |
|--------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| EVI-01 | **El login nunca se graba.** Se ejecuta en un contexto de navegador separado, sin video ni traza; solo se transfiere el estado de sesión (cifrado) al contexto que se graba. Así la contraseña tipeada no aparece en ninguna evidencia.                                      |
| EVI-02 | **Enmascarado en capturas:** los campos de contraseña y los selectores que el usuario marque como sensibles se tapan en screenshots (opción mask de Playwright).                                                                                                             |
| EVI-03 | **Redacción de red:** en los logs de red y archivos HAR se reemplazan por \[REDACTADO\] los headers Authorization, Cookie y Set-Cookie, los parámetros y campos con nombres como password, token, secret o apikey, y el cuerpo de las respuestas (por defecto no se guarda). |
| EVI-04 | **Detector de secretos:** consola, red, DOM y texto de reportes se analizan con patrones de JWT, claves de API conocidas y claves privadas. Lo detectado se redacta y se avisa al usuario.                                                                                   |
| EVI-05 | **Modo datos sensibles** por proyecto: desactiva video y snapshots de DOM en trazas y aplica enmascarado a todos los campos de formulario. Recomendado para sistemas con datos reales de personas.                                                                           |
| EVI-06 | **Retención:** las evidencias se eliminan (borrado criptográfico) tras 90 días por defecto, salvo las de hallazgos incluidos en reportes.                                                                                                                                    |
| EVI-07 | Los videos se graban solo cuando falla una prueba (se descartan los de ejecuciones exitosas).                                                                                                                                                                                |

## 3.9 Exportación y compartición

Exportar es la única forma en que los datos salen de QAtlas por decisión
del usuario. Por eso es un proceso guiado:

1.  **Vista previa:** antes de exportar se muestra exactamente qué se
    incluye: texto, capturas, videos, trazas y logs.

2.  **Selección:** el usuario puede quitar cualquier evidencia y elegir
    el nivel (solo texto y capturas, o completo).

3.  **Revisión de redacción:** se listan las redacciones aplicadas y las
    advertencias del detector de secretos; si hay advertencias sin
    revisar, se pide confirmación explícita.

4.  **Formato:** PDF y Markdown (sin metadatos de autor, rutas locales
    ni nombre del equipo) o **paquete cifrado \`.qatlas\`** con
    contraseña de un solo uso, para compartir evidencia completa con
    otro usuario de QAtlas.

5.  **Destino:** si la carpeta elegida está sincronizada con un servicio
    en la nube (OneDrive, Google Drive, Dropbox, iCloud), se avisa antes
    de guardar.

6.  **Registro:** cada exportación queda en la auditoría local: qué,
    cuándo y en qué formato.

Copiar al portapapeles: los secretos nunca se copian en texto plano
desde la interfaz; si el usuario copia una credencial, el portapapeles
se limpia automáticamente a los 30 segundos.

### Controles por formato de salida

| **ID** | **Formato**     | **Control**                                                                                                                                                                                                                                                           |
|--------|-----------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| EXP-01 | Excel y CSV     | **Inyección de fórmulas:** toda celda de texto que empiece con =, +, -, @, tabulación o retorno de carro se escapa (prefijo con apóstrofo), porque el contenido puede venir del sitio probado o de un archivo importado. Nunca se generan fórmulas a partir de datos. |
| EXP-02 | Video y GIF     | No se pueden redactar: si un dato sensible estuvo en pantalla, queda grabado. En modo datos sensibles no se graba video; en la vista previa de exportación el video se marca como "puede contener datos sensibles" y no se incluye por defecto.                       |
| EXP-03 | PDF, Excel, MP4 | Se generan sin metadatos de autor, rutas locales, nombre del equipo ni software de origen.                                                                                                                                                                            |
| EXP-04 | HTML            | Un solo archivo autocontenido, con CSP restrictiva y sin recursos externos: se abre sin conexión y no hace requests al abrirse.                                                                                                                                       |
| EXP-05 | Traza y HAR     | Pasan por la redacción de EVI-03 y EVI-04; la traza no incluye el login (EVI-01). Se marcan como "para desarrollo" en la vista previa.                                                                                                                                |
| EXP-06 | ZIP             | Opción de cifrado con contraseña (AES-256). Los nombres de archivo internos no revelan datos (se usan IDs).                                                                                                                                                           |

## 3.10 Almacenamiento local

- La bóveda se guarda en la carpeta de datos local del usuario y no en
  la carpeta móvil (en Windows, %LOCALAPPDATA% y no %APPDATA%, que puede
  sincronizarse en redes corporativas).

- Al iniciar, QAtlas verifica que la carpeta de datos no esté dentro de
  una carpeta sincronizada; si lo está, lo advierte y ofrece moverla.

- Los archivos temporales se crean dentro de la bóveda (cifrados) y se
  eliminan al terminar cada ejecución y al iniciar la aplicación
  (limpieza de restos de cierres inesperados).

- La aplicación excluye su carpeta de datos de la indexación de búsqueda
  del sistema operativo cuando la plataforma lo permite.

## 3.11 Cadena de suministro

- **Dependencias mínimas:** cada dependencia nueva requiere
  justificación escrita en el PR (para qué se usa, alternativas,
  mantenimiento del paquete).

- Instalación con npm ci y lockfile versionado; scripts de instalación
  de terceros deshabilitados por defecto (ignore-scripts) con una lista
  explícita de excepciones.

- Auditoría automática en CI: npm audit, OSV-Scanner y revisión de
  licencias. Un hallazgo crítico bloquea el build.

- Dependabot o Renovate para actualizaciones, revisadas manualmente.

- **SBOM** (lista de componentes, formato CycloneDX) publicada con cada
  versión.

- **Firma de código:** instaladores firmados (Authenticode en Windows;
  firma y notarización en macOS). Checksums SHA-256 publicados.

- Builds generados solo en CI, nunca en equipos personales, con acciones
  de GitHub fijadas por hash de commit.

## 3.12 Actualizaciones

- Desactivadas por defecto. En el primer inicio se pregunta si se desea
  buscar actualizaciones.

- Si se activan: solo se **consulta** si hay una versión nueva. La
  descarga e instalación requieren confirmación del usuario.

- Los paquetes de actualización se verifican por firma antes de
  instalarse; si la verificación falla, no se instalan.

- Alternativa sin conexión: descargar el instalador firmado manualmente
  desde la página de versiones.

## 3.13 Logs y diagnóstico

- Logs locales, estructurados, con redacción automática (los mismos
  filtros de EVI-03 y EVI-04) y rotación (máximo 7 días o 50 MB).

- Nunca contienen secretos, contenidos de formularios, cuerpos de
  respuestas ni la contraseña maestra.

- Sin envío automático de errores. Para pedir ayuda, el usuario genera
  un **paquete de diagnóstico** que pasa por la misma revisión previa
  que una exportación.

## 3.14 Archivos de entrada

QAtlas recibe archivos que no controla: planillas de Excel, logs del
sistema probado, paquetes .qatlas y tests .spec.ts. Todos se tratan como
**no confiables**.

| **ID** | **Control**                                                                                                                                                                                                                                                                                   |
|--------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ENT-01 | Los archivos se procesan en un **proceso aislado** sin acceso a la clave maestra ni a la red. El proceso principal solo recibe los datos ya validados.                                                                                                                                        |
| ENT-02 | **Excel sin ejecución:** nunca se ejecutan macros (los .xlsm se leen ignorando el código VBA y se avisa que lo tenían), nunca se evalúan fórmulas (se usa solo el último valor calculado guardado en el archivo) y nunca se siguen vínculos a otros archivos ni conexiones de datos externas. |
| ENT-03 | **Límites:** tamaño máximo del archivo (por defecto 20 MB), tamaño descomprimido máximo (protección contra "bombas zip", ya que un .xlsx es un ZIP), cantidad máxima de hojas, filas y caracteres por celda.                                                                                  |
| ENT-04 | **Contenido oculto:** se detectan hojas, filas y columnas ocultas y se muestran en la vista previa antes de importar, para que no entren datos que el usuario no ve.                                                                                                                          |
| ENT-05 | Todo texto importado se trata como texto plano: nunca se interpreta como HTML ni como código en la interfaz.                                                                                                                                                                                  |
| ENT-06 | El archivo original no se guarda; solo los datos importados, cifrados en la bóveda, más el hash del archivo para trazabilidad.                                                                                                                                                                |
| ENT-07 | **Logs del sistema probado:** se leen solo los archivos que el usuario elige con un diálogo, en modo solo lectura y solo durante las ejecuciones; las líneas capturadas pasan por la redacción y el detector de secretos antes de guardarse.                                                  |
| ENT-08 | Los paquetes .qatlas se verifican (integridad y versión) antes de descifrarlos y se importan a un proyecto nuevo, nunca sobre uno existente sin confirmación.                                                                                                                                 |

## 3.15 Verificación de la seguridad

La seguridad no se declara: se prueba en cada versión. Suite de
seguridad automatizada, obligatoria en CI:

| **ID** | **Test**                        | **Qué verifica**                                                                                                                                                                                                                                                                            |
|--------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| TS-01  | **Secreto canario**             | Se crea un proyecto con una credencial con un valor único (por ejemplo, CANARIO-8f3a…), se ejecutan escaneos, casos, exportaciones y diagnóstico, y luego se busca ese valor en todos los archivos de la bóveda, temporales, logs y exportaciones. Debe aparecer cero veces en texto plano. |
| TS-02  | Base cifrada                    | Abrir el archivo de la base sin clave falla, y el archivo no contiene texto legible de los datos cargados.                                                                                                                                                                                  |
| TS-03  | Salida de red                   | Con un servidor de prueba que registra conexiones, se verifica que QAtlas no contacta ningún destino fuera de la lista permitida durante el uso completo de la app.                                                                                                                         |
| TS-04  | Contención del crawler          | La app de prueba incluye links y redirecciones a otros dominios, WebSockets y service workers: ninguno llega a destino.                                                                                                                                                                     |
| TS-05  | Modo solo lectura y exclusiones | El crawler no envía requests de escritura ni toca botones excluidos (servidor de prueba que registra métodos).                                                                                                                                                                              |
| TS-06  | Login no grabado                | La contraseña no aparece en video (inspección de fotogramas OCR), traza ni HAR.                                                                                                                                                                                                             |
| TS-07  | Configuración de Electron       | Análisis estático (Electronegativity) y verificación de fuses, CSP y opciones de ventana del build final.                                                                                                                                                                                   |
| TS-08  | IPC                             | Mensajes malformados o desde orígenes no esperados se rechazan.                                                                                                                                                                                                                             |
| TS-09  | Bloqueo                         | Tras el bloqueo automático, ningún dato es accesible y las claves no están en memoria del renderer.                                                                                                                                                                                         |
| TS-10  | Borrado criptográfico           | Tras eliminar un proyecto, sus evidencias no pueden descifrarse.                                                                                                                                                                                                                            |
| TS-11  | Inyección de fórmulas           | Datos con =, +, -, @ en casos y hallazgos se exportan a Excel y CSV sin generar fórmulas.                                                                                                                                                                                                   |
| TS-12  | Excel malicioso                 | Archivos de prueba con macros, vínculos externos, conexiones de datos, bomba zip y contenido oculto: no se ejecuta nada, no se conecta a nada y se informa cada caso.                                                                                                                       |
| TS-13  | Logs con secretos               | Un log del backend de prueba que imprime el secreto canario y un JWT: ninguno de los dos queda guardado ni exportado en texto plano.                                                                                                                                                        |
| TS-14  | Metadatos                       | PDF, Excel y MP4 exportados no contienen nombre de usuario del sistema, nombre del equipo ni rutas locales.                                                                                                                                                                                 |

Además, por cada versión mayor: modelado de amenazas actualizado
(STRIDE), revisión contra el **checklist de seguridad de Electron** y
los requisitos aplicables de **OWASP ASVS**, y una política de
divulgación responsable (SECURITY.md) para reportar vulnerabilidades.

# 4. Arquitectura

## 4.1 Stack tecnológico

| **Capa**                 | **Tecnología**                                                     | **Motivo**                                                                                 |
|--------------------------|--------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Contenedor de escritorio | Electron (versión con soporte vigente)                             | Corre Node y Playwright de forma nativa; modelo de procesos que permite aislar la interfaz |
| Empaquetado              | Electron Forge + firma de código                                   | Instaladores para Windows, macOS y Linux; aplicación de fuses                              |
| Interfaz                 | React 19 + TypeScript + Vite                                       | Ecosistema amplio; tipado compartido con el resto                                          |
| UI                       | Tailwind CSS + shadcn/ui (empaquetados)                            | Componentes accesibles, sin recursos remotos                                               |
| Estado y datos           | TanStack Query sobre IPC + React Router (modo memoria)             | Cache de datos y actualización en vivo de ejecuciones                                      |
| Lógica principal         | Node.js (proceso principal de Electron) + TypeScript               | Base de datos, cifrado, políticas de red, coordinación                                     |
| Comunicación interna     | IPC de Electron con contratos tipados y validados con Zod          | Sin servidor HTTP ni puertos abiertos                                                      |
| Base de datos            | SQLite cifrada con SQLCipher (better-sqlite3-multiple-ciphers)     | Archivo local cifrado, sin servidor                                                        |
| Acceso a datos           | Drizzle ORM + migraciones versionadas                              | Tipos generados y compatible con SQLCipher                                                 |
| Criptografía             | Módulo crypto de Node (AES-256-GCM) + Argon2id                     | Primitivas estándar y auditadas; sin criptografía propia                                   |
| Motor de pruebas         | Playwright en proceso aislado                                      | Chromium, Firefox, WebKit; trazas, video, interceptación de red                            |
| Accesibilidad            | @axe-core/playwright                                               | Auditorías WCAG                                                                            |
| Proxy de salida          | Proxy HTTP/HTTPS local propio (sin inspección TLS)                 | Hace cumplir la lista de dominios permitidos para todo el tráfico del navegador            |
| Reportes PDF             | Playwright (HTML a PDF) en contexto sin red                        | Reutiliza el navegador incluido                                                            |
| Excel                    | ExcelJS (lectura y escritura)                                      | Lee .xlsx sin ejecutar macros ni evaluar fórmulas; genera planillas con formato            |
| Video                    | FFmpeg empaquetado (ffmpeg-static)                                 | Convierte el WebM de Playwright a MP4, recorta y genera GIF; suma unos 70 MB al instalador |
| Calidad                  | Vitest, Playwright Test, ESLint, Electronegativity, GitHub Actions | La herramienta también se prueba a sí misma                                                |

## 4.2 Procesos y componentes

| **Proceso**                    | **Responsabilidad**                                                                                    | **Acceso**                                                          |
|--------------------------------|--------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| Principal (main)               | Bóveda, claves, base de datos, políticas de red, coordinación de ejecuciones, exportaciones, auditoría | Disco (bóveda), claves en memoria                                   |
| Interfaz (renderer)            | Pantallas de React                                                                                     | Solo IPC tipado. Sin Node, sin red, sin disco                       |
| Preload                        | Puente mínimo entre interfaz y principal                                                               | Funciones explícitas vía contextBridge                              |
| Runner (utilityProcess)        | Ejecuta escaneos y casos con Playwright; produce resultados y evidencias                               | Solo lo que el principal le envía por ejecución; red solo vía proxy |
| Proxy de salida                | Filtra todo el tráfico del navegador de pruebas                                                        | Lista de dominios de la ejecución en curso                          |
| Navegadores de prueba          | Chromium, Firefox o WebKit controlados por Playwright                                                  | Perfil efímero; red solo vía proxy                                  |
| Sandbox de importados (fase 3) | Ejecuta archivos .spec.ts importados                                                                   | Entorno mínimo, sin claves, red solo vía proxy                      |
| Procesador de archivos         | Lee y valida Excel, logs y paquetes .qatlas (ENT-01)                                                   | Sin claves ni red; devuelve datos validados                         |
| Lector de logs (fase 3)        | Sigue en vivo las fuentes de log durante una ejecución                                                 | Solo los archivos elegidos, solo lectura                            |

## 4.3 Diagrama

> ┌──────────────────────────── Equipo del usuario
> ──────────────────────────────┐
>
> │ │
>
> │ ┌──────────────┐ IPC tipado ┌──────────────────┐
> ┌──────────────────┐ │
>
> │ │ Interfaz │ ───────────► │ Proceso principal│──►│ Bóveda cifrada │
> │
>
> │ │ (React, │ ◄─────────── │ claves, red │ │ SQLite+SQLCipher │ │
>
> │ │ sandbox, │ │ auditoría │ │ evidencias AES │ │
>
> │ │ sin red) │ └────────┬─────────┘ └──────────────────┘ │
>
> │ └──────────────┘ │ trabajo por ejecución │
>
> │ ▼ │
>
> │ ┌──────────────────┐ │
>
> │ │ Runner aislado │ │
>
> │ │ (Playwright) │ │
>
> │ └────────┬─────────┘ │
>
> │ ▼ │
>
> │ ┌──────────────────┐ │
>
> │ │ Proxy de salida │──► ✗ otros dominios │
>
> │ │ (lista permitida)│ (bloqueados) │
>
> │ └────────┬─────────┘ │
>
> └────────────────────────────────────────┼─────────────────────────────────────┘
>
> ▼ permitido
>
> ┌────────────────────────────────────┐
>
> │ Sistema probado (dominios del │
>
> │ proyecto) · integraciones activadas│
>
> └────────────────────────────────────┘

## 4.4 Ciclo de vida de una ejecución

1.  El usuario lanza un escaneo, suite o caso. El principal verifica que
    la bóveda esté desbloqueada y que el proyecto tenga autorización
    vigente.

2.  Crea la ejecución en estado encolada en la cola local (persistida en
    SQLite).

3.  Inicia el proxy de salida con los dominios del proyecto. Si no puede
    iniciarlo, la ejecución falla sin ejecutar nada (fallar cerrado).

4.  Envía al runner la configuración y, si hace falta, el secreto de la
    credencial.

5.  El runner hace el login en un contexto sin grabación (EVI-01) y abre
    el contexto de prueba con el estado de sesión, video y traza según
    la configuración del proyecto.

6.  Ejecuta el escaneo o los casos y envía al principal, por IPC, el
    progreso y los hallazgos a medida que aparecen.

7.  Las evidencias pasan por la redacción y el detector de secretos y se
    guardan cifradas.

8.  Al terminar, el runner borra el perfil efímero y los secretos de
    memoria, y el principal detiene el proxy.

9.  El principal calcula el resumen (nuevos, recurrentes, resueltos,
    regresiones, conexiones bloqueadas) y marca la ejecución como
    finalizada, fallida o cancelada.

## 4.5 Estructura del repositorio

> qatlas/
>
> ├── apps/
>
> │ ├── desktop/
>
> │ │ ├── src/main/ \# Proceso principal: bóveda, cripto, IPC, políticas
> de red
>
> │ │ ├── src/preload/ \# Puente mínimo (contextBridge)
>
> │ │ └── src/renderer/ \# Interfaz React
>
> │ └── sandbox-site/ \# App de prueba con errores plantados
>
> ├── packages/
>
> │ ├── runner/ \# Motor de pruebas (Playwright) y proxy de salida
>
> │ ├── crypto/ \# Esquema de claves y cifrado de archivos
>
> │ ├── redaction/ \# Redacción y detector de secretos
>
> │ ├── importers/ \# Importación de Excel y paquetes (proceso aislado)
>
> │ ├── exporters/ \# PDF, Markdown, Excel, HTML, video, JUnit, ZIP
>
> │ ├── db/ \# Esquema Drizzle y migraciones
>
> │ └── shared/ \# Tipos y contratos IPC (Zod)
>
> ├── e2e/ \# Tests de la app con Playwright
>
> ├── security-tests/ \# Suite de seguridad (TS-01 a TS-14)
>
> ├── docs/
>
> ├── SECURITY.md
>
> └── .github/workflows/

# 5. Modelo de datos

Base SQLite cifrada. Todas las tablas incluyen id (UUID), created_at y
updated_at. Los campos marcados con (C) tienen además cifrado a nivel de
campo. Los campos JSON se guardan como texto.

| **Entidad**           | **Campos principales**                                                                                                                                                                                                                             | **Fase** |
|-----------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| boveda_meta           | version_esquema, salt_kdf, parametros_kdf, clave_maestra_cifrada, recordar_en_equipo                                                                                                                                                               | 1        |
| configuracion         | bloqueo_minutos, actualizaciones_activas, retencion_dias, idioma                                                                                                                                                                                   | 1        |
| proyecto              | nombre, url_base, dominios_permitidos (JSON), max_rps, max_paginas, solo_lectura, exclusiones (JSON), modo_datos_sensibles, selectores_sensibles (JSON), clave_proyecto_cifrada                                                                    | 1        |
| autorizacion          | proyecto_id, texto_aceptado, version_texto, fecha, verificacion_dominio                                                                                                                                                                            | 1        |
| credencial            | proyecto_id, nombre, usuario, secreto (C), url_login, pasos_login (JSON)                                                                                                                                                                           | 1        |
| ejecucion             | proyecto_id, tipo, objetivo_id, navegador, estado, inicio, fin, resumen (JSON), programacion_id                                                                                                                                                    | 1        |
| pagina_visitada       | ejecucion_id, url, status_http, tiempo_carga_ms, profundidad                                                                                                                                                                                       | 1        |
| hallazgo              | ejecucion_id, proyecto_id, tipo, severidad, titulo, descripcion, url, huella, estado, primera_vez_en, ultima_vez_en, caso_id, paso_indice                                                                                                          | 1        |
| evidencia             | hallazgo_id, ejecucion_id o resultado_paso_id, tipo (screenshot, captura_anotada, video, gif, traza, consola, har, log), ruta_archivo_cifrado, nonce, tamaño, redacciones (JSON), alertas_secretos (JSON)                                          | 1        |
| reporte_bug           | proyecto_id, titulo, pasos, esperado, obtenido, severidad, entorno (JSON), estado                                                                                                                                                                  | 1        |
| reporte_hallazgo      | reporte_id, hallazgo_id                                                                                                                                                                                                                            | 1        |
| exportacion           | reporte_id, formato, nivel, evidencias_incluidas (JSON), fecha, destino_sincronizado                                                                                                                                                               | 1        |
| conexion              | fecha, proceso, destino, permitida, regla, ejecucion_id                                                                                                                                                                                            | 1        |
| auditoria             | accion, entidad, entidad_id, detalle (JSON)                                                                                                                                                                                                        | 1        |
| caso_prueba           | proyecto_id, codigo, codigo_externo, titulo, modulo, descripcion, precondiciones, prioridad, tags (JSON), tipo (manual, automatizado, mixto), uso (funcional, regresion, uat), origen (editor, excel, grabado, importado), requiere_login, version | 2        |
| paso                  | caso_id, orden, descripcion, datos, resultado_esperado, accion, localizador (JSON), valor (C si es sensible), opciones (JSON), automatizado                                                                                                        | 2        |
| plantilla_importacion | nombre, mapeo_columnas (JSON), formato (fila por paso o por caso), hoja, fila_encabezado, separador_pasos                                                                                                                                          | 2        |
| importacion           | proyecto_id, plantilla_id, nombre_archivo, hash_archivo, fecha, creados, actualizados, errores (JSON), advertencias (JSON)                                                                                                                         | 2        |
| ejecucion_manual      | ejecucion_id, caso_id, ejecutado_por, inicio, fin, estado                                                                                                                                                                                          | 2        |
| resultado_paso        | ejecucion_manual_id, paso_id, estado (ok, falla, bloqueado, no_aplica), resultado_obtenido, comentario                                                                                                                                             | 2        |
| ronda_uat             | proyecto_id, nombre, version_sistema, fecha_inicio, fecha_fin, estado                                                                                                                                                                              | 2        |
| acta_uat              | ronda_id, conclusion (aprobado, aprobado_con_observaciones, rechazado), observaciones, firmantes (JSON: nombre, rol, fecha), fecha_emision                                                                                                         | 2        |
| suite / suite_caso    | nombre, descripcion / suite_id, caso_id, orden                                                                                                                                                                                                     | 2        |
| resultado_caso        | ejecucion_id, caso_id, estado, duracion_ms, paso_fallido                                                                                                                                                                                           | 2        |
| variable              | proyecto_id, nombre, valor (C si es secreta), secreta                                                                                                                                                                                              | 2        |
| programacion          | proyecto_id, objetivo, cron, zona_horaria, activa                                                                                                                                                                                                  | 3        |
| fuente_log            | proyecto_id, tipo (archivo, docker), ruta o contenedor (C), patrones_error (JSON), activa                                                                                                                                                          | 3        |
| linea_log             | ejecucion_id, fuente_id, fecha, nivel, texto_redactado, paso_indice, hallazgo_id                                                                                                                                                                   | 3        |
| test_importado        | proyecto_id, nombre_archivo, contenido, hash, tags (JSON)                                                                                                                                                                                          | 3        |
| integracion           | tipo (github, jira, slack, webhook), dominios (JSON), config (C), activa                                                                                                                                                                           | 4        |
| vinculo_externo       | reporte_id, integracion_id, id_externo, url_externa, estado_externo                                                                                                                                                                                | 4        |
| linea_base_visual     | proyecto_id, url o caso+paso, navegador, viewport, ruta_imagen_cifrada                                                                                                                                                                             | 4        |

## 5.1 Huella de un hallazgo y detección de regresiones

Cada hallazgo tiene una **huella** (hash) calculada a partir de su tipo,
la URL normalizada y el mensaje normalizado (sin números de línea, IDs
ni timestamps). Al guardar un hallazgo:

- Si no existe otro con la misma huella en el proyecto → se crea como
  **nuevo**.

- Si existe y está abierto → es **recurrente** (se actualiza la última
  aparición).

- Si existe y estaba **resuelto** → se reabre como **regresión**, con
  alerta destacada.

- Si un hallazgo abierto no aparece en una ejecución que cubrió su URL o
  caso → pasa a **posiblemente resuelto**.

## 5.2 Estados de un hallazgo

| **Estado**            | **Descripción**                                            |
|-----------------------|------------------------------------------------------------|
| nuevo                 | Detectado por primera vez, sin revisar                     |
| confirmado            | Verificado como problema real                              |
| descartado            | Falso positivo; no se vuelve a alertar con la misma huella |
| reportado             | Incluido en un reporte de bug                              |
| posiblemente_resuelto | No apareció en la última ejecución que lo cubría           |
| resuelto              | Confirmado como corregido                                  |
| regresion             | Estaba resuelto y volvió a aparecer                        |

# 6. Módulos funcionales

## 6.1 Bóveda y desbloqueo (BOV)

**Fase:** 1

Protección de todos los datos de QAtlas con la contraseña maestra.

### Funcionalidades

- Asistente de primer inicio: creación de contraseña maestra,
  explicación de que no hay recuperación, sugerencia de copia de
  seguridad, elección sobre actualizaciones.

- Pantalla de desbloqueo; bloqueo manual con un botón y atajo de
  teclado.

- Bloqueo automático por inactividad, suspensión o bloqueo del sistema.

- Cambio de contraseña maestra.

- Copia de seguridad cifrada de la bóveda completa y restauración.

- Opción "Recordar en este equipo" (desactivada por defecto).

- Borrado completo de la bóveda.

### Reglas

- RN-BOV-01: contraseña de al menos 12 caracteres, verificada contra una
  lista local de contraseñas comunes.

- RN-BOV-02: tras 5 intentos fallidos, espera creciente entre intentos
  (30 s, 1 min, 5 min…).

- RN-BOV-03: con la bóveda bloqueada, ninguna pantalla muestra datos y
  las ejecuciones programadas no corren.

- RN-BOV-04: el borrado completo requiere escribir la contraseña maestra
  y una confirmación textual.

## 6.2 Proyectos y autorización (PRY)

**Fase:** 1

Registro de cada sistema a probar, con sus límites de seguridad.

### Funcionalidades

- Crear proyecto: nombre, URL base, dominios permitidos (se propone el
  de la URL), descripción.

- Aceptación obligatoria de la declaración de autorización (SEG-01).

- Límites: requests por segundo, máximo de páginas, profundidad, timeout
  por página.

- Modo solo lectura (activado por defecto) y lista de exclusiones.

- Modo datos sensibles y selectores sensibles para enmascarar.

- Credenciales de prueba cifradas, con definición del login y botón
  "Probar login".

- Eliminar proyecto con borrado criptográfico.

### Reglas

- RN-PRY-01: no se puede ejecutar nada sin autorización vigente.

- RN-PRY-02: la URL base debe pertenecer a un dominio permitido.

- RN-PRY-03: cambiar la URL base o los dominios exige volver a aceptar
  la autorización.

- RN-PRY-04: el secreto de una credencial nunca se muestra completo;
  solo se reemplaza.

- RN-PRY-05: no se permiten comodines amplios en dominios (por ejemplo,
  \*.com); sí subdominios de un dominio concreto (\*.lexora.test).

## 6.3 Escaneo automático (ESC)

**Fase:** 1

Prueba genérica que recorre la aplicación y detecta problemas sin
definir casos.

### Funcionalidades

- **Crawler** dentro de los dominios permitidos, respetando profundidad,
  máximo de páginas, exclusiones y límite de velocidad; espera de red
  inactiva en SPAs.

- **Errores HTTP:** 4xx y 5xx, requests fallidas.

- **Links rotos** internos, indicando dónde está el link.

- **Errores de JavaScript** y console.error.

- **Accesibilidad** con axe-core (WCAG 2.1 A y AA).

- **Rendimiento básico:** tiempo de carga, LCP, peso de página, requests
  lentas.

- **Seguridad básica observable:** contenido mixto, cookies de sesión
  sin Secure o HttpOnly, formularios de login sobre HTTP, scripts de
  terceros detectados (dominios bloqueados por el proxy).

- Escaneo autenticado con las credenciales del proyecto.

### Reglas

- RN-ESC-01: el crawler nunca sale de los dominios permitidos.

- RN-ESC-02: en modo solo lectura se abortan requests de escritura salvo
  el login.

- RN-ESC-03: nunca se visitan URLs ni se clickean elementos de la lista
  de exclusiones.

- RN-ESC-04: una URL se analiza una sola vez por escaneo.

- RN-ESC-05: se detiene al alcanzar el máximo de páginas o de tiempo, y
  lo informa.

### Severidad automática

| **Tipo de hallazgo**                                           | **Severidad por defecto** |
|----------------------------------------------------------------|---------------------------|
| Página con error 5xx                                           | Crítica                   |
| Excepción de JavaScript no capturada                           | Alta                      |
| Link interno roto / recurso con error                          | Media                     |
| console.error                                                  | Baja                      |
| Accesibilidad critical / serious                               | Alta / Media              |
| Accesibilidad moderate / minor                                 | Baja                      |
| Cookie de sesión insegura / contenido mixto / login sobre HTTP | Alta                      |
| Script o recurso de dominio externo bloqueado                  | Informativa               |
| Página lenta                                                   | Baja                      |

## 6.4 Ejecuciones (EJE)

**Fase:** 1

Lanzamiento, seguimiento e historial de las corridas.

### Funcionalidades

- Lanzar escaneo (fase 1), suite o caso (fase 2) eligiendo navegador.

- Progreso en vivo: página o paso actual, hallazgos y conexiones
  bloqueadas.

- Cancelar, re-ejecutar y comparar ejecuciones.

- Detalle con resumen, páginas visitadas, hallazgos, evidencias y visor
  de trazas aislado.

### Reglas

- RN-EJE-01: no puede haber dos ejecuciones en curso del mismo objetivo.

- RN-EJE-02: si no se pueden aplicar los controles de red, la ejecución
  no comienza.

## 6.5 Hallazgos, reportes y exportación (REP)

**Fase:** 1

Gestión de problemas detectados y su conversión en reportes listos para
compartir de forma segura.

### Funcionalidades

- Bandeja de hallazgos con filtros y agrupación.

- Detalle con evidencia redactada, historial y alertas del detector de
  secretos.

- Confirmar, descartar (con motivo), cambiar severidad, marcar como
  resuelto.

- Generar reporte de bug con pasos, esperado, obtenido, entorno y
  evidencias precargados.

- Exportación guiada (sección 3.9) en los formatos de la sección 6.5.1.

- Reporte de ejecución con métricas y gráficos.

- Importar paquetes .qatlas recibidos de otro usuario.

### Reglas

- RN-REP-01: un reporte siempre tiene al menos una evidencia.

- RN-REP-02: ninguna exportación contiene secretos de credenciales
  (verificado por TS-01).

- RN-REP-03: no se puede exportar con alertas de secretos sin revisar
  sin una confirmación explícita.

### 6.5.1 Tipos de reporte y formatos

| **Reporte**            | **Para quién** | **Formatos**                                                                                                                                                                                            | **Fase** |
|------------------------|----------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------|
| Reporte de bug         | Desarrollo     | PDF · Markdown · captura anotada (PNG con el elemento resaltado) · ZIP con todas las evidencias (cifrado opcional)                                                                                      | 1        |
|                        |                | Video MP4 recortado a los segundos previos a la falla, con el nombre de cada paso como subtítulo · GIF corto para incrustar en issues · traza de Playwright · HAR redactado · líneas de log del backend | 3        |
| Reporte de ejecución   | QA, líder, PM  | PDF ejecutivo con métricas y gráficos · HTML interactivo de un solo archivo                                                                                                                             | 1        |
|                        |                | Excel con resultado por caso y paso, y lista de hallazgos                                                                                                                                               | 2        |
|                        |                | JUnit XML para pipelines de CI                                                                                                                                                                          | 3        |
| Planilla de casos      | QA, auditoría  | Excel en la plantilla de QAtlas o en el formato original importado (ida y vuelta)                                                                                                                       | 2        |
| Matriz de trazabilidad | QA, auditoría  | Excel y PDF: requisito → caso → ejecución → hallazgo → bug                                                                                                                                              | 2        |
| Acta de UAT            | Negocio, PM    | PDF con resumen, resultados por caso, observaciones y conformidad                                                                                                                                       | 2        |

Todos los formatos pasan por la exportación guiada y los controles
EXP-01 a EXP-06.

### 6.5.2 Estructura del reporte de bug

| **Sección**           | **Contenido**                                                                                 | **Origen**                              |
|-----------------------|-----------------------------------------------------------------------------------------------|-----------------------------------------|
| Título                | \[Módulo / URL\] Descripción breve                                                            | Sugerido; editable                      |
| Severidad             | Crítica / Alta / Media / Baja                                                                 | Del hallazgo; editable                  |
| Entorno               | URL, navegador y versión, viewport, fecha, ID de ejecución (sin datos del equipo del usuario) | Automático                              |
| Pasos para reproducir | Lista numerada                                                                                | Del caso o de la navegación del crawler |
| Esperado / obtenido   | Comportamiento esperado y real                                                                | De la verificación o plantilla por tipo |
| Evidencia             | Capturas, video, traza, consola y red (redactados)                                            | Automático; seleccionable               |
| Frecuencia            | Primera aparición y repeticiones                                                              | Automático                              |

## 6.6 Privacidad y conexiones (PRV)

**Fase:** 1

Transparencia sobre lo que hace la aplicación con la red y los datos.

### Funcionalidades

- Monitor de conexiones (sección 3.5) con filtros por proceso, destino y
  estado.

- Panel de privacidad: estado del cifrado, bloqueo, actualizaciones,
  integraciones activas y dominios permitidos de cada una.

- Pantalla de **Actividad** que unifica el registro de auditoría, los
  errores internos de QAtlas y el monitor de conexiones, con filtros y
  búsqueda. Permite diagnosticar problemas sin enviar nada fuera del
  equipo.

- Aviso de carpetas sincronizadas (sección 3.10).

## 6.7 Casos de prueba y suites (CAS)

**Fase:** 2

Pruebas propias con un editor visual de pasos, sin código.

### Funcionalidades

- Casos con código autogenerado (CP-001), prioridad y tags; suites
  ordenadas.

- Editor de pasos con arrastrar y soltar y selector asistido de
  elementos.

- Variables y generadores ({{faker.email}}, {{timestamp}}); variables
  secretas cifradas y nunca visibles en evidencias.

- Versionado de casos y exportación a .spec.ts.

### Reglas

- RN-CAS-01: todo caso tiene al menos una verificación.

- RN-CAS-02: un valor marcado como secreto nunca aparece en pasos
  exportados, trazas ni reportes (se exporta como referencia a variable
  de entorno).

### Acciones del editor

| **Acción**                                                      | **Parámetros**              | **Ejemplo**                                |
|-----------------------------------------------------------------|-----------------------------|--------------------------------------------|
| Ir a                                                            | URL o ruta                  | Ir a /clientes                             |
| Click                                                           | Elemento                    | Click en "Nuevo Cliente"                   |
| Escribir                                                        | Elemento, valor o variable  | Escribir {{faker.email}} en "Mail"         |
| Seleccionar / marcar                                            | Elemento, opción            | Seleccionar "Activo" en "Estado"           |
| Presionar tecla                                                 | Tecla                       | Presionar Enter                            |
| Subir archivo                                                   | Elemento, archivo de prueba | Subir contrato.pdf                         |
| Esperar                                                         | Elemento o URL              | Esperar a que aparezca la tabla            |
| Verificar visible / texto / URL / valor / habilitado / cantidad | Elemento y valor esperado   | Verificar que "Guardar" está deshabilitado |
| Guardar en variable                                             | Elemento, nombre            | Guardar el N° de expediente                |
| Captura                                                         | —                           | Tomar screenshot (con enmascarado)         |

Localizadores por orden de preferencia: rol y nombre accesible, label,
placeholder, texto, data-testid y CSS (avanzado). El editor avisa si un
localizador es frágil o ambiguo.

## 6.8 Importación de casos desde Excel (XLS)

**Fase:** 2

Convierte las planillas de casos de prueba y scripts de UAT que el
equipo ya usa en casos de QAtlas, sin reescribirlos. Es la puerta de
entrada principal para equipos que trabajan con Excel.

### Funcionalidades

- **Plantilla de QAtlas** descargable, con columnas sugeridas: ID,
  Módulo, Título, Precondiciones, N° de paso, Descripción del paso,
  Datos de prueba, Resultado esperado, Prioridad, Tipo (funcional,
  regresión, UAT), Tags.

- **Asistente de mapeo** para usar el formato propio del equipo: el
  usuario elige la hoja y la fila de encabezados, y asigna cada columna
  de su planilla a un dato de QAtlas. QAtlas sugiere el mapeo por los
  nombres de las columnas (por ejemplo, "Resultado Esperado", "Esperado"
  o "Expected").

- Soporta los dos formatos más comunes: **una fila por paso** (el ID del
  caso se repite o queda en celdas combinadas) y **una fila por caso**
  (los pasos van en una celda, numerados o separados por saltos de
  línea).

- Varias hojas en un mismo archivo (por ejemplo, una por módulo).

- El mapeo se guarda como **plantilla de importación** para reutilizarlo
  con las próximas versiones de la planilla.

- **Vista previa y validación** antes de importar: casos y pasos
  detectados, errores por fila (por ejemplo, "fila 14: falta el
  resultado esperado"), contenido oculto (ENT-04) y celdas con fórmulas.

- **Reimportación:** si un caso ya existe (mismo ID), se actualiza y se
  guarda una nueva versión, mostrando antes las diferencias. Los casos
  que ya no están en la planilla no se borran: se marcan para revisar.

- Los casos importados quedan como **manuales** y se pueden ejecutar de
  inmediato con la guía paso a paso (módulo MAN).

- **Automatización asistida:** QAtlas propone convertir pasos con
  redacción reconocible ("Ingresar X en el campo Y", "Hacer clic en Z",
  "Verificar que se muestre W") en pasos automatizables. Cada propuesta
  queda como borrador hasta que el usuario elige el elemento en pantalla
  y la confirma. Los pasos no convertibles siguen siendo manuales, y un
  caso puede ser **mixto**.

- **Exportación de ida y vuelta:** los casos y sus resultados se
  exportan al mismo formato de la planilla original, agregando columnas
  de resultado (Estado, Resultado obtenido, Fecha, Ejecutado por,
  Evidencia, Bug).

### Reglas

- RN-XLS-01: se aplican todos los controles de archivos de entrada
  ENT-01 a ENT-06.

- RN-XLS-02: un caso importado debe tener al menos un paso con resultado
  esperado; si no, se importa como borrador y se informa.

- RN-XLS-03: la conversión a pasos automatizados nunca es automática:
  siempre requiere confirmación del usuario paso por paso.

- RN-XLS-04: se importan los valores visibles de las celdas; si una
  celda tiene fórmula, se toma su último valor guardado y se avisa.

## 6.9 Ejecución manual y UAT (MAN)

**Fase:** 2

Guía para ejecutar casos manuales y rondas de UAT, registrando
resultados y evidencias con la misma trazabilidad que las pruebas
automatizadas.

### Funcionalidades

- **Modo guiado:** QAtlas muestra un paso por vez con su descripción,
  datos de prueba y resultado esperado. El tester ejecuta el paso en el
  sistema y marca el resultado: OK, Falla, Bloqueado o No aplica, con
  comentario y resultado obtenido.

- Se puede abrir el sistema probado en un navegador controlado por
  QAtlas (con la contención de red de la sección 3.5) o usar cualquier
  otro medio y registrar solo los resultados.

- **Evidencia manual:** captura de una región de la pantalla con un
  atajo, o adjuntar archivos. Las capturas se pueden anotar (flechas,
  recuadros, desenfoque de datos sensibles) antes de guardarlas.

- Un paso marcado como Falla genera un **hallazgo** con la evidencia, y
  desde ahí un reporte de bug, igual que en las pruebas automáticas.

- Suites mixtas: en una misma ejecución, los pasos automatizados corren
  solos y QAtlas se detiene en los manuales para que el tester los
  complete.

- **Rondas de UAT:** agrupan casos de tipo UAT para una versión del
  sistema, con fechas, responsables (nombres cargados localmente) y
  avance.

- **Acta de UAT** en PDF: resumen de la ronda, resultados por caso,
  observaciones, bugs abiertos y espacio de conformidad con nombre, rol
  y fecha de cada firmante.

- Métricas de la ronda: avance, porcentaje de aprobación y casos
  bloqueados.

### Reglas

- RN-MAN-01: un caso manual queda "aprobado" solo si todos sus pasos
  están en OK o No aplica.

- RN-MAN-02: un paso en Falla o Bloqueado exige un comentario.

- RN-MAN-03: el acta de UAT registra la conformidad como datos (nombre,
  rol, fecha); no reemplaza una firma digital con validez legal.

- RN-MAN-04: las capturas manuales pasan por el detector de secretos y
  por las mismas reglas de exportación que el resto de las evidencias.

## 6.10 Grabador integrado (GRA)

**Fase:** 3

Crear casos usando la aplicación normalmente; al ser de escritorio, no
requiere extensión de navegador.

### Funcionalidades

- QAtlas abre un navegador visible controlado por Playwright, con el
  proxy de salida activo, y registra clicks, escritura, selección y
  navegación.

- Panel lateral para agregar verificaciones mientras se graba.

- Al terminar, el caso se abre en el editor.

### Reglas

- RN-GRA-01: el navegador de grabación tiene la misma contención de red
  que una ejecución.

- RN-GRA-02: lo escrito en campos de contraseña se reemplaza por una
  referencia a la credencial o a una variable secreta.

## 6.11 Importación de tests de Playwright (IMP)

**Fase:** 3

Ejecutar desde QAtlas tests escritos en código, como los de lexora-qa.

### Funcionalidades

- Importar archivos .spec.ts o una carpeta local.

- Ejecutarlos en el sandbox (sección 3.7) con la URL y credenciales del
  proyecto inyectadas como variables de entorno.

- Convertir sus resultados en hallazgos de QAtlas, con redacción.

### Reglas

- RN-IMP-01: antes de ejecutar código importado por primera vez, se
  muestra el archivo y se pide confirmación.

## 6.12 Programación y notificaciones (PRG)

**Fase:** 3

Ejecuciones automáticas.

### Funcionalidades

- Programar escaneos o suites (diario, semanal, días hábiles,
  personalizado).

- Ejecución en segundo plano desde la bandeja del sistema mientras
  QAtlas está abierto y la bóveda desbloqueada (o con "Recordar en este
  equipo" activado).

- Notificaciones locales del sistema operativo con resumen sin datos
  sensibles.

- Interfaz de línea de comandos (qatlas run) para usar QAtlas en
  pipelines de CI locales o propios.

### Reglas

- RN-PRG-01: una ejecución programada no se lanza si la anterior sigue
  en curso.

## 6.13 Monitor de logs del sistema probado (MON)

**Fase:** 3

Detecta errores del backend que no se ven en pantalla, cruzando el log
del sistema con cada paso de la prueba.

### Funcionalidades

- Configurar **fuentes de log** por proyecto: archivos locales (elegidos
  con un diálogo) o la salida de contenedores Docker locales.

- Patrones de error configurables (por defecto: ERROR, FATAL, Exception,
  Traceback, stack traces) y formatos comunes reconocidos (JSON,
  Serilog, log4j, NLog, Winston).

- Durante una ejecución, QAtlas sigue el log en vivo y asocia cada línea
  al paso que se estaba ejecutando según la hora.

- Un error en el log genera un hallazgo del tipo **"Error de backend"**,
  aunque la prueba haya pasado en pantalla, con las líneas relevantes
  como evidencia.

- Vista de línea de tiempo: pasos de la prueba y líneas de log en
  paralelo.

### Reglas

- RN-MON-01: se aplica ENT-07: solo archivos elegidos por el usuario,
  solo lectura, solo durante ejecuciones.

- RN-MON-02: solo se guardan las líneas relevantes (errores y su
  contexto inmediato), redactadas; nunca el log completo.

- RN-MON-03: para Docker se usa solo lectura de logs; QAtlas nunca
  ejecuta comandos dentro de los contenedores.

## 6.14 Integraciones opcionales (INT)

**Fase:** 4

Conectar QAtlas con herramientas del equipo, siempre por decisión
explícita del usuario.

### Funcionalidades

- GitHub Issues y Jira: crear issue desde un reporte, con la misma
  revisión previa que una exportación; sincronizar estado.

- Slack y webhooks salientes: notificaciones con contenido mínimo
  (proyecto, resultado, cantidades), sin evidencias.

- Cada integración se activa por separado, muestra sus dominios y se
  puede desactivar en cualquier momento; sus tokens se guardan cifrados.

### Reglas

- RN-INT-01: ninguna integración se activa por defecto.

- RN-INT-02: ningún dato se envía a una integración sin una acción del
  usuario o una regla de notificación que él configuró.

## 6.15 Regresión visual (VIS)

**Fase:** 4

Detectar cambios visuales no esperados.

### Funcionalidades

- Líneas base por página o paso, navegador y viewport, guardadas
  cifradas.

- Comparación con resaltado de diferencias, tolerancia y zonas
  ignoradas.

- Aprobar como nueva línea base o reportar.

## 6.16 Dashboard y métricas (DSH)

**Fase:** 4

Vista de la calidad de cada proyecto en el tiempo, calculada localmente.

### Funcionalidades

- Hallazgos abiertos por severidad, regresiones, tasa de éxito de
  suites, tests inestables.

- Evolución temporal y tiempo promedio hasta la resolución.

# 7. Casos de uso principales

## 7.1 Fase 1

### CU-00 — Primer inicio y creación de la bóveda

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>QAtlas recién instalado.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Abre QAtlas y ve el asistente de bienvenida.</p>
<p>2. Define la contraseña maestra (con medidor de fortaleza).</p>
<p>3. Lee y confirma que entiende que no hay recuperación.</p>
<p>4. Elige si busca actualizaciones.</p>
<p>5. QAtlas crea la bóveda cifrada y sugiere hacer una copia de
seguridad.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>2a. Contraseña débil o común: no se acepta.</p>
<p>5a. La carpeta de datos está sincronizada con la nube: se avisa y se
ofrece otra ubicación.</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Bóveda creada y desbloqueada.</td>
</tr>
</tbody>
</table>

### CU-01 — Crear proyecto con autorización

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Bóveda desbloqueada.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Elige "Nuevo proyecto".</p>
<p>2. Ingresa nombre y URL base.</p>
<p>3. Revisa los dominios permitidos propuestos.</p>
<p>4. Configura límites o deja los valores por defecto.</p>
<p>5. Acepta la declaración de autorización.</p>
<p>6. QAtlas crea el proyecto y su clave.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>3a. Dominio con comodín demasiado amplio: no se acepta.</p>
<p>5a. No acepta la autorización: el proyecto no se crea.</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Proyecto creado y habilitado.</td>
</tr>
</tbody>
</table>

### CU-02 — Configurar y probar credenciales

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Proyecto creado.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Agrega usuario y contraseña de prueba.</p>
<p>2. Indica la URL de login o usa la detección automática.</p>
<p>3. Presiona "Probar login".</p>
<p>4. QAtlas ejecuta el login sin grabación y muestra si la sesión quedó
iniciada.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>4a. El login falla: se muestra una captura del error (con campos
enmascarados) y se permite definir los pasos manualmente.</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Credencial guardada cifrada y validada.</td>
</tr>
</tbody>
</table>

### CU-03 — Ejecutar escaneo

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Proyecto con autorización vigente.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Elige "Escanear", selecciona chequeos y navegador.</p>
<p>2. QAtlas inicia el proxy de salida y el runner.</p>
<p>3. El usuario ve el progreso en vivo.</p>
<p>4. Al terminar ve el resumen: hallazgos nuevos, recurrentes,
regresiones y conexiones bloqueadas.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>2a. El proxy no puede iniciar: la ejecución falla sin
navegar.</p>
<p>3a. El usuario cancela: se conserva lo encontrado.</p>
<p>3b. El sistema probado no responde: ejecución "fallida" con el
motivo.</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Ejecución registrada con hallazgos y evidencias cifradas.</td>
</tr>
</tbody>
</table>

### CU-04 — Revisar hallazgos

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Existen hallazgos.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Filtra la bandeja.</p>
<p>2. Abre un hallazgo y revisa la evidencia.</p>
<p>3. Lo confirma, descarta o ajusta.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>3a. Descarte como falso positivo: futuras apariciones se
ocultan.</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Hallazgo clasificado.</td>
</tr>
</tbody>
</table>

### CU-05 — Generar y exportar un reporte de forma segura

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Hallazgo confirmado.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Crea el reporte desde uno o varios hallazgos.</p>
<p>2. Revisa y edita el borrador.</p>
<p>3. Elige "Exportar" y ve la vista previa de todo lo incluido.</p>
<p>4. Quita las evidencias que no quiere compartir.</p>
<p>5. Revisa las redacciones y alertas.</p>
<p>6. Elige el formato y el destino.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>5a. Hay alertas de secretos sin revisar: se exige confirmación
explícita.</p>
<p>6a. Destino sincronizado con la nube: se avisa antes de
guardar.</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Archivo exportado; exportación registrada en la auditoría.</td>
</tr>
</tbody>
</table>

### CU-06 — Revisar conexiones de la aplicación

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Bóveda desbloqueada.</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Abre "Privacidad y conexiones".</p>
<p>2. Ve el listado de conexiones salientes con su estado.</p>
<p>3. Filtra por bloqueadas para revisar intentos de salida.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>—</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>El usuario verificó la actividad de red de QAtlas.</td>
</tr>
</tbody>
</table>

## 7.2 Fases 2 a 4

### CU-07 — Crear caso de prueba con el editor

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Proyecto creado (fase 2).</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Crea el caso.</p>
<p>2. Agrega pasos con el selector asistido.</p>
<p>3. Agrega al menos una verificación.</p>
<p>4. Lo ejecuta y ve el resultado paso a paso.</p>
<p>5. Lo guarda.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>4a. Falla un paso: se muestra la captura y el error para
corregirlo.</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Caso guardado.</td>
</tr>
</tbody>
</table>

### CU-08 — Grabar un caso

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Proyecto creado (fase 3).</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Elige "Grabar".</p>
<p>2. Usa la aplicación en el navegador que abre QAtlas.</p>
<p>3. Agrega verificaciones desde el panel.</p>
<p>4. Detiene la grabación y revisa el caso en el editor.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>2a. Intenta navegar fuera de los dominios permitidos: el proxy lo
bloquea y se avisa.</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Caso creado con origen "grabado".</td>
</tr>
</tbody>
</table>

### CU-10 — Importar casos desde Excel

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Proyecto creado (fase 2).</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Elige "Importar desde Excel" y selecciona el archivo.</p>
<p>2. QAtlas lo procesa en el proceso aislado y muestra hojas y
encabezados.</p>
<p>3. El usuario elige una plantilla de importación guardada o mapea las
columnas (con sugerencias).</p>
<p>4. Revisa la vista previa: casos, pasos, errores por fila, contenido
oculto y fórmulas.</p>
<p>5. Confirma la importación.</p>
<p>6. QAtlas crea o actualiza los casos como manuales y guarda la
plantilla si es nueva.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>2a. El archivo supera los límites o tiene macros, vínculos
externos o conexiones de datos: se informa; las macros y vínculos se
ignoran, y si supera los límites no se importa.</p>
<p>4a. Hay filas con errores: el usuario puede corregir la planilla y
volver a importar, o importar solo las filas válidas.</p>
<p>5a. Hay casos existentes con el mismo ID: se muestran las diferencias
y el usuario elige actualizar u omitir.</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Casos importados, listos para ejecutarse manualmente.</td>
</tr>
</tbody>
</table>

### CU-11 — Ejecutar una ronda de UAT y emitir el acta

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Usuario</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Casos de tipo UAT importados o creados (fase 2).</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Crea una ronda de UAT con la versión del sistema y los casos
incluidos.</p>
<p>2. Ejecuta cada caso en modo guiado, marcando cada paso y adjuntando
evidencia.</p>
<p>3. Los pasos en Falla generan hallazgos y, si corresponde, reportes
de bug.</p>
<p>4. Al terminar, revisa el resumen de la ronda.</p>
<p>5. Genera el acta de UAT con la conclusión, observaciones y
firmantes.</p>
<p>6. La exporta en PDF (y los resultados en Excel, en el formato
original).</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td><p>2a. Un paso está bloqueado (por ejemplo, el ambiente no
funciona): se marca Bloqueado con comentario y la ronda sigue.</p>
<p>5a. Hay bugs críticos abiertos: el acta los lista y sugiere la
conclusión "rechazado" o "aprobado con observaciones".</p></td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Ronda cerrada con acta emitida y trazabilidad completa.</td>
</tr>
</tbody>
</table>

### CU-12 — Detectar un error de backend con el monitor de logs

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Sistema</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Fuente de log configurada (fase 3).</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Durante una ejecución, QAtlas sigue el log del backend.</p>
<p>2. Aparece una excepción mientras se ejecuta el paso "Guardar
cliente".</p>
<p>3. QAtlas crea un hallazgo "Error de backend" asociado a ese paso,
con las líneas redactadas.</p>
<p>4. El usuario lo ve en la línea de tiempo y genera el reporte de
bug.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>2a. La línea contiene un secreto: se redacta antes de guardarse y se
avisa.</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>Bug de backend detectado aunque la interfaz no mostrara error.</td>
</tr>
</tbody>
</table>

### CU-09 — Detectar una regresión

<table>
<colgroup>
<col style="width: 21%" />
<col style="width: 78%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Campo</strong></th>
<th><strong>Detalle</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Actor</td>
<td>Sistema</td>
</tr>
<tr class="even">
<td>Precondición</td>
<td>Hallazgo en estado "resuelto".</td>
</tr>
<tr class="odd">
<td>Flujo principal</td>
<td><p>1. Una ejecución encuentra un hallazgo con la misma huella.</p>
<p>2. QAtlas lo reabre como "regresión".</p>
<p>3. Lo destaca en el resumen y envía una notificación local.</p></td>
</tr>
<tr class="even">
<td>Flujos alternativos</td>
<td>—</td>
</tr>
<tr class="odd">
<td>Postcondición</td>
<td>El usuario se entera en la misma ejecución que la detecta.</td>
</tr>
</tbody>
</table>

# 8. Requisitos no funcionales

| **ID** | **Categoría**               | **Requisito**                                                                                                                                       |
|--------|-----------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| RNF-01 | Plataformas                 | Por ahora, solo Windows 10/11 x64 (ADR 005). Objetivo desde los instaladores (semana 10): Windows 10/11, macOS 13 o superior y Linux (Ubuntu 22.04 o superior), x64 y ARM64. |
| RNF-02 | Instalación                 | Instaladores firmados; sin permisos de administrador para la instalación por usuario.                                                               |
| RNF-03 | Rendimiento                 | Inicio y desbloqueo en menos de 3 segundos; la interfaz responde en menos de 200 ms en operaciones comunes.                                         |
| RNF-04 | Rendimiento                 | Un escaneo de 100 páginas termina en menos de 15 minutos con la configuración por defecto.                                                          |
| RNF-05 | Seguridad                   | Cumple todos los controles de la sección 3 y pasa la suite TS-01 a TS-14 en cada versión.                                                           |
| RNF-06 | Privacidad                  | Cero conexiones salientes no autorizadas (verificado por TS-03).                                                                                    |
| RNF-07 | Funcionamiento sin conexión | Todas las funciones, salvo integraciones y actualizaciones, funcionan sin internet (por ejemplo, contra sistemas en localhost o en la red interna). |
| RNF-08 | Usabilidad                  | Un usuario nuevo crea su bóveda, un proyecto y su primer escaneo en menos de 5 minutos.                                                             |
| RNF-09 | Accesibilidad               | La interfaz de QAtlas cumple WCAG 2.1 AA.                                                                                                           |
| RNF-10 | Confiabilidad               | Un cierre inesperado no corrompe la bóveda (transacciones y modo WAL) y al reiniciar se limpian los temporales.                                     |
| RNF-11 | Mantenibilidad              | Cobertura de tests unitarios mayor al 80 % en los paquetes crypto, redaction y runner; mayor al 70 % en el resto.                                   |
| RNF-12 | Recursos                    | Consumo en reposo menor a 300 MB de RAM; videos solo en fallas.                                                                                     |
| RNF-13 | Idioma                      | Interfaz en español, preparada para traducción.                                                                                                     |

# 9. Contratos internos (IPC)

No existe una API HTTP. La interfaz se comunica con el proceso principal
mediante canales IPC con nombre, cada uno con un esquema Zod de entrada
y salida. El preload expone solo estas funciones.

| **Canal**                                                                           | **Descripción**                                                  | **Fase** |
|-------------------------------------------------------------------------------------|------------------------------------------------------------------|----------|
| boveda:crear · desbloquear · bloquear · cambiarClave · respaldar · restaurar        | Gestión de la bóveda                                             | 1        |
| proyectos:listar · crear · actualizar · eliminar                                    | Proyectos                                                        | 1        |
| proyectos:aceptarAutorizacion                                                       | Declaración de autorización                                      | 1        |
| credenciales:guardar · reemplazarSecreto · probarLogin                              | Credenciales (nunca devuelve el secreto)                         | 1        |
| ejecuciones:lanzarEscaneo · cancelar · listar · detalle                             | Ejecuciones                                                      | 1        |
| ejecuciones:progreso (evento)                                                       | Progreso en vivo, del principal a la interfaz                    | 1        |
| hallazgos:listar · actualizar                                                       | Bandeja de hallazgos                                             | 1        |
| evidencias:obtenerVista                                                             | Devuelve la evidencia descifrada y redactada solo para mostrarla | 1        |
| reportes:crear · actualizar · previsualizarExportacion · exportar · importarPaquete | Reportes y exportación                                           | 1        |
| privacidad:conexiones · auditoria · estado                                          | Panel de privacidad                                              | 1        |
| casos:\* · suites:\* · variables:\*                                                 | Casos, suites y variables                                        | 2        |
| excel:analizar · previsualizar · importar · plantillas:\*                           | Importación desde Excel                                          | 2        |
| manual:iniciar · registrarPaso · capturarPantalla · finalizar                       | Ejecución manual                                                 | 2        |
| uat:rondas:\* · uat:emitirActa                                                      | Rondas y actas de UAT                                            | 2        |
| logs:fuentes:\* · logs:lineaDeTiempo                                                | Monitor de logs                                                  | 3        |
| grabador:iniciar · detener                                                          | Grabador integrado                                               | 3        |
| importados:\* · programaciones:\*                                                   | Tests importados y programación                                  | 3        |
| integraciones:\* · visual:\* · metricas:\*                                          | Integraciones, regresión visual, dashboard                       | 4        |

Reglas: ningún canal acepta rutas de archivo arbitrarias desde la
interfaz (los diálogos de archivo se abren desde el proceso principal);
ningún canal devuelve claves ni secretos; todo canal valida la entrada y
verifica el origen.

# 10. Plan de desarrollo por fases

Cada fase produce un producto usable y demostrable. Las duraciones son
estimaciones para una persona a tiempo parcial con asistencia de Claude
Code. La fase 1 es más larga que en la versión web porque concentra toda
la base de seguridad: **la seguridad no se agrega al final; se construye
primero**.

| **Fase** | **Nombre**                                               | **Resultado**                                                        | **Duración estimada** |
|----------|----------------------------------------------------------|----------------------------------------------------------------------|-----------------------|
| 1        | Base segura, escáner y reportes                          | Escáner de escritorio cifrado, con reportes y exportación segura     | 8 a 10 semanas        |
| 2        | Casos de prueba: Excel, manual, UAT y sin código         | Herramienta que reemplaza la planilla de casos y la ejecución de UAT | 6 a 8 semanas         |
| 3        | Grabación, importación, monitor de logs y automatización | Plataforma con ejecuciones automáticas                               | 5 a 7 semanas         |
| 4        | Integraciones opcionales, visual y métricas              | Producto completo                                                    | 4 a 6 semanas         |

## 10.1 Fase 1 — Base segura, escáner y reportes

**Objetivo:** tener una app de escritorio que proteja todos los datos
desde el primer día, encuentre problemas reales y genere reportes que se
puedan compartir sin exponer información.

**Duración estimada:** 8 a 10 semanas

### Incluye

- Esqueleto Electron endurecido (sección 3.6) y pipeline de CI con la
  suite de seguridad desde el día uno.

- Bóveda: esquema de claves, SQLCipher, cifrado de evidencias, bloqueo
  (BOV).

- Proyectos, autorización y credenciales cifradas (PRY).

- Runner aislado y proxy de salida (3.5, 3.7).

- Escaneo (ESC), ejecuciones (EJE), hallazgos y regresiones.

- Redacción y detector de secretos (3.8).

- Reportes y exportación guiada (REP): reporte de bug en PDF, Markdown,
  captura anotada y ZIP; reporte de ejecución en PDF y HTML; controles
  EXP-01 a EXP-06 que apliquen.

- Privacidad, conexiones y pantalla de Actividad (PRV).

- App de prueba con errores plantados y con intentos de fuga plantados.

### Entregables

- Instalador firmado para Windows (y para las otras plataformas si se
  cuenta con certificados).

- Suite de seguridad TS-01 a TS-10 y TS-14 pasando en CI.

- Escaneo de Lexora con hallazgos documentados.

- SECURITY.md y modelo de amenazas publicado en el repositorio.

- README con GIF de demostración.

### Criterio de terminado

- El test del secreto canario (TS-01) no encuentra el valor en ningún
  archivo.

- El test de salida de red (TS-03) no registra ninguna conexión no
  autorizada.

- Un bug reintroducido se detecta como regresión.

### Orden sugerido de trabajo (fase 1)

1.  Semana 1: monorepo, Electron endurecido, CSP, fuses, IPC tipado, CI
    con lint, typecheck y Electronegativity.

2.  Semana 2: paquete crypto (Argon2id, AES-GCM, esquema de claves) con
    tests exhaustivos.

3.  Semana 3: bóveda con SQLCipher, desbloqueo, bloqueo automático,
    copia de seguridad; TS-02 y TS-09.

4.  Semana 4: proyectos, autorización, credenciales cifradas; app de
    prueba (sandbox-site).

5.  Semana 5: runner aislado y proxy de salida; TS-03, TS-04 y TS-05.

6.  Semana 6: crawler y chequeos; login sin grabación (TS-06).

7.  Semana 7: redacción, detector de secretos, evidencias cifradas;
    TS-01 (canario).

8.  Semana 8: hallazgos, huella y regresiones; monitor de conexiones.

9.  Semana 9: reportes (PDF, Markdown, HTML, captura anotada, ZIP) y
    exportación guiada; TS-10 y TS-14.

10. Semana 10: firma e instaladores, documentación, demo y revisión con
    el checklist de Electron.

## 10.2 Fase 2 — Casos de prueba: Excel, manual, UAT y sin código

**Objetivo:** que un equipo que hoy trabaja con planillas pueda importar
sus casos y scripts de UAT, ejecutarlos con QAtlas, devolver los
resultados en Excel y empezar a automatizar.

**Duración estimada:** 6 a 8 semanas

### Incluye

- Importación de casos desde Excel con asistente de mapeo y plantillas
  (XLS), con los controles ENT-01 a ENT-06.

- Ejecución manual guiada, rondas de UAT y acta de UAT en PDF (MAN).

- Módulo CAS: editor, selector asistido, variables y secretos, suites
  (incluidas mixtas), versionado, exportación a .spec.ts.

- Automatización asistida de pasos importados.

- Exportaciones a Excel: planilla de casos (ida y vuelta), reporte de
  ejecución y matriz de trazabilidad, con EXP-01.

- Tests de seguridad TS-11 y TS-12; extensión de TS-01 a variables
  secretas y capturas manuales.

### Entregables

- Una planilla real de casos (anonimizada) importada, ejecutada y
  exportada con resultados en su formato original.

- Una ronda de UAT de Lexora con su acta en PDF.

- Suite de regresión de Lexora creada desde la interfaz; comparación con
  lexora-qa.

### Criterio de terminado

- Una planilla de 100 casos se importa en menos de 2 minutos, incluido
  el mapeo con una plantilla guardada.

- La planilla exportada con resultados se abre en Excel sin advertencias
  y sin fórmulas generadas a partir de datos.

- Un .spec.ts exportado corre con Playwright sin cambios y sin contener
  secretos.

### Orden sugerido de trabajo (fase 2)

1.  Semanas 1 y 2: modelo de casos y pasos, proceso aislado de archivos,
    lectura de Excel con controles ENT y TS-12.

2.  Semana 3: asistente de mapeo, plantillas de importación, vista
    previa y reimportación con diferencias.

3.  Semana 4: ejecución manual guiada, capturas anotadas y hallazgos
    desde pasos manuales.

4.  Semana 5: rondas y actas de UAT; exportaciones a Excel (TS-11).

5.  Semanas 6 a 8: editor sin código, automatización asistida, suites
    mixtas y exportación a .spec.ts.

## 10.3 Fase 3 — Grabación, importación y automatización

**Objetivo:** reducir el esfuerzo de crear pruebas y hacer que corran
solas.

**Duración estimada:** 5 a 7 semanas

### Incluye

- Grabador integrado (GRA).

- Importación de .spec.ts en sandbox (IMP).

- Monitor de logs del sistema probado (MON) con TS-13.

- Reportes con video MP4 recortado y subtitulado, GIF, traza, HAR y
  JUnit XML.

- Programación, ejecución en segundo plano y notificaciones locales
  (PRG).

- CLI qatlas run.

- Detección de tests inestables.

### Entregables

- Suite de lexora-qa ejecutándose desde QAtlas.

- Regresión nocturna de Lexora programada.

- Bug de backend de Lexora detectado por el monitor de logs.

### Criterio de terminado

- El sandbox no accede a claves ni a la bóveda (test automatizado).

- Lo tipeado en campos de contraseña durante una grabación nunca queda
  guardado.

## 10.4 Fase 4 — Integraciones opcionales, visual y métricas

**Objetivo:** integrar QAtlas al flujo del equipo sin comprometer la
privacidad, y medir la calidad en el tiempo.

**Duración estimada:** 4 a 6 semanas

### Incluye

- Integraciones opt-in: GitHub Issues, Jira, Slack, webhooks (INT).

- Regresión visual (VIS).

- Dashboard y métricas (DSH).

- Actualizaciones firmadas opcionales (3.12).

- Verificación de propiedad de dominio (SEG-06).

- Revisión de seguridad externa o par revisor del código.

### Entregables

- Bug de Lexora creado como issue de GitHub desde QAtlas, con revisión
  previa.

- Dashboard con al menos un mes de historial.

- Versión 1.0 publicada con SBOM y checksums.

### Criterio de terminado

- Con todas las integraciones desactivadas, TS-03 sigue sin registrar
  conexiones externas.

- Cerrar un issue en GitHub actualiza el hallazgo en QAtlas.

# 11. Estrategia de calidad de QAtlas

| **Nivel**   | **Herramienta**                                     | **Qué cubre**                                                                                  |
|-------------|-----------------------------------------------------|------------------------------------------------------------------------------------------------|
| Unitario    | Vitest                                              | Criptografía, redacción, detector de secretos, huella, normalización de URLs, políticas de red |
| Integración | Vitest                                              | Bóveda real, proxy real, runner con la app de prueba                                           |
| E2E         | Playwright (soporte de Electron)                    | Flujos de los casos de uso desde la interfaz de QAtlas                                         |
| Seguridad   | Suite TS-01 a TS-14, Electronegativity, OSV-Scanner | Controles de la sección 3                                                                      |
| Dogfooding  | QAtlas                                              | QAtlas escanea la app de prueba y sus propias pantallas de documentación                       |

**App de prueba con errores y trampas plantadas:** un sitio pequeño
incluido en el repositorio con un 404, un error de JavaScript, un botón
sin label, un botón "Eliminar", links y redirecciones a otros dominios,
un WebSocket externo, un service worker, un script de "analítica" de
terceros y un token JWT impreso en la consola. Los tests verifican que
QAtlas encuentre los errores, bloquee todas las salidas y redacte el
token. Se suman **planillas de prueba** (válidas, con errores, con
macros, vínculos externos, contenido oculto y bomba zip) y un **backend
de prueba** que escribe excepciones y secretos en su log.

**Política de bugs:** todo bug corregido suma un test de regresión. Todo
bug de seguridad suma además un test en la suite de seguridad.

# 12. Riesgos

| **Riesgo**                              | **Impacto** | **Mitigación**                                                                                                                |
|-----------------------------------------|-------------|-------------------------------------------------------------------------------------------------------------------------------|
| Alcance grande para una persona         | Alto        | Fases independientes; no avanzar sin cerrar la anterior                                                                       |
| Error de implementación criptográfica   | Alto        | Solo primitivas estándar (AES-GCM, Argon2id) de una implementación de referencia o auditada; tests con vectores conocidos; revisión externa en fase 4 |
| Pérdida de la contraseña maestra        | Alto        | Advertencia clara, copia de seguridad sugerida, "Recordar en este equipo" opcional                                            |
| Vulnerabilidad en Electron o Chromium   | Alto        | Actualización rápida de versiones; el contenido del sitio probado nunca se ejecuta en la ventana de QAtlas                    |
| Fuga por redacción incompleta           | Medio       | Detector de secretos, modo datos sensibles, revisión previa a exportar, test canario                                          |
| Falta de certificado de firma de código | Medio       | Empezar con Windows (certificado accesible); publicar checksums; builds solo en CI                                            |
| Uso sobre sistemas sin permiso          | Alto        | Controles de la sección 3.2                                                                                                   |
| Crawler incompleto en SPAs complejas    | Medio       | URLs semilla; casos de prueba para lo que el crawler no alcance                                                               |
| Falsos positivos                        | Medio       | Descarte por huella; severidades y umbrales configurables                                                                     |

# Anexo A — Prompt para iniciar la Fase 1 con Claude Code

Guardar la versión Markdown de este documento como
docs/especificacion-qatlas.md en la carpeta del proyecto y pegar este
prompt en la primera sesión:

> Vamos a construir QAtlas, una aplicación de ESCRITORIO de testing para
>
> aplicaciones web. La especificación completa está en
>
> docs/especificacion-qatlas.md: leela entera antes de empezar, en
> especial la
>
> sección 3 (Seguridad y privacidad), que es el requisito central del
> proyecto.
>
> Soy QA tester, estoy terminando la carrera de desarrollo de software y
> este
>
> proyecto es para mi portfolio de QA Automation.
>
> STACK (no lo cambies sin consultarme)
>
> \- Electron endurecido + React + TypeScript + Vite + Tailwind +
> shadcn/ui.
>
> \- Proceso principal en Node + TypeScript; comunicación solo por IPC
> tipado con
>
> Zod. Sin servidor HTTP ni puertos de escucha.
>
> \- SQLite cifrada con SQLCipher (better-sqlite3-multiple-ciphers) +
> Drizzle.
>
> \- Criptografía: crypto de Node (AES-256-GCM) y Argon2id. Nada de
> cripto propia.
>
> \- Playwright en un utilityProcess aislado, con proxy de salida
> propio.
>
> \- Monorepo: apps/desktop, apps/sandbox-site, packages/{runner,crypto,
>
> redaction,db,shared}, security-tests/.
>
> REGLAS DE SEGURIDAD (no negociables)
>
> \- Ningún dato sale del equipo salvo por acción explícita del usuario.
>
> Cero telemetría, cero CDNs, cero recursos remotos en la interfaz.
>
> \- Denegar por defecto: toda conexión no permitida se bloquea y se
> registra.
>
> \- Nunca escribas datos del usuario en disco sin cifrar (incluye
> temporales).
>
> \- Nunca loguees secretos, contenidos de formularios ni cuerpos de
> respuestas.
>
> \- Configuración de Electron según la sección 3.6, verificada en CI.
>
> \- Fallar cerrado: si un control de seguridad no se puede aplicar, no
> se
>
> ejecuta nada.
>
> \- Cada control de seguridad tiene su test en security-tests/ (TS-01 a
> TS-14).
>
> Ninguna tarea está terminada si la suite de seguridad no pasa.
>
> \- Cada dependencia nueva: justificala y consultame antes de
> agregarla.
>
> \- Si una decisión implica un tradeoff de seguridad, explicámelo y
> esperá mi
>
> respuesta. Nunca relajes un control para "hacer que funcione".
>
> ALCANCE: SOLO FASE 1 (sección 10.1). Diseñá el esquema de datos para
> poder
>
> extenderlo, pero no implementes nada de fases posteriores.
>
> PRIMERAS TAREAS (mostrame el plan antes de cada una)
>
> 1\. Creá CLAUDE.md con este contexto, el stack y las reglas de
> seguridad.
>
> 2\. Creá SECURITY.md y docs/modelo-de-amenazas.md a partir de la
> sección 3.
>
> 3\. Semana 1 de la sección 10.1: monorepo, Electron endurecido, CSP,
> fuses,
>
> IPC tipado y CI (lint, typecheck, tests, Electronegativity).
>
> 4\. Semana 2: paquete crypto con tests (incluidos vectores de prueba
> conocidos).
>
> 5\. Seguí el orden semanal de la sección 10.1 y confirmá conmigo al
> terminar
>
> cada semana.

# Anexo B — Checklist de seguridad por versión

Se completa antes de publicar cada versión. Ningún punto puede quedar
sin marcar.

| **\#** | **Verificación**                                                       |
|--------|------------------------------------------------------------------------|
| 1      | Suite de seguridad TS-01 a TS-14 en verde                              |
| 2      | npm audit y OSV-Scanner sin hallazgos críticos ni altos sin justificar |
| 3      | Electronegativity sin hallazgos nuevos                                 |
| 4      | Fuses verificados en el binario final                                  |
| 5      | CSP verificada en el build final                                       |
| 6      | Electron en versión con soporte de seguridad vigente                   |
| 7      | Dependencias nuevas revisadas y justificadas                           |
| 8      | SBOM generado y publicado                                              |
| 9      | Instaladores firmados y checksums publicados                           |
| 10     | Modelo de amenazas revisado si hubo funcionalidades nuevas             |
| 11     | Notas de versión con los cambios de seguridad                          |

# Anexo C — Trazabilidad

| **Caso de uso**       | **Módulos** | **Controles y reglas**                | **Tests de seguridad** | **Fase** |
|-----------------------|-------------|---------------------------------------|------------------------|----------|
| CU-00 Primer inicio   | BOV         | RN-BOV-01, 3.4, 3.10                  | TS-02, TS-09           | 1        |
| CU-01 Crear proyecto  | PRY         | RN-PRY-01 a 05, SEG-01, SEG-02        | —                      | 1        |
| CU-02 Credenciales    | PRY         | RN-PRY-04, EVI-01                     | TS-01, TS-06           | 1        |
| CU-03 Escaneo         | ESC, EJE    | RN-ESC-01 a 05, SEG-03 a 05, 3.5, 3.7 | TS-03, TS-04, TS-05    | 1        |
| CU-04 Hallazgos       | REP         | Sección 5                             | —                      | 1        |
| CU-05 Exportar        | REP         | RN-REP-01 a 03, 3.9                   | TS-01                  | 1        |
| CU-06 Conexiones      | PRV         | 3.5                                   | TS-03                  | 1        |
| CU-07 Editor          | CAS         | RN-CAS-01, 02                         | TS-01                  | 2        |
| CU-08 Grabar          | GRA         | RN-GRA-01, 02                         | TS-03, TS-06           | 3        |
| CU-09 Regresión       | EJE, REP    | Sección 5.1                           | —                      | 1        |
| CU-10 Importar Excel  | XLS         | RN-XLS-01 a 04, ENT-01 a 06           | TS-12                  | 2        |
| CU-11 Ronda de UAT    | MAN, REP    | RN-MAN-01 a 04, EXP-01                | TS-01, TS-11           | 2        |
| CU-12 Monitor de logs | MON         | RN-MON-01 a 03, ENT-07                | TS-13                  | 3        |
