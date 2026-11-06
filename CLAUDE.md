# CLAUDE.md — Contexto para Claude Code

## Proyecto

QAtlas es una aplicación de ESCRITORIO de testing para aplicaciones web: escaneo automático,
importación de casos desde Excel, ejecución manual y UAT, casos sin código y reportes de bugs con
evidencia. Es un proyecto de portfolio de QA Automation.

La especificación completa está en `docs/especificacion-qatlas.md`. Leé la sección 3 (Seguridad y
privacidad) antes de cualquier cambio: es el requisito central del proyecto.

## Estado actual

- Fase 1, semana 1 terminada: monorepo, Electron endurecido, CSP, protocolo `app://`, IPC tipado,
  suite de seguridad inicial (TS-03 parcial, TS-07, TS-08), E2E con Playwright y CI.
- Sistema de diseño Índigo aplicado: shell con menú lateral, Inicio, Privacidad y conexiones,
  páginas "en construcción" y selector de tema (Sistema · Claro · Oscuro).
- Fase 1, semana 2 terminada: paquete `packages/crypto` (Argon2id, jerarquía de claves, archivos en
  streaming, campos, borrado criptográfico). Ver su README.
- Fase 1, semana 3 terminada: `packages/db` (SQLCipher, Drizzle, migraciones, `boveda.sellada`, copia),
  primer inicio, desbloqueo con freno, bloqueo, restauración, tema persistido; TS-02 y TS-09. Ver las
  ADR 006 a 010.
- Por ahora solo se soporta Windows x64 (ver `docs/decisiones/005-argon2id.md`).
- Fase 1, semana 4 terminada: proyectos, autorización versionada, credenciales cifradas, auditoría, purga
  por lápida y `apps/sandbox-site`. Ver las ADR 011 a 015.
- Fase 1, semana 5 terminada: `packages/runner` (proxy de salida en su `utilityProcess`, runner por
  ejecución, agente de Node), ejecuciones con cola, `credenciales:probarLogin`, monitor de conexiones,
  TS-03, TS-04 y TS-05. Ver las ADR 016 a 020.
- Fase 1, semana 6a terminada: crawler y chequeos del escaneo (ESC), `pagina_visitada`, `hallazgo` y
  `hallazgo_ocurrencia` con el detalle cifrado, evento `ejecuciones:progreso`, TS-05 completo y el oráculo
  del sandbox. Ver las ADR 021 a 024.
- Fase 1, semana 6b terminada: estrategias de login (formulario, SSO, enlace con token, asistido), roles,
  dominios de autenticación, proxy de login aparte, estado de sesión en memoria y cifrado, sesión vencida con
  confirmación, límites y pausa, parámetros sensibles, TS-06 y la zona con login del sandbox. Ver las ADR 025 a 029
  y el catálogo de estrategias en la especificación (6.2.1).
- La básica pasó a la fase 2 (ADR 025): si el origen base redirige a otro origen, Chromium le manda el
  `Authorization` que puso la ruta. `ESTRATEGIAS_PENDIENTES` en `@qatlas/shared` la deja visible y deshabilitada;
  `e2e/basica-encabezado.e2e.ts` reproduce la fuga con `test.fail`.
- La ventana del asistido usa un perfil temporal propio con el gestor de contraseñas apagado (ADR 028).
- Próximo: semana 7, redacción y detector de secretos; TS-01 completo.
- El runner es `crearRunner` (runner.ts); entrada-runner.ts solo lo conecta al `parentPort`. Un E2E que necesita
  manejar la ventana del login asistido corre los servicios y el runner en su proceso (`ts-06-login-asistido.e2e.ts`).
- El estado de sesión nunca va a la base ni a disco. Un cambio que deja sin valor una sesión avisa con el callback
  de `ServicioProyectos` (`descartarSesiones`).
- Los E2E cargan con `tsconfig.e2e.json` (sin el mapeo de better-sqlite3 a sus tipos). Node 22.15 o más nuevo.
- El oráculo (`hallazgos-esperados.json`) se compara en `e2e/escaneo-oraculo.e2e.ts` y `e2e/escaneo.e2e.ts`:
  un chequeo nuevo necesita su caso plantado en el sandbox, y un hallazgo sin documentar hace fallar el test.
- `packages/runner/src/motor` no importa red, `child_process` ni `electron`: un test lo verifica.
- Cada tabla nueva con `proyecto_id` va en `TABLAS_DE_PROYECTO` (un test lo verifica), y un canal IPC
  nuevo queda bloqueado con la bóveda bloqueada salvo que se agregue a `CANALES_SIN_BOVEDA`.
- La auditoría guarda solo IDs y nombres de campos (ADR 015).
- Pendientes de la semana 10: compilar SQLCipher desde fuente para los instaladores (ADR 006),
  `asarUnpack` con verificación sobre el binario final (ADR 007), avisos de terceros del instalador, con
  la MPL-2.0 de la Public Suffix List (ADR 011), y empaquetar Chromium en `resources/navegadores`, firmado
  (ADR 020). En Linux, el sandbox de Chromium necesita configuración (en CI se usa `sysctl`): si algún día
  se distribuye para Linux, resolverlo en el instalador sin relajar la seguridad del equipo del usuario.
- Pendientes de la fase 3: los `.spec.ts` importados son código de terceros y necesitan aislamiento a
  nivel del sistema operativo (ADR 017).
- Pendiente (sin semana): confiar en el certificado de un sistema interno por su huella exacta, como opción por
  proyecto, explícita y auditada. Nunca «aceptar cualquier certificado».
- Pendiente: correr el E2E del CI de Linux dentro de un network namespace sin salida, para probar a nivel
  del sistema operativo que la app no abre conexiones no autorizadas (ADR 016).

## Stack (no cambiar sin consultar)

- Electron + electron-vite. React 19 + TypeScript 6 + Vite 8 + Tailwind 4.
- IPC solo por el contrato de `packages/shared/src/ipc-contract.ts` (Zod).
- Vitest para unitarios y seguridad; Playwright para E2E de la app.
- Motor de pruebas: `playwright-core` en versión exacta, con Chromium fijado por su hash (ADR 020).
- Accesibilidad: `axe-core` en versión exacta, inyectado en un mundo aislado (ADR 021).
- Criptografía: `crypto` de Node (AES-256-GCM, HKDF) + `argon2` (versión exacta, ADR 005).
- SQLite + SQLCipher (better-sqlite3-multiple-ciphers, versión exacta, ADR 006) + Drizzle, sin
  drizzle-kit. Contraseñas: `@zxcvbn-ts` (ADR 008). Dominios: `tldts` (ADR 011).
- TypeScript 6 (no 7): typescript-eslint todavía no soporta TS 7. Ver `docs/decisiones/`.

## Reglas de seguridad (no negociables)

- Ningún dato sale del equipo salvo por acción explícita del usuario. Cero telemetría, cero CDNs,
  cero recursos remotos en la interfaz.
- Denegar por defecto: toda conexión no permitida se bloquea y se registra.
- Nunca escribir datos del usuario en disco sin cifrar (incluye temporales).
- Nunca loguear secretos, contenidos de formularios ni cuerpos de respuestas.
- Toda ventana usa `SECURE_WEB_PREFERENCES`. Nunca `nodeIntegration: true`, `sandbox: false`,
  `contextIsolation: false` ni `webSecurity: false` (TS-07 lo verifica).
- Canales IPC nuevos: agregarlos al contrato con esquemas `.strict()` de entrada y salida; nunca
  aceptar rutas de archivo desde la interfaz ni devolver secretos. Agregar casos a TS-08.
- El preload solo importa tipos de `@qatlas/shared` y expone funciones específicas.
- Fallar cerrado: si un control de seguridad no se puede aplicar, no se ejecuta nada.
- Criptografía: solo primitivas estándar, de una implementación de referencia o auditada. Nada de
  criptografía propia. Lo que dependa de `crypto` debe probarse también en Electron (usa BoringSSL).
- Cada control de seguridad tiene su test en `security-tests/`. Ninguna tarea está terminada si la
  suite de seguridad no pasa.
- `.npmrc` tiene `ignore-scripts=true`. Si un paquete necesita su script de instalación, agregarlo a
  `scripts/allowed-install-scripts.mjs` con el motivo, previa consulta.
- Cada dependencia nueva: justificarla y consultar antes de agregarla.
- Si una decisión implica un tradeoff de seguridad, explicarlo y esperar respuesta. Nunca relajar un
  control para "hacer que funcione".
- Datos personales: el repo es público. En ningún archivo versionado, mensaje de commit, test, fixture,
  log de ejemplo, documentación ni descripción de PR puede aparecer nada que identifique a la autora o
  a su equipo: rutas locales, nombre de usuario de Windows, nombre del equipo, nombres de carpetas
  reales, emails, nombres de organizaciones, URLs internas ni datos de su trabajo.
  - Usar siempre datos ficticios inventados: usuario "ana", rutas como
    `C:\Users\ana\AppData\Local\QAtlas`, dominios `example.com` y `example.test`, emails `@example.com`.
  - Nunca partir de un valor real para redactarlo o abreviarlo (ni iniciales). Inventarlo desde cero.
  - Si un comando muestra una ruta o dato real de la máquina, no copiarlo a ningún archivo ni repetirlo
    en resúmenes: decir "la ruta local". `security-tests/privacidad-repo.test.ts` lo verifica.

## Reglas de Git (no negociables)

- Nunca hacer push, pull ni fetch de remotos, merge a `develop` o `main`, force push ni borrar ramas
  remotas. Eso lo hace la autora. Claude solo commitea en local.
- Ramas: siempre `feat/[funcionalidad-modulo]`, creadas desde `develop` (ej.: `feat/boveda-db`,
  `feat/escaneo-runner`, `feat/importacion-excel`).
- Nunca commitear en `main` ni en `develop`.
- Al terminar una tarea, entregar el título y la descripción del PR, usando la plantilla
  `.github/pull_request_template.md`, con el checklist ya evaluado ítem por ítem y la tabla de
  dependencias nuevas completa.
- Flujo completo: `CONTRIBUTING.md`.

## Reglas de procesos

- Nunca cerrar procesos por nombre (por ejemplo, todos los `electron.exe`). Solo los que inició Claude,
  por su PID.

## Diseño

- Sistema de diseño "Índigo": `docs/diseno/sistema-de-diseno.md`. Un sistema, dos modos (claro y
  oscuro); por defecto sigue al sistema operativo.
- Usar siempre los tokens (`bg-surface`, `text-muted`, `bg-accent`…) y los componentes de
  `renderer/src/ui/`. Nunca colores sueltos en hexadecimal.
- Verificar contraste en los dos modos. El color nunca comunica solo: siempre con texto.
- Funciones que todavía no existen: visibles, deshabilitadas y con "Llega en: …". Nunca datos
  inventados en la interfaz.

## Convenciones

- Interfaz, comentarios y documentación en español.
- Lógica de seguridad en funciones puras (sin importar `electron`) para poder probarla con Vitest.
- Commits chicos y descriptivos.

## Antes de dar una tarea por terminada

```bash
npm run check                         # lint, tipos, tests, Electronegativity
npm run navegador:instalar            # una vez, o al subir Playwright
npm run build && npm run test:e2e     # E2E (en Linux sin pantalla: xvfb-run -a npm run test:e2e)
```

Si Electronegativity reporta algo nuevo, corregirlo o documentarlo en
`docs/seguridad/electronegativity.md` con su justificación.
