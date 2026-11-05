# 023 — Cómo se guardan los hallazgos hasta la semana 8

- **Estado:** aceptada
- **Fecha:** 2026-11-05

## Contexto

La sección 5 define `hallazgo` por proyecto, con huella, estados y primera y última aparición. La huella, la fusión
y las regresiones son de la semana 8. La redacción es de la semana 7, y un mensaje de consola o un selector pueden
traer datos de la página.

## Decisión

- **Dos tablas desde ahora,** para no rehacerlas:
  - `hallazgo`: la identidad, por proyecto, con las columnas de la especificación. Esta semana una por aparición, con
    `huella` vacía y estado `nuevo`.
  - `hallazgo_ocurrencia`: cada aparición en una ejecución, con su URL, la página de origen y su detalle.
- **`clave`:** lo que identifica el problema en su página (regla de axe, código HTTP, nombre de cookie, host). Para un
  mensaje de consola o una excepción, un hash del mensaje normalizado sin números ni IDs: el texto es de la página y
  no queda en claro. Lo encontró el test del oráculo. La semana 8 calcula la huella con tipo, URL y clave, y fusiona sin volver
  a escanear.
- **En claro:** tipo, severidad, un título genérico y la URL sin query.
- **Cifrado con la clave del proyecto:** el detalle (mensaje de consola o de excepción, selectores, URL del recurso)
  y la URL completa de una página con query. Si el proyecto se elimina, queda ilegible (ADR 009). Se descifra solo
  para mostrarlo en la pantalla de la ejecución.
- **`pagina_visitada`:** una fila por página analizada, con estado, tiempo de carga y profundidad.

## Consecuencias

- La semana 8 agrega la fusión y las transiciones de estado sin cambiar estas tablas.
- Hasta la semana 7, el detalle se guarda sin redactar, cifrado. No sale de la app: no hay exportación todavía.
- Las tres tablas tienen `proyecto_id` y están en `TABLAS_DE_PROYECTO`: se purgan con el proyecto.

## Verificación

`apps/desktop/src/main/ejecuciones/ejecuciones.test.ts`: el detalle y la query no aparecen en ninguna fila en claro,
se muestran descifrados y se purgan con el proyecto.
