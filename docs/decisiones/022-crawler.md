# 022 — El crawler: qué recorre, qué toca y qué informa que no cubrió

- **Estado:** aceptada
- **Fecha:** 2026-11-05

## Decisión

### Qué recorre

- **En anchura,** desde la URL base, dentro de los dominios del proyecto (RN-ESC-01), con profundidad, máximo de
  páginas, tiempo máximo (RN-ESC-05) y exclusiones (RN-ESC-03).
- **Descubre** `a[href]` y `area[href]`, también los que aparecen después de esperar la red inactiva, con un límite
  de 5 segundos.
- **Una redirección dentro del alcance** cuenta como la página donde termina: se analiza una vez, con sus hallazgos
  ahí. Si la navegación falla, la URL es la pedida, no la que quedó en la pestaña.

### RN-ESC-04: cada URL una vez

Normalización: sin fragmento, sin usuario ni contraseña, host en minúsculas, sin el puerto por defecto, parámetros
ordenados por nombre y valor, y sin barra final salvo en la raíz. Como máximo 2048 caracteres.

**Trampas de URLs infinitas:** como máximo 20 variantes de query por ruta y 10 rutas por forma. La forma reemplaza
los segmentos con números: `/calendario/2026/11` es `/calendario/#/#`. Lo descartado se cuenta.

### Qué toca (TS-05)

- **Con solo lectura, ningún clic.** Los botones se cuentan como cobertura no alcanzada.
- **Sin solo lectura,** se clickean de a uno los botones que no envían un formulario y que no coinciden con una
  exclusión. La exclusión se busca en el texto, `aria-label`, `id`, `name`, `title` y `data-testid`. Hasta 10 por
  página: si cambia la URL, la ruta nueva entra a la cola y se vuelve.
- **Un botón que envía un formulario nunca se toca,** aun sin solo lectura.

### Solo lectura y WebSocket

Solo lectura cortaba las escrituras HTTP, pero un WebSocket permitido dejaba pasar lo que la página mandaba: era un
hueco de la semana 5. Ahora, en solo lectura, los mensajes salientes de la página se descartan, y el resumen dice
cuántos, para que no parezca un error del sitio. Lo que el servidor manda sigue llegando. Puede romper un sitio que
dependa de WebSocket: en solo lectura se prefiere eso.

### Límite de requests por segundo

Se aplica a navegaciones y clics, no a los subrecursos que pide cada página: limitarlos rompería las páginas.

### Lo que informa que no cubrió

El resumen de la ejecución dice:

- Si se detuvo por el máximo de páginas o por el tiempo máximo, con páginas sin recorrer.
- Cuántos botones no se tocaron por solo lectura.
- Cuántos links o botones coincidieron con una exclusión.
- Cuántas URLs se descartaron por parecer infinitas.
- Cuántos mensajes de WebSocket se descartaron por solo lectura.

### Tiempo máximo

No existía por proyecto: se suma `max_minutos`, por defecto 30. No cambia el alcance, así que no invalida la
autorización. Queda en la auditoría como cualquier campo.

## Para después

- Rutas declaradas por el router de una SPA, sin clics.
- `sitemap.xml` y `robots.txt` como fuentes de rutas.
- Formularios de búsqueda: hoy no se completan ni se envían.
- Iframes del mismo origen.
- Escaneo autenticado, con el login real: rama 6b.

## Verificación

`packages/runner/src/motor/urls.test.ts` y `e2e/contencion.e2e.ts` (TS-05 con sus controles: sin solo lectura y sin
exclusiones, los botones de la SPA escriben y el WebSocket llega).
