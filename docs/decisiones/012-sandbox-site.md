# 012 — App de prueba en Node puro, con dominios reservados

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

El escáner de las semanas 5 a 8 necesita un sitio con problemas conocidos, sin depender de sitios reales.
Tiene que correr en dev y en CI, simular dominios sin tocar el archivo hosts de la máquina, y un intento de
fuga no puede llegar nunca a un dominio real, aunque falle el proxy.

## Decisión

- **Node puro, sin dependencias:** `node:http` en `.mjs`, sin build. Vite no aporta nada a páginas estáticas.
- **Cómo se levanta:** `npm run dev -w @qatlas/sandbox-site` en `127.0.0.1:43180`. Los tests llaman a
  `iniciarSandbox({ puerto: 0 })`, así que el CI no necesita un paso propio.
- **Escucha solo en `127.0.0.1`**, sin opción para cambiarlo, y rechaza con 421 cualquier `Host` desconocido,
  para que un sitio que apunte su dominio a esa IP no pueda hablarle (DNS rebinding).
- **Nunca se empaqueta:** no es dependencia de la app y no está en su configuración de build. Un test lo verifica.
- **Oráculo:** `hallazgos-esperados.json` declara cada problema con tipo, URL y severidad. Un test comprueba
  que el sitio hace lo que el manifiesto dice.

### Dominios

Solo dominios reservados: `.test`, `.example` e `.invalid` (RFC 2606 y 6761). No `example.com`, que sí resuelve.

Chromium los resuelve con `--host-resolver-rules`, que no toca el sistema: `REGLAS_RESOLVER` los manda todos a
`127.0.0.1`. Si el proxy fallara, la conexión llega a este servidor, que la guarda en `registro.fugas`: así se
distingue «el proxy la bloqueó» de «falló el DNS». Sin esa regla, los dominios reservados no resuelven y el
intento tampoco sale del equipo.

`registro.trampas` y `registro.posts` hacen lo mismo con las exclusiones y el modo solo lectura.

## Consecuencias

- **Sin verificar todavía en un navegador real:** los tests comprueban el mapa, el manifiesto y el registro con
  `node:http`. La regla de Chromium se ejercita recién con el runner de la semana 5.
- La cookie insegura, el login y las páginas con errores son a propósito: este sitio no debe exponerse. Por
  eso no hay opción para escuchar en otra dirección.
- Falta lo que corresponde a otros controles: redirecciones a otros dominios, WebSocket externo y service
  worker (semana 5), y JWT en la consola (semana 7).

## Verificación

`security-tests/sandbox-site.test.ts`: cada dominio de fuga es reservado y está mapeado a `127.0.0.1`, ninguna
página referencia otro host, y cada entrada del manifiesto se cumple.
