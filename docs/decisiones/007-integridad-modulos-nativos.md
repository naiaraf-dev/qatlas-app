# 007 — Integridad de los módulos nativos: un registro revisado

- **Estado:** aceptada (revisada el 2026-11-07: el hash sale de un registro revisado, no del disco)
- **Fecha:** 2026-10-30

## Contexto

Un `.node` no se puede cargar desde dentro del asar: va desempaquetado (`asarUnpack`). La documentación
de Electron no dice que su validación de integridad cubra esos archivos, así que se asume que no. Un
módulo manipulado corre dentro del proceso principal y ve la contraseña y las claves (amenaza A-21).

Los dos paquetes nativos, `argon2` y `better-sqlite3-multiple-ciphers`, traen sus binarios precompilados
en `prebuilds/`, para varias plataformas, y no tienen script de instalación (ADR 005 y 006).

## Qué garantizaba antes, y el hueco

Hasta el 2026-11-06, el build calculaba el SHA-256 de los `.node` **que encontraba en `node_modules`** y lo
dejaba en el bundle, y la app lo comparaba al iniciar. Eso detectaba un cambio **después** del build. No
había ningún hash revisado en el repo: un binario nuevo que llegaba con una actualización se aceptaba
solo. Lo único que fijaba su contenido era la integridad del tarball en `package-lock.json`, y Dependabot
la actualiza sola.

Lo mostró el PR de Dependabot de `argon2` 0.45.1 → 0.45.2: el CI pasó aunque el `.node` de Windows x64
cambió. Además, el CI corre en Linux y solo miraba el binario de Linux, que esta vez no había cambiado.

## Decisión

1. **Un registro revisado:** `scripts/nativos-hashes.json` guarda el SHA-256 de cada `.node` de cada
   plataforma que traen los paquetes, por versión. Se registra a mano, después de revisar la versión
   (`node scripts/verificar-nativos.mjs --calcular` imprime los hashes de lo instalado), y el commit
   dice qué se revisó.
2. **El CI y `npm run check`** corren `npm run nativos:verificar`: todo lo instalado, de todas las
   plataformas, tiene que coincidir con el registro. Falla con una versión sin registrar, un binario de
   más, uno registrado que falta o un hash distinto. Así, el CI de Linux también ve un cambio en el
   binario de Windows, y un PR que cambia un binario falla hasta que alguien lo revisa y lo registra.
3. **El CI verifica las firmas de npm** (`npm audit signatures`): la firma del registro y la procedencia
   de cada paquete instalado.
4. **El build** (`electron.vite.config.ts`) usa `manifiestoRegistrado`: verifica lo mismo que el script, y
   falla si algo no coincide o si su plataforma no tiene binarios registrados. Lo que deja en el bundle
   es el **valor registrado**, no el calculado del disco.
5. **Al iniciar**, `verificarNativos` compara cada archivo con ese valor **antes de cargarlo**. Por eso
   `boveda/servicio` se importa de forma dinámica, y un test comprueba que `index.ts` solo tenga un import
   de tipos de él. Si un archivo falta o no coincide, o el manifiesto está vacío, QAtlas muestra un error
   y sale sin ejecutar nada.

Los mensajes del script y del build no llevan rutas: el log del CI es público.

## Qué garantiza ahora

- Un binario nativo entra a la app solo si su hash fue revisado y registrado en el repo.
- El cambio de un binario en una actualización, en cualquier plataforma, frena el CI hasta revisarlo.
- La app instalada desde un build de CI no carga un `.node` distinto del registrado.

## Qué queda para la semana 10

- **Firma y fuses.** El manifiesto está protegido solo si el asar está validado (fuses activos) y el
  ejecutable firmado. Hasta entonces, quien puede modificar los archivos de la app instalada también puede
  modificar el manifiesto: se detectan la corrupción y las manipulaciones parciales.
- **`asarUnpack` y la verificación sobre el binario final**, cuando se elija el empaquetador
  ([ADR 001](001-electron-vite.md)). `rutaFueraDelAsar` ya resuelve esas rutas.
- **Compilar SQLCipher desde fuente** para los instaladores (ADR 006). Ese binario se registra igual.

## Tradeoffs

- **Revisar es humano.** El registro no dice si un binario es bueno, sino que alguien lo revisó. La
  revisión compara el binario con el anterior, mira qué cambió en el paquete y su procedencia.
- **Ventana entre verificar y cargar:** alguien podría cambiar el archivo en ese instante. Quien puede
  hacerlo ya tiene control del equipo, que está fuera del alcance (3.1).
- **Costo:** leer y calcular el hash de pocos archivos al iniciar, y de todos los de `prebuilds/` en el
  CI y en el build.

## Verificación

- `security-tests/nativos-registro.test.ts`: sobre una copia de los paquetes, un byte cambiado en un
  `.node` hace fallar el script (por línea de comandos), el build (`manifiestoRegistrado`) y la app
  (contra el valor registrado). El binario de otra plataforma también se detecta, igual que una versión
  sin registrar, un binario de más y uno que falta. Al restaurar, todo vuelve a pasar.
- `security-tests/nativos-integridad.test.ts`: binario modificado, faltante, paquete inexistente,
  manifiesto vacío y orden de carga.
- El E2E confirma que la app arranca con los binarios reales.
