import { describe, expect, it } from 'vitest';
import {
  hostPertenece,
  proponerDominio,
  validarAlcance,
  validarDominio,
  validarUrlBase,
  validarUrlLogin,
} from './dominios';

const INTERNO = { sistemaInterno: true };

describe('validarDominio: normalización', () => {
  it.each([
    ['lexora.test', 'lexora.test'],
    ['  lexora.test  ', 'lexora.test'],
    ['LEXORA.Test', 'lexora.test'],
    ['lexora.test.', 'lexora.test'],
    ['lexora.test:8443', 'lexora.test'],
    ['lexora.test/ruta/profunda?a=1#b', 'lexora.test'],
    ['https://Lexora.test:8443/ruta', 'lexora.test'],
    ['HTTP://lexora.test', 'lexora.test'],
    ['app.lexora.test', 'app.lexora.test'],
    ['*.lexora.test', '*.lexora.test'],
    ['*.LEXORA.test.', '*.lexora.test'],
    ['https://*.lexora.test/', '*.lexora.test'],
    ['münchen.test', 'xn--mnchen-3ya.test'],
    ['*.münchen.test', '*.xn--mnchen-3ya.test'],
    ['xn--mnchen-3ya.test', 'xn--mnchen-3ya.test'],
    ['ａｎａ.test', 'ana.test'],
    ['lexora。test', 'lexora.test'],
    ['example.co.uk', 'example.co.uk'],
    ['*.example.co.uk', '*.example.co.uk'],
    ['ana.github.io', 'ana.github.io'],
    ['*.ana.github.io', '*.ana.github.io'],
    ['intranet.local', 'intranet.local'],
    ['lexora.test.evil.com', 'lexora.test.evil.com'],
    ['localhost', 'localhost'],
    ['LOCALHOST', 'localhost'],
    ['localhost:3000', 'localhost'],
    ['127.0.0.1', '127.0.0.1'],
    ['127.0.0.1:43180', '127.0.0.1'],
    ['http://127.0.0.1:43180/panel', '127.0.0.1'],
  ])('%s → %s', (entrada, esperado) => {
    expect(validarDominio(entrada)).toEqual({ ok: true, valor: esperado });
  });

  it('un homógrafo en cirílico no se confunde con el dominio en ASCII', () => {
    const resultado = validarDominio('lеxora.test'); // la "е" es cirílica
    expect(resultado.ok && resultado.valor).toMatch(/^xn--/);
    expect(resultado.ok && resultado.valor).not.toBe('lexora.test');
  });
});

describe('validarDominio: comodines (RN-PRY-05)', () => {
  it.each([
    ['*', 'comodin-amplio'],
    ['*.', 'comodin-amplio'],
    ['*.com', 'comodin-amplio'],
    ['*.COM', 'comodin-amplio'],
    ['*.co.uk', 'comodin-amplio'],
    ['*.com.ar', 'comodin-amplio'],
    ['*.test', 'comodin-amplio'],
    ['*.local', 'comodin-amplio'],
    ['*.github.io', 'comodin-amplio'],
    ['*.vercel.app', 'comodin-amplio'],
    ['*.s3.amazonaws.com', 'comodin-amplio'],
    ['*.intranet', 'comodin-amplio'],
    ['*.localhost', 'comodin-amplio'],
    ['*.127.0.0.1', 'comodin-amplio'],
    ['*.*.lexora.test', 'comodin-invalido'],
    ['*lexora.test', 'comodin-invalido'],
    ['lexora*.test', 'comodin-invalido'],
    ['app.*.test', 'comodin-invalido'],
    ['lexora.test*', 'comodin-invalido'],
  ])('%s se rechaza: %s', (entrada, motivo) => {
    expect(validarDominio(entrada)).toEqual({ ok: false, motivo });
  });

  it.each(['*.intranet', '*.10.0.0.1', '*.192.168.0.1', '*.com', '*'])(
    'Sistema interno no habilita el comodín %s',
    (entrada) => {
      expect(validarDominio(entrada, INTERNO).ok).toBe(false);
    },
  );
});

describe('validarDominio: sufijos públicos', () => {
  it.each(['com', 'co.uk', 'com.ar', 'test', 'local', 'example', 'github.io', 'vercel.app'])(
    '%s no es un dominio concreto',
    (entrada) => {
      expect(validarDominio(entrada)).toEqual({ ok: false, motivo: 'sufijo-publico' });
    },
  );

  it.each(['com', 'test', 'local', 'uk', 'onion', 'invalid'])(
    'Sistema interno tampoco admite %s como host',
    (entrada) => {
      expect(validarDominio(entrada, INTERNO)).toEqual({ ok: false, motivo: 'sufijo-publico' });
    },
  );
});

describe('validarDominio: entradas inválidas', () => {
  it.each([
    ['', 'vacio'],
    ['   ', 'vacio'],
    ['ftp://lexora.test', 'esquema-no-permitido'],
    ['file:///C:/x', 'esquema-no-permitido'],
    ['ws://lexora.test', 'esquema-no-permitido'],
    ['javascript://lexora.test', 'esquema-no-permitido'],
    ['ana:clave@example.test', 'credenciales-en-url'],
    ['https://ana@example.test', 'credenciales-en-url'],
    ['evil.com@example.test', 'credenciales-en-url'],
    ['lexora.test\\evil.com', 'invalido'],
    ['lexora test', 'invalido'],
    ['lexora\t.test', 'invalido'],
    ['lexora.test..', 'invalido'],
    ['.lexora.test', 'invalido'],
    ['lexora..test', 'invalido'],
    ['lexora.test:puerto', 'invalido'],
    ['javascript:alert(1)', 'invalido'],
    ['data:text/html,x', 'invalido'],
    [`${'a'.repeat(250)}.test`, 'invalido'],
    ['x'.repeat(3000), 'invalido'],
  ])('%j se rechaza: %s', (entrada, motivo) => {
    expect(validarDominio(entrada)).toEqual({ ok: false, motivo });
  });

  it.each(['foo.localhost', 'a.b.localhost'])('%s se rechaza: solo localhost exacto', (entrada) => {
    expect(validarDominio(entrada)).toEqual({ ok: false, motivo: 'localhost-no-exacto' });
    expect(validarDominio(entrada, INTERNO)).toEqual({ ok: false, motivo: 'localhost-no-exacto' });
  });
});

describe('validarDominio: IPs', () => {
  it.each([
    ['10.0.0.0'],
    ['10.0.0.1'],
    ['10.255.255.255'],
    ['172.16.0.0'],
    ['172.16.0.1'],
    ['172.31.255.255'],
    ['192.168.0.0'],
    ['192.168.1.20'],
    ['192.168.255.255'],
  ])('privada %s: con Sistema interno sí; sin la opción, no', (ip) => {
    expect(validarDominio(ip)).toEqual({ ok: false, motivo: 'requiere-sistema-interno' });
    expect(validarDominio(ip, INTERNO)).toEqual({ ok: true, valor: ip });
  });

  it.each([
    ['borde bajo de 10/8', '9.255.255.255'],
    ['borde alto de 10/8', '11.0.0.0'],
    ['borde bajo de 172.16/12', '172.15.255.255'],
    ['borde alto de 172.16/12', '172.32.0.0'],
    ['borde bajo de 192.168/16', '192.167.255.255'],
    ['borde alto de 192.168/16', '192.169.0.0'],
    ['sin especificar', '0.0.0.0'],
    ['0/8', '0.1.2.3'],
    ['enlace local, inicio', '169.254.0.0'],
    ['enlace local, metadatos', '169.254.169.254'],
    ['enlace local, fin', '169.254.255.255'],
    ['multicast, inicio', '224.0.0.0'],
    ['multicast, fin', '239.255.255.255'],
    ['reservada', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['otro loopback', '127.0.0.2'],
    ['CGNAT', '100.64.0.1'],
    ['pública', '8.8.8.8'],
    ['pública', '203.0.113.10'],
  ])('%s (%s) se rechaza siempre', (_nombre, ip) => {
    expect(validarDominio(ip)).toEqual({ ok: false, motivo: 'ip-no-permitida' });
    expect(validarDominio(ip, INTERNO)).toEqual({ ok: false, motivo: 'ip-no-permitida' });
  });

  it.each([
    ['decimal', '2130706433'],
    ['hexadecimal', '0x7f.0.0.1'],
    ['hexadecimal corta', '0x7f.1'],
    ['abreviada', '127.1'],
    ['octal', '010.0.0.1'],
    ['con ceros', '192.168.001.001'],
    ['con punto final', '127.0.0.1.'],
    ['de ancho completo', '１２７.0.0.1'],
  ])('forma %s (%s) se rechaza siempre: solo decimal con puntos', (_nombre, ip) => {
    expect(validarDominio(ip)).toEqual({ ok: false, motivo: 'ip-no-canonica' });
    expect(validarDominio(ip, INTERNO)).toEqual({ ok: false, motivo: 'ip-no-canonica' });
  });

  it.each(['[::1]', '[fe80::1]', '[::ffff:10.0.0.1]', 'http://[2001:db8::1]/'])(
    'IPv6 %s se rechaza siempre',
    (ip) => {
      expect(validarDominio(ip, INTERNO)).toEqual({ ok: false, motivo: 'ip-no-permitida' });
    },
  );
});

describe('validarDominio: nombres de una etiqueta', () => {
  it('solo con Sistema interno, como host exacto', () => {
    expect(validarDominio('intranet')).toEqual({ ok: false, motivo: 'requiere-sistema-interno' });
    expect(validarDominio('INTRANET', INTERNO)).toEqual({ ok: true, valor: 'intranet' });
    expect(validarDominio('http://intranet:8080/x', INTERNO)).toEqual({
      ok: true,
      valor: 'intranet',
    });
  });
});

describe('validarUrlBase', () => {
  it.each([
    ['https://lexora.test', 'https://lexora.test/', 'lexora.test'],
    ['HTTPS://LEXORA.test/App?x=1#frag', 'https://lexora.test/App?x=1', 'lexora.test'],
    ['https://lexora.test./a', 'https://lexora.test/a', 'lexora.test'],
    ['http://127.0.0.1:43180/', 'http://127.0.0.1:43180/', '127.0.0.1'],
    ['http://localhost:3000', 'http://localhost:3000/', 'localhost'],
    ['https://münchen.test', 'https://xn--mnchen-3ya.test/', 'xn--mnchen-3ya.test'],
  ])('%s', (entrada, url, host) => {
    expect(validarUrlBase(entrada)).toEqual({ ok: true, url, host });
  });

  it.each([
    ['', 'vacio'],
    ['lexora.test', 'invalido'],
    ['//lexora.test', 'invalido'],
    ['ftp://lexora.test', 'esquema-no-permitido'],
    ['file:///C:/x', 'esquema-no-permitido'],
    ['javascript:alert(1)', 'esquema-no-permitido'],
    ['data:text/html,x', 'esquema-no-permitido'],
    ['https://ana:clave@example.test', 'credenciales-en-url'],
    ['https://lexora.test@example.test', 'credenciales-en-url'],
    ['https://lexora.test\\evil.example', 'invalido'],
    ['https://lexora .test', 'invalido'],
    ['https://', 'invalido'],
    ['https://co.uk', 'sufijo-publico'],
    ['https://*.lexora.test', 'invalido'],
    ['http://8.8.8.8/', 'ip-no-permitida'],
    ['http://169.254.169.254/latest', 'ip-no-permitida'],
    ['http://0.0.0.0:3000/', 'ip-no-permitida'],
    ['http://[::1]/', 'ip-no-permitida'],
    ['http://2130706433/', 'ip-no-canonica'],
    ['http://0x7f.1/', 'ip-no-canonica'],
    ['http://192.168.1.20/', 'requiere-sistema-interno'],
    ['http://intranet/', 'requiere-sistema-interno'],
    ['https://foo.localhost', 'localhost-no-exacto'],
    [`https://x.test/${'a'.repeat(2100)}`, 'invalido'],
  ])('%j se rechaza: %s', (entrada, motivo) => {
    expect(validarUrlBase(entrada)).toEqual({ ok: false, motivo });
  });

  it('con Sistema interno admite IPs privadas y nombres de una etiqueta', () => {
    expect(validarUrlBase('http://192.168.1.20:8080/app', INTERNO)).toEqual({
      ok: true,
      url: 'http://192.168.1.20:8080/app',
      host: '192.168.1.20',
    });
    expect(validarUrlBase('http://intranet/', INTERNO).ok).toBe(true);
  });
});

describe('hostPertenece', () => {
  it.each([
    ['lexora.test', ['lexora.test'], true],
    ['app.lexora.test', ['*.lexora.test'], true],
    ['a.b.lexora.test', ['*.lexora.test'], true],
    ['lexora.test', ['*.lexora.test'], false],
    ['app.lexora.test', ['lexora.test'], false],
    ['lexora.test.evil.com', ['lexora.test'], false],
    ['lexora.test.evil.com', ['*.lexora.test'], false],
    ['evillexora.test', ['lexora.test'], false],
    ['evillexora.test', ['*.lexora.test'], false],
    ['lexora.test', [], false],
    ['b.test', ['a.test', 'b.test'], true],
  ])('%s en %j: %s', (host, patrones, esperado) => {
    expect(hostPertenece(host, patrones)).toBe(esperado);
  });
});

describe('proponerDominio', () => {
  it('propone el host exacto, no todo el dominio registrable', () => {
    expect(proponerDominio('https://app.lexora.test:8443/x')).toBe('app.lexora.test');
  });

  it('no propone nada si la URL no vale', () => {
    expect(proponerDominio('ftp://lexora.test')).toBeNull();
    expect(proponerDominio('http://10.0.0.1/')).toBeNull();
    expect(proponerDominio('http://10.0.0.1/', INTERNO)).toBe('10.0.0.1');
  });
});

describe('validarAlcance (RN-PRY-02)', () => {
  const base = {
    urlBase: 'https://app.lexora.test/',
    dominios: ['app.lexora.test'],
    sistemaInterno: false,
  };

  it('normaliza la URL y los dominios y quita los repetidos', () => {
    expect(
      validarAlcance({
        ...base,
        urlBase: 'HTTPS://APP.lexora.test',
        dominios: ['APP.lexora.test', 'app.lexora.test.', 'https://app.lexora.test/x'],
      }),
    ).toEqual({ ok: true, urlBase: 'https://app.lexora.test/', dominios: ['app.lexora.test'] });
  });

  it('acepta una URL cubierta por un comodín', () => {
    expect(validarAlcance({ ...base, dominios: ['*.lexora.test'] }).ok).toBe(true);
  });

  it('rechaza una URL fuera de los dominios', () => {
    expect(validarAlcance({ ...base, dominios: ['lexora.test'] })).toEqual({
      ok: false,
      errores: [{ campo: 'urlBase', motivo: 'url-fuera-de-dominios' }],
    });
  });

  it('rechaza un dominio parecido', () => {
    expect(
      validarAlcance({
        urlBase: 'https://lexora.test.evil.com/',
        dominios: ['lexora.test'],
        sistemaInterno: false,
      }).ok,
    ).toBe(false);
  });

  it('rechaza una lista vacía', () => {
    expect(validarAlcance({ ...base, dominios: [] })).toEqual({
      ok: false,
      errores: [{ campo: 'dominios', motivo: 'sin-dominios' }],
    });
  });

  it('informa todos los errores juntos', () => {
    expect(
      validarAlcance({ urlBase: 'ftp://x.test', dominios: ['*.com'], sistemaInterno: false }),
    ).toEqual({
      ok: false,
      errores: [
        { campo: 'urlBase', motivo: 'esquema-no-permitido' },
        { campo: 'dominios', motivo: 'comodin-amplio' },
      ],
    });
  });

  it('la opción Sistema interno decide si una IP privada entra', () => {
    const interno = { urlBase: 'http://10.0.0.5/', dominios: ['10.0.0.5'] };
    expect(validarAlcance({ ...interno, sistemaInterno: false }).ok).toBe(false);
    expect(validarAlcance({ ...interno, sistemaInterno: true }).ok).toBe(true);
  });
});

describe('validarUrlLogin', () => {
  const opciones = { dominios: ['lexora.test', '*.lexora.test'], permitirLoginHttp: false };
  const publico = { dominios: ['portal.example'], permitirLoginHttp: false };

  it('normaliza una URL dentro de los dominios', () => {
    expect(validarUrlLogin('HTTPS://app.lexora.test/login#x', opciones)).toEqual({
      ok: true,
      url: 'https://app.lexora.test/login',
    });
  });

  it.each([
    ['https://evil.example/login', 'login-fuera-de-dominios'],
    ['https://lexora.test.evil.com/login', 'login-fuera-de-dominios'],
    ['https://evillexora.test/login', 'login-fuera-de-dominios'],
    ['https://ana:clave@example.test/', 'credenciales-en-url'],
    ['ftp://lexora.test/', 'esquema-no-permitido'],
    ['http://2130706433/', 'ip-no-canonica'],
    ['', 'vacio'],
  ])('%j se rechaza: %s', (entrada, motivo) => {
    expect(validarUrlLogin(entrada, opciones)).toEqual({ ok: false, motivo });
  });

  it.each([
    ['http://lexora.test/login', ['lexora.test']],
    ['http://app.lexora.test/login', ['*.lexora.test']],
    ['http://localhost:3000/login', ['localhost']],
    ['http://127.0.0.1:43180/login', ['127.0.0.1']],
  ])('%s en http se admite sin la opción', (url, dominios) => {
    expect(validarUrlLogin(url, { dominios, permitirLoginHttp: false }).ok).toBe(true);
  });

  it.each([
    ['http://portal.example/login', ['portal.example']],
    ['http://192.168.1.20/login', ['192.168.1.20']],
    ['http://intranet/login', ['intranet']],
    ['http://test.example/login', ['test.example']],
  ])('%s en http necesita la opción', (url, dominios) => {
    expect(validarUrlLogin(url, { dominios, permitirLoginHttp: false })).toEqual({
      ok: false,
      motivo: 'login-sin-cifrar',
    });
    expect(validarUrlLogin(url, { dominios, permitirLoginHttp: true }).ok).toBe(true);
  });

  it('en https no hace falta la opción', () => {
    expect(validarUrlLogin('https://portal.example/login', publico).ok).toBe(true);
  });

  it('la opción no saca la URL de los dominios permitidos', () => {
    expect(
      validarUrlLogin('http://evil.example/', { ...publico, permitirLoginHttp: true }),
    ).toEqual({ ok: false, motivo: 'login-fuera-de-dominios' });
  });
});
