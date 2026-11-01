# 020 — De dónde sale el navegador de pruebas

- **Estado:** aceptada
- **Fecha:** 2026-11-01

## Contexto

Playwright descarga sus navegadores desde internet, y eso choca con «nada se descarga sin acción explícita». Además,
**Playwright 1.64.1 solo compara el tamaño de la descarga con `content-length`:** no verifica un hash.

## Opciones

| Opción                        | Motivo                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| **Chromium en el instalador** | **Elegida.** Sin red, con la firma del instalador. Agranda la descarga                |
| Descarga explícita            | Para Firefox y WebKit, más adelante: tres navegadores no entran bien en un instalador |
| El Chromium de Electron       | Playwright lo maneja como app. El sitio probado correría dentro del binario de QAtlas |

## Decisión

- **Producto:** Chromium completo en `resources/navegadores` (semana 10). Ocupa 437 MB instalado en Windows, contra
  278 MB de headless shell, pero la grabación de la fase 3 necesita ventana visible.
- **La app nunca descarga un navegador:** le pasa la ruta al runner, y `launch` no descarga. Si falta, la ejecución
  falla sin abrir nada. Un E2E lo verifica con una carpeta vacía.
- **Desarrollo y CI:** `npm run navegador:instalar`, con Playwright en versión exacta.
- **Hash de la primera descarga:** `scripts/navegador-hashes.json`, por revisión y plataforma.
  `scripts/verificar-navegador.mjs` lo compara antes y después de los E2E. Si no coincide, falla. El «después» ya
  sirvió: un entorno sin `SystemDrive` hacía que Chromium escribiera en su propia carpeta.

## Dependencias

| Paquete                  | Para qué               | Script de instalación | Tamaño instalado | Licencia   | Mantenimiento |
| ------------------------ | ---------------------- | --------------------- | ---------------- | ---------- | ------------- |
| `playwright-core` 1.64.1 | Controlar el navegador | No                    | 14 MB            | Apache-2.0 | Microsoft     |

Ya estaba como transitiva de `@playwright/test`, que también pasa a versión exacta. Alternativa: hablar CDP a mano, que
es peor. No trae navegadores ni los descarga al instalarse.

## Límites

- **Es confianza en el primer uso:** protege de un cambio posterior, no de que esa primera descarga ya estuviera
  alterada. La comparación con una fuente independiente llega con los instaladores.
- **El hash de Linux se calculó en Windows,** descargando la versión de Linux con
  `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE`. **No se probó en una máquina Linux todavía:** si difiere, el CI falla e imprime el
  hash que encontró. Antes de registrarlo hay que entender por qué difiere.
- Subir Playwright cambia la revisión de Chromium: hay que registrar el hash nuevo a propósito.
