# 038 — Retención de las evidencias y modo datos sensibles

- **Estado:** aceptada
- **Fecha:** 2026-11-08

## Decisión

**Retención (EVI-06).**

- Es una configuración de la bóveda (`retencionDias`): 90 días por defecto, de 1 a 3650. Se cambia en
  Bóveda, y el cambio queda en la auditoría sin el valor.
- Corre al desbloquear, antes de mostrar nada: lo creado antes del corte se elimina con borrado
  criptográfico. Primero se borran las filas con sus semillas (ADR 035) y después los archivos.
- Queda una fila de auditoría por proyecto, con la cantidad.
- **La excepción de los reportes está preparada:** `evidenciasEnReportes(base)` devuelve las evidencias
  de hallazgos incluidos en reportes, y la retención no las toca. Hoy devuelve un conjunto vacío, porque
  los reportes llegan en la semana 9; ahí se completa sin cambiar nada más.

**Restos.** Al desbloquear, y después de eliminar un proyecto, se borra todo archivo de la carpeta de
evidencias que no tenga fila (una ejecución cortada, un tramo descartado, un proyecto eliminado). Es
ilegible, porque su semilla no está, y se borra igual. Nunca se toca lo que una ejecución en curso está
escribiendo.

**Modo datos sensibles (EVI-05).**

- Es una opción del proyecto, auditada como las demás.
- Con el modo activo: sin video, sin snapshots del DOM, y todos los campos de formulario tapados en las
  capturas.
- **f6: al activarlo**, la interfaz cuenta los videos y los snapshots que ya existen y ofrece dos
  opciones:
  - eliminarlos con borrado criptográfico, con una confirmación;
  - conservarlos como están.
- Las dos opciones quedan en la auditoría (`evidencias.modo-sensible-eliminar` o
  `evidencias.modo-sensible-conservar`), solo con la cantidad.

## Verificación

- `apps/desktop/src/main/evidencias/servicio.test.ts`: la retención a los 89 y a los 91 días, con los días
  de la bóveda y su auditoría; eliminar y conservar.
- `security-tests/ts-10-evidencias.test.ts`: lo eliminado no se descifra.
- `e2e/evidencias-app.e2e.ts`: el aviso de f6, conservar, y eliminar con confirmación, en la app real.
