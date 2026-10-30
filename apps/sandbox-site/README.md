# App de prueba (sandbox-site)

Sitio con problemas plantados para que el escáner de las semanas 5 a 8 tenga qué encontrar, sin depender
de sitios reales. Node puro, sin dependencias. Decisión: [ADR 012](../../docs/decisiones/012-sandbox-site.md).

```bash
npm run dev -w @qatlas/sandbox-site   # http://127.0.0.1:43180
```

`SANDBOX_PUERTO` cambia el puerto. Los tests llaman a `iniciarSandbox({ puerto: 0 })`, así que el CI no
necesita ningún paso propio.

- **Escucha solo en `127.0.0.1`** y rechaza con 421 cualquier `Host` que no conozca.
- **Nunca se empaqueta:** no es dependencia de la app, y `security-tests/sandbox-site.test.ts` lo verifica.

## Login de prueba

Credenciales inventadas, que no sirven para nada fuera de este sitio:

| Campo      | Valor                 |
| ---------- | --------------------- |
| Usuario    | `ana@example.com`     |
| Contraseña | `Sandbox-Prueba-2026` |

## Qué tiene plantado

`hallazgos-esperados.json` es el oráculo: cada problema, con su tipo, URL y severidad esperada. Un test
comprueba que el manifiesto y el sitio coinciden.

| Página           | Problema                                                          |
| ---------------- | ----------------------------------------------------------------- |
| `/error-500`     | Responde 500                                                      |
| `/excepcion-js`  | Excepción de JavaScript sin capturar                              |
| `/links-rotos`   | Dos links internos que responden 404                              |
| `/consola`       | `console.error`                                                   |
| `/accesibilidad` | Imagen sin `alt`, botón sin nombre, campo sin etiqueta, contraste |
| `/lenta`         | Tarda 3 segundos                                                  |
| `/login`         | Cookie de sesión sin `Secure` ni `HttpOnly`                       |
| `/formulario`    | POST que el modo solo lectura debe bloquear                       |
| `/panel`         | Trampas «Cerrar sesión» y «Eliminar cuenta» (exclusiones)         |
| `/fuga`          | Script, pixel y `fetch` a dominios externos ficticios             |

## Dominios sin tocar el archivo hosts

El sitio y las fugas usan solo dominios reservados: `.test`, `.example` e `.invalid`. Un navegador de prueba
los resuelve con `--host-resolver-rules`, usando `REGLAS_RESOLVER`, que los manda a todos a `127.0.0.1`.

Si el proxy fallara, un intento de fuga llega a este servidor, que lo guarda en `registro.fugas`: el test
lo detecta, y nunca sale a un dominio real. `registro.trampas` y `registro.posts` hacen lo mismo con las
exclusiones y el modo solo lectura.

## Lo que falta

Se suma con cada control que lo necesite: redirecciones a otros dominios, WebSocket externo y service worker
(TS-03 a TS-05, semana 5), y JWT en la consola (TS-01, semana 7).
