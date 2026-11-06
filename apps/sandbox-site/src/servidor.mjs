import { createHash } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { createServer } from 'node:http';
import { createServer as crearServidorTls } from 'node:https';

/**
 * App de prueba de QAtlas: tiene problemas plantados a propósito para que el escáner tenga qué
 * encontrar. El oráculo es `hallazgos-esperados.json`. Node puro y sin dependencias.
 *
 * Escucha solo en 127.0.0.1. Nunca se empaqueta con la app (ADR 012).
 */

export const HOST_ESCUCHA = '127.0.0.1';
export const PUERTO_POR_DEFECTO = 43180;
export const HOST_SITIO = 'sandbox.test';

/** Credenciales inventadas, documentadas en el README. No sirven para nada fuera de acá. */
export const CREDENCIALES_DE_PRUEBA = { usuario: 'ana@example.com', clave: 'Sandbox-Prueba-2026' };

// Dominios de los intentos de fuga: reservados (RFC 6761), nunca resuelven a un equipo real.
const FUGA_SCRIPT = 'analitica.fuga.test';
const FUGA_PIXEL = 'pixel.fuga.example';
const FUGA_FETCH = 'api.fuga.invalid';
const FUGA_REDIRECCION = 'redireccion.fuga.test';
const FUGA_WEBSOCKET = 'ws.fuga.example';
const FUGA_SERVICE_WORKER = 'sw.fuga.invalid';
// Por UDP: no pasan por el proxy, y por eso van aparte de los demás.
const FUGA_STUN = 'stun.fuga.test';
const FUGA_QUIC = 'quic.fuga.test';
export const HOSTS_UDP_DE_FUGA = [FUGA_STUN, FUGA_QUIC];
export const HOSTS_DE_FUGA = [
  FUGA_SCRIPT,
  FUGA_PIXEL,
  FUGA_FETCH,
  FUGA_REDIRECCION,
  FUGA_WEBSOCKET,
  FUGA_SERVICE_WORKER,
];

/**
 * Cómo un navegador de prueba resuelve estos dominios sin tocar el archivo hosts: todo a 127.0.0.1.
 * Se pasa a Chromium con `--host-resolver-rules`. Si el proxy fallara, una fuga llega a este
 * servidor, que la registra, y nunca a un dominio real.
 */
export const MAPA_DE_HOSTS = Object.freeze({
  [HOST_SITIO]: HOST_ESCUCHA,
  [FUGA_SCRIPT]: HOST_ESCUCHA,
  [FUGA_PIXEL]: HOST_ESCUCHA,
  [FUGA_FETCH]: HOST_ESCUCHA,
  [FUGA_REDIRECCION]: HOST_ESCUCHA,
  [FUGA_WEBSOCKET]: HOST_ESCUCHA,
  [FUGA_SERVICE_WORKER]: HOST_ESCUCHA,
  [FUGA_STUN]: HOST_ESCUCHA,
  [FUGA_QUIC]: HOST_ESCUCHA,
});

export const REGLAS_RESOLVER = Object.entries(MAPA_DE_HOSTS)
  .map(([host, ip]) => `MAP ${host} ${ip}`)
  .join(',');

const DEMORA_LENTA_MS = 3000;
const COOKIE_SESION = 'sesion';
const COOKIE_ANONIMA = 'sesion_anonima';
const TOKEN_SESION = 'sesion-de-prueba-inventada';
const LARGO_MAXIMO_CUERPO = 4096;

const pagina = (titulo, cuerpo) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${titulo} · Sandbox</title></head>
<body>
<h1>${titulo}</h1>
${cuerpo}
<p><a href="/">Volver al inicio</a></p>
</body>
</html>`;

const inicio = (puertoHttps) =>
  pagina(
    'Sandbox de QAtlas',
    `<p>Sitio de prueba con problemas plantados.</p>
<ul>
  <li><a href="/login">Iniciar sesión</a></li>
  <li><a href="/panel">Panel</a></li>
  <li><a href="/error-500">Error del servidor</a></li>
  <li><a href="/excepcion-js">Excepción de JavaScript</a></li>
  <li><a href="/links-rotos">Links rotos</a></li>
  <li><a href="/consola">Error en la consola</a></li>
  <li><a href="/accesibilidad">Accesibilidad</a></li>
  <li><a href="/lenta">Página lenta</a></li>
  <li><a href="/formulario">Formulario</a></li>
  <li><a href="/fuga">Intentos de fuga</a></li>
  <li><a href="/redirige-afuera">Redirección a otro dominio</a></li>
  <li><a href="/websocket-externo">WebSocket externo</a></li>
  <li><a href="/service-worker">Service worker</a></li>
  <li><a href="/api-en-otro-puerto">API en otro puerto</a></li>
  <li><a href="/puerto-no-declarado">Puerto no declarado</a></li>
  <li><a href="/auto-post">Envío automático</a></li>
  <li><a href="/webrtc">WebRTC</a></li>
  <li><a href="/cerrar-sesion">Cerrar sesión</a></li>
  <li><a href="/eliminar-cuenta">Eliminar cuenta</a></li>
  <li><a href="/sana">Página sana</a></li>
  <li><a href="/lcp-lenta">Imagen principal lenta</a></li>
  <li><a href="/calendario/2026/11">Calendario</a></li>
  <li><a href="/buscar?t=1">Búsqueda</a></li>
  <li><a href="/spa">Aplicación de una página</a></li>
  <li><a href="/ws-escritura">WebSocket que escribe</a></li>
  ${puertoHttps ? `<li><a href="https://${HOST_SITIO}:${puertoHttps}/mixto">Contenido mixto</a></li>` : ''}
</ul>`,
  );

const LOGIN = pagina(
  'Iniciar sesión',
  `<form method="post" action="/login">
  <label>Email <input id="usuario" name="usuario" type="email" autocomplete="off"></label>
  <label>Contraseña <input id="clave" name="clave" type="password" autocomplete="off"></label>
  <button type="submit">Entrar</button>
</form>`,
);

const PANEL = pagina(
  'Panel',
  `<p>Sesión iniciada.</p>
<p><a href="/cerrar-sesion">Cerrar sesión</a></p>
<p><a href="/eliminar-cuenta">Eliminar cuenta</a></p>`,
);

const EXCEPCION = pagina(
  'Excepción de JavaScript',
  `<script>throw new Error('Excepción plantada en el sandbox');</script>`,
);

const LINKS_ROTOS = pagina(
  'Links rotos',
  `<ul>
  <li><a href="/no-existe-1">Roto 1</a></li>
  <li><a href="/carpeta/no-existe-2">Roto 2</a></li>
</ul>`,
);

const CONSOLA = pagina(
  'Error en la consola',
  `<script>console.error('Error plantado en el sandbox');</script>`,
);

// El contraste de #bbbbbb sobre blanco es de 1,9:1.
const ACCESIBILIDAD = pagina(
  'Accesibilidad',
  `<img src="/imagen.svg">
<button type="button"></button>
<input type="text">
<p style="color:#bbbbbb;background:#ffffff">Texto con poco contraste.</p>`,
);

const FORMULARIO = pagina(
  'Formulario',
  `<form method="post" action="/formulario/enviar">
  <label>Mensaje <input name="mensaje"></label>
  <button type="submit">Mandar</button>
</form>`,
);

const fuga = (puerto) =>
  pagina(
    'Intentos de fuga',
    `<p>Esta página intenta sacar datos a dominios externos ficticios.</p>
<script src="http://${FUGA_SCRIPT}:${puerto}/a.js"></script>
<img alt="" width="1" height="1" src="http://${FUGA_PIXEL}:${puerto}/p.gif">
<script>
  fetch('http://${FUGA_FETCH}:${puerto}/datos', { method: 'GET', mode: 'no-cors' }).catch(() => {});
</script>`,
  );

const websocketExterno = (puerto) =>
  pagina(
    'WebSocket externo',
    `<script>
  window.resultadoWs = new Promise((listo) => {
    const ws = new WebSocket('ws://${FUGA_WEBSOCKET}:${puerto}/canal');
    ws.onopen = () => listo('abierto');
    ws.onerror = () => listo('error');
    ws.onclose = () => listo('cerrado');
  });
</script>`,
  );

const SERVICE_WORKER = pagina(
  'Service worker',
  `<script>
  window.resultadoSw = navigator.serviceWorker
    ? navigator.serviceWorker.register('/sw.js').then(() => 'registrado', () => 'rechazado')
    : Promise.resolve('sin-soporte');
</script>`,
);

const swJs = (puerto) =>
  `fetch('http://${FUGA_SERVICE_WORKER}:${puerto}/datos', { mode: 'no-cors' }).catch(() => {});`;

const apiEnOtroPuerto = (puertoApi) =>
  pagina(
    'API en otro puerto',
    `<script>
  window.resultadoApi = fetch('http://${HOST_ESCUCHA}:${puertoApi}/datos', { mode: 'cors' })
    .then((r) => r.json()).then((j) => j.origen, () => 'error');
</script>`,
  );

const puertoNoDeclarado = (puertoTrampa) =>
  pagina(
    'Puerto no declarado',
    `<script>
  window.resultadoTrampa = fetch('http://${HOST_ESCUCHA}:${puertoTrampa}/datos', { mode: 'no-cors' })
    .then(() => 'llego', () => 'error');
</script>`,
  );

// Se dispara sola al cargar: el modo solo lectura la tiene que frenar sin que nadie haga clic.
const AUTO_POST = pagina(
  'Envío automático',
  `<script>
  fetch('/formulario/enviar', { method: 'POST', body: 'mensaje=automatico' }).catch(() => {});
</script>`,
);

// La IP literal también: una regla del resolvedor no alcanza a STUN.
const webrtc = (puertoUdp) =>
  pagina(
    'WebRTC',
    `<script>
  window.resultadoRtc = new Promise((listo) => {
    const candidatos = [];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:${HOST_ESCUCHA}:${puertoUdp}', 'stun:${FUGA_STUN}:${puertoUdp}'] }],
    });
    const terminar = () => listo({ candidatos, sdp: pc.localDescription ? pc.localDescription.sdp : '' });
    pc.createDataChannel('fuga');
    pc.onicecandidate = (e) => {
      if (e.candidate) candidatos.push(e.candidate.candidate);
      else terminar();
    };
    pc.createOffer().then((oferta) => pc.setLocalDescription(oferta));
    setTimeout(terminar, 3000);
  });
</script>`,
  );

const quic = (puertoUdp) =>
  pagina(
    'QUIC',
    `<script>
  fetch('https://${FUGA_QUIC}:${puertoUdp}/datos', { mode: 'no-cors' }).catch(() => {});
</script>`,
  );

// Páginas sanas: ningún chequeo debería encontrar nada acá. Si encuentra algo, es un falso positivo.
const SANA = pagina(
  'Página sana',
  `<p>Una página sin problemas, para detectar falsos positivos.</p>
<p><a href="/sana/otra">Otra página sana</a></p>`,
);
const SANA_OTRA = pagina(
  'Otra página sana',
  `<p>También sin problemas.</p>
<img src="/imagen.svg" alt="Un cuadrado de ejemplo" width="40" height="40">`,
);

// La imagen principal tarda: el LCP pasa los 4 segundos.
const DEMORA_LCP_MS = 4500;
const LCP_LENTA = pagina(
  'Imagen principal lenta',
  '<img src="/imagen-grande.svg" alt="Una imagen grande de ejemplo" width="1200" height="800">',
);
// Con detalle: Chromium no cuenta para el LCP una imagen de un solo color (baja entropía).
const IMAGEN_GRANDE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">${Array.from(
  { length: 600 },
  (_, i) =>
    `<rect x="${(i * 37) % 1200}" y="${(i * 53) % 800}" width="${20 + (i % 40)}" height="${15 + (i % 30)}" fill="#${((i * 2654435761) >>> 8).toString(16).padStart(6, '0').slice(0, 6)}"/>`,
).join('')}</svg>`;

// Trampas de URLs infinitas: cada mes enlaza al siguiente, y cada búsqueda a otra con otro parámetro.
const calendario = (anio, mes) => {
  const siguiente = mes === 12 ? [anio + 1, 1] : [anio, mes + 1];
  return pagina(
    `Calendario ${mes}/${anio}`,
    `<p><a href="/calendario/${siguiente[0]}/${siguiente[1]}">Mes siguiente</a></p>`,
  );
};
const buscar = (t) =>
  pagina(
    'Búsqueda',
    `<p><a href="/buscar?t=${t + 1}&amp;orden=${(t * 7) % 13}">Más resultados</a></p>`,
  );

// Una aplicación de una página: navega y escribe con botones, sin links.
const SPA = pagina(
  'Aplicación de una página',
  `<div id="vista"><p>Inicio de la aplicación.</p></div>
<button type="button" id="ver">Ver detalle</button>
<button type="button" id="guardar">Guardar cambios</button>
<button type="button" id="borrar" data-testid="eliminar-todo">Quitar todo</button>
<script>
  const vista = document.getElementById('vista');
  document.getElementById('ver').onclick = () => {
    history.pushState({}, '', '/spa/detalle');
    vista.textContent = 'Detalle.';
  };
  document.getElementById('guardar').onclick = () => {
    fetch('/api/guardar', { method: 'POST', body: 'x' }).catch(() => {});
  };
  document.getElementById('borrar').onclick = () => {
    fetch('/api/eliminar', { method: 'POST', body: 'x' }).catch(() => {});
  };
</script>`,
);

// Escribe por WebSocket apenas abre: solo lectura no puede dejarlo pasar.
const WS_ESCRITURA = pagina(
  'WebSocket que escribe',
  `<script>
  window.resultadoWsEscritura = new Promise((listo) => {
    const ws = new WebSocket(\`ws://\${location.host}/canal\`);
    ws.onopen = () => { ws.send('guardar'); setTimeout(() => listo('enviado'), 300); };
    ws.onerror = () => listo('error');
  });
</script>`,
);

// En HTTPS, un script por HTTP: contenido mixto.
const mixto = (puertoHttp) =>
  pagina('Contenido mixto', `<script src="http://${HOST_SITIO}:${puertoHttp}/mixto.js"></script>`);

const IMAGEN = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"></svg>';

function responder(res, estado, cuerpo, encabezados = {}) {
  res.writeHead(estado, { 'content-type': 'text/html; charset=utf-8', ...encabezados });
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let texto = '';
    req.setEncoding('utf8');
    req.on('data', (trozo) => {
      texto += trozo;
      if (texto.length > LARGO_MAXIMO_CUERPO) {
        req.destroy();
        rechazar(new Error('Cuerpo demasiado grande'));
      }
    });
    req.on('end', () => {
      resolver(texto);
    });
    req.on('error', rechazar);
  });
}

function tieneSesion(req) {
  return (req.headers.cookie ?? '')
    .split(';')
    .some((par) => par.trim() === `${COOKIE_SESION}=${TOKEN_SESION}`);
}

/**
 * Levanta el sitio. Con `puerto: 0` el sistema elige uno libre, como en los tests. `registro` guarda
 * lo que pasó, para verificar que el escáner y el proxy hicieron lo que debían.
 */
export function iniciarSandbox({
  puerto = PUERTO_POR_DEFECTO,
  demoraLentaMs = DEMORA_LENTA_MS,
  // Clave y certificado de prueba, generados por quien lo llama. Sin esto, no hay HTTPS.
  tls = undefined,
} = {}) {
  const registro = {
    fugas: [],
    trampas: [],
    posts: [],
    api: [],
    puertoNoDeclarado: [],
    websockets: [],
    serviceWorkers: [],
    hosts: [],
    udp: [],
    tls: [],
    https: [],
    intentosLogin: [],
    rutas: [],
    wsMensajes: [],
  };
  let puertoReal = puerto;
  let puertoApi = 0;
  let puertoTrampa = 0;
  let puertoUdp = 0;
  let puertoHttps = 0;

  const atender = async (req, res) => {
    const nombreHost = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    registro.hosts.push(nombreHost);

    if (HOSTS_DE_FUGA.includes(nombreHost)) {
      // Si esto se registra, el proxy dejó salir una conexión que debía bloquear.
      registro.fugas.push(nombreHost);
      responder(res, 204, '');
      return;
    }
    // Protege de un sitio cualquiera que apunte su dominio a 127.0.0.1 (DNS rebinding).
    if (![HOST_SITIO, HOST_ESCUCHA, 'localhost'].includes(nombreHost)) {
      responder(res, 421, '');
      return;
    }

    const { pathname } = new URL(req.url ?? '/', `http://${HOST_ESCUCHA}`);
    registro.rutas.push(pathname);
    const clave = `${req.method} ${pathname}`;
    switch (clave) {
      case 'GET /':
        responder(res, 200, inicio(puertoHttps));
        return;
      case 'GET /login':
        // Plantado: una cookie de sesión anónima sin HttpOnly, antes de cualquier login, y «tema», sin
        // vencimiento ni HttpOnly: informativa, porque no se sabe si guarda la sesión. Las otras dos no
        // son hallazgos: la anti-CSRF tiene que ser legible por JavaScript, y «preferences» no es de sesión
        // aunque contenga «ses».
        responder(res, 200, LOGIN, {
          'set-cookie': [
            `${COOKIE_ANONIMA}=anonima-inventada; Path=/`,
            'XSRF-TOKEN=csrf-inventado; Path=/',
            'preferences=tema-oscuro; Path=/; Max-Age=31536000',
            'tema=oscuro; Path=/',
          ],
        });
        return;
      case 'POST /login': {
        registro.intentosLogin.push(pathname);
        const datos = new URLSearchParams(await leerCuerpo(req));
        if (
          datos.get('usuario') === CREDENCIALES_DE_PRUEBA.usuario &&
          datos.get('clave') === CREDENCIALES_DE_PRUEBA.clave
        ) {
          // Plantado: cookie de sesión sin Secure ni HttpOnly.
          responder(res, 302, '', {
            location: '/panel',
            'set-cookie': `${COOKIE_SESION}=${TOKEN_SESION}; Path=/`,
          });
        } else {
          responder(res, 401, LOGIN);
        }
        return;
      }
      case 'GET /panel':
        if (tieneSesion(req)) responder(res, 200, PANEL);
        else responder(res, 302, '', { location: '/login' });
        return;
      case 'GET /error-500':
        responder(res, 500, pagina('Error del servidor', '<p>Falla plantada.</p>'));
        return;
      case 'GET /excepcion-js':
        responder(res, 200, EXCEPCION);
        return;
      case 'GET /links-rotos':
        responder(res, 200, LINKS_ROTOS);
        return;
      case 'GET /consola':
        responder(res, 200, CONSOLA);
        return;
      case 'GET /accesibilidad':
        responder(res, 200, ACCESIBILIDAD);
        return;
      case 'GET /imagen.svg':
        responder(res, 200, IMAGEN, { 'content-type': 'image/svg+xml' });
        return;
      case 'GET /lenta':
        await new Promise((resolver) => setTimeout(resolver, demoraLentaMs));
        responder(res, 200, pagina('Página lenta', '<p>Tardó en responder.</p>'));
        return;
      case 'GET /formulario':
        responder(res, 200, FORMULARIO);
        return;
      case 'POST /formulario/enviar':
        registro.posts.push(pathname);
        responder(res, 200, pagina('Recibido', '<p>El formulario llegó al servidor.</p>'));
        return;
      case 'GET /cerrar-sesion':
      case 'GET /eliminar-cuenta':
        // Si esto se registra, el crawler no respetó las exclusiones.
        registro.trampas.push(pathname);
        responder(res, 302, '', {
          location: '/',
          'set-cookie': `${COOKIE_SESION}=; Path=/; Max-Age=0`,
        });
        return;
      case 'GET /fuga':
        responder(res, 200, fuga(puertoReal));
        return;
      case 'GET /redirige-afuera':
        responder(res, 302, '', { location: `http://${FUGA_REDIRECCION}:${puertoReal}/destino` });
        return;
      case 'GET /redirige-adentro':
        responder(res, 302, '', { location: '/' });
        return;
      case 'GET /websocket-externo':
        responder(res, 200, websocketExterno(puertoReal));
        return;
      case 'GET /service-worker':
        responder(res, 200, SERVICE_WORKER);
        return;
      case 'GET /sw.js':
        registro.serviceWorkers.push(pathname);
        responder(res, 200, swJs(puertoReal), { 'content-type': 'text/javascript' });
        return;
      case 'GET /api-en-otro-puerto':
        responder(res, 200, apiEnOtroPuerto(puertoApi));
        return;
      case 'GET /puerto-no-declarado':
        responder(res, 200, puertoNoDeclarado(puertoTrampa));
        return;
      case 'GET /webrtc':
        responder(res, 200, webrtc(puertoUdp));
        return;
      case 'GET /quic':
        responder(res, 200, quic(puertoUdp));
        return;
      case 'GET /favicon.ico':
        responder(res, 204, '');
        return;
      case 'GET /sana':
        responder(res, 200, SANA);
        return;
      case 'GET /sana/otra':
        responder(res, 200, SANA_OTRA);
        return;
      case 'GET /lcp-lenta':
        responder(res, 200, LCP_LENTA);
        return;
      case 'GET /imagen-grande.svg':
        await new Promise((resolver) => setTimeout(resolver, DEMORA_LCP_MS));
        responder(res, 200, IMAGEN_GRANDE, { 'content-type': 'image/svg+xml' });
        return;
      case 'GET /spa':
      case 'GET /spa/detalle':
        responder(res, 200, SPA);
        return;
      case 'POST /api/guardar':
      case 'POST /api/eliminar':
        registro.posts.push(pathname);
        responder(res, 204, '');
        return;
      case 'GET /ws-escritura':
        responder(res, 200, WS_ESCRITURA);
        return;
      case 'GET /mixto':
        responder(res, 200, mixto(puertoReal));
        return;
      case 'GET /mixto.js':
        responder(res, 200, 'void 0;', { 'content-type': 'text/javascript' });
        return;
      case 'GET /auto-post':
        responder(res, 200, AUTO_POST);
        return;
      default: {
        const mes = /^GET \/calendario\/(\d{4})\/(\d{1,2})$/.exec(clave);
        if (mes) {
          responder(res, 200, calendario(Number(mes[1]), Number(mes[2])));
          return;
        }
        if (clave === 'GET /buscar') {
          const t = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('t')) || 1;
          responder(res, 200, buscar(t));
          return;
        }
        responder(res, 404, pagina('No encontrada', '<p>No existe esta página.</p>'));
      }
    }
  };

  const servidor = createServer((req, res) => {
    atender(req, res).catch(() => {
      if (!res.headersSent) responder(res, 400, '');
      else res.end();
    });
  });

  // Un WebSocket a un dominio de fuga queda registrado aunque nunca se complete el saludo.
  // `closeAllConnections` no ve un socket que ya se actualizó: hay que cerrarlos a mano.
  const websocketsAbiertos = new Set();
  servidor.on('upgrade', (req, socket) => {
    websocketsAbiertos.add(socket);
    socket.on('close', () => {
      websocketsAbiertos.delete(socket);
    });
    socket.on('error', () => {});
    const nombreHost = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    registro.hosts.push(nombreHost);
    if (HOSTS_DE_FUGA.includes(nombreHost)) {
      registro.fugas.push(nombreHost);
      socket.destroy();
      return;
    }
    registro.websockets.push(nombreHost);
    socket.on('data', (datos) => {
      // Una trama de texto chica y enmascarada, como la manda un navegador.
      const largo = datos[1] & 0x7f;
      if (datos.length < 6 || largo >= 126 || (datos[0] & 0x0f) !== 1) return;
      const mascara = datos.subarray(2, 6);
      const texto = Buffer.from(datos.subarray(6, 6 + largo).map((b, i) => b ^ mascara[i % 4]));
      registro.wsMensajes.push(texto.toString('utf8'));
    });
    const aceptar = createHash('sha1')
      .update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${aceptar}\r\n\r\n`,
    );
  });

  // Una API en otro puerto: el caso de un frontend en 5173 y su backend en 3000.
  const servidorApi = createServer((req, res) => {
    registro.api.push(req.url ?? '/');
    res.writeHead(200, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    });
    res.end(JSON.stringify({ origen: 'api' }));
  });

  // Otro servicio local, no declarado en el proyecto: si algo llega acá, el proxy falló.
  // Lo que llegue acá salió del navegador por UDP, sin pasar por el proxy.
  const receptorUdp = createSocket('udp4');
  receptorUdp.on('message', (mensaje) => {
    registro.udp.push(mensaje.length);
  });

  const servidorTls =
    tls &&
    crearServidorTls(tls, (req, res) => {
      const ruta = (req.url ?? '/').split('?')[0];
      registro.https.push(req.method === 'GET' ? ruta : `${req.method} ${ruta}`);
      // Un sitio puede anunciar HTTP3 por su cuenta: el navegador no debería hacerle caso.
      res.setHeader('alt-svc', `h3=":${puertoUdp}"`);
      atender(req, res).catch(() => {
        if (!res.headersSent) responder(res, 400, '');
        else res.end();
      });
    });
  servidorTls?.on('secureConnection', (socket) => {
    registro.tls.push(socket.getProtocol());
  });
  servidorTls?.on('tlsClientError', () => {});

  const servidorTrampa = createServer((req, res) => {
    registro.puertoNoDeclarado.push(req.url ?? '/');
    res.writeHead(204);
    res.end();
  });

  const escuchar = (servidorX, puertoX) =>
    new Promise((listo, rechazar) => {
      servidorX.once('error', rechazar);
      servidorX.listen(puertoX, HOST_ESCUCHA, () => {
        listo(servidorX.address());
      });
    });
  const cerrarUno = (servidorX) =>
    new Promise((listo) => {
      servidorX.close(() => {
        listo();
      });
      servidorX.closeAllConnections();
    });

  return (async () => {
    const direccion = await escuchar(servidor, puerto);
    puertoReal = direccion.port;
    puertoApi = (await escuchar(servidorApi, 0)).port;
    puertoTrampa = (await escuchar(servidorTrampa, 0)).port;
    await new Promise((listo, rechazar) => {
      receptorUdp.once('error', rechazar);
      receptorUdp.bind(0, HOST_ESCUCHA, listo);
    });
    puertoUdp = receptorUdp.address().port;
    if (servidorTls) puertoHttps = (await escuchar(servidorTls, 0)).port;
    return {
      puerto: puertoReal,
      puertoApi,
      puertoTrampa,
      puertoUdp,
      puertoHttps,
      direccion: direccion.address,
      url: `http://${HOST_ESCUCHA}:${puertoReal}`,
      registro,
      cerrar: () => {
        for (const socket of websocketsAbiertos) socket.destroy();
        return Promise.all([
          cerrarUno(servidor),
          cerrarUno(servidorApi),
          cerrarUno(servidorTrampa),
          ...(servidorTls ? [cerrarUno(servidorTls)] : []),
          new Promise((listo) => {
            receptorUdp.close(listo);
          }),
        ]).then(() => undefined);
      },
    };
  })();
}
