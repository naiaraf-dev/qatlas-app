# CLAUDE.md — Contexto para Claude Code

## Proyecto

QAtlas es una aplicación de ESCRITORIO de testing para aplicaciones web: escaneo automático,
importación de casos desde Excel, ejecución manual y UAT, casos sin código y reportes de bugs con
evidencia. Es el proyecto de portfolio de QA Automation de la autora, que trabaja como tester QA.

La especificación completa está en `docs/especificacion-qatlas.md`. Leé la sección 3 (Seguridad y
privacidad) antes de cualquier cambio: es el requisito central del proyecto.

## Estado actual

- Fase 1, semana 1 terminada: monorepo, Electron endurecido, CSP, protocolo `app://`, IPC tipado,
  suite de seguridad inicial (TS-03 parcial, TS-07, TS-08), E2E con Playwright y CI.
- Próximo: semana 2, paquete `packages/crypto` (sección 3.4 y 10.1).

## Stack (no cambiar sin consultar)

- Electron + electron-vite. React 19 + TypeScript 6 + Vite 8 + Tailwind 4.
- IPC solo por el contrato de `packages/shared/src/ipc-contract.ts` (Zod).
- Vitest para unitarios y seguridad; Playwright para E2E de la app.
- Próximas: SQLite + SQLCipher (better-sqlite3-multiple-ciphers) + Drizzle; crypto de Node + Argon2id.
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
- Cada control de seguridad tiene su test en `security-tests/`. Ninguna tarea está terminada si la
  suite de seguridad no pasa.
- `.npmrc` tiene `ignore-scripts=true`. Si un paquete necesita su script de instalación, agregarlo a
  `scripts/allowed-install-scripts.mjs` con el motivo, previa consulta.
- Cada dependencia nueva: justificarla y consultar antes de agregarla.
- Si una decisión implica un tradeoff de seguridad, explicarlo y esperar respuesta. Nunca relajar un
  control para "hacer que funcione".

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
