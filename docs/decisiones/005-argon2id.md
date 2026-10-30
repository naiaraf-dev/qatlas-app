# 005 — Argon2id con el paquete `argon2` (implementación de referencia)

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

La especificación (3.4) pide Argon2id con 64 MiB, 3 iteraciones y salt de 16 bytes.

Lo primero fue verificar si había Argon2 nativo. En el proceso principal de Electron 45.1.0 (Node
24.22.1), `crypto.argon2Sync` existe, pero al llamarla lanza `ERR_CRYPTO_ARGON2_NOT_SUPPORTED`:
Electron usa BoringSSL, no OpenSSL. En Node 22.18, el del equipo de desarrollo y el CI, no existe.

## Opciones

| Opción                  | Vector RFC 9106 | Motivo                                                                                         |
| ----------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| **`argon2` 0.45.1**     | Sí              | **Elegida.** Envuelve el código C de referencia                                                |
| `@noble/hashes` 2.4.0   | Sí              | JS puro, sin dependencias. Excluye Argon2 de su auditoría y sus autores advierten que es lento |
| `@node-rs/argon2` 2.2.2 | No              | No acepta datos asociados, así que no puede correr el vector oficial                           |
| `hash-wasm` 4.12.0      | No              | Tampoco acepta datos asociados; última publicación en 2024                                     |

## Decisión

Usar `argon2` con la versión exacta fija (`0.45.1`), detrás de la interfaz `ImplementacionArgon2id`.

**No hay auditoría publicada de esta librería.** Se eligió por:

1. **Envolver la implementación de referencia en C** de los autores de Argon2.
2. **Rendimiento:** 60 ms de mediana en la máquina de desarrollo, con 64 MiB, 3 iteraciones y 4
   carriles (medido en Electron).
3. **Margen para subir parámetros:** el costo para el atacante crece sin afectar el desbloqueo. Los
   autores de `@noble/hashes` advierten que en JS, unas 5 veces más lento, la ventaja es del atacante.

Además, borra su copia de la contraseña y la memoria interna en C, y calcula fuera del hilo principal.

Por esto, la regla del proyecto pasa a ser usar una **implementación de referencia o auditada**.

## Verificación

- Vector oficial de RFC 9106 (sección 5.3), en Node y dentro del runtime real de Electron.
- `npm run test:crypto:electron` corre toda la suite de crypto en Electron, también en CI.
- Se resuelve con revisión externa en la fase 4 (riesgos, sección 12 de la especificación).

## Consecuencias

- **Dependencias:** suma `argon2` y sus 4 dependencias directas (`@phc/format`, `cross-env`,
  `node-addon-api`, `node-gyp-build`). Su script de instalación queda bloqueado por `ignore-scripts`:
  usa el binario precompilado que trae el paquete, así que no requiere una excepción en
  `scripts/allowed-install-scripts.mjs`.
- **Plataformas:** por ahora solo se soporta Windows x64. `win32-arm64` y `darwin-x64` no tienen binario
  precompilado y quedan para los instaladores (semana 10). Ahí sí hará falta compilar y una excepción.
- **Integridad:** el `.node` queda fuera del asar y de su validación de integridad. Se resuelve en la
  semana 3, junto con SQLCipher.
- **Reversible:** el resultado de Argon2id no depende de la implementación. Cambiar de librería no
  toca la bóveda ni el resto del paquete.
- Conviene revisar esta decisión si Electron incorpora Argon2 nativo.
