# 017 — Qué aísla el runner y qué no

- **Estado:** aceptada
- **Fecha:** 2026-11-01

## Contexto

La sección 3.7 pide correr Playwright en un `utilityProcess`, sin acceso a las claves. Hacía falta saber qué significa
eso de verdad, y cómo pasarle el secreto de una credencial.

## Medido en un `utilityProcess` real

- **Puede:** leer y escribir archivos del usuario, lanzar procesos y abrir sockets. También tiene `electron.net`.
- **`--permission` por `execArgv`:** no tiene efecto.
- **Entorno:** hereda el del principal, salvo que se le pase uno explícito.
- **Un entorno mínimo sin `SystemRoot`:** los sockets fallan en Windows.
- **Playwright funciona** dentro de uno, con entorno mínimo.

Es separación de memoria, **no un sandbox del sistema operativo**.

## Decisión

- **Contra qué protege:** el runner es código propio. Lo no confiable es el sitio probado, que corre en el sandbox
  de Chromium. El detalle, capa por capa, está en el [modelo de amenazas](../modelo-de-amenazas.md).
- **Sandbox de Chromium encendido.** Playwright lo trae apagado. Un test mira la línea de comando real del renderer,
  y su control muestra que lo vería si se apagara. En el CI de Linux hace falta permitir los espacios de nombres sin
  privilegios, que Ubuntu 24.04 restringe: se ajusta la máquina del CI, nunca se apaga el sandbox.
- **Un runner por ejecución,** que termina al final. Es la única limpieza real de su memoria.
- **Entorno cerrado:** una lista explícita de variables. `stdio: 'ignore'`, y el directorio de trabajo dentro del perfil.
- **Sin claves por construcción:** el mensaje tiene un esquema estricto, sin lugar para ellas, y el paquete no depende
  de `@qatlas/crypto` ni de `@qatlas/db`. Un test lo verifica.
- **Sin red propia:** Playwright habla con Chromium por un pipe. El agente de Node niega todo, con una lista vacía.
- **Test estático:** el código del motor no puede importar módulos de red, `electron` ni `child_process`, ni usar
  `fetch`. `playwright-core` los usa internamente; nuestro código, no.

### El secreto

1. `usarSecreto` lo descifra, recién con el proxy y el runner en marcha.
2. Viaja por `postMessage`, solo en el mensaje de login. Nunca por entorno, argumentos, archivo ni stdout.
3. En el principal se borran la copia enviada y el original, también si algo falla.
4. En el runner, el arreglo se pone en cero al terminar el login.
5. El proceso termina, y con él lo que quedó en su memoria.

**Límite:** `page.fill` exige un string, que no se puede borrar, y el valor también pasa por la memoria de Chromium.
Dura hasta que terminan los dos procesos.

### Prueba de login

Una contraseña mala nunca puede dar verde. La credencial exige un **indicador de éxito**: la URL coincide con un
patrón, aparece un elemento o desaparece el formulario. Sin indicador, «Probar login» no está disponible.

- **Tiene que estar en falso antes de enviar** y en verdadero después. Si ya se cumplía, no dice nada: da «falló».
- **La URL se compara sin query ni fragmento:** un parámetro no puede hacer que una pantalla de error parezca un éxito.
  El patrón solo admite `*`, sin expresiones regulares, para no abrir un ReDoS.
- **Sin video, traza ni capturas** (EVI-01). Devuelve solo un resultado y un motivo de una lista cerrada, nunca
  contenido de la página. Un error de Playwright puede traer texto de la página: se descarta entero.

**Hasta 3 intentos cada 15 minutos, por credencial.** Cada prueba es un intento real, y uno fallido puede bloquear la
cuenta en el sistema probado: la pantalla lo avisa antes.

- Cuenta el intento recién cuando el secreto sale hacia el runner, y lo registra antes de mandarlo. Lo que falló antes,
  como un proxy que no arrancó, no llegó al sistema.
- También cuentan los exitosos: el límite es simple y no depende de lo que el sistema haga con ellos.
- Vive en la base (`intento_login`): sobrevive a reinicios y bloqueos. Reemplazar el secreto no lo reinicia.
- **Límite:** es por credencial, y eliminarla y crearla de nuevo da una identidad nueva. Una restauración vuelve a los
  intentos de la copia. Protege de un error, no de alguien decidido: es su propia cuenta de prueba. El reloj es el del
  equipo.

**Límite:** un indicador mal elegido, que también aparezca en una pantalla de error distinta del login, puede dar verde.
QAtlas no puede saberlo.

## Consecuencias

- Si alguien ejecutara código dentro del runner, podría leer la bóveda cifrada, sin abrirla, y el secreto del login en
  curso. Se acepta porque ese código es nuestro.
- **Pendiente, fase 3:** los `.spec.ts` importados son código de terceros, y esta suposición deja de valer. Necesitan
  aislamiento a nivel del sistema operativo.

## Verificación

`security-tests/runner-aislamiento.test.ts`, `e2e/contencion.e2e.ts` y, en un `utilityProcess` real,
`e2e/ejecuciones.e2e.ts`. El entorno lo prueba una sonda, no el runner mismo; el runner recibe su entorno de
`entornoMinimo`, con su test propio.
