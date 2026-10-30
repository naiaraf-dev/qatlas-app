import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  abrirBaseCifrada,
  analizarSellada,
  CONFIGURACION_POR_DEFECTO,
  crearCopia,
  ErrorBoveda,
  escribirAtomico,
  estadoArchivos,
  guardarConfiguracion,
  inicializarDatos,
  instalarPar,
  leerConfiguracion,
  leerCopia,
  leerLapidas,
  leerSellada,
  migrar,
  purgarConLapida,
  recuperarInstalacion,
  registrarLapidas,
  rutasBoveda,
  serializarSellada,
  verificarArchivoCifrado,
  verificarIntegridad,
  VERSION_ESQUEMA,
  type BaseCifrada,
} from './index';

const SELLADA = {
  version: 1,
  kdf: {
    algoritmo: 'argon2id' as const,
    version: 19 as const,
    memoriaKiB: 64 * 1024,
    iteraciones: 3,
    paralelismo: 4,
  },
  salt: Buffer.alloc(16, 7),
  maestraEnvuelta: Buffer.alloc(60, 9),
};

let carpeta: string;
let abiertas: BaseCifrada[];
const clave = randomBytes(32);

function abrir(ruta: string, k: Buffer = clave): BaseCifrada {
  const base = abrirBaseCifrada(ruta, k);
  abiertas.push(base);
  return base;
}

function codigo(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ErrorBoveda ? error.codigo : 'OTRO';
  }
  return undefined;
}

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-db-'));
  abiertas = [];
});

afterEach(() => {
  for (const base of abiertas) if (base.open) base.close();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Conexión cifrada', () => {
  it('crea una base que no es SQLite en claro y vuelve a abrir con la misma clave', () => {
    const ruta = path.join(carpeta, 'b.db');
    const base = abrir(ruta);
    migrar(base);
    base.close();
    expect(() => {
      verificarArchivoCifrado(ruta);
    }).not.toThrow();
    expect(abrir(ruta).pragma('user_version', { simple: true })).toBe(VERSION_ESQUEMA);
  });

  it('rechaza una clave incorrecta o de otro largo', () => {
    const ruta = path.join(carpeta, 'b.db');
    const base = abrir(ruta);
    migrar(base);
    base.close();
    expect(codigo(() => abrir(ruta, randomBytes(32)))).toBe('BASE_INVALIDA');
    expect(codigo(() => abrir(ruta, randomBytes(16)))).toBe('BASE_INVALIDA');
  });

  it('detecta un archivo en texto plano', () => {
    const ruta = path.join(carpeta, 'plano.db');
    writeFileSync(ruta, Buffer.from('SQLite format 3\0resto', 'latin1'));
    expect(
      codigo(() => {
        verificarArchivoCifrado(ruta);
      }),
    ).toBe('BASE_INVALIDA');
  });

  it('activa los pragmas de seguridad', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    expect(base.pragma('temp_store', { simple: true })).toBe(2);
    expect(base.pragma('secure_delete', { simple: true })).toBe(1);
    expect(base.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('Migraciones', () => {
  it('son idempotentes y se aplican por versión', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    migrar(base);
    const extra = [
      { version: 1, sql: '' },
      { version: 2, sql: 'CREATE TABLE extra (x);' },
    ];
    migrar(base, extra);
    expect(base.pragma('user_version', { simple: true })).toBe(2);
    expect(base.prepare('SELECT count(*) AS c FROM extra').get()).toEqual({ c: 0 });
  });

  it('una migración que falla no deja cambios a medias', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    expect(() => {
      migrar(base, [{ version: 1, sql: 'CREATE TABLE a (x); ESTO NO ES SQL;' }]);
    }).toThrow();
    expect(base.pragma('user_version', { simple: true })).toBe(0);
    expect(base.prepare("SELECT count(*) AS c FROM sqlite_master WHERE name = 'a'").get()).toEqual({
      c: 0,
    });
  });

  it('rechaza una base de una versión más nueva', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    base.pragma('user_version = 999');
    expect(
      codigo(() => {
        migrar(base);
      }),
    ).toBe('ESQUEMA_MAS_NUEVO');
  });

  it('el esquema de Drizzle coincide con las columnas de la migración', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    const columnas = (tabla: string) =>
      (base.pragma(`table_info(${tabla})`) as { name: string }[]).map((c) => c.name).sort();
    expect(columnas('boveda_meta')).toEqual(
      ['created_at', 'id', 'recordar_en_equipo', 'updated_at', 'version_esquema'].sort(),
    );
    expect(columnas('configuracion')).toEqual(
      [
        'actualizaciones_activas',
        'bloqueo_minutos',
        'created_at',
        'id',
        'idioma',
        'retencion_dias',
        'tema',
        'updated_at',
      ].sort(),
    );
  });
});

describe('Configuración', () => {
  it('guarda y lee los valores, con los valores por defecto de la especificación', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    inicializarDatos(base, false);
    expect(leerConfiguracion(base)).toEqual(CONFIGURACION_POR_DEFECTO);
    expect(CONFIGURACION_POR_DEFECTO.bloqueoMinutos).toBe(15);
    guardarConfiguracion(base, { bloqueoMinutos: 30, tema: 'dark' });
    expect(leerConfiguracion(base)).toMatchObject({ bloqueoMinutos: 30, tema: 'dark' });
  });

  it('sin fila de configuración falla cerrado', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    expect(codigo(() => leerConfiguracion(base))).toBe('BASE_INVALIDA');
    expect(
      codigo(() => {
        guardarConfiguracion(base, { tema: 'dark' });
      }),
    ).toBe('BASE_INVALIDA');
  });
});

describe('Lápidas y purga', () => {
  const lapida = (proyectoId: string, eliminadoEn = '2026-10-01T00:00:00.000Z') => ({
    proyectoId,
    eliminadoEn,
  });

  it('combina sin duplicar y conserva la fecha original', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    registrarLapidas(base, []);
    registrarLapidas(base, [lapida('a')]);
    registrarLapidas(base, [lapida('a', '2030-01-01T00:00:00.000Z'), lapida('b')]);
    expect(leerLapidas(base).sort((x, y) => x.proyectoId.localeCompare(y.proyectoId))).toEqual([
      lapida('a'),
      lapida('b'),
    ]);
  });

  it('purga los datos de los proyectos con lápida y deja los demás', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    base.exec('CREATE TABLE evidencia (proyecto_id TEXT, dato TEXT); ');
    base.exec("INSERT INTO evidencia VALUES ('a', 'de-a'), ('b', 'de-b');");

    purgarConLapida(base, ['evidencia']); // sin lápidas no borra nada
    expect(base.prepare('SELECT count(*) AS c FROM evidencia').get()).toEqual({ c: 2 });

    registrarLapidas(base, [lapida('a')]);
    purgarConLapida(base); // sin tablas registradas no hace nada
    purgarConLapida(base, ['evidencia']);
    expect(base.prepare('SELECT dato FROM evidencia').all()).toEqual([{ dato: 'de-b' }]);
  });
});

describe('verificarIntegridad', () => {
  it('acepta una base sana y rechaza una con páginas alteradas', () => {
    const ruta = path.join(carpeta, 'b.db');
    const base = abrir(ruta);
    migrar(base);
    verificarIntegridad(base);
    base.close();

    const bytes = readFileSync(ruta);
    bytes.fill(0xff, 4096, 4200);
    writeFileSync(ruta, bytes);
    const abierta = abrir(ruta);
    expect(
      codigo(() => {
        verificarIntegridad(abierta);
      }),
    ).toBe('BASE_INVALIDA');
  });
});

describe('boveda.sellada', () => {
  const conKdf = (cambios: object) =>
    Buffer.from(
      JSON.stringify({
        ...JSON.parse(serializarSellada(SELLADA).toString()),
        kdf: { ...SELLADA.kdf, ...cambios },
      }),
    );

  it('ida y vuelta sin perder datos', () => {
    expect(analizarSellada(serializarSellada(SELLADA))).toEqual(SELLADA);
  });

  it.each([
    ['memoria por debajo del mínimo', { memoriaKiB: 64 * 1024 - 1 }],
    ['iteraciones por debajo del mínimo', { iteraciones: 2 }],
    ['sin paralelismo', { paralelismo: 0 }],
    ['memoria absurda', { memoriaKiB: 1024 * 1024 * 1024 }],
    ['otro algoritmo', { algoritmo: 'argon2i' }],
    ['otra versión', { version: 16 }],
    ['tipo incorrecto', { iteraciones: '3' }],
  ])('rechaza parámetros de Argon2id: %s', (_nombre, cambios) => {
    expect(codigo(() => analizarSellada(conKdf(cambios)))).toBe('SELLADA_INVALIDA');
  });

  it.each([
    ['basura', Buffer.from('no es json')],
    ['json que no es objeto', Buffer.from('null')],
    ['otro formato', Buffer.from(JSON.stringify({ formato: 'otro' }))],
    ['enorme', Buffer.alloc(64 * 1024 + 1, 0x20)],
    [
      'salt de otro largo',
      Buffer.from(
        JSON.stringify({ ...JSON.parse(serializarSellada(SELLADA).toString()), salt: 'AAAA' }),
      ),
    ],
    [
      'clave envuelta sin base64',
      Buffer.from(
        JSON.stringify({
          ...JSON.parse(serializarSellada(SELLADA).toString()),
          maestraEnvuelta: '***',
        }),
      ),
    ],
  ])('rechaza: %s', (_nombre, datos) => {
    expect(codigo(() => analizarSellada(datos))).toBe('SELLADA_INVALIDA');
  });

  it('un archivo que no existe o cortado a la mitad se rechaza', () => {
    const ruta = path.join(carpeta, 'boveda.sellada');
    expect(codigo(() => leerSellada(ruta))).toBe('SELLADA_INVALIDA');
    const entero = serializarSellada(SELLADA);
    writeFileSync(ruta, entero.subarray(0, entero.length / 2));
    expect(codigo(() => leerSellada(ruta))).toBe('SELLADA_INVALIDA');
  });
});

describe('Escritura atómica', () => {
  const ruta = () => path.join(carpeta, 'boveda.sellada');

  it('crea y reemplaza el archivo sin dejar temporales', () => {
    escribirAtomico(ruta(), Buffer.from('uno'));
    escribirAtomico(ruta(), Buffer.from('dos'));
    expect(readFileSync(ruta(), 'utf8')).toBe('dos');
    expect(readdirSync(carpeta)).toEqual(['boveda.sellada']);
  });

  it('si el rename falla, el archivo anterior queda intacto y no quedan temporales', () => {
    escribirAtomico(ruta(), serializarSellada(SELLADA));
    expect(() => {
      escribirAtomico(ruta(), Buffer.from('{"a medio'), {
        renombrar: () => {
          throw new Error('corte de luz simulado');
        },
      });
    }).toThrow();
    expect(leerSellada(ruta())).toEqual(SELLADA);
    expect(readdirSync(carpeta)).toEqual(['boveda.sellada']);
  });

  it('un temporal a medio escribir no afecta la bóveda y se limpia al iniciar', () => {
    escribirAtomico(ruta(), serializarSellada(SELLADA));
    writeFileSync(`${ruta()}.tmp-abc123`, '{"formato":"qatlas.sell');
    expect(leerSellada(ruta())).toEqual(SELLADA);
    recuperarInstalacion(carpeta);
    expect(readdirSync(carpeta)).toEqual(['boveda.sellada']);
    expect(leerSellada(ruta())).toEqual(SELLADA);
  });
});

describe('Instalación de la base y el archivo sellado', () => {
  it('detecta los estados de los archivos', () => {
    const rutas = rutasBoveda(carpeta);
    expect(estadoArchivos(rutas)).toBe('sin-boveda');
    writeFileSync(rutas.sellada, 'x');
    expect(estadoArchivos(rutas)).toBe('danada');
    writeFileSync(rutas.base, 'x');
    expect(estadoArchivos(rutas)).toBe('existe');
    rmSync(rutas.sellada);
    expect(estadoArchivos(rutas)).toBe('danada');
  });

  it('instala los dos juntos y sin restos', () => {
    const rutas = rutasBoveda(carpeta);
    writeFileSync(rutas.baseNueva, 'base-nueva');
    instalarPar(rutas, Buffer.from('sellada-nueva'));
    expect(readFileSync(rutas.base, 'utf8')).toBe('base-nueva');
    expect(readFileSync(rutas.sellada, 'utf8')).toBe('sellada-nueva');
    expect(existsSync(rutas.marca)).toBe(false);
    expect(existsSync(rutas.baseNueva)).toBe(false);
  });

  it('corte antes de la marca: descarta lo nuevo y conserva lo anterior', () => {
    const rutas = rutasBoveda(carpeta);
    writeFileSync(rutas.base, 'base-vieja');
    writeFileSync(rutas.sellada, 'sellada-vieja');
    writeFileSync(rutas.baseNueva, 'base-nueva');
    writeFileSync(rutas.selladaNueva, 'sellada-nueva');
    recuperarInstalacion(carpeta);
    expect(readFileSync(rutas.base, 'utf8')).toBe('base-vieja');
    expect(readFileSync(rutas.sellada, 'utf8')).toBe('sellada-vieja');
    expect(existsSync(rutas.baseNueva)).toBe(false);
    expect(existsSync(rutas.selladaNueva)).toBe(false);
  });

  it('corte después de la marca: termina la instalación aunque la base ya se haya movido', () => {
    const rutas = rutasBoveda(carpeta);
    writeFileSync(rutas.base, 'base-nueva');
    writeFileSync(rutas.sellada, 'sellada-vieja');
    writeFileSync(rutas.selladaNueva, 'sellada-nueva');
    writeFileSync(rutas.marca, '1');
    recuperarInstalacion(carpeta);
    expect(readFileSync(rutas.base, 'utf8')).toBe('base-nueva');
    expect(readFileSync(rutas.sellada, 'utf8')).toBe('sellada-nueva');
    expect(existsSync(rutas.marca)).toBe(false);
  });
});

describe('Copia de seguridad', () => {
  const sellada = serializarSellada(SELLADA);

  it('sale cifrada de la base abierta, y la base sigue en uso', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    inicializarDatos(base, false);
    const destino = path.join(carpeta, 'copia.qatlas');
    crearCopia(base, sellada, carpeta, destino);

    expect(leerConfiguracion(base).bloqueoMinutos).toBe(15);
    expect(readdirSync(carpeta).some((n) => n.includes('.tmp-'))).toBe(false);

    const contenido = leerCopia(destino);
    expect(contenido.sellada.equals(sellada)).toBe(true);
    const restaurada = path.join(carpeta, 'restaurada.db');
    writeFileSync(restaurada, contenido.base);
    expect(leerConfiguracion(abrir(restaurada)).bloqueoMinutos).toBe(15);
    expect(codigo(() => abrir(restaurada, randomBytes(32)))).toBe('BASE_INVALIDA');
  });

  it('si el destino no se puede escribir, no deja temporales', () => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    const destino = path.join(carpeta, 'no-existe', 'copia.qatlas');
    expect(() => {
      crearCopia(base, sellada, carpeta, destino);
    }).toThrow();
    expect(readdirSync(carpeta).some((n) => n.includes('.tmp-'))).toBe(false);
  });

  it.each<[string, (bueno: Buffer) => Buffer]>([
    ['vacía', () => Buffer.alloc(0)],
    ['otra magia', (b) => Buffer.concat([Buffer.from('XXXX'), b.subarray(4)])],
    [
      'otra versión',
      (b) => {
        const c = Buffer.from(b);
        c[4] = 2;
        return c;
      },
    ],
    [
      'largo de sellada enorme',
      (b) => {
        const c = Buffer.from(b);
        c.writeUInt32BE(0xffffffff, 5);
        return c;
      },
    ],
    ['cortada', (b) => b.subarray(0, 40)],
    [
      'base en texto plano',
      (b) => {
        const largo = b.readUInt32BE(5);
        const c = Buffer.from(b);
        c.write('SQLite format 3\0', 9 + largo, 'latin1');
        return c;
      },
    ],
  ])('rechaza una copia: %s', (_nombre, alterar) => {
    const base = abrir(path.join(carpeta, 'b.db'));
    migrar(base);
    const destino = path.join(carpeta, 'copia.qatlas');
    crearCopia(base, sellada, carpeta, destino);
    const alterada = path.join(carpeta, 'alterada.qatlas');
    writeFileSync(alterada, alterar(readFileSync(destino)));
    expect(statSync(destino).size).toBeGreaterThan(0);
    expect(codigo(() => leerCopia(alterada))).toBe('COPIA_INVALIDA');
  });

  it('un archivo que no existe se rechaza', () => {
    expect(codigo(() => leerCopia(path.join(carpeta, 'nada')))).toBe('COPIA_INVALIDA');
  });
});
