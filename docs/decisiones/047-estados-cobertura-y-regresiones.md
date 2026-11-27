# 047 — Estados, cobertura y regresiones

- **Estado:** aceptada
- **Fecha:** 2026-11-27

## Contexto

La 5.1 y la 5.2 definen qué pasa con un hallazgo entre ejecuciones; la 6.4 pide comparar ejecuciones, la 6.5
una bandeja, y CU-09 detectar una regresión. El criterio de terminado de la fase 1 es «un bug reintroducido se
detecta como regresión». Varias cosas no cerraban en la especificación: ver «Lo que no cerraba».

## Decisión

### Siete estados, y la aparición en cada ocurrencia

- El hallazgo tiene uno de los siete estados de la 5.2: nuevo, confirmado, descartado, reportado,
  posiblemente_resuelto, resuelto y regresion.
- **«Recurrente» no es un estado:** es la **aparición** de una ocurrencia (`nueva`, `recurrente` o
  `regresion`). Así, un hallazgo confirmado o reportado que vuelve a aparecer no pierde la decisión de nadie.
- Las transiciones son funciones puras (`main/hallazgos/estados.ts`):
  - **Regresión solo desde «resuelto»**, con alerta.
  - Un **posiblemente resuelto** que vuelve recupera el estado que tenía, y la aparición es recurrente.
  - Un **descartado** que vuelve registra la ocurrencia sin alerta y sigue descartado (CU-04 3a); la bandeja lo
    oculta salvo que se pida. Se puede **reabrir a mano** (vuelve a «nuevo»).
  - **Resuelto lo decide la persona** («confirmado como corregido», 5.2), también en lote desde el filtro
    «posiblemente resueltos». Un chequeo que oscila, como el LCP, daría regresiones falsas si se resolviera solo.
  - La **severidad cambiada a mano** no la pisa una aparición nueva.

### Cobertura: lo que no se recorrió no se da por arreglado

Al terminar un escaneo, un hallazgo abierto que no apareció pasa a «posiblemente resuelto» solo si la ejecución
**analizó una página de la misma forma** que alguna donde apareció en su última ejecución, **con el mismo
contexto**: las dos sin login, o la misma credencial y el mismo rol. Las fallidas y las canceladas no mueven
estados; en una cortada por un límite, cuentan solo las páginas analizadas. `cubierto_en` guarda la última vez
que una ejecución lo cubrió, y la bandeja marca «sin cobertura» lo abierto que la última ejecución del proyecto no
recorrió.

### Decisiones de la persona

- **Descartar** pide un motivo: es texto de la persona y puede tener datos del sitio, así que se guarda
  **cifrado con la clave del proyecto** y se descifra solo para mostrarlo en el detalle. Al reabrir, se borra.
- Cada decisión (confirmar, descartar, resolver, reabrir, severidad, lote) queda en la **auditoría solo con IDs
  y nombres de campos** (ADR 015).

### La alerta de CU-09, solo dentro de la app

La regresión se destaca en el resumen de la ejecución, en la lista de ejecuciones y arriba de la bandeja. La
notificación del sistema es del módulo PRG (fase 3): el centro de notificaciones guarda lo que muestra, así que
cuando llegue, va con un texto genérico.

### Comparar dos ejecuciones

Del mismo proyecto, terminadas, en orden (la que empezó antes es la anterior): **nuevos** (en la posterior y no en
la anterior), **recurrentes**, **regresiones** (aparición `regresion` en la posterior), **resueltos** (estaban, y
la posterior los cubrió) y **no cubiertos** (estaban, y la posterior no recorrió su página). No descifra nada.

### Lo guardado antes de la semana 8

Al abrir la base, después de la redacción de lo guardado (ADR 033), proyecto por proyecto y en una transacción:
se recalcula la clave de cada mensaje con la normalización v2 (descifrando el detalle ya redactado), se calcula
la huella y los duplicados se **fusionan en el más antiguo**, con sus ocurrencias (la primera queda `nueva`, las
demás `recurrente`). Si tenían estados distintos, **gana la última decisión de una persona** sobre los estados
automáticos. La fusión queda en la auditoría con IDs y cantidad. Idempotente (`proyecto.huellas_version`); un
corte deja el proyecto como estaba.

### Bandeja y páginas

Hallazgos (la bandeja, de un proyecto o de todos, con filtros y agrupación, incluida «mismo problema en varias
páginas»: igual tipo y clave en distintas formas, con en cuántas páginas aparece), Ejecuciones (todas, y
comparar) y Escaneos (lanzar y los últimos). La bandeja nunca recibe la huella, la clave, el detalle ni el
motivo: el grupo es un hash corto de tipo y clave.

### sandbox-site: arreglar y reintroducir

`sitio.arreglar(id)` y `sitio.reintroducir(id)`, por el ID del oráculo (`ARREGLABLES`), **desde el proceso del
test**: no hay endpoint HTTP que el crawler pueda encontrar ni tocar. Un ID que no se puede arreglar falla.

## Lo que no cerraba en la especificación

- La 5.2 tiene siete estados sin «recurrente», que aparece en la 5.1: es la aparición.
- CU-09 está en la sección de fases 2 a 4, pero el anexo C lo pone en la fase 1, y pide una notificación local
  del módulo PRG (fase 3): alerta dentro de la app.
- «La última ejecución que lo cubría» no decía qué pasa con los roles ni con las ejecuciones cortadas.
- «Descartado: no se vuelve a alertar» no decía si se registra la ocurrencia: se registra sin alerta.

## Verificación

- `main/hallazgos/estados.test.ts` y `cobertura.test.ts`: cada transición, la cobertura por forma y contexto, con
  controles (ningún otro estado da regresión; otra página u otro contexto no cubren).
- `main/ejecuciones/ejecuciones.test.ts`: el ciclo entre ejecuciones con el runner simulado, las decisiones (el
  motivo no aparece en claro en ninguna fila; auditoría con IDs y campos), el lote, la severidad manual, la
  bandeja y la comparación.
- `main/hallazgos/huellas-guardadas.test.ts`: la fusión, la regla de la última decisión, la auditoría, la
  idempotencia y el corte.
- `security-tests/ts-08-ipc.test.ts`: filtros y acciones como listas cerradas; la bandeja no devuelve huella,
  clave, detalle ni motivo; los canales quedan bloqueados con la bóveda bloqueada.
- `e2e/regresiones.e2e.ts`: el criterio de la fase 1 con la app, el escáner y el sandbox reales, con los dos
  controles (arreglado pero sin recorrer su página no queda posiblemente resuelto; sin reintroducirlo no hay
  regresión), y axe en las tres páginas nuevas en los dos modos.
