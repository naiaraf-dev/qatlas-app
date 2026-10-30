# 007 — Integridad de los módulos nativos fuera del asar

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

Un `.node` no se puede cargar desde dentro del asar: va desempaquetado (`asarUnpack`). La documentación
de Electron no dice que su validación de integridad cubra esos archivos, así que se asume que no. Un
módulo manipulado corre dentro del proceso principal y ve la contraseña y las claves (amenaza A-21).

## Decisión

1. El build (`electron.vite.config.ts`) calcula el SHA-256 de los `.node` de SQLCipher y `argon2` para
   la plataforma, y los deja dentro del bundle del proceso principal, que sí está dentro del asar.
2. Al iniciar, `verificarNativos` compara cada archivo **antes de cargarlo**. Por eso
   `boveda/servicio` se importa de forma dinámica, y un test comprueba que `index.ts` solo tenga un
   import de tipos de él.
3. Si un archivo falta o no coincide, o el manifiesto está vacío, QAtlas muestra un error y sale sin
   ejecutar nada.

`asarUnpack` y la verificación sobre el binario final se hacen en la semana 10, cuando se elija el
empaquetador ([ADR 001](001-electron-vite.md)). `rutaFueraDelAsar` ya resuelve esas rutas.

## Tradeoffs

- **La protección completa llega con la semana 10.** El hash está protegido solo si el asar está
  validado (fuses activos) y el ejecutable firmado. Antes, quien pueda modificar los archivos también
  puede modificar el manifiesto. Hasta entonces detecta corrupción y manipulaciones parciales.
- **Ventana entre verificar y cargar:** alguien podría cambiar el archivo en ese instante. Quien puede
  hacerlo ya tiene control del equipo, que está fuera del alcance (3.1).
- **Costo al iniciar:** leer y calcular el hash de pocos archivos.

## Verificación

`security-tests/nativos-integridad.test.ts` (binario modificado, faltante, paquete inexistente, manifiesto
vacío, orden de carga). El E2E confirma que la app arranca con los binarios reales.
