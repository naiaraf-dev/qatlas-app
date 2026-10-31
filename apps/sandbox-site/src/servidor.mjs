import { createServer } from 'node:http';

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
export const HOSTS_DE_FUGA = [FUGA_SCRIPT, FUGA_PIXEL, FUGA_FETCH];

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
});

export const REGLAS_RESOLVER = Object.entries(MAPA_DE_HOSTS)
  .map(([host, ip]) => `MAP ${host} ${ip}`)
  .join(',');

const DEMORA_LENTA_MS = 3000;
const COOKIE_SESION = 'sesion';
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

const INICIO = pagina(
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
} = {}) {
  const registro = { fugas: [], trampas: [], posts: [] };
  let puertoReal = puerto;

  const atender = async (req, res) => {
    const nombreHost = (req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();

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
    const clave = `${req.method} ${pathname}`;
    switch (clave) {
      case 'GET /':
        responder(res, 200, INICIO);
        return;
      case 'GET /login':
        responder(res, 200, LOGIN);
        return;
      case 'POST /login': {
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
      default:
        responder(res, 404, pagina('No encontrada', '<p>No existe esta página.</p>'));
    }
  };

  const servidor = createServer((req, res) => {
    atender(req, res).catch(() => {
      if (!res.headersSent) responder(res, 400, '');
      else res.end();
    });
  });

  return new Promise((resolver, rechazar) => {
    servidor.once('error', rechazar);
    servidor.listen(puerto, HOST_ESCUCHA, () => {
      const direccion = servidor.address();
      puertoReal = direccion.port;
      resolver({
        puerto: puertoReal,
        direccion: direccion.address,
        url: `http://${HOST_ESCUCHA}:${puertoReal}`,
        registro,
        cerrar: () =>
          new Promise((listo) => {
            servidor.close(() => {
              listo();
            });
            servidor.closeAllConnections();
          }),
      });
    });
  });
}
