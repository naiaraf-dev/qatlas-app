import { describe, expect, it } from 'vitest';
import {
  clasificarIp,
  decidirNombre,
  decidirResolucion,
  decidirUrlSinResolver,
  normalizarHost,
  puertosLocalesPermitidos,
  type PoliticaDeRed,
} from './reglas';

const REMOTO: PoliticaDeRed = {
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.example.com', '*.lexora.example'],
  sistemaInterno: false,
  puertosLocales: [],
};
const LOCAL: PoliticaDeRed = {
  urlBase: 'http://localhost:5173/',
  dominios: ['localhost', '127.0.0.1', 'lexora.test'],
  sistemaInterno: false,
  puertosLocales: [3000],
};
const INTERNO: PoliticaDeRed = {
  urlBase: 'http://intranet.example.com:8080/',
  dominios: ['intranet.example.com', '*.interna.example', '192.168.1.20'],
  sistemaInterno: true,
  puertosLocales: [],
};

describe('clasificarIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['10.0.0.0', 'privada'],
    ['10.255.255.255', 'privada'],
    ['172.16.0.0', 'privada'],
    ['172.31.255.255', 'privada'],
    ['192.168.0.1', 'privada'],
    ['::ffff:10.0.0.1', 'privada'],
    ['169.254.169.254', 'prohibida'],
    ['169.254.0.0', 'prohibida'],
    ['0.0.0.0', 'prohibida'],
    ['100.64.0.1', 'prohibida'],
    ['224.0.0.1', 'prohibida'],
    ['255.255.255.255', 'prohibida'],
    ['192.0.2.1', 'prohibida'],
    ['fe80::1', 'prohibida'],
    ['fc00::1', 'prohibida'],
    ['fd12:3456::1', 'prohibida'],
    ['ff02::1', 'prohibida'],
    ['::', 'prohibida'],
    ['64:ff9b::a00:1', 'prohibida'],
    ['2002:7f00:1::', 'prohibida'],
    ['::ffff:169.254.169.254', 'prohibida'],
    ['::ffff:7f00:1', 'prohibida'],
    ['no-es-una-ip', 'prohibida'],
    ['8.8.8.8', 'publica'],
    ['172.15.255.255', 'publica'],
    ['172.32.0.0', 'publica'],
    ['2606:4700::1111', 'publica'],
  ])('%s es %s', (ip, clase) => {
    expect(clasificarIp(ip)).toBe(clase);
  });
});

describe('decidirNombre: la lista, antes de cualquier DNS', () => {
  it.each([
    ['app.example.com', true],
    ['APP.example.com.', true],
    ['x.lexora.example', true],
    ['lexora.example', false],
    ['evil.example', false],
    ['app.example.com.evil.example', false],
    ['evilapp.example.com', false],
  ])('%s → %s', (host, permitida) => {
    expect(decidirNombre(host, REMOTO).permitida).toBe(permitida);
  });

  it('dice qué regla bloqueó', () => {
    expect(decidirNombre('evil.example', REMOTO)).toEqual({
      permitida: false,
      regla: 'fuera-de-dominios',
    });
  });

  it('normaliza corchetes, mayúsculas y punto final', () => {
    expect(normalizarHost('[::1]')).toBe('::1');
    expect(normalizarHost('LEXORA.test.')).toBe('lexora.test');
  });
});

describe('DNS rebinding', () => {
  it.each(['10.0.0.1', '192.168.1.1', '172.16.0.1'])(
    'un nombre público que resuelve a %s se bloquea',
    (ip) => {
      expect(decidirResolucion('app.example.com', 443, [ip], REMOTO)).toEqual({
        permitida: false,
        regla: 'dns-ip-privada',
      });
    },
  );

  it('un nombre público que resuelve a loopback se bloquea, aun con Sistema interno', () => {
    for (const politica of [REMOTO, INTERNO]) {
      const host = politica === REMOTO ? 'app.example.com' : 'intranet.example.com';
      expect(decidirResolucion(host, 443, ['127.0.0.1'], politica)).toEqual({
        permitida: false,
        regla: 'dns-loopback-no-local',
      });
    }
  });

  it('link-local se bloquea siempre, también con Sistema interno y host en la lista', () => {
    expect(decidirResolucion('intranet.example.com', 8080, ['169.254.169.254'], INTERNO)).toEqual({
      permitida: false,
      regla: 'dns-ip-prohibida',
    });
  });

  it('una sola IP prohibida bloquea el nombre completo, aunque la otra sea válida', () => {
    expect(
      decidirResolucion('app.example.com', 443, ['8.8.8.8', '169.254.169.254'], REMOTO).permitida,
    ).toBe(false);
    expect(
      decidirResolucion('app.example.com', 443, ['8.8.8.8', '10.0.0.1'], REMOTO).permitida,
    ).toBe(false);
    expect(
      decidirResolucion('app.example.com', 443, ['127.0.0.1', '8.8.8.8'], REMOTO).permitida,
    ).toBe(false);
  });

  it('sin respuesta del DNS, se bloquea', () => {
    expect(decidirResolucion('app.example.com', 443, [], REMOTO)).toEqual({
      permitida: false,
      regla: 'dns-sin-respuesta',
    });
  });

  it('una IP pública se admite', () => {
    expect(decidirResolucion('app.example.com', 443, ['8.8.8.8'], REMOTO)).toEqual({
      permitida: true,
      regla: 'dominio-permitido',
    });
  });
});

describe('Sistema interno: solo los rangos privados, con el host exacto', () => {
  it('admite una IP privada si el host está en la lista', () => {
    expect(decidirResolucion('intranet.example.com', 8080, ['10.0.0.5'], INTERNO)).toEqual({
      permitida: true,
      regla: 'ip-interna-declarada',
    });
    expect(decidirResolucion('192.168.1.20', 8080, ['192.168.1.20'], INTERNO).permitida).toBe(true);
  });

  it('un comodín no alcanza', () => {
    expect(decidirResolucion('x.interna.example', 80, ['10.0.0.5'], INTERNO).regla).toBe(
      'dns-ip-privada',
    );
  });

  it('sin la opción, el mismo host no llega', () => {
    const sinOpcion = { ...INTERNO, sistemaInterno: false };
    expect(decidirResolucion('intranet.example.com', 8080, ['10.0.0.5'], sinOpcion).regla).toBe(
      'dns-ip-privada',
    );
  });
});

describe('Loopback: solo los puertos declarados', () => {
  it('el puerto de la URL base viene incluido, y el declarado se suma', () => {
    expect([...puertosLocalesPermitidos(LOCAL)].sort()).toEqual([3000, 5173]);
  });

  it.each([
    [5173, true],
    [3000, true],
    [5174, false],
    [80, false],
    [443, false],
  ])('puerto %i → %s', (puerto, permitida) => {
    expect(decidirResolucion('localhost', puerto, ['127.0.0.1'], LOCAL).permitida).toBe(permitida);
    expect(decidirResolucion('127.0.0.1', puerto, ['127.0.0.1'], LOCAL).permitida).toBe(permitida);
    expect(decidirResolucion('lexora.test', puerto, ['127.0.0.1'], LOCAL).permitida).toBe(
      permitida,
    );
  });

  it('dice qué regla bloqueó', () => {
    expect(decidirResolucion('localhost', 5174, ['127.0.0.1'], LOCAL).regla).toBe(
      'puerto-local-no-declarado',
    );
  });

  it('sin puerto explícito, la URL base usa el de su esquema', () => {
    const http = { ...LOCAL, urlBase: 'http://localhost/', puertosLocales: [] };
    const https = { ...LOCAL, urlBase: 'https://localhost/', puertosLocales: [] };
    expect([...puertosLocalesPermitidos(http)]).toEqual([80]);
    expect([...puertosLocalesPermitidos(https)]).toEqual([443]);
  });

  it('si la URL base es remota, ningún puerto local viene incluido', () => {
    const mixta = { ...LOCAL, urlBase: 'https://app.example.com:8443/', puertosLocales: [] };
    expect(puertosLocalesPermitidos(mixta).size).toBe(0);
    expect(decidirResolucion('localhost', 8443, ['127.0.0.1'], mixta).permitida).toBe(false);
  });
});

describe('Hosts no locales: 80, 443 y el puerto explícito de la URL base', () => {
  it.each([
    [80, true],
    [443, true],
    [22, false],
    [8080, false],
    [3306, false],
  ])('sin puerto en la URL base, %i → %s', (puerto, permitida) => {
    const decision = decidirResolucion('app.example.com', puerto, ['8.8.8.8'], REMOTO);
    expect(decision.permitida).toBe(permitida);
    if (!permitida) expect(decision.regla).toBe('puerto-no-permitido');
  });

  it('con puerto explícito, se suma solo ese', () => {
    const politica = { ...REMOTO, urlBase: 'https://app.example.com:8443/' };
    expect(decidirResolucion('app.example.com', 8443, ['8.8.8.8'], politica).permitida).toBe(true);
    expect(decidirResolucion('app.example.com', 8444, ['8.8.8.8'], politica).permitida).toBe(false);
  });

  it('un puerto local declarado no abre ese puerto en un host remoto', () => {
    const politica = { ...REMOTO, puertosLocales: [8080] };
    expect(decidirResolucion('app.example.com', 8080, ['8.8.8.8'], politica).permitida).toBe(false);
  });
});

describe('decidirUrlSinResolver: la segunda capa del navegador', () => {
  it.each([
    ['https://app.example.com/x', true],
    ['wss://app.example.com/x', true],
    ['https://evil.example/x', false],
    ['ftp://app.example.com/', false],
    ['file:///C:/x', false],
    ['no es una url', false],
  ])('%s → %s', (url, permitida) => {
    expect(decidirUrlSinResolver(url, REMOTO).permitida).toBe(permitida);
  });
});
