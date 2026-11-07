/**
 * La zona con login del sandbox (semana 6b) hace lo que dice: roles, proveedor de identidad en otro
 * dominio, enlace con token, segundo factor, autenticación básica y vencimientos con un reloj controlado.
 */
import { request } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HOST_IDP,
  HOST_PORTAL,
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  USUARIO_BASICA,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';

interface Respuesta {
  estado: number;
  encabezados: Record<string, string | string[] | undefined>;
  cuerpo: string;
}

let sitio: SandboxActivo | undefined;
let reloj = 0;

afterEach(async () => {
  await sitio?.cerrar();
  sitio = undefined;
});

async function levantar(
  sesion: { inactividadMs?: number; maximoMs?: number; maximoPaginas?: number } = {},
) {
  reloj = 1_000_000;
  sitio = await iniciarSandbox({ puerto: 0, sesion, ahora: () => reloj });
  return sitio;
}

/** Un navegador mínimo: cookies por host y redirecciones a mano, como las seguiría Chromium. */
function cliente(activo: SandboxActivo) {
  const frascos = new Map<string, Map<string, string>>();
  const frasco = (host: string) => {
    if (!frascos.has(host)) frascos.set(host, new Map());
    return frascos.get(host) as Map<string, string>;
  };

  function pedir(
    url: string,
    {
      metodo = 'GET',
      cuerpo,
      autorizacion,
    }: { metodo?: string; cuerpo?: string; autorizacion?: string } = {},
  ): Promise<Respuesta> {
    const destino = new URL(url, `http://${HOST_SITIO}:${activo.puerto}`);
    const cookies = [...frasco(destino.hostname)].map(([n, v]) => `${n}=${v}`).join('; ');
    return new Promise((listo, fallo) => {
      const pedido = request(
        {
          host: '127.0.0.1',
          port: activo.puerto,
          method: metodo,
          path: destino.pathname + destino.search,
          headers: {
            host: destino.host,
            ...(cookies ? { cookie: cookies } : {}),
            ...(cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
            ...(autorizacion ? { authorization: autorizacion } : {}),
          },
        },
        (res) => {
          let texto = '';
          res.setEncoding('utf8');
          res.on('data', (t: string) => (texto += t));
          res.on('end', () => {
            for (const linea of [res.headers['set-cookie'] ?? []].flat()) {
              const [par] = linea.split(';');
              const [nombre, ...valor] = (par ?? '').split('=');
              if (!nombre) continue;
              if (/Max-Age=0/i.test(linea)) frasco(destino.hostname).delete(nombre);
              else frasco(destino.hostname).set(nombre, valor.join('='));
            }
            listo({ estado: res.statusCode ?? 0, encabezados: res.headers, cuerpo: texto });
          });
        },
      );
      pedido.on('error', fallo);
      pedido.end(cuerpo);
    });
  }

  /** Sigue las redirecciones y devuelve la última respuesta y su URL. */
  async function navegar(url: string, opciones?: Parameters<typeof pedir>[1]) {
    let actual = new URL(url, `http://${HOST_SITIO}:${activo.puerto}`).href;
    let respuesta = await pedir(actual, opciones);
    for (let i = 0; i < 10 && respuesta.estado >= 300 && respuesta.estado < 400; i++) {
      actual = new URL(String(respuesta.encabezados.location), actual).href;
      respuesta = await pedir(actual);
    }
    return { ...respuesta, url: actual };
  }

  return { pedir, navegar, frasco };
}

const formulario = (rol: 'admin' | 'lector') =>
  new URLSearchParams({
    usuario: USUARIOS_APP[rol].usuario,
    clave: USUARIOS_APP[rol].clave,
  }).toString();

describe('Sandbox: formulario y roles', () => {
  it('sin sesión, la app manda al login', async () => {
    const c = cliente(await levantar());
    const r = await c.navegar('/app/inicio');
    expect(r.url).toMatch(/\/app\/login$/);
    expect(r.cuerpo).toContain('type="password"');
  });

  it('cada rol ve lo suyo; un 403 por rol no cierra la sesión', async () => {
    const activo = await levantar();
    for (const rol of ['admin', 'lector'] as const) {
      const c = cliente(activo);
      const r = await c.navegar('/app/login', { metodo: 'POST', cuerpo: formulario(rol) });
      expect(r.url).toMatch(/\/app\/inicio$/);
      expect(r.cuerpo).toContain(`Sesión de ${rol}`);
      expect((await c.pedir('/app/admin')).estado).toBe(rol === 'admin' ? 200 : 403);
      expect((await c.pedir('/app/informes')).estado).toBe(200);
    }
    expect(activo.autenticacion.registro.logins).toEqual([
      { via: 'formulario', rol: 'admin' },
      { via: 'formulario', rol: 'lector' },
    ]);
  });

  it('la cookie de la app es HttpOnly y la zona no tiene links al resto del sandbox', async () => {
    const c = cliente(await levantar());
    const login = await c.pedir('/app/login', { metodo: 'POST', cuerpo: formulario('admin') });
    expect(String(login.encabezados['set-cookie'])).toMatch(/app_sesion=\w+; Path=\/; HttpOnly/);
    const inicio = await c.pedir('/app/inicio');
    const links = [...inicio.cuerpo.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(links.every((link) => link?.startsWith('/app/'))).toBe(true);
    // El parámetro sensible plantado.
    expect(links).toContain('/app/compartir?token=enlace-inventado-de-prueba&amp;vista=lista');
  });

  it('el inicio del sandbox no tiene un link a la zona', async () => {
    const c = cliente(await levantar());
    expect((await c.pedir('/')).cuerpo).not.toContain('/app/');
  });

  it('salir cierra la sesión', async () => {
    const c = cliente(await levantar());
    await c.navegar('/app/login', { metodo: 'POST', cuerpo: formulario('admin') });
    await c.pedir('/app/salir');
    expect((await c.navegar('/app/inicio')).url).toMatch(/\/app\/login$/);
  });
});

describe('Sandbox: vencimientos, con el reloj controlado', () => {
  it('por inactividad', async () => {
    const activo = await levantar({ inactividadMs: 1000 });
    const c = cliente(activo);
    await c.navegar('/app/login', { metodo: 'POST', cuerpo: formulario('admin') });
    reloj += 900;
    expect((await c.pedir('/app/informes')).estado).toBe(200);
    reloj += 900;
    expect((await c.pedir('/app/informes')).estado).toBe(200);
    reloj += 1001;
    expect((await c.navegar('/app/informes')).url).toMatch(/\/app\/login$/);
    expect(activo.autenticacion.registro.vencidas).toEqual(['/app/informes']);
  });

  it('por tiempo máximo, aunque haya actividad', async () => {
    const c = cliente(await levantar({ maximoMs: 2000 }));
    await c.navegar('/app/login', { metodo: 'POST', cuerpo: formulario('admin') });
    for (let i = 0; i < 4; i++) {
      reloj += 500;
      expect((await c.pedir('/app/informes')).estado).toBe(200);
    }
    reloj += 1;
    expect((await c.pedir('/app/informes')).estado).toBe(302);
  });

  it('por cantidad de páginas, sin tiempo de por medio', async () => {
    const c = cliente(await levantar({ maximoPaginas: 2 }));
    await c.navegar('/app/login', { metodo: 'POST', cuerpo: formulario('admin') });
    expect((await c.pedir('/app/informes')).estado).toBe(200);
    expect((await c.pedir('/app/informes')).estado).toBe(302);
  });

  it('vencerSesiones vence la app y el proveedor sin esperar', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    await c.navegar('/app/sso');
    const login = await c.navegar('/app/sso');
    await c.navegar(login.url, { metodo: 'POST', cuerpo: formulario('lector') });
    expect((await c.pedir('/app/inicio')).estado).toBe(200);
    activo.autenticacion.vencerSesiones();
    const vuelta = await c.navegar('/app/inicio');
    expect(new URL(vuelta.url).hostname).toBe(HOST_IDP);
    expect(new URL(vuelta.url).pathname).toBe('/idp/login');
  });
});

describe('Sandbox: SSO con redirección', () => {
  it('va al proveedor en otro dominio, vuelve con code y state, y abre la sesión', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    const login = await c.navegar('/app/sso');
    expect(new URL(login.url).hostname).toBe(HOST_IDP);
    const vuelta = await c.navegar(login.url, { metodo: 'POST', cuerpo: formulario('admin') });
    expect(new URL(vuelta.url).hostname).toBe(HOST_SITIO);
    expect(vuelta.cuerpo).toContain('Sesión de admin');
    expect(c.frasco(HOST_IDP).has('idp_sesion')).toBe(true);
    expect(activo.autenticacion.registro.logins).toEqual([{ via: 'sso', rol: 'admin' }]);
  });

  it('con la sesión del proveedor activa, vuelve sin pedir la contraseña', async () => {
    const c = cliente(await levantar());
    const login = await c.navegar('/app/sso');
    await c.navegar(login.url, { metodo: 'POST', cuerpo: formulario('admin') });
    c.frasco(HOST_SITIO).clear();
    expect((await c.navegar('/app/sso')).cuerpo).toContain('Sesión de admin');
  });

  it('el proveedor no devuelve el código a otro origen, y un código no se usa dos veces', async () => {
    const c = cliente(await levantar());
    const ajeno = await c.pedir(
      `http://${HOST_IDP}:0/idp/autorizar?redirect_uri=${encodeURIComponent('http://evil.example/')}&state=x`,
    );
    expect(ajeno.estado).toBe(400);
    expect((await c.pedir('/app/callback?code=inventado&state=x')).estado).toBe(401);
  });

  it('las rutas del proveedor existen solo en su dominio, y las de la app solo en el suyo', async () => {
    const c = cliente(await levantar());
    expect((await c.pedir('/idp/login')).estado).toBe(404);
    expect((await c.pedir(`http://${HOST_IDP}:0/app/login`)).estado).toBe(404);
  });

  it('los dominios nuevos están mapeados a 127.0.0.1 y son reservados', () => {
    for (const host of [HOST_IDP, HOST_PORTAL]) {
      expect(MAPA_DE_HOSTS[host]).toBe('127.0.0.1');
      expect(host).toMatch(/\.test$/);
    }
  });
});

describe('Sandbox: enlace con token', () => {
  it('el portal da enlaces de un solo uso que abren la sesión y sacan el token de la URL', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    const portal = await c.pedir(`http://${HOST_PORTAL}:0/portal/`);
    const enlace = /href="([^"]+entrar\?token=[^"]+)"/.exec(portal.cuerpo)?.[1] ?? '';
    expect(new URL(enlace).hostname).toBe(HOST_SITIO);
    const r = await c.navegar(enlace);
    expect(r.url).toMatch(/\/app\/inicio$/);
    c.frasco(HOST_SITIO).clear();
    expect((await c.pedir(enlace)).estado).toBe(401);
  });

  it('uno reutilizable sirve para volver a entrar; vencida la sesión, la app pide otro enlace', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    const enlace = activo.autenticacion.emitirEnlace('lector', { reutilizable: true });
    await c.navegar(enlace);
    activo.autenticacion.vencerSesiones();
    expect((await c.pedir('/app/inicio')).estado).toBe(401);
    expect((await c.navegar(enlace)).cuerpo).toContain('Sesión de lector');
  });
});

describe('Sandbox: segundo factor (login asistido)', () => {
  it('pide aprobar en el teléfono, y entra cuando el test lo aprueba', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    const pantalla = await c.navegar('/app/login-mfa', {
      metodo: 'POST',
      cuerpo: formulario('admin'),
    });
    expect(pantalla.url).toMatch(/\/app\/segundo-factor$/);
    expect(activo.autenticacion.registro.segundoFactor).toBe(1);
    expect((await c.pedir('/app/segundo-factor/estado')).cuerpo).toBe('pendiente');
    expect((await c.navegar('/app/segundo-factor/completar')).url).toMatch(/login-mfa$/);
    activo.autenticacion.aprobarSegundoFactor();
    expect((await c.pedir('/app/segundo-factor/estado')).cuerpo).toBe('aprobado');
    expect((await c.navegar('/app/segundo-factor/completar')).cuerpo).toContain('Sesión de admin');
  });

  it('la variante plantada guarda la contraseña en localStorage al enviar', async () => {
    const c = cliente(await levantar());
    const pagina = await c.pedir('/app/login-mfa');
    expect(pagina.cuerpo).toContain("localStorage.setItem('clave-recordada'");
  });
});

describe('Sandbox: autenticación HTTP básica', () => {
  it('sin credenciales responde 401 con el desafío; con ellas, entra', async () => {
    const activo = await levantar();
    const c = cliente(activo);
    const sin = await c.pedir('/basica/');
    expect(sin.estado).toBe(401);
    expect(sin.encabezados['www-authenticate']).toMatch(/^Basic realm=/);
    const valor = Buffer.from(`${USUARIO_BASICA.usuario}:${USUARIO_BASICA.clave}`).toString(
      'base64',
    );
    const con = await c.pedir('/basica/', { autorizacion: `Basic ${valor}` });
    expect(con.estado).toBe(200);
    expect(con.cuerpo).toContain('menu-usuario');
    expect(activo.autenticacion.registro.basicaRechazada).toBe(1);
  });
});
