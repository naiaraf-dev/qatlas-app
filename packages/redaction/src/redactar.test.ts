/**
 * Redacción y detector de secretos. Todos los secretos son inventados y se arman por partes: ninguno
 * aparece literal en el repo, para que no lo confunda un escáner de secretos.
 */
import { describe, expect, it } from 'vitest';
import {
  ComparadorDeSecretos,
  contarRedacciones,
  entropia,
  esNombreSensible,
  esNombreSospechoso,
  normalizarMensaje,
  PATRONES,
  pareceSecreto,
  redactarCuerpo,
  redactarEncabezados,
  redactarFormulario,
  redactarJson,
  redactarSecuencia,
  redactarTexto,
  redactarUrl,
  segmentosDeNombre,
  variantesDeSecreto,
} from './index';

/** Un cuerpo de `n` caracteres alfanuméricos, reconocible como de prueba. */
const relleno = (n: number, base = 'Prueba0Qatlas0Ficticio') =>
  base.repeat(Math.ceil(n / base.length)).slice(0, n);
const b64url = (texto: string) => Buffer.from(texto).toString('base64url');

const JWT = [
  b64url('{"alg":"HS256","typ":"JWT"}'),
  b64url('{"sub":"ana-prueba","rol":"lectora"}'),
  relleno(43),
].join('.');
const PEM = [
  '-----BEGIN ' + 'PRIVATE KEY-----',
  'MIIB' + relleno(60),
  relleno(64),
  '-----END ' + 'PRIVATE KEY-----',
].join('\n');

/** Un ejemplo positivo por patrón. */
const POSITIVOS: Record<string, string> = {
  'clave-privada-pem': PEM,
  jwt: JWT,
  'aws-access-key': 'AKIA' + 'PRUEBA0QATLAS000',
  'github-token': 'ghp' + '_' + relleno(36),
  'gitlab-token': 'glpat' + '-' + relleno(20),
  'slack-token': 'xoxb' + '-' + relleno(24),
  'stripe-key': 'sk' + '_test_' + relleno(24),
  'google-api-key': 'AIza' + relleno(35),
  'npm-token': 'npm' + '_' + relleno(36),
  'anthropic-key': 'sk-' + 'ant-' + relleno(40),
  'openai-key': 'sk-' + 'proj-' + relleno(48),
  'sendgrid-key': 'SG' + '.' + relleno(22) + '.' + relleno(43),
  bearer: 'Bearer ' + relleno(30),
  basica: 'Basic ' + Buffer.from('ana:clave-de-prueba').toString('base64'),
  'url-con-usuario': 'https://ana:' + 'clave-de-prueba' + '@app.example.test/panel',
};

/** Parecidos que no son secretos. */
const NEGATIVOS: Record<string, string> = {
  'clave-privada-pem': '-----BEGIN ' + 'PUBLIC KEY-----\nMIIB' + relleno(40),
  jwt: 'eyJ no es un token. eyJabc',
  'aws-access-key': 'AKIA-no-es-una-clave',
  'github-token': 'ghp' + '_corto',
  'gitlab-token': 'glpat' + '-corto',
  'slack-token': 'xoxz' + '-' + relleno(24),
  'stripe-key': 'sk' + '_prod_' + relleno(24),
  'google-api-key': 'AIza' + 'corta',
  'npm-token': 'npm' + '_install',
  'anthropic-key': 'sk-' + 'ant-corta',
  'openai-key': 'sk-' + 'learn',
  'sendgrid-key': 'SG' + '.corta.corta',
  bearer: 'Bearer abc',
  basica: 'Basic auth',
  'url-con-usuario': 'https://app.example.test/panel?usuario=ana',
};

describe('Patrones (EVI-04)', () => {
  it('cada patrón tiene un ejemplo positivo y uno negativo', () => {
    for (const patron of PATRONES) {
      expect(POSITIVOS[patron.id], patron.id).toBeDefined();
      expect(NEGATIVOS[patron.id], patron.id).toBeDefined();
      expect(patron.expresion.flags, patron.id).toContain('g');
    }
  });

  it.each(PATRONES.map((p) => [p.id, p.tipo] as const))('%s se redacta como %s', (id, tipo) => {
    const ejemplo = POSITIVOS[id] ?? '';
    const resultado = redactarTexto(`antes ${ejemplo} después`);
    expect(resultado.texto).toContain(`[REDACTADO:${tipo}]`);
    expect(resultado.texto).toMatch(/^antes /);
    expect(resultado.texto).toMatch(/ después$/);
    expect(resultado.registros).toContainEqual(expect.objectContaining({ regla: id, tipo }));
    // Nada del valor queda, salvo el prefijo que el patrón deja a la vista (Bearer, el esquema).
    const secreto = id === 'url-con-usuario' ? 'clave-de-prueba' : ejemplo.slice(-12);
    expect(resultado.texto).not.toContain(secreto);
  });

  it.each(PATRONES.map((p) => [p.id] as const))('%s: el parecido no se redacta', (id) => {
    const ejemplo = NEGATIVOS[id] ?? '';
    expect(redactarTexto(ejemplo).registros.filter((r) => r.regla === id)).toEqual([]);
  });

  it('Bearer conserva el esquema y la URL conserva el host', () => {
    expect(redactarTexto(`Authorization: ${POSITIVOS.bearer ?? ''}`).texto).toContain('Bearer');
    expect(redactarTexto(POSITIVOS['url-con-usuario'] ?? '').texto).toBe(
      'https://[REDACTADO:url-con-usuario]@app.example.test/panel',
    );
  });

  it('una clave PEM cortada se redacta hasta el final', () => {
    const cortada = PEM.slice(0, 80);
    expect(redactarTexto(`log: ${cortada}`).texto).toBe('log: [REDACTADO:clave-privada]');
  });
});

describe('Nombres sensibles, por segmentos', () => {
  it.each([
    ['accessToken', ['access', 'token']],
    ['X-API-Key', ['x', 'api', 'key']],
    ['client_secret', ['client', 'secret']],
    ['APIKey', ['api', 'key']],
  ])('%s → %j', (nombre, segmentos) => {
    expect(segmentosDeNombre(nombre)).toEqual(segmentos);
  });

  it.each([
    ['access_token', true],
    ['apiKey', true],
    ['X-Auth-Token', true],
    ['password', true],
    ['contraseña', true],
    ['tokenizer', false],
    ['authors', false],
    ['nombre', false],
    ['', false],
  ])('%s: %s', (nombre, sensible) => {
    expect(esNombreSensible(nombre)).toBe(sensible);
  });

  it('sospechoso es más amplio: alcanza con contener la palabra', () => {
    expect(esNombreSospechoso('apiKeyId')).toBe(true);
    expect(esNombreSospechoso('signingKey')).toBe(true);
    expect(esNombreSospechoso('color')).toBe(false);
  });
});

describe('Entropía, solo en contextos sospechosos', () => {
  const ALEATORIO = 'Zq8xT2vLr9KpW4nYc7HsB3dF';

  it('la entropía de un texto repetido es cero, y la de uno aleatorio, alta', () => {
    expect(entropia('')).toBe(0);
    expect(entropia('aaaaaaaa')).toBe(0);
    expect(entropia(ALEATORIO)).toBeGreaterThan(4);
    expect(pareceSecreto(ALEATORIO)).toBe(true);
    expect(pareceSecreto('corto')).toBe(false);
  });

  it('con un nombre sospechoso y un valor que parece secreto, se redacta', () => {
    expect(redactarTexto(`signingKey=${ALEATORIO}`).texto).toBe('signingKey=[REDACTADO:entropia]');
  });

  it('con un nombre sospechoso y un valor común, no', () => {
    expect(redactarTexto('signingKey=mi-clave-de-firma').registros).toEqual([]);
  });

  it('sin contexto, la entropía sola no redacta nada', () => {
    expect(redactarTexto(`hola ${ALEATORIO} chau`).registros).toEqual([]);
  });

  it.each([
    ['un UUID', 'signingKeyId=3f2a1b9c-1234-4234-8234-123456789012'],
    ['un SHA-1 de git', 'keyCommit: 9fceb02d0ae598e95dc970b74767f19372d61af8'],
    ['un SHA-256', 'keyHash=' + 'a'.repeat(32) + 'b'.repeat(32)],
    ['un integrity de un recurso', 'keyIntegrity="sha256-' + relleno(44) + '"'],
    ['un número', 'keyCount=12345678901234567890123'],
  ])('no son secretos: %s', (_, texto) => {
    expect(redactarTexto(texto).registros).toEqual([]);
  });
});

describe('Falsos positivos que no se redactan', () => {
  it.each([
    ['un UUID suelto', 'request 3f2a1b9c-1234-4234-8234-123456789012 falló'],
    ['el hash de un asset', 'GET /assets/app.3f9a8c7d2b1e4f60.js 404'],
    ['un nonce', '<script nonce="r4nd0mN0nc3V4lu3xyz123">'],
    ['un integrity', '<link integrity="sha384-' + relleno(64) + '">'],
    ['un commit', 'commit 9fceb02d0ae598e95dc970b74767f19372d61af8'],
    ['un color', 'color: #5b5bd6'],
    ['un código HTTP', 'code: 404'],
    ['un token nulo', 'token: null'],
    ['un texto común', 'TypeError: no se pudo leer la propiedad «x»'],
  ])('%s', (_, texto) => {
    const resultado = redactarTexto(texto);
    expect(resultado.registros).toEqual([]);
    expect(resultado.texto).toBe(texto);
  });
});

describe('Campos con nombre sensible en texto libre', () => {
  it.each([
    ['password=hunter-prueba', 'password=[REDACTADO:campo]'],
    ['"apiKey": "valor-de-prueba"', '"apiKey": "[REDACTADO:campo]"'],
    ["token: 'valor-de-prueba'", "token: '[REDACTADO:campo]'"],
    ['otp=123456', 'otp=[REDACTADO:campo]'],
  ])('%s', (entrada, salida) => {
    expect(redactarTexto(entrada).texto).toBe(salida);
  });
});

describe('URLs (EVI-03)', () => {
  it('los parámetros sensibles de la query y del fragmento, sin tocar el resto', () => {
    const { texto, registros } = redactarUrl(
      'https://app.example.test/entrar?token=abc123&vista=lista#access_token=xyz&estado=1',
    );
    expect(texto).toBe(
      'https://app.example.test/entrar?token=[REDACTADO:parametro]&vista=lista#access_token=[REDACTADO:parametro]&estado=1',
    );
    expect(contarRedacciones(registros)).toBe(2);
  });

  it('un nombre codificado también, y un valor vacío no', () => {
    expect(redactarUrl('https://x.example.test/?api%5Fkey=v1&token=').texto).toBe(
      'https://x.example.test/?api%5Fkey=[REDACTADO:parametro]&token=',
    );
    expect(redactarUrl('https://x.example.test/?%E0%A4%A=1').registros).toEqual([]);
  });

  it('un JWT en la ruta y el usuario de la URL', () => {
    const { texto } = redactarUrl(`https://ana:clave-de-prueba@x.example.test/s/${JWT}/ver`);
    expect(texto).toBe('https://[REDACTADO:url-con-usuario]@x.example.test/s/[REDACTADO:jwt]/ver');
  });

  it('una URL sin nada sensible queda igual', () => {
    const url = 'https://app.example.test/productos?pagina=2&orden=precio';
    expect(redactarUrl(url)).toEqual({ texto: url, registros: [] });
  });

  it('redactar lo ya redactado no cambia nada', () => {
    const una = redactarUrl('https://x.example.test/?token=abc').texto;
    expect(redactarUrl(una)).toEqual({ texto: una, registros: [] });
  });
});

describe('Encabezados, formularios, JSON y cuerpos (EVI-03)', () => {
  it('Authorization, Cookie, Set-Cookie y Proxy-Authorization siempre; los demás, por el detector', () => {
    const { encabezados, registros } = redactarEncabezados([
      { nombre: 'Authorization', valor: 'Bearer ' + relleno(30) },
      { nombre: 'Cookie', valor: 'sesion=abc' },
      { nombre: 'Set-Cookie', valor: 'sesion=abc; HttpOnly' },
      { nombre: 'Proxy-Authorization', valor: 'Basic abc' },
      { nombre: 'X-API-Key', valor: 'cualquier-cosa' },
      { nombre: 'Content-Type', valor: 'text/html' },
      { nombre: 'X-Debug', valor: `jwt=${JWT}` },
    ]);
    expect(encabezados.map((e) => e.valor)).toEqual([
      '[REDACTADO:encabezado]',
      '[REDACTADO:encabezado]',
      '[REDACTADO:encabezado]',
      '[REDACTADO:encabezado]',
      '[REDACTADO:encabezado]',
      'text/html',
      'jwt=[REDACTADO:jwt]',
    ]);
    expect(contarRedacciones(registros)).toBe(6);
  });

  it('un formulario', () => {
    expect(redactarFormulario('usuario=ana&password=clave+de+prueba&recordar=1').texto).toBe(
      'usuario=ana&password=[REDACTADO:parametro]&recordar=1',
    );
  });

  it('un JSON: los campos sensibles enteros, y los textos por el detector', () => {
    const { texto, registros } = redactarJson(
      JSON.stringify({
        usuario: 'ana',
        password: 'clave-de-prueba',
        datos: { token: 123, lista: [`hola ${JWT}`], vacio: null },
        credenciales: { client_secret: '' },
      }),
    );
    expect(JSON.parse(texto)).toEqual({
      usuario: 'ana',
      password: '[REDACTADO:campo]',
      datos: { token: '[REDACTADO:campo]', lista: ['hola [REDACTADO:jwt]'], vacio: null },
      credenciales: '[REDACTADO:campo]',
    });
    expect(contarRedacciones(registros)).toBe(4);
  });

  it('un JSON inválido se trata como texto', () => {
    expect(redactarJson('{password=clave-de-prueba').texto).toBe('{password=[REDACTADO:campo]');
  });

  it('el cuerpo de una respuesta no se guarda', () => {
    expect(redactarCuerpo()).toEqual({
      texto: '[REDACTADO:cuerpo]',
      registros: [{ regla: 'cuerpo-de-respuesta', tipo: 'cuerpo', cantidad: 1 }],
    });
  });
});

describe('Secretos de las credenciales, sin guardarlos (ADR 031)', () => {
  const CANARIO = 'CANARIO-prueba-7c1e9a';
  const crear = () => ComparadorDeSecretos.crear([Buffer.from(CANARIO)]);

  it('las variantes: tal cual, para URL, formulario, base64, base64url y hex', () => {
    expect(variantesDeSecreto('clave mía+1')).toEqual(
      [
        'clave mía+1',
        'clave%20m%C3%ADa%2B1',
        'clave+m%C3%ADa%2B1',
        'Y2xhdmUgbcOtYSsx',
        'Y2xhdmUgbcOtYSsx',
        '636c617665206dc3ad612b31',
        '636C617665206DC3AD612B31',
      ].filter((v, i, todas) => todas.indexOf(v) === i),
    );
    expect(variantesDeSecreto('abc')).toEqual([]);
  });

  it('encuentra el valor exacto y sus codificaciones, y lo redacta', () => {
    const comparador = crear();
    for (const variante of variantesDeSecreto(CANARIO)) {
      const { texto, registros } = redactarTexto(`dato ${variante} fin`, { comparador });
      expect(texto, variante).toBe('dato [REDACTADO:credencial] fin');
      expect(registros).toEqual([
        { regla: 'secreto-de-credencial', tipo: 'credencial', cantidad: 1 },
      ]);
    }
  });

  it('no guarda el secreto: ni en sus propiedades ni al serializarlo', () => {
    const comparador = crear();
    const visto = JSON.stringify(Object.entries(comparador)) + JSON.stringify(comparador);
    for (const variante of variantesDeSecreto(CANARIO)) expect(visto).not.toContain(variante);
  });

  it('cada aparición se redacta, y un texto sin el secreto queda igual', () => {
    const comparador = crear();
    expect(redactarTexto(`${CANARIO}${CANARIO} y ${CANARIO}`, { comparador }).texto).toBe(
      '[REDACTADO:credencial][REDACTADO:credencial] y [REDACTADO:credencial]',
    );
    expect(redactarTexto('nada que ver', { comparador }).registros).toEqual([]);
  });

  it('vacío o descartado, no encuentra nada', () => {
    expect(ComparadorDeSecretos.vacio().estaVacio).toBe(true);
    const comparador = crear();
    comparador.descartar();
    expect(comparador.estaVacio).toBe(true);
    expect(redactarTexto(CANARIO, { comparador }).registros).toEqual([]);
  });

  it('un secreto partido en dos mensajes consecutivos se redacta en los dos', () => {
    const comparador = crear();
    const [a, b] = redactarSecuencia(
      [`primera parte: ${CANARIO.slice(0, 10)}`, `${CANARIO.slice(10)} y sigue`],
      { comparador },
    );
    expect(a?.texto).toBe('primera parte: [REDACTADO:credencial]');
    expect(b?.texto).toBe('[REDACTADO:credencial] y sigue');
    // Sin el comparador, nada.
    expect(
      redactarSecuencia([CANARIO.slice(0, 10), CANARIO.slice(10)]).map((r) => r.texto),
    ).toEqual([CANARIO.slice(0, 10), CANARIO.slice(10)]);
  });

  it('es rápido para un mensaje largo', () => {
    const comparador = crear();
    const inicio = performance.now();
    redactarTexto('x'.repeat(2000), { comparador });
    expect(performance.now() - inicio).toBeLessThan(500);
  });
});

describe('Mensajes', () => {
  it('normaliza números, IDs y líneas siguientes', () => {
    expect(
      normalizarMensaje('Error 42 en 3f2a1b9c-1234-4234-8234-123456789012\nsegunda línea'),
    ).toBe('Error # en <id>');
  });
});
