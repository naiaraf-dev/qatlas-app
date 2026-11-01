# 016 — Proxy de salida propio, en su propio proceso

- **Estado:** aceptada
- **Fecha:** 2026-11-01

## Contexto

La sección 3.5 pide que todo el tráfico del navegador de pruebas pase por un proxy local que solo permita los
dominios del proyecto. Hay que resolver DNS y conectarse a la IP ya validada, y eso tiene que estar bajo control.

## Opciones

| Opción                       | Motivo                                                                    |
| ---------------------------- | ------------------------------------------------------------------------- |
| **`node:http` y `node:net`** | **Elegida.** Sin dependencias, y el control del DNS es nuestro            |
| `proxy-chain` 3.0.1          | Activo, pero suma `socks`, `socks-proxy-agent` y `tslib`, que no se usan  |
| `http-proxy` 1.18.1          | Arrastra `follow-redirects`: seguir redirecciones es lo que no debe hacer |
| `http-proxy-middleware`      | Pensado para un servidor web. Cuatro dependencias directas más `httpxy`   |

**Tradeoff aceptado:** el código y sus errores son nuestros. Por eso las reglas son funciones puras, con los
bordes de cada rango probados.

## Decisión

- **Su propio `utilityProcess`,** sin claves ni base. Separado del runner, para que un error del motor de pruebas
  no pueda cambiar la lista. Si se cae, su evento de salida aborta la ejecución.
- **Solo en 127.0.0.1, en un puerto que elige el sistema,** con una credencial por ejecución. «De un solo uso»
  significa una por ejecución, no una por conexión: Chromium la manda en cada una. Termina con el proxy.
- **Un primer intento sin credencial no se registra:** Chromium siempre empieza así. Una credencial incorrecta sí.
- **HTTPS por CONNECT, sin interceptar:** decide por el host del CONNECT y no ve nada de lo que viaja adentro.
- **No sigue redirecciones:** cada salto es otra solicitud del navegador, y se decide igual.
- **Un Upgrade directo se rechaza:** Chromium abre los WebSockets con CONNECT.

### Reglas

1. El nombre tiene que estar en la lista, antes de tocar el DNS. Una fuga nunca llega a resolverse.
2. Se resuelve **una vez**, y se conecta a una de esas IPs, nunca al nombre. `localhost` y una IP literal no pasan
   por el DNS.
3. Se validan **todas** las IPs de la respuesta: una sola prohibida bloquea el nombre completo, porque quien controla
   el DNS elige cuál se usa.
   - **Link-local y el resto de lo reservado:** rechazadas siempre, aun con Sistema interno (ADR 011).
   - **Loopback:** solo para `localhost`, `127.0.0.1` y `.test`.
   - **Privadas:** solo con Sistema interno y el host exacto en la lista. Un comodín no alcanza.
4. **Puertos locales:** los declarados en el proyecto, con el de la URL base incluido si su host es local. Cambiarlos
   cambia el alcance: queda en la auditoría e invalida la autorización. Esto reemplaza lo que decía la ADR 011: solo
   el puerto de la URL base no sirve para un frontend en 5173 con su API en 3000.
5. **Hosts no locales:** 80, 443 y el puerto explícito de la URL base, si tiene.
6. **El puerto del propio proxy:** bloqueado siempre, aunque esté declarado.

### Declaración de autorización

Los puertos extra se muestran junto a los dominios. Sin puertos extra, el texto v1 no cambia y las aceptaciones
siguen valiendo.

### Monitor de conexiones

`conexion` guarda solo `host:puerto`, nunca rutas: pueden traer tokens. Tiene `proyecto_id`, y se purga con el
proyecto. El resumen cuenta todo, pero se guardan hasta 2000 filas por ejecución: un sitio que martilla no puede llenar
la base. Los mensajes de dos procesos no llegan en orden, así que una conexión posterior al «terminé» se guarda igual.

### `--host-resolver-rules`

Comprobado en un navegador real: con proxy, Chromium le manda el nombre sin resolverlo, así que esa regla no hace nada.
Por eso la app no la pasa. Los tests la usan solo como **control positivo**: sin proxy, cada fuga llega al sandbox. Sin
ese control, «no llegó nada» también podría querer decir que nunca iba a llegar. En el proxy, los dominios de prueba
los resuelve un resolvedor inyectado.

### Ruido del propio Chromium

Medido en la versión instalada: en cada navegación se conecta a su buscador por defecto (`PreconnectToSearch`), y al ver
un formulario, al servicio de autocompletar (`AutofillServerCommunication`). El proxy los bloqueaba, pero llenaban el
monitor con destinos que el sitio nunca pidió. Se apagan por argumento, y un E2E verifica que no aparezca ningún destino
inesperado. Una versión nueva de Chromium puede traer otro: el proxy lo va a bloquear y ese test lo va a mostrar.

## Límites

- **Domain fronting:** dentro de un túnel permitido se puede hablar con otro host. Verlo exigiría interceptar TLS.
- **TS-03 no es una captura del sistema:** observa los sockets del proceso principal y lo que recibe el servidor de
  prueba. **Pendiente:** correr el E2E del CI de Linux dentro de un network namespace sin salida.
- **WebRTC y QUIC** se apagan por argumento, sin un test con navegador real que lo pruebe.
- Con HTTPS, la regla decide si se abre el túnel, y nada más. Solo lectura lo controla la segunda capa, en el navegador.

## Verificación

`packages/runner/src/red/*.test.ts`, sin DNS real ni internet. `e2e/contencion.e2e.ts`, en un navegador real contra el
sandbox, que confirma desde su lado que no le llegó ninguna fuga. `e2e/ejecuciones.e2e.ts`, en la app real.
