---
name: diagnostico-ci
description: Diagnosticar y corregir una falla del CI o un test inestable de QAtlas. Usala cuando la autora pegue un log del CI, cuando un test falle o pase "a veces", o cuando aparezca un error que no se reproduce en local.
---

# Diagnóstico de una falla del CI

En QAtlas un test que falla "a veces" es un error, no mala suerte. Esta skill junta lo que aprendimos con cada falla.

## 1. Juntar la evidencia

- El log que pega la autora: el error, el test, y si falló también en el reintento.
- Los artifacts (captura, `error-context.md`, traza, `procesos-y-memoria.txt`): no los podés bajar; la autora los copia en `.artefactos/`.
- Qué cambió desde la última corrida en verde: commits, dependencias, versión de Chromium o de Electron.

## 2. Clasificar

- **Infraestructura** (un 504 al descargar, el registro de npm, la caché del CI): pasa antes de los tests. Reintentar está bien, y si se repite se investiga.
- **Un test que falla siempre**: un error del código o del test.
- **Un test inestable** (falla y después pasa): **nunca** se resuelve reintentando ni aflojando la aserción. `failOnFlakyTests` lo frena a propósito.

## 3. Reproducir

- `npm run test:e2e:area -- <patrón>` y, para inestables, `npm run test:e2e:area -- <patrón> --repeat-each=10 --retries=0`. El patrón es el nombre del archivo sin `e2e/` ni `.e2e.ts` (`fugas-udp-tls`, no la ruta), y suma el smoke.
- En Windows, un patrón con `|` se rompe al pasar por `npm run` (cmd): llamá directo a `node scripts/e2e-area.mjs "a|b"`.
- Si no se reproduce en local, agregá diagnóstico que el CI imprima la próxima vez (sin rutas ni datos de la máquina).
- Separá siempre **comprobado** de **supuesto**. Descartá hipótesis con datos.

## 4. Causas que ya encontramos

Revisalas antes de inventar una nueva:

- **Tiempos:** actuar antes de una señal (un `kill` antes de que la ejecución estuviera en curso; mirar antes de que llegue la respuesta).
- **Leer lo anterior:** "la última" fila, conexión o ejecución era la de otra corrida.
- **Pasar por la razón equivocada:** el texto buscado aparecía en otro lado; el OCR no leía la imagen; la contraseña se veía como puntos.
- **Limpieza tardía:** se declaraba "terminado" antes de que el navegador o el runner cerraran.
- **Playwright sin límite de tiempo:** `close`, `newPage` o `isVisible` colgados.
- **Navegador distinto:** un `launch` sin la ruta verificada o sin `opcionesChromium`; un segundo `--disable-features` que pisa al de Playwright.
- **Entorno:** una variable restaurada como el texto `"undefined"`; `DISPLAY` ausente en Linux; Linux sin GPU; fuentes distintas en Linux.
- **Linux:** la ruta de un socket Unix de más de 107 bytes.
- **Windows:** PID reutilizados (identificar por PID y hora de creación); el foco de la ventana; el firewall avisando por un socket en escucha.
- **Memoria:** la máquina local al límite (mirar `procesos-y-memoria.txt` y que no queden procesos vivos).
- **Caché:** una respuesta incompleta guardada (npm, por ejemplo) que hace fallar cada reintento.
- **Concurrencia en la app:** un evento que llega en medio de otra operación (el inspector de `app.evaluate` no es un evento real).

## 5. Corregir

- Si el error es de la **app**, se corrige la app, no solo el test.
- El test queda determinístico: señal en vez de tiempo, identidad en vez de posición, control positivo y testigo.
- Un test nuevo que **falle con el código viejo** y pase con el nuevo.
- Un control de seguridad nunca se afloja para que el CI pase. Si algo no tiene solución hoy, se marca `test.fail` con explicación, ADR y fecha o semana de solución, y se agrega otro test que verifique que lo ya cerrado sigue cerrado.
- Revisá si el mismo patrón está en otros tests y corregilos también.

## 6. Entregar

- Commit aparte, con la causa en el mensaje.
- Resumen corto para la autora, sin tablas: causa (comprobada o supuesta), corrección, test nuevo, qué falta confirmar en el CI, y el texto para sumar a la descripción del PR.
