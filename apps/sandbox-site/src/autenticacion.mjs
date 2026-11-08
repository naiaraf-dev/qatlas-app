import { randomBytes } from 'node:crypto';

/**
 * La zona con login del sandbox (semana 6b): una app en `/app` con dos roles, un proveedor de identidad
 * ficticio en otro dominio, un portal que entra con un enlace con token, un segundo factor que se
 * aprueba «desde el teléfono», y una zona con autenticación HTTP básica.
 *
 * Las sesiones vencen por inactividad, por tiempo máximo o por cantidad de páginas, con tiempos cortos
 * y configurables, y con un reloj que el test puede controlar. `vencerSesiones()` las vence todas, para
 * que un test no tenga que esperar. Ninguna página de la zona tiene un link al inicio del sandbox: el
 * escaneo autenticado se queda adentro, y el inicio no tiene un link a la zona.
 */

/** Usuarios inventados, documentados en el README. No sirven para nada fuera de acá. */
export const USUARIOS_APP = Object.freeze({
  admin: Object.freeze({ usuario: 'ana-admin@example.com', clave: 'Sandbox-Admin-2026' }),
  lector: Object.freeze({ usuario: 'ana-lector@example.com', clave: 'Sandbox-Lector-2026' }),
});
export const USUARIO_BASICA = Object.freeze({ usuario: 'ana', clave: 'Sandbox-Basica-2026' });

export const HOST_IDP = 'idp.sandbox.test';
export const HOST_PORTAL = 'portal.sandbox.test';

const COOKIE_APP = 'app_sesion';
const COOKIE_ORIGEN = 'app_origen';
const COOKIE_IDP = 'idp_sesion';
const COOKIE_FACTOR = 'app_factor';

const paginaApp = (titulo, cuerpo) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${titulo} · App del sandbox</title></head>
<body>
<main>
<h1>${titulo}</h1>
${cuerpo}
</main>
</body>
</html>`;

const formularioLogin = (accion, titulo, extra = '') =>
  paginaApp(
    titulo,
    `<form method="post" action="${accion}" id="form-login">
  <label>Email <input id="usuario" name="usuario" type="email" autocomplete="off"></label>
  <label>Contraseña <input id="clave" name="clave" type="password" autocomplete="off"></label>
  <button type="submit">Entrar</button>
</form>${extra}`,
  );

const leerCookies = (req) =>
  Object.fromEntries(
    (req.headers.cookie ?? '')
      .split(';')
      .map((par) => par.trim().split('='))
      .filter(([nombre]) => nombre)
      .map(([nombre, ...valor]) => [nombre, valor.join('=')]),
  );

const aleatorio = () => randomBytes(12).toString('hex');

/** Con un canario (TS-01), la contraseña del admin es el canario. */
function rolDe(usuario, clave, canario) {
  for (const [rol, datos] of Object.entries(USUARIOS_APP)) {
    const esperada = rol === 'admin' && canario ? canario : datos.clave;
    if (datos.usuario === usuario && esperada === clave) return rol;
  }
  return null;
}

/**
 * @param {object} opciones
 * @param {{ inactividadMs?: number, maximoMs?: number, maximoPaginas?: number }} [opciones.sesion]
 * @param {() => number} [opciones.ahora]
 * @param {() => { app: string, idp: string, portal: string }} opciones.origenes  Con el puerto real.
 */
export function crearZonaAutenticada({
  sesion = {},
  ahora = Date.now,
  origenes,
  canario = undefined,
}) {
  const inactividadMs = sesion.inactividadMs ?? 10 * 60_000;
  const maximoMs = sesion.maximoMs ?? 60 * 60_000;
  const maximoPaginas = sesion.maximoPaginas ?? Number.POSITIVE_INFINITY;

  /** @type {Map<string, { rol: string, origen: string, creada: number, ultima: number, paginas: number, vencida: boolean }>} */
  const sesiones = new Map();
  const sesionesIdp = new Map();
  const codigos = new Map();
  const enlaces = new Map();
  const factores = new Map();

  const registro = {
    /** Cada login completado: por dónde y con qué rol. */
    logins: [],
    /** Cada vez que una página de la app encontró la sesión vencida. */
    vencidas: [],
    /** Pantallas de segundo factor servidas: la señal para aprobarlo. */
    segundoFactor: 0,
    /** Pedidos a la zona básica sin credenciales o con unas malas. */
    basicaRechazada: 0,
    /** Rutas de la app pedidas con sesión activa, en orden. */
    rutasConSesion: [],
  };

  const vigente = (datos) =>
    !datos.vencida &&
    ahora() - datos.ultima <= inactividadMs &&
    ahora() - datos.creada <= maximoMs &&
    datos.paginas < maximoPaginas;

  function abrirSesion(res, rol, origen, destino = '/app/inicio') {
    const id = aleatorio();
    sesiones.set(id, { rol, origen, creada: ahora(), ultima: ahora(), paginas: 0, vencida: false });
    registro.logins.push({ via: origen, rol });
    res.writeHead(302, {
      location: destino,
      'set-cookie': [
        `${COOKIE_APP}=${id}; Path=/; HttpOnly; SameSite=Lax`,
        `${COOKIE_ORIGEN}=${origen}; Path=/; HttpOnly; SameSite=Lax`,
      ],
    });
    res.end();
  }

  /** Lo que ve alguien sin sesión, según cómo había entrado: así se ve en un sistema real. */
  function sinSesion(res, origen) {
    if (origen === 'sso') {
      res.writeHead(302, { location: '/app/sso' });
    } else if (origen === 'token') {
      res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' });
      res.end(paginaApp('Sesión vencida', '<p>Volvé a entrar con el enlace del portal.</p>'));
      return;
    } else if (origen === 'mfa') {
      res.writeHead(302, { location: '/app/login-mfa' });
    } else {
      res.writeHead(302, { location: '/app/login' });
    }
    res.end();
  }

  const html = (res, estado, cuerpo, encabezados = {}) => {
    res.writeHead(estado, { 'content-type': 'text/html; charset=utf-8', ...encabezados });
    res.end(cuerpo);
  };

  const inicio = (rol) =>
    paginaApp(
      'Inicio',
      `<p id="menu-usuario">Sesión de ${rol}</p>
<nav aria-label="Secciones">
<ul>
  <li><a href="/app/informes">Informes</a></li>
  <li><a href="/app/compartir?token=enlace-inventado-de-prueba&amp;vista=lista">Compartir un informe</a></li>
  <li><a href="/app/admin">Administración</a></li>
  ${canario ? '<li><a href="/app/depuracion">Depuración</a></li>' : ''}
  <li><a href="/app/salir">Salir</a></li>
</ul>
</nav>`,
    );

  /** Las páginas de la app con sesión. Devuelve false si la ruta no es de acá. */
  function paginaConSesion(res, ruta, datos) {
    registro.rutasConSesion.push(ruta);
    const volver = '<p><a href="/app/inicio">Volver al inicio de la app</a></p>';
    switch (ruta) {
      case '/app':
      case '/app/':
      case '/app/inicio':
        html(res, 200, inicio(datos.rol));
        return true;
      case '/app/informes':
        html(res, 200, paginaApp('Informes', `<p>Informes de ${datos.rol}.</p>${volver}`));
        return true;
      case '/app/depuracion':
        // TS-01, solo con un canario: una página con sesión que imprime la contraseña en la consola.
        if (!canario) return false;
        html(
          res,
          200,
          paginaApp(
            'Depuración',
            `<p>Datos de la sesión.</p><script>console.error(${JSON.stringify(
              `sesión de ${datos.rol} con la clave ${canario}`,
            )});</script>${volver}`,
          ),
        );
        return true;
      case '/app/compartir':
        // Plantado: el token del enlace va en la URL (parámetro sensible).
        html(res, 200, paginaApp('Compartir', `<p>Enlace para compartir.</p>${volver}`));
        return true;
      case '/app/admin':
        if (datos.rol !== 'admin') {
          // Un 403 por rol, con la sesión activa: no es una sesión vencida.
          html(
            res,
            403,
            paginaApp('Sin permiso', `<p>Tu rol no puede ver esta sección.</p>${volver}`),
          );
          return true;
        }
        html(
          res,
          200,
          paginaApp('Administración', `<p><a href="/app/admin/usuarios">Usuarios</a></p>${volver}`),
        );
        return true;
      case '/app/admin/usuarios':
        if (datos.rol !== 'admin') {
          html(
            res,
            403,
            paginaApp('Sin permiso', `<p>Tu rol no puede ver esta sección.</p>${volver}`),
          );
          return true;
        }
        html(res, 200, paginaApp('Usuarios', `<p>Dos usuarios de prueba.</p>${volver}`));
        return true;
      default:
        return false;
    }
  }

  async function atenderApp(req, res, ruta, url, leerCuerpo) {
    const cookies = leerCookies(req);
    const clave = `${req.method} ${ruta}`;
    switch (clave) {
      case 'GET /app/login':
        html(res, 200, formularioLogin('/app/login', 'Entrar a la app'));
        return true;
      case 'POST /app/login': {
        const datos = new URLSearchParams(await leerCuerpo(req));
        const rol = rolDe(datos.get('usuario'), datos.get('clave'), canario);
        if (rol) abrirSesion(res, rol, 'formulario');
        else
          html(
            res,
            401,
            formularioLogin(
              '/app/login',
              'Entrar a la app',
              '<p role="alert">Datos incorrectos.</p>',
            ),
          );
        return true;
      }
      case 'GET /app/login-mfa':
        // Plantado: la página guarda la contraseña en localStorage al enviar. El estado de sesión que
        // guarda QAtlas nunca la tiene que incluir (TS-06).
        html(
          res,
          200,
          formularioLogin(
            '/app/login-mfa',
            'Entrar con segundo factor',
            `<script>
document.getElementById('form-login').addEventListener('submit', () => {
  localStorage.setItem('clave-recordada', document.getElementById('clave').value);
});
</script>`,
          ),
        );
        return true;
      case 'POST /app/login-mfa': {
        const datos = new URLSearchParams(await leerCuerpo(req));
        const rol = rolDe(datos.get('usuario'), datos.get('clave'), canario);
        if (!rol) {
          html(
            res,
            401,
            formularioLogin(
              '/app/login-mfa',
              'Entrar con segundo factor',
              '<p role="alert">Datos incorrectos.</p>',
            ),
          );
          return true;
        }
        const id = aleatorio();
        factores.set(id, { rol, aprobado: false });
        res.writeHead(302, {
          location: '/app/segundo-factor',
          'set-cookie': `${COOKIE_FACTOR}=${id}; Path=/app; HttpOnly; SameSite=Lax`,
        });
        res.end();
        return true;
      }
      case 'GET /app/login-push': {
        // Solo el segundo factor, sin escribir nada: para el login asistido en la app real, donde el
        // test no puede escribir en la ventana. Lo aprueba el test, como desde un teléfono.
        const id = aleatorio();
        factores.set(id, { rol: 'admin', aprobado: false });
        res.writeHead(302, {
          location: '/app/segundo-factor',
          'set-cookie': `${COOKIE_FACTOR}=${id}; Path=/app; HttpOnly; SameSite=Lax`,
        });
        res.end();
        return true;
      }
      case 'GET /app/segundo-factor':
        if (!factores.has(cookies[COOKIE_FACTOR])) {
          sinSesion(res, 'mfa');
          return true;
        }
        registro.segundoFactor += 1;
        html(
          res,
          200,
          paginaApp(
            'Segundo factor',
            `<p>Aprobá el ingreso en tu teléfono.</p>
<script>
setInterval(async () => {
  const r = await fetch('/app/segundo-factor/estado');
  if ((await r.text()) === 'aprobado') location.href = '/app/segundo-factor/completar';
}, 200);
</script>`,
          ),
        );
        return true;
      case 'GET /app/segundo-factor/estado':
        html(res, 200, factores.get(cookies[COOKIE_FACTOR])?.aprobado ? 'aprobado' : 'pendiente', {
          'content-type': 'text/plain; charset=utf-8',
        });
        return true;
      case 'GET /app/segundo-factor/completar': {
        const factor = factores.get(cookies[COOKIE_FACTOR]);
        if (!factor?.aprobado) {
          sinSesion(res, 'mfa');
          return true;
        }
        factores.delete(cookies[COOKIE_FACTOR]);
        abrirSesion(res, factor.rol, 'mfa');
        return true;
      }
      case 'GET /app/sso': {
        // Como OpenID Connect: al proveedor, con un `state` que vuelve en el callback.
        const state = aleatorio();
        const destino = new URL('/idp/autorizar', origenes().idp);
        destino.searchParams.set('client_id', 'app-del-sandbox');
        destino.searchParams.set('redirect_uri', new URL('/app/callback', origenes().app).href);
        destino.searchParams.set('state', state);
        res.writeHead(302, { location: destino.href });
        res.end();
        return true;
      }
      case 'GET /app/callback': {
        const codigo = codigos.get(url.searchParams.get('code') ?? '');
        codigos.delete(url.searchParams.get('code') ?? '');
        if (!codigo || !url.searchParams.get('state')) {
          html(res, 401, paginaApp('Login fallido', '<p>El código no es válido.</p>'));
          return true;
        }
        abrirSesion(res, codigo.rol, 'sso');
        return true;
      }
      case 'GET /app/entrar': {
        const enlace = enlaces.get(url.searchParams.get('token') ?? '');
        if (!enlace) {
          html(res, 401, paginaApp('Enlace vencido', '<p>Pedí otro enlace en el portal.</p>'));
          return true;
        }
        if (!enlace.reutilizable) enlaces.delete(url.searchParams.get('token') ?? '');
        abrirSesion(res, enlace.rol, 'token');
        return true;
      }
      case 'GET /app/salir':
        sesiones.delete(cookies[COOKIE_APP]);
        res.writeHead(302, {
          location: '/app/login',
          'set-cookie': `${COOKIE_APP}=; Path=/; Max-Age=0`,
        });
        res.end();
        return true;
      default:
        break;
    }
    if (req.method !== 'GET') return false;
    const datos = sesiones.get(cookies[COOKIE_APP]);
    if (!datos || !vigente(datos)) {
      if (datos) registro.vencidas.push(ruta);
      sinSesion(res, cookies[COOKIE_ORIGEN]);
      return true;
    }
    datos.ultima = ahora();
    datos.paginas += 1;
    if (paginaConSesion(res, ruta, datos)) return true;
    html(res, 404, paginaApp('No encontrada', '<p>No existe esta página.</p>'));
    return true;
  }

  async function atenderIdp(req, res, ruta, url, leerCuerpo) {
    const cookies = leerCookies(req);
    const pedido = url.searchParams;
    const volverConCodigo = (rol, redirectUri, state) => {
      const codigo = aleatorio();
      codigos.set(codigo, { rol });
      const destino = new URL(redirectUri);
      destino.searchParams.set('code', codigo);
      destino.searchParams.set('state', state);
      return destino.href;
    };
    const redirectValido = (texto) => {
      try {
        return new URL(texto).origin === new URL(origenes().app).origin;
      } catch {
        return false;
      }
    };
    if (req.method === 'GET' && ruta === '/idp/autorizar') {
      if (!redirectValido(pedido.get('redirect_uri') ?? '')) {
        html(res, 400, paginaApp('Pedido inválido', '<p>La dirección de vuelta no es válida.</p>'));
        return true;
      }
      const sesionIdp = sesionesIdp.get(cookies[COOKIE_IDP]);
      if (sesionIdp && !sesionIdp.vencida) {
        res.writeHead(302, {
          location: volverConCodigo(
            sesionIdp.rol,
            pedido.get('redirect_uri'),
            pedido.get('state') ?? '',
          ),
        });
        res.end();
        return true;
      }
      const login = new URL('/idp/login', origenes().idp);
      login.search = url.search;
      res.writeHead(302, { location: login.href });
      res.end();
      return true;
    }
    if (ruta === '/idp/login') {
      const accion = `/idp/login${url.search.replace(/&/g, '&amp;')}`;
      if (req.method === 'GET') {
        html(res, 200, formularioLogin(accion, 'Proveedor de identidad'));
        return true;
      }
      if (req.method === 'POST') {
        const datos = new URLSearchParams(await leerCuerpo(req));
        const rol = rolDe(datos.get('usuario'), datos.get('clave'), canario);
        if (!rol || !redirectValido(pedido.get('redirect_uri') ?? '')) {
          html(
            res,
            401,
            formularioLogin(
              accion,
              'Proveedor de identidad',
              '<p role="alert">Datos incorrectos.</p>',
            ),
          );
          return true;
        }
        const id = aleatorio();
        sesionesIdp.set(id, { rol, vencida: false });
        res.writeHead(302, {
          location: volverConCodigo(rol, pedido.get('redirect_uri'), pedido.get('state') ?? ''),
          'set-cookie': `${COOKIE_IDP}=${id}; Path=/idp; HttpOnly; SameSite=Lax`,
        });
        res.end();
        return true;
      }
    }
    return false;
  }

  function atenderPortal(req, res, ruta) {
    if (req.method !== 'GET' || (ruta !== '/portal' && ruta !== '/portal/')) return false;
    const enlaces = ['admin', 'lector']
      .map((rol) => `<li><a href="${api.emitirEnlace(rol)}">Entrar como ${rol}</a></li>`)
      .join('\n');
    html(res, 200, paginaApp('Portal', `<ul>${enlaces}</ul>`));
    return true;
  }

  function atenderBasica(req, res, ruta) {
    if (!ruta.startsWith('/basica')) return false;
    const [tipo, valor] = (req.headers.authorization ?? '').split(' ');
    const [usuario, ...resto] = Buffer.from(valor ?? '', 'base64')
      .toString('utf8')
      .split(':');
    if (
      tipo !== 'Basic' ||
      usuario !== USUARIO_BASICA.usuario ||
      resto.join(':') !== USUARIO_BASICA.clave
    ) {
      registro.basicaRechazada += 1;
      html(res, 401, paginaApp('Sin acceso', '<p>Esta zona pide usuario y contraseña.</p>'), {
        'www-authenticate': 'Basic realm="Zona basica del sandbox"',
      });
      return true;
    }
    if (ruta === '/basica' || ruta === '/basica/') {
      html(
        res,
        200,
        paginaApp(
          'Zona básica',
          '<p id="menu-usuario">Entraste.</p><p><a href="/basica/informe">Informe</a></p>',
        ),
      );
      return true;
    }
    if (ruta === '/basica/informe') {
      html(
        res,
        200,
        paginaApp('Informe de la zona básica', '<p><a href="/basica/">Volver</a></p>'),
      );
      return true;
    }
    html(res, 404, paginaApp('No encontrada', '<p>No existe esta página.</p>'));
    return true;
  }

  const api = {
    registro,
    /** Vence todas las sesiones de la app y del proveedor, sin esperar. */
    vencerSesiones() {
      for (const datos of sesiones.values()) datos.vencida = true;
      for (const datos of sesionesIdp.values()) datos.vencida = true;
    },
    /** Lo que haría la persona en su teléfono. */
    aprobarSegundoFactor() {
      for (const factor of factores.values()) factor.aprobado = true;
    },
    /** Un enlace del portal. De un solo uso, salvo que se pida otra cosa. */
    emitirEnlace(rol, { reutilizable = false, token = aleatorio() } = {}) {
      enlaces.set(token, { rol, reutilizable });
      return new URL(`/app/entrar?token=${token}`, origenes().app).href;
    },
  };

  /**
   * Devuelve true si atendió el pedido. `host` ya viene sin puerto y en minúsculas.
   */
  async function atender(req, res, host, leerCuerpo) {
    const url = new URL(req.url ?? '/', 'http://x');
    const ruta = url.pathname;
    const { app, idp, portal } = origenes();
    const hostDe = (origen) => new URL(origen).hostname;
    if (ruta.startsWith('/idp/'))
      return host === hostDe(idp) && atenderIdp(req, res, ruta, url, leerCuerpo);
    if (ruta.startsWith('/portal')) return host === hostDe(portal) && atenderPortal(req, res, ruta);
    if (host !== hostDe(app)) return false;
    if (ruta === '/app' || ruta.startsWith('/app/'))
      return atenderApp(req, res, ruta, url, leerCuerpo);
    return atenderBasica(req, res, ruta);
  }

  return { atender, api };
}
