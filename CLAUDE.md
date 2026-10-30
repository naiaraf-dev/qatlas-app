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
- Próximo: semana 4, proyectos, autorización y credenciales cifradas; app de prueba. Cada tabla nueva
  con `proyecto_id` va en `TABLAS_DE_PROYECTO`, y un canal IPC nuevo queda bloqueado con la bóveda
  bloqueada salvo que se agregue a `CANALES_SIN_BOVEDA`.
- Pendientes de la semana 10: compilar SQLCipher desde fuente para los instaladores (ADR 006) y
  `asarUnpack` con verificación sobre el binario final (ADR 007).

## Stack (no cambiar sin consultar)

- Electron + electron-vite. React 19 + TypeScript 6 + Vite 8 + Tailwind 4.
- IPC solo por el contrato de `packages/shared/src/ipc-contract.ts` (Zod).
- Vitest para unitarios y seguridad; Playwright para E2E de la app.
- Criptografía: `crypto` de Node (AES-256-GCM, HKDF) + `argon2` (versión exacta, ADR 005).
- SQLite + SQLCipher (better-sqlite3-multiple-ciphers, versión exacta, ADR 006) + Drizzle, sin
  drizzle-kit. Contraseñas: `@zxcvbn-ts` (ADR 008).
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
npm run build && npm run test:e2e     # E2E (en Linux sin pantalla: xvfb-run -a npm run test:e2e)
```

Si Electronegativity reporta algo nuevo, corregirlo o documentarlo en
`docs/seguridad/electronegativity.md` con su justificación.
