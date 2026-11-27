# 045 — El navegador de pruebas no acepta conexiones de la red

- **Estado:** en curso: falta decidir qué hacer con el sondeo IPv4 de WebRTC
- **Fecha:** 2026-11-27

## Contexto

Durante el E2E, el firewall de Windows avisó que «Google Chrome for Testing» quería aceptar conexiones
entrantes. Se midieron, por PID, los sockets de los procesos de Chromium (`Get-NetTCPConnection` y
`Get-NetUDPEndpoint` en Windows, `/proc/<pid>/net` en Linux):

- Lo provocaba también el navegador **de la app** (`opcionesChromium`, sin controles), no solo los controles
  positivos. Con una página que usa WebRTC liga, además de lo de loopback:
  - UDP en el puerto 5353 (mDNS), en `0.0.0.0` o `::`: el responder de `WebRtcHideLocalIpsWithMdns`, que
    reemplaza las IP locales por un nombre `.local` y contesta por él en la red local;
  - UDP en `::`, en un puerto efímero;
  - UDP en `0.0.0.0`, en un puerto efímero, durante menos de un segundo.
- Sin WebRTC en la página, nada fuera de loopback. TCP en escucha, nunca.
- **No sale nada:** los tests de salida siguen igual (el receptor UDP del sandbox no recibe paquetes, y
  WebRTC no da candidatos ni direcciones). Es superficie de **entrada**: un socket ligado a todas las
  interfaces puede recibir paquetes de la red, si el firewall del equipo los deja pasar.

## Decisión, hasta ahora

- **`WebRtcHideLocalIpsWithMdns` apagada** (`FUNCIONES_APAGADAS_POR_QATLAS`): desaparece el 5353. La
  ocultación no hace falta: con `disable_non_proxied_udp`, WebRTC no da direcciones, y
  `fugas-udp-tls.e2e.ts` ya lo probaba sin ella.
- **`--force-fieldtrials=WebRTC-IPv6Default/Disabled/`** (`ARGUMENTOS_DE_RED`): desaparece el de `::`. Como
  Chromium se queda con el último `--force-fieldtrials`, `opcionesChromium` no lo acepta como argumento suelto.
- **El de `0.0.0.0` queda.** Se probaron, sin éxito: `--force-webrtc-ip-handling-policy`,
  `--enforce-webrtc-ip-permission-check`, `--webrtc-udp-port-range` y apagar la función `WebRtc`. Todo
  indica que es el sondeo con que WebRTC averigua su dirección IPv4 por defecto: «conecta» un socket UDP a
  una dirección pública, sin mandar nada, y lo cierra.
- **No se apaga WebRTC todavía:** ninguna opción de Chromium lo apaga sin código en el mundo de la página
  (`--disable-blink-features=RTCPeerConnection` no tiene efecto; `RTCPeerConnection` sigue existiendo).

## Cómo se verifica

- `e2e/webrtc-sin-escucha.e2e.ts`: con `opcionesChromium` sin controles, detrás del proxy real, abre
  `/webrtc` y mira los sockets de los procesos de Chromium (por PID y hora de creación) cada 250 ms durante
  4 s. Falla con cualquier TCP en escucha y con cualquier UDP fuera de loopback (0.0.0.0, `::` o una IP de
  la red). Control positivo: con `sinArgumentosDeRed`, los ve. **Hoy falla** por el sondeo IPv4: es la
  condición de cierre de esta ADR.
- `security-tests/sockets-escucha.test.ts`: la clasificación de direcciones y la lectura de Windows y de
  Linux.
- `packages/runner/src/motor/opciones-chromium.test.ts`: la función apagada, la prueba de campo y que no se
  la pueda pisar.

## Aviso del firewall

Los controles positivos (`sinArgumentosDeRed`) ligan sockets a propósito: en Windows puede aparecer el
aviso. Se responde «Cancelar» (CONTRIBUTING).
