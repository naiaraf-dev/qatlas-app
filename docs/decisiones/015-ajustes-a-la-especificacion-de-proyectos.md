# 015 — Lo que no cerraba en la especificación de proyectos

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Modelo de datos

- **`proyecto`:** faltaban `descripcion`, `max_profundidad` y `timeout_pagina_segundos`. Se suman
  `nombre_normalizado`, `sistema_interno` y `permitir_login_http`.
- **`autorizacion`:** faltaba el alcance aceptado. Se suman `url_base_aceptada`, `dominios_aceptados`,
  `sistema_interno_aceptado` e `invalidada_en`.
- **`credencial`:** se suma `secreto_actualizado_en`.
- **Valores por defecto:** no estaban definidos. 2 solicitudes por segundo, 200 páginas, profundidad 5 y 30
  segundos por página.
- **Nombres únicos** sin distinguir mayúsculas, también con acentos: confirmar un borrado escribiendo el nombre
  no puede ser ambiguo.

## Auditoría y borrado

SEG-07 pide registrar «contra qué URL», pero una URL en la auditoría sobreviviría al borrado criptográfico del
proyecto.

**Decisión:** la auditoría guarda **solo IDs y nombres de campos**, y las acciones son una lista cerrada. Nunca
secretos, valores, nombres ni URLs. La URL de cada ejecución va en `ejecucion`, que es una tabla de proyecto y se
purga (semana 5). Después de eliminar un proyecto queda el rastro con su UUID.

Activar o desactivar `sistemaInterno`, `permitirLoginHttp`, `soloLectura` y `modoDatosSensibles` se registra aparte,
con su sentido (`opcion.activar`, `opcion.desactivar`), porque relajar un control tiene que quedar registrado
(principio 3.3).

**Límite:** la auditoría vive en la base cifrada, pero no es a prueba de manipulación: quien tenga la bóveda
abierta puede modificarla. Su pantalla llega con el panel de privacidad.

## Eliminar

Un borrado se puede cortar. La lápida, el borrado de filas y la auditoría van en una transacción. VACUUM no puede
ir dentro, así que se ejecuta después y, si no llegó a correr, se reintenta al desbloquear:
`completarBorradosPendientes` termina también un borrado con lápida y filas pendientes.

`purgarConLapida` borra primero `TABLAS_DE_PROYECTO` y al final la fila de `proyecto`, que tiene la clave. Un test
verifica que toda tabla con `proyecto_id` esté en esa lista.

## Canales

Se suman a la sección 9:

- `proyectos:obtener`, para el detalle.
- `proyectos:validar`, para mostrar los errores antes del último paso del asistente. No guarda nada.
- `credenciales:eliminar`: sin él, una credencial equivocada no se podría borrar nunca.

`credenciales:probarLogin` se registra en la semana 5, con el runner. El botón queda visible y deshabilitado.

Los canales `proyectos:*` y `credenciales:*` no están en `CANALES_SIN_BOVEDA`, así que la bóveda bloqueada los
rechaza. TS-08 lo verifica.

Las reglas de dominios y credenciales están en las [ADR 011](011-validacion-de-dominios.md) y
[013](013-cifrado-de-credenciales.md).
