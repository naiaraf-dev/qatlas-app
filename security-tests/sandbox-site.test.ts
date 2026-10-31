/**
 * La app de prueba: el manifiesto coincide con lo que el sitio hace, y un intento de fuga nunca puede
 * llegar a un dominio real, aunque el proxy falle (ADR 012).
 */
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CREDENCIALES_DE_PRUEBA,
  HOST_ESCUCHA,
  HOSTS_DE_FUGA,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  REGLAS_RESOLVER,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';

const RAIZ = path.resolve(import.meta.dirname, '..');
const manifiesto = JSON.parse(
  readFileSync(path.join(RAIZ, 'apps/sandbox-site/hallazgos-esperados.json'), 'utf8'),
) as {
  hallazgos: {
    id: string;
    tipo: string;
    url: string;
    origen?: string;
    severidad: string;
    regla?: string;
  }[];
  soloLectura: { url: string; origen: string; metodo: string }[];
  exclusiones: { url: string; origen: string; texto: string }[];
  fugas: { host: string; origen: string; tipo: string }[];
};

const RESERVADOS = /\.(test|example|invalid)$/;

let sitio: SandboxActivo;

interface Respuesta {
  estado: number;
  cuerpo: string;
  encabezados: Record<string, string | string[] | undefined>;
}

function pedir(
  ruta: string,
  {
    metodo = 'GET',
    host,
    cookie,
    cuerpo,
  }: {
    metodo?: string;
    host?: string;
    cookie?: string;
    cuerpo?: string;
  } = {},
): Promise<Respuesta> {
  return new Promise((resolver, rechazar) => {
    const req = request(
      {
        host: HOST_ESCUCHA,
        port: sitio.puerto,
        path: ruta,
        method: metodo,
        headers: {
          ...(host ? { host } : {}),
          ...(cookie ? { cookie } : {}),
          ...(cuerpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
        },
      },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (trozo: string) => {
          texto += trozo;
        });
        res.on('end', () => {
          resolver({ estado: res.statusCode ?? 0, cuerpo: texto, encabezados: res.headers });
        });
      },
    );
    req.on('error', rechazar);
    req.end(cuerpo);
  });
}

const login = () =>
  pedir('/login', {
    metodo: 'POST',
    cuerpo: new URLSearchParams(
      Object.entries({
        usuario: CREDENCIALES_DE_PRUEBA.usuario,
        clave: CREDENCIALES_DE_PRUEBA.clave,
      }),
    ).toString(),
  });

beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, demoraLentaMs: 50 });
});

afterAll(async () => {
  await sitio.cerrar();
});

describe('Intentos de fuga: nunca a un dominio real', () => {
  it('cada dominio de fuga del manifiesto es reservado', () => {
    expect(manifiesto.fugas.length).toBeGreaterThanOrEqual(3);
    for (const { host } of manifiesto.fugas) expect(host).toMatch(RESERVADOS);
  });

  it('cada dominio de fuga del manifiesto está mapeado a 127.0.0.1', () => {
    for (const { host } of manifiesto.fugas) {
      expect(MAPA_DE_HOSTS[host]).toBe('127.0.0.1');
      expect(REGLAS_RESOLVER).toContain(`MAP ${host} 127.0.0.1`);
    }
  });

  it('el manifiesto y el servidor declaran los mismos dominios', () => {
    expect(manifiesto.fugas.map((f) => f.host).sort()).toEqual([...HOSTS_DE_FUGA].sort());
  });

  it('todo el mapa apunta a 127.0.0.1 y a dominios reservados', () => {
    for (const [host, ip] of Object.entries(MAPA_DE_HOSTS)) {
      expect(host).toMatch(RESERVADOS);
      expect(ip).toBe('127.0.0.1');
    }
  });

  it('ninguna página referencia un host fuera de los reservados', async () => {
    const rutas = [
      '/',
      '/login',
      '/error-500',
      '/excepcion-js',
      '/links-rotos',
      '/consola',
      '/accesibilidad',
      '/formulario',
      '/fuga',
      ...manifiesto.hallazgos.map((h) => h.url),
    ];
    const html = await Promise.all(rutas.map((r) => pedir(r).then((res) => res.cuerpo)));
    const panel = await pedir('/panel', { cookie: 'sesion=sesion-de-prueba-inventada' });
    const hosts = [
      ...[...html, panel.cuerpo].join('\n').matchAll(/https?:\/\/([^/:"'\s<>]+)/g),
    ].map((m) => m[1] as string);
    expect(hosts.length).toBeGreaterThanOrEqual(3);
    for (const host of hosts) expect(host).toMatch(RESERVADOS);
  });

  it('la página de fuga intenta llegar a los tres dominios', async () => {
    const { cuerpo } = await pedir('/fuga');
    expect(cuerpo).toContain(`<script src="http://analitica.fuga.test:${String(sitio.puerto)}/`);
    expect(cuerpo).toContain(`src="http://pixel.fuga.example:${String(sitio.puerto)}/`);
    expect(cuerpo).toContain(`fetch('http://api.fuga.invalid:${String(sitio.puerto)}/`);
  });

  it.each(HOSTS_DE_FUGA)('una conexión que llegue a %s queda registrada', async (host) => {
    const res = await pedir('/a.js', { host: `${host}:${String(sitio.puerto)}` });
    expect(res.estado).toBe(204);
    expect(sitio.registro.fugas).toContain(host);
  });
});

describe('Red', () => {
  it('escucha solo en 127.0.0.1', () => {
    expect(sitio.direccion).toBe('127.0.0.1');
  });

  it('rechaza un Host desconocido (DNS rebinding)', async () => {
    expect((await pedir('/', { host: 'evil.example' })).estado).toBe(421);
    expect((await pedir('/', { host: 'sandbox.test.evil.example' })).estado).toBe(421);
  });

  it('acepta su propio nombre', async () => {
    expect((await pedir('/', { host: 'sandbox.test' })).estado).toBe(200);
  });

  it('nunca se empaqueta: la app no depende de él', () => {
    const paquete = readFileSync(path.join(RAIZ, 'apps/desktop/package.json'), 'utf8');
    const vite = readFileSync(path.join(RAIZ, 'apps/desktop/electron.vite.config.ts'), 'utf8');
    expect(paquete).not.toContain('sandbox-site');
    expect(vite).not.toContain('sandbox-site');
  });
});

describe('El sitio hace lo que dice el manifiesto', () => {
  it('cada hallazgo tiene tipo, URL y severidad válidos', () => {
    expect(manifiesto.hallazgos.length).toBeGreaterThanOrEqual(10);
    for (const { tipo, url, severidad } of manifiesto.hallazgos) {
      expect(tipo).toBeTruthy();
      expect(url).toMatch(/^\//);
      expect(['critica', 'alta', 'media', 'baja']).toContain(severidad);
    }
    const ids = manifiesto.hallazgos.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('la página con error responde 500', async () => {
    const { url } = manifiesto.hallazgos.find((h) => h.tipo === 'error-http') as { url: string };
    expect((await pedir(url)).estado).toBe(500);
  });

  it('los links rotos responden 404 y están en su página de origen', async () => {
    const rotos = manifiesto.hallazgos.filter((h) => h.tipo === 'link-roto');
    expect(rotos).toHaveLength(2);
    for (const { url, origen } of rotos) {
      expect((await pedir(url)).estado).toBe(404);
      expect((await pedir(origen ?? '')).cuerpo).toContain(`href="${url}"`);
    }
  });

  it('la excepción y el console.error están plantados', async () => {
    expect((await pedir('/excepcion-js')).cuerpo).toContain('throw new Error');
    expect((await pedir('/consola')).cuerpo).toContain('console.error');
  });

  it('los problemas de accesibilidad están plantados', async () => {
    const { cuerpo } = await pedir('/accesibilidad');
    expect(cuerpo).toMatch(/<img src="[^"]+">/);
    expect(cuerpo).toContain('<button type="button"></button>');
    expect(cuerpo).toContain('<input type="text">');
    expect(cuerpo).toContain('color:#bbbbbb');
  });

  it('la página lenta demora', async () => {
    const inicio = performance.now();
    await pedir('/lenta');
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(45);
  });

  it('el login con las credenciales de prueba da una cookie sin Secure ni HttpOnly', async () => {
    const res = await login();
    expect(res.estado).toBe(302);
    const [cookie] = res.encabezados['set-cookie'] as string[];
    expect(cookie).toMatch(/^sesion=/);
    expect(cookie).not.toMatch(/secure/i);
    expect(cookie).not.toMatch(/httponly/i);
  });

  it('un login incorrecto se rechaza y el panel exige sesión', async () => {
    const mala = await pedir('/login', { metodo: 'POST', cuerpo: 'usuario=x&clave=y' });
    expect(mala.estado).toBe(401);
    expect(mala.encabezados['set-cookie']).toBeUndefined();
    expect((await pedir('/panel')).estado).toBe(302);
  });

  it('un cuerpo demasiado grande no tira el servidor', async () => {
    await pedir('/login', { metodo: 'POST', cuerpo: 'x'.repeat(10000) }).catch(() => undefined);
    expect((await pedir('/')).estado).toBe(200);
  });

  it('las trampas están en el panel y se registran si alguien las visita', async () => {
    const [cookie] = (await login()).encabezados['set-cookie'] as string[];
    const panel = await pedir('/panel', { cookie: (cookie as string).split(';')[0] as string });
    expect(panel.estado).toBe(200);
    for (const { url, texto } of manifiesto.exclusiones) {
      expect(panel.cuerpo).toContain(`<a href="${url}">${texto}</a>`);
      await pedir(url);
      expect(sitio.registro.trampas).toContain(url);
    }
  });

  it('el formulario hace POST y se registra', async () => {
    const { url, origen } = manifiesto.soloLectura[0] as { url: string; origen: string };
    expect((await pedir(origen)).cuerpo).toContain(`method="post" action="${url}"`);
    expect(sitio.registro.posts).toEqual([]);
    await pedir(url, { metodo: 'POST', cuerpo: 'mensaje=hola' });
    expect(sitio.registro.posts).toEqual([url]);
  });
});
