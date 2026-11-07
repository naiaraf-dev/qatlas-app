import { describe, expect, it } from 'vitest';
import {
  depurarEstado,
  EXCLUSIONES_DE_CIERRE,
  hallazgosDeSecretos,
  iniciarSesion,
  llevaBasica,
  motivoDeSospecha,
  variantesDeSecreto,
  type EstadoSesion,
  type SenalesDePagina,
} from './sesion';
import type { Browser } from 'playwright-core';
import { coincideExclusion } from './chequeos';

const POLITICA = {
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.lexora.test', '*.api.lexora.test'],
  sistemaInterno: false,
  puertosLocales: [],
};

const cookie = (name: string, value: string, domain: string) => ({
  name,
  value,
  domain,
  path: '/',
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: 'Lax' as const,
});

describe('variantesDeSecreto', () => {
  it('el valor, codificado para URL y en base64', () => {
    expect(variantesDeSecreto('clave mía+1')).toEqual([
      'clave mía+1',
      'clave%20m%C3%ADa%2B1',
      'Y2xhdmUgbcOtYSsx',
    ]);
  });

  it('menos de 4 caracteres no se busca: daría falsos positivos en todo', () => {
    expect(variantesDeSecreto('abc')).toEqual([]);
  });
});

describe('depurarEstado (TS-06)', () => {
  const SECRETO = 'CANARIO-contrasena-07';
  const estado: EstadoSesion = {
    cookies: [
      cookie('sesion', 'abc123', 'app.lexora.test'),
      cookie('idp_sesion', 'xyz', 'idp.lexora.test'),
      cookie('recordar', encodeURIComponent(SECRETO), '.app.lexora.test'),
      cookie('api', 'k', 'v1.api.lexora.test'),
    ],
    origins: [
      {
        origin: 'https://app.lexora.test',
        localStorage: [
          { name: 'tema', value: 'oscuro' },
          { name: 'clave-recordada', value: SECRETO },
          { name: 'b64', value: `x${Buffer.from(SECRETO).toString('base64')}x` },
        ],
      },
      { origin: 'https://idp.lexora.test', localStorage: [{ name: 'x', value: 'y' }] },
    ],
  };

  it('deja solo el alcance del escaneo y saca todo lo que contiene el secreto', () => {
    const { estado: limpio, encontrados } = depurarEstado(estado, POLITICA, [SECRETO]);
    expect(limpio.cookies.map((c) => c.name)).toEqual(['sesion', 'api']);
    expect(limpio.origins).toEqual([
      { origin: 'https://app.lexora.test', localStorage: [{ name: 'tema', value: 'oscuro' }] },
    ]);
    expect(JSON.stringify(limpio)).not.toContain('CANARIO');
    expect(encontrados).toEqual([
      { tipo: 'cookie', nombre: 'recordar', origen: 'app.lexora.test' },
      { tipo: 'localStorage', nombre: 'clave-recordada', origen: 'https://app.lexora.test' },
      { tipo: 'localStorage', nombre: 'b64', origen: 'https://app.lexora.test' },
    ]);
  });

  it('sin secretos, solo filtra por alcance', () => {
    expect(depurarEstado(estado, POLITICA, []).encontrados).toEqual([]);
  });

  it('el hallazgo dice dónde, nunca el valor', () => {
    const { encontrados } = depurarEstado(estado, POLITICA, [SECRETO]);
    const hallazgos = hallazgosDeSecretos(encontrados, 'https://app.lexora.test/login');
    expect(hallazgos.map((h) => [h.tipo, h.severidad, h.clave])).toEqual([
      ['secreto-en-almacenamiento', 'alta', 'cookie:recordar'],
      ['secreto-en-almacenamiento', 'alta', 'localStorage:clave-recordada'],
      ['secreto-en-almacenamiento', 'alta', 'localStorage:b64'],
    ]);
    expect(JSON.stringify(hallazgos)).not.toContain('CANARIO');
  });
});

describe('motivoDeSospecha (ADR 027)', () => {
  const DATOS = {
    urlLogin: 'https://app.lexora.test/login',
    dominiosAutenticacion: ['idp.lexora.test', '*.sso.lexora.test'],
  };
  const sana: SenalesDePagina = {
    urlFinal: 'https://app.lexora.test/panel',
    estado: 200,
    bloqueadaPorNosotros: false,
    navegacionesBloqueadas: [],
    formularioDeLogin: false,
  };

  it.each<[string, Partial<SenalesDePagina>, string | null]>([
    ['una página normal', {}, null],
    [
      'terminó en la URL de login, con query',
      { urlFinal: 'https://app.lexora.test/login?volver=/x' },
      'url-de-login',
    ],
    [
      'una redirección al proveedor, que cortamos',
      { urlFinal: null, estado: null, navegacionesBloqueadas: ['idp.lexora.test'] },
      'dominio-de-autenticacion',
    ],
    [
      'un comodín de autenticación',
      { navegacionesBloqueadas: ['a.sso.lexora.test'] },
      'dominio-de-autenticacion',
    ],
    [
      'otro dominio cortado no es una sospecha',
      { urlFinal: null, estado: null, navegacionesBloqueadas: ['evil.example'] },
      null,
    ],
    ['un 401', { estado: 401 }, 'no-autorizado'],
    ['un 403 del sitio', { estado: 403 }, 'prohibido'],
    ['un 403 de nuestro proxy no lo es', { estado: 403, bloqueadaPorNosotros: true }, null],
    ['el formulario de login en pantalla', { formularioDeLogin: true }, 'formulario-de-login'],
    ['un 404 no lo es', { estado: 404 }, null],
  ])('%s', (_nombre, cambios, esperado) => {
    expect(motivoDeSospecha({ ...sana, ...cambios }, DATOS)).toBe(esperado);
  });
});

describe('Exclusiones de cierre de sesión', () => {
  it.each([
    [['https://app.lexora.test/logout']],
    [['https://app.lexora.test/app/salir', 'Salir']],
    [['#', 'Cerrar sesión']],
    [['https://app.lexora.test/auth/sign-out']],
  ])('%j no se toca', (textos) => {
    expect(coincideExclusion(textos, EXCLUSIONES_DE_CIERRE)).toBe(true);
  });

  it('un link común sí', () => {
    expect(
      coincideExclusion(['https://app.lexora.test/informes', 'Informes'], EXCLUSIONES_DE_CIERRE),
    ).toBe(false);
  });
});

describe('llevaBasica (ADR 025)', () => {
  const HTTPS = { origen: 'https://app.example.test', permitirHttp: false };
  const HTTP = { origen: 'http://app.example.test:8080', permitirHttp: false };

  it('en https, solo al origen exacto', () => {
    expect(llevaBasica('https://app.example.test/panel?x=1', HTTPS)).toBe(true);
    expect(llevaBasica('https://app.example.test:443/panel', HTTPS)).toBe(true);
    expect(llevaBasica('https://app.example.test:8443/panel', HTTPS)).toBe(false);
    expect(llevaBasica('https://otra.example.test/panel', HTTPS)).toBe(false);
    expect(llevaBasica('https://example.test/panel', HTTPS)).toBe(false);
    expect(llevaBasica('https://app.example.test.evil.example/', HTTPS)).toBe(false);
    expect(llevaBasica('wss://app.example.test/socket', HTTPS)).toBe(false);
  });

  it('nunca baja a http, aunque sea el mismo host', () => {
    expect(llevaBasica('http://app.example.test/panel', HTTPS)).toBe(false);
    expect(llevaBasica('http://app.example.test/panel', { ...HTTPS, permitirHttp: true })).toBe(
      false,
    );
  });

  it('en http, nunca sin «Permitir login sin cifrar», tampoco en un equipo local o .test', () => {
    expect(llevaBasica('http://app.example.test:8080/panel', HTTP)).toBe(false);
    expect(
      llevaBasica('http://localhost:8080/', {
        origen: 'http://localhost:8080',
        permitirHttp: false,
      }),
    ).toBe(false);
    expect(llevaBasica('http://app.example.test:8080/panel', { ...HTTP, permitirHttp: true })).toBe(
      true,
    );
  });

  it('con la opción, igual solo al origen exacto', () => {
    const conOpcion = { ...HTTP, permitirHttp: true };
    expect(llevaBasica('http://app.example.test/panel', conOpcion)).toBe(false);
    expect(llevaBasica('http://otra.example.test:8080/panel', conOpcion)).toBe(false);
    expect(llevaBasica('https://app.example.test:8080/panel', conOpcion)).toBe(false);
  });

  it('una URL que no se puede leer no la lleva', () => {
    expect(llevaBasica('no es una url', HTTPS)).toBe(false);
    expect(llevaBasica('', HTTPS)).toBe(false);
  });
});

describe('Login asistido sin ventana (ADR 028)', () => {
  const ERROR_SIN_PANTALLA =
    "browserType.launchPersistentContext: Target page, context or browser has been closed\nBrowser logs:\n\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗\n║ Looks like you launched a headed browser without having a XServer running.                     ║\n║ Set either 'headless: true' or use 'xvfb-run <your-playwright-app>' before running Playwright. ║\n╚════════════════════════════════════════════════════════════════════════════════════════════════╝\nCall log:\n  - <launching> /home/ana/.cache/ms-playwright/chromium-1/chrome-linux/chrome --user-data-dir=/home/ana/datos/perfiles/1234abcd/asistido-x\n  - [pid=1][err] [1:1:ERROR:ozone_platform_x11.cc(240)] Missing X server or $DISPLAY\n  - [pid=1][err] [1:1:ERROR:env.cc(257)] The platform failed to initialize.  Exiting.";

  it('si la ventana no abre, falla enseguida con la causa y sin rutas, y no se reintenta como un login', async () => {
    let intentos = 0;
    const resultado = await iniciarSesion({} as Browser, {
      datos: {
        estrategia: 'asistido',
        urlLogin: 'https://app.example.test/login',
        pasos: [],
        indicador: { tipo: 'aparece', selector: '#menu' },
        usuario: '',
        dominiosAutenticacion: [],
        sesionMaxMs: null,
        permitirLoginHttp: false,
      },
      proxy: { servidor: 'http://127.0.0.1:1', usuario: 'u', clave: 'c' },
      politica: {
        urlBase: 'https://app.example.test/',
        dominios: ['app.example.test'],
        sistemaInterno: false,
        puertosLocales: [],
      },
      secreto: null,
      timeoutMs: 1000,
      alRegistrar: () => undefined,
      abrirVisible: () => {
        intentos += 1;
        return Promise.reject(new Error(ERROR_SIN_PANTALLA));
      },
      politicaDelEscaneo: {
        urlBase: 'https://app.example.test/',
        dominios: ['app.example.test'],
        sistemaInterno: false,
        puertosLocales: [],
      },
      origenBase: 'https://app.example.test',
    });
    expect(intentos).toBe(1);
    expect(resultado).toMatchObject({ resultado: 'ventana-no-disponible', causa: 'pantalla' });
    const detalle = resultado.resultado === 'ventana-no-disponible' ? resultado.detalle : '';
    expect(detalle).toContain('Missing X server or $DISPLAY');
    expect(detalle).not.toMatch(/ana|launching|user-data-dir|perfiles/);
  });
});
