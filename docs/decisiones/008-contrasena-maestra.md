# 008 — Validación de la contraseña maestra con zxcvbn-ts

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

RN-BOV-01 pide al menos 12 caracteres, un medidor de fortaleza y verificación contra una lista local
de contraseñas comunes. Todo tiene que ir empaquetado: sin descargas.

## Opciones

| Opción                       | Tamaño sin comprimir | Motivo                                                       |
| ---------------------------- | -------------------- | ------------------------------------------------------------ |
| **`@zxcvbn-ts`, común + es** | Unos 6,3 MB          | **Elegida.** Lista común, patrones de teclado y español      |
| SecLists 10 mil + reglas     | Unos 75 KB           | Más liviana, pero las reglas propias miden peor la fortaleza |
| `zxcvbn` original            | —                    | Sin mantenimiento: la última versión es la 4.4.2             |

## Decisión

`@zxcvbn-ts/core` 4.2.0, `@zxcvbn-ts/language-common` 4.1.3 y `@zxcvbn-ts/language-es-es` 4.1.2, con
versión exacta. Licencia MIT, sin scripts de instalación. Suman dos dependencias chicas:
`fastest-levenshtein` y `@zxcvbn-ts/dictionary-compression`.

Una contraseña se acepta solo si cumple todo:

- 12 caracteres o más, contados como caracteres y no como unidades UTF-16.
- No coincide completa con una entrada de `passwords-common`.
- Puntaje de 3 o más, de un máximo de 4.

El medidor corre en la interfaz, porque evaluar en cada tecla enviaría la contraseña por IPC muchas
veces. El proceso principal repite la validación y es quien decide: un renderer comprometido no puede
crear una bóveda con una contraseña débil.

Vive en el subpaquete `@qatlas/shared/contrasena`, y la interfaz lo carga con `import()` solo en el
primer inicio (1,3 MB en un archivo aparte, sin red).

## Consecuencias

- **La lista no se actualiza sola:** cambia con cada versión de QAtlas. No puede haber descargas.
- **El puntaje es una estimación**, no una garantía: una frase famosa puede puntuar alto.
- **Un error que encontró el test:** el diccionario se llama `passwords-common`, no `passwords`. Al
  actualizar el paquete hay que confirmar que siga llamándose así; el test de motivo `comun` falla si
  cambia.
