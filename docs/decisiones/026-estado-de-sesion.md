# 026 — El estado de sesión: en memoria, cifrado y depurado

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Después de un login, el navegador tiene la sesión en sus cookies y su almacenamiento. Para no entrar en cada
escaneo, y para que un login asistido sirva más de una vez, ese estado se guarda. Es una credencial más: quien lo
tiene, entra.

## Decisión

**Se toma en el runner y se depura antes de salir.** Del `storageState` del contexto de login queda solo lo de los
dominios del alcance: las cookies del proveedor de identidad no le sirven al escaneo, y no se guardan. Tampoco queda
ningún valor que contenga el secreto (tal cual, codificado para URL o en base64); en el asistido, lo que la persona
escribió como contraseña (ADR 028); en el enlace, cada parámetro del enlace. Si el sitio guardaba la contraseña así,
es un hallazgo (ADR 029). El estado viaja al proceso principal con un esquema estricto y con límites.

**Solo en memoria, cifrado con la clave del proyecto.** El proceso principal lo cifra con AES-256-GCM y el contexto
`sesion/<proyecto>/<credencial>` en el AAD. Nunca va a la base ni a un archivo. Se descarta:

- al bloquear la bóveda;
- al guardar, reemplazar el secreto o eliminar una credencial del proyecto;
- al cambiar el alcance o eliminar el proyecto;
- a las 12 horas, diga lo que diga el sitio.

**Se reusa con cuidado.** El próximo escaneo con esa credencial recibe el estado y su edad. Si la edad pasa la duración
máxima de la sesión (menos un minuto), ni se prueba. Si no, se confirma antes de usarlo (ADR 027); si no sirve, se
entra. «Probar login» también lo deja guardado: probar un login asistido y después escanear no pide entrar dos veces.

**La duración máxima** es una opción del proyecto, de 2 a 720 minutos. Con ella, el escaneo vuelve a entrar un minuto
antes de que venza.

## Consecuencias

- El estado pasa en claro por la memoria del runner y del proceso principal, el tiempo justo para cifrarlo o usarlo:
  el mismo límite que un secreto (A-23, E-11).
- Cerrar la app pierde las sesiones: el próximo escaneo vuelve a entrar. Es a propósito.
- Lo que un sitio guarde en IndexedDB no se conserva: Playwright no lo incluye por defecto, y no hizo falta.
