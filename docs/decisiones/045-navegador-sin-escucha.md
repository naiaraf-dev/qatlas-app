# 045 — El navegador de pruebas no acepta conexiones de la red

- **Estado:** aceptada con brecha conocida (un UDP sin conectar mientras una página usa WebRTC; se cierra
  en la semana 10)
- **Fecha:** 2026-11-27

## Contexto

Durante el E2E, el firewall de Windows avisó que «Google Chrome for Testing» quería aceptar conexiones
entrantes. Se midieron, por PID, los sockets de los procesos de Chromium (`Get-NetTCPConnection` y
`Get-NetUDPEndpoint` en Windows, `/proc/<pid>/net` en Linux):

- Lo provocaba también el navegador **de la app** (`opcionesChromium`, sin controles), no solo los controles
  positivos. Con una página que usa WebRTC ligaba, además de lo de loopback:
  - UDP en el puerto 5353 (mDNS), en `0.0.0.0` o `::`: el responder de `WebRtcHideLocalIpsWithMdns`, que
    reemplaza las IP locales por un nombre `.local` y contesta por él en la red local;
  - UDP en `::`, en un puerto efímero;
  - UDP en `0.0.0.0`, en un puerto efímero.
- Sin WebRTC en la página, nada fuera de loopback. TCP en escucha, nunca.
- **No sale nada:** el receptor UDP del sandbox no recibe paquetes, y WebRTC no da candidatos ni
  direcciones (`fugas-udp-tls.e2e.ts`). Es superficie de **entrada**: un socket ligado a todas las
  interfaces puede recibir paquetes de la red, si el firewall del equipo los deja pasar.

## Lo que se cerró

- **El 5353:** `WebRtcHideLocalIpsWithMdns` apagada (`FUNCIONES_APAGADAS_POR_QATLAS`). La ocultación no hace
  falta: con `disable_non_proxied_udp`, WebRTC no da direcciones, y `fugas-udp-tls.e2e.ts` ya lo probaba sin
  ella.
- **El de `::`:** `--force-fieldtrials=WebRTC-IPv6Default/Disabled/` (`ARGUMENTOS_DE_RED`). Como Chromium se
  queda con el último `--force-fieldtrials`, `opcionesChromium` no lo acepta como argumento suelto.

## La brecha que queda

**Un UDP sin conectar en `0.0.0.0`, en un puerto efímero, mientras una página usa WebRTC.** El CI de Linux
lo mostró así en dos intentos: «local 0.0.0.0 · remoto 0.0.0.0 puerto 0 · estado sin conectar» (puertos
53086 y 38423). No es un sondeo conectado a un destino, como se supuso primero: acepta paquetes de
cualquier interfaz mientras existe.

- **Lo que se probó, sin éxito:** `--force-webrtc-ip-handling-policy`, `--enforce-webrtc-ip-permission-check`,
  `--webrtc-udp-port-range`, apagar la función `WebRtc` y `--disable-blink-features=RTCPeerConnection` (no
  tiene efecto: `RTCPeerConnection` sigue existiendo).
- **Por qué no se apaga WebRTC:** ninguna opción de Chromium lo hace. La única forma desde la app es código
  en el mundo de la página, que la página vería y podría esquivar (ADR 021).

### Por qué el riesgo es acotado

- **Nadie sabe a dónde mandar:** con `disable_non_proxied_udp`, WebRTC no da candidatos ICE, así que ni la
  página ni un par remoto conocen la dirección y el puerto de ese socket.
- **El puerto es al azar** y el socket vive solo mientras la página usa WebRTC.
- **Lo que llegue tiene que pasar la sesión de WebRTC:** ICE descarta los mensajes STUN sin el usuario y la
  contraseña de la sesión (`MESSAGE-INTEGRITY`), y los datos van después por DTLS. Un paquete cualquiera de
  la red se descarta. Esto es lo que dice el protocolo, no algo que pruebe un test de QAtlas.
- **El firewall del equipo** pregunta antes de dejar entrar (Windows) o no deja entrar por defecto en
  muchos equipos. No se puede contar con eso: por eso la solución es de la app.

### La solución: semana 10

Los instaladores suman, a nivel del sistema operativo:

- una **regla de firewall de entrada** que bloquee el Chromium empaquetado (`resources/navegadores`, ADR
  020), creada por el instalador;
- en Linux, el **network namespace sin salida** ya anotado para el CI (ADR 016), que también deja sin
  entrada.

## Cómo se verifica

`e2e/webrtc-sin-escucha.e2e.ts`, con `opcionesChromium` sin controles, detrás del proxy real. Abre `/webrtc`
y mira los sockets de los procesos de Chromium (por PID y hora de creación) cada 250 ms durante 4 s.

- **Lo que se cerró sigue cerrado:** falla con TCP en escucha, el 5353, `::` o una IP de la red. Todo lo que
  no sea el UDP en `0.0.0.0` de la brecha.
- **El test de cierre**, estricto (falla con cualquier socket fuera de loopback), marcado con `test.fail`
  como la fuga de la básica. Si un día deja de fallar, avisa: hay que revisar esta ADR y sacar la marca.
- **Control positivo:** con `sinArgumentosDeRed`, ve los sockets, y el filtro de «lo que se cerró» también.
- **Diagnóstico:** cuando el test de cierre falla, imprime cada socket (`[webrtc-sin-escucha]` en el log y
  una anotación en el reporte): protocolo, local, remoto y estado. En Linux sale de `/proc/<pid>/net`; en
  Windows, `Get-NetUDPEndpoint` no da el destino de un UDP. Las IP de la red del equipo van solo por su
  clase: los logs del CI son públicos.

También `security-tests/sockets-escucha.test.ts` (la clasificación y la lectura de Windows y Linux) y
`packages/runner/src/motor/opciones-chromium.test.ts` (la función apagada, la prueba de campo y que no se
la pueda pisar).

## Aviso del firewall

Los controles positivos (`sinArgumentosDeRed`) ligan sockets a propósito, y hasta la semana 10 también la
brecha: en Windows puede aparecer el aviso. Se responde «Cancelar» (CONTRIBUTING).
