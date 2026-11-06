import { describe, expect, it } from 'vitest';
import {
  parametrosSensibles,
  analizarCookie,
  claveDeMensaje,
  esAntiCsrf,
  TITULO_COOKIE_SIN_VENCIMIENTO,
  segmentosDeNombre,
  coincideExclusion,
  consoleErrorRelevante,
  hallazgoDeEstado,
  hallazgosDeRendimiento,
  hostDe,
  normalizarMensaje,
  SEVERIDAD,
  severidadDeAccesibilidad,
  UMBRALES,
} from './chequeos';

const URL_PAGINA = 'https://app.lexora.test/x';

describe('Severidad automática (tabla de 6.3)', () => {
  it('cada tipo tiene la de la tabla', () => {
    expect(SEVERIDAD).toMatchObject({
      'error-javascript': 'alta',
      'link-roto': 'media',
      'recurso-con-error': 'media',
      'console-error': 'baja',
      'cookie-insegura': 'alta',
      'contenido-mixto': 'alta',
      'login-sin-cifrar': 'alta',
      'recurso-externo-bloqueado': 'informativa',
      rendimiento: 'baja',
    });
  });

  it.each([
    ['critical', 'alta'],
    ['serious', 'media'],
    ['moderate', 'baja'],
    ['minor', 'baja'],
    [null, 'baja'],
  ])('accesibilidad %s → %s', (impacto, severidad) => {
    expect(severidadDeAccesibilidad(impacto)).toBe(severidad);
  });
});

describe('Estado HTTP de la página', () => {
  it('2xx y 3xx están bien', () => {
    expect(hallazgoDeEstado(200, URL_PAGINA, null)).toBeNull();
    expect(hallazgoDeEstado(304, URL_PAGINA, null)).toBeNull();
  });

  it('5xx es crítica', () => {
    expect(hallazgoDeEstado(503, URL_PAGINA, null)).toMatchObject({
      tipo: 'error-http',
      severidad: 'critica',
      clave: '503',
    });
  });

  it('404 o 410 al seguir un link es un link roto, con su origen', () => {
    expect(hallazgoDeEstado(404, URL_PAGINA, 'https://app.lexora.test/')).toMatchObject({
      tipo: 'link-roto',
      severidad: 'media',
      urlOrigen: 'https://app.lexora.test/',
    });
    expect(hallazgoDeEstado(410, URL_PAGINA, 'https://app.lexora.test/')?.tipo).toBe('link-roto');
  });

  it('un 404 sin origen, o cualquier otro 4xx, es un error HTTP', () => {
    expect(hallazgoDeEstado(404, URL_PAGINA, null)?.tipo).toBe('error-http');
    expect(hallazgoDeEstado(403, URL_PAGINA, 'https://app.lexora.test/')).toMatchObject({
      tipo: 'error-http',
      severidad: 'media',
    });
  });
});

describe('console.error', () => {
  it('cuenta un error del sitio', () => {
    expect(consoleErrorRelevante('TypeError: x is undefined', [])).toBe(true);
  });

  it.each([
    'Failed to load resource: the server responded with a status of 404 ()',
    "Mixed Content: The page at 'https://x.test/' was loaded over HTTPS",
    "WebSocket connection to 'ws://ws.fuga.example/canal' failed",
  ])('descarta: %s', (texto) => {
    expect(consoleErrorRelevante(texto, ['ws.fuga.example'])).toBe(false);
  });

  it('la clave de un mensaje es un hash: el texto de la página no queda en claro', () => {
    const clave = claveDeMensaje('TypeError: la tarjeta 4111 no existe');
    expect(clave).toMatch(/^msj:[0-9a-f]{16}$/);
    expect(clave).not.toContain('tarjeta');
    // El mismo problema con otros números da la misma clave.
    expect(claveDeMensaje('TypeError: la tarjeta 5500 no existe')).toBe(clave);
    expect(claveDeMensaje('Otro error')).not.toBe(clave);
  });

  it('el mensaje se normaliza para la clave: sin números ni IDs', () => {
    expect(
      normalizarMensaje('Error 42 en 3f2a1b9c-1234-4234-8234-123456789012\nsegunda línea'),
    ).toBe('Error # en <id>');
  });
});

describe('Cookies de sesión', () => {
  it('una cookie de sesión sin HttpOnly se marca; no se guarda el valor', () => {
    const cookie = analizarCookie('sesion=abc123; Path=/', false);
    expect(cookie).toEqual({
      nombre: 'sesion',
      deSesion: true,
      faltaHttpOnly: true,
      faltaSecure: false,
    });
    expect(JSON.stringify(cookie)).not.toContain('abc123');
  });

  it('en HTTP no se pide Secure: el problema es el login sin cifrar', () => {
    expect(analizarCookie('sid=x; Path=/; HttpOnly', false)).toBeNull();
  });

  it('en HTTPS se pide Secure', () => {
    expect(analizarCookie('sid=x; Path=/; HttpOnly', true)).toEqual({
      nombre: 'sid',
      deSesion: true,
      faltaHttpOnly: false,
      faltaSecure: true,
    });
  });

  it.each([
    ['ASP.NET_SessionId', ['asp', 'net', 'session', 'id']],
    ['authToken', ['auth', 'token']],
    ['sesion_anonima', ['sesion', 'anonima']],
    ['connect.sid', ['connect', 'sid']],
    ['__RequestVerificationToken', ['request', 'verification', 'token']],
  ])('segmentos de %s', (nombre, segmentos) => {
    expect(segmentosDeNombre(nombre)).toEqual(segmentos);
  });

  it.each(['preferences', 'classes', 'messages', 'sesame', 'sidebar_estado'])(
    'un nombre que contiene «ses» o «sid» sin serlo no es de sesión: %s',
    (nombre) => {
      expect(analizarCookie(`${nombre}=x; Max-Age=3600`, true)).toBeNull();
    },
  );

  it.each(['PHPSESSID', 'JSESSIONID', 'ASP.NET_SessionId', 'connect.sid', 'auth_token', 'jwt'])(
    'un nombre de sesión conocido se reconoce aunque venza: %s',
    (nombre) => {
      expect(analizarCookie(`${nombre}=x; Max-Age=3600`, false)?.faltaHttpOnly).toBe(true);
    },
  );

  it.each(['XSRF-TOKEN', 'csrftoken', '_csrf', '__RequestVerificationToken', 'csrf_token'])(
    'una cookie anti-CSRF sin HttpOnly no es un hallazgo: %s',
    (nombre) => {
      expect(esAntiCsrf(nombre)).toBe(true);
      expect(analizarCookie(`${nombre}=x; Path=/`, false)).toBeNull();
      expect(analizarCookie(`${nombre}=x; Path=/; Secure`, true)).toBeNull();
    },
  );

  it('una anti-CSRF en HTTPS sin Secure sí lo es', () => {
    expect(analizarCookie('XSRF-TOKEN=x; Path=/', true)).toEqual({
      nombre: 'XSRF-TOKEN',
      deSesion: true,
      faltaHttpOnly: false,
      faltaSecure: true,
    });
  });

  it('sin vencimiento y sin indicio en el nombre: informativa si le falta HttpOnly, nada más', () => {
    expect(analizarCookie('tema=oscuro; Path=/', true)).toEqual({
      nombre: 'tema',
      deSesion: false,
      faltaHttpOnly: true,
      faltaSecure: false,
    });
    expect(analizarCookie('tema=oscuro; Path=/; HttpOnly', true)).toBeNull();
    expect(TITULO_COOKIE_SIN_VENCIMIENTO).toBe(
      'Cookie sin vencimiento y sin HttpOnly; si guarda la sesión, debería tener HttpOnly',
    );
  });

  it('no vencer ya no alcanza para ser de sesión', () => {
    expect(analizarCookie('tema=oscuro; Path=/', false)?.deSesion).toBe(false);
    expect(analizarCookie('sesion=x; Path=/', false)?.deSesion).toBe(true);
  });

  it('una cookie con vencimiento y sin nombre de sesión no es de sesión', () => {
    expect(analizarCookie('preferencia=oscuro; Max-Age=3600', true)).toBeNull();
    expect(analizarCookie('idioma=es; Expires=Wed, 01 Jan 2031 00:00:00 GMT', true)).toBeNull();
  });

  it('el nombre puede hacerla de sesión aunque venza', () => {
    expect(analizarCookie('auth_token=x; Max-Age=3600', true)?.nombre).toBe('auth_token');
  });

  it('con todo lo que hace falta, no hay hallazgo', () => {
    expect(analizarCookie('sesion=x; Secure; HttpOnly; SameSite=Lax', true)).toBeNull();
  });

  it('un encabezado sin nombre se ignora', () => {
    expect(analizarCookie('=x', true)).toBeNull();
  });
});

describe('Rendimiento', () => {
  const sano = { cargaMs: 800, lcpMs: 900, pesoBytes: 100_000, requestsLentas: 0 };

  it('una página sana no tiene hallazgos', () => {
    expect(hallazgosDeRendimiento(URL_PAGINA, sano)).toEqual([]);
  });

  it('cada umbral da su hallazgo, con severidad baja', () => {
    const hallazgos = hallazgosDeRendimiento(URL_PAGINA, {
      cargaMs: UMBRALES.cargaMs,
      lcpMs: UMBRALES.lcpMs + 1,
      pesoBytes: UMBRALES.pesoBytes + 1,
      requestsLentas: 2,
    });
    expect(hallazgos.map((h) => h.clave)).toEqual(['carga', 'lcp', 'peso', 'request-lenta']);
    expect(hallazgos.every((h) => h.severidad === 'baja')).toBe(true);
  });

  it('justo por debajo, nada', () => {
    expect(
      hallazgosDeRendimiento(URL_PAGINA, {
        cargaMs: UMBRALES.cargaMs - 1,
        lcpMs: UMBRALES.lcpMs,
        pesoBytes: UMBRALES.pesoBytes,
        requestsLentas: 0,
      }),
    ).toEqual([]);
  });

  it('sin medición, nada', () => {
    expect(hallazgosDeRendimiento(URL_PAGINA, { ...sano, cargaMs: null, lcpMs: null })).toEqual([]);
  });
});

describe('Varios', () => {
  it('hostDe', () => {
    expect(hostDe('http://127.0.0.1:3000/x')).toBe('127.0.0.1:3000');
    expect(hostDe('no es url')).toBe('');
  });

  it('una exclusión vale por texto o por atributos, sin distinguir mayúsculas', () => {
    expect(coincideExclusion(['Quitar todo', 'eliminar-todo'], ['eliminar'])).toBe(true);
    expect(coincideExclusion(['Ver detalle'], ['eliminar'])).toBe(false);
    expect(coincideExclusion(['CERRAR SESIÓN'], ['cerrar sesión'])).toBe(true);
  });
});

describe('parametrosSensibles (semana 6b)', () => {
  it.each([
    ['https://x.test/a?token=abc', ['token:media']],
    ['https://x.test/a?access_token=abc&vista=1', ['access_token:media']],
    ['https://x.test/a?apiKey=abc', ['apiKey:media']],
    ['https://x.test/a?api_key=abc', ['api_key:media']],
    ['https://x.test/a?sessionId=1&SID=2', ['sessionId:media', 'SID:media']],
    ['https://x.test/cb?code=abc&state=xyz', ['code:informativa']],
    ['https://x.test/a?code=abc', ['code:media']],
    ['https://x.test/a?tokenizer=1&authors=2&pagina=3', []],
    ['https://x.test/a', []],
    ['no es una url', []],
  ])('%s', (url, esperado) => {
    expect(parametrosSensibles(url).map((p) => `${p.nombre}:${p.severidad}`)).toEqual(esperado);
  });
});
