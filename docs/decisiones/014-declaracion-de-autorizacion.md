# 014 — Declaración de autorización y su versionado

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Texto, versión 1

> Declaración de autorización
>
> Declaro que:
>
> 1. Soy titular de este sistema o cuento con autorización de quien lo es para probarlo, y esa autorización
>    cubre las pruebas que voy a ejecutar.
> 2. El alcance se limita a esta URL base y estos dominios: {url_base} · {dominios}.
> 3. Entiendo que QAtlas navega y envía solicitudes automáticas, y que eso puede generar carga, registros o
>    cambios de datos, aun en modo solo lectura.
> 4. Voy a respetar los límites y las políticas de uso del sistema. QAtlas no verifica esta autorización: la
>    responsabilidad de contar con ella es mía.
>
> Esta aceptación se guarda solo en este equipo.

## Decisión

- **Inmutable:** el texto es una constante en `packages/shared/src/declaracion.ts`, y un test congela su hash.
  Un cambio de fondo es una versión nueva, que obliga a aceptar de nuevo en todos los proyectos.
- **Qué se guarda:** una fila por aceptación con el texto completo, la versión, la fecha, la URL base, los
  dominios y la opción Sistema interno. Solo se le agrega `invalidada_en` si después cambia el alcance.
- **Lo aceptado es lo mostrado:** la interfaz manda el texto que vio, y el proceso principal lo compara con el
  que corresponde al alcance que se guarda. Si no coinciden, no se crea nada.
- **Interfaz:** la casilla arranca sin marcar y el botón queda deshabilitado hasta marcarla. Cambiar un dato del
  asistente la desmarca.
- **Atómico (CU-01):** el proyecto, su clave y la aceptación se crean en una transacción. Sin aceptación no hay
  proyecto.

## Vigencia

`verificarAutorizacion` es la función que usa el runner de la semana 5, y falla cerrado:

| Situación                                          | Resultado          |
| -------------------------------------------------- | ------------------ |
| Sin aceptación, o proyecto inexistente             | `sin-aceptar`      |
| Aceptada con otra versión de la declaración        | `version-anterior` |
| Cambió la URL base, los dominios o Sistema interno | `alcance-cambiado` |
| Volver al alcance anterior después de invalidarla  | `alcance-cambiado` |

Volver atrás no la revive: RN-PRY-03 exige aceptar de nuevo. Por eso hay una marca, además de la comparación del
alcance, que sigue como segunda capa.

## Consecuencias

- La declaración es una afirmación de quien la acepta: QAtlas no puede verificarla. SEG-06, opcional, llega en
  la fase 4.
- Cambiar el nombre, los límites, las exclusiones o el login en http no la invalida. Cambiar solo lectura
  tampoco, porque el texto ya dice «aun en modo solo lectura»; queda en la auditoría.
