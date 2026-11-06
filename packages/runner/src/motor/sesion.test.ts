import { describe, expect, it } from 'vitest';
import {
  depurarEstado,
  EXCLUSIONES_DE_CIERRE,
  hallazgosDeSecretos,
  motivoDeSospecha,
  variantesDeSecreto,
  type EstadoSesion,
  type SenalesDePagina,
} from './sesion';
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
