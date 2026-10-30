import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analizarFreno,
  esperaPorFallos,
  FRENO_INICIAL,
  registrarFallo,
  segundosRestantes,
} from './freno-intentos';
import { DetectorInactividad } from './inactividad';
import { BovedaBloqueada, ServicioBoveda } from './servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const OTRA = 'cometa-verde-sobre-el-rio-58';

let carpeta: string;
let servicios: ServicioBoveda[];

function servicio(opciones: Partial<ConstructorParameters<typeof ServicioBoveda>[0]> = {}) {
  const creado = new ServicioBoveda({ carpeta, ...opciones });
  servicios.push(creado);
  return creado;
}

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-boveda-'));
  servicios = [];
});

afterEach(() => {
  for (const s of servicios) s.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Freno de intentos (RN-BOV-02)', () => {
  it.each([
    [1, 0],
    [4, 0],
    [5, 30],
    [6, 60],
    [7, 300],
    [8, 900],
    [9, 1800],
    [50, 1800],
  ])('con %i fallos espera %i s', (fallos, segundos) => {
    expect(esperaPorFallos(fallos)).toBe(segundos);
  });

  it('cuenta los segundos restantes y limita un reloj atrasado', () => {
    const estado = registrarFallo({ fallos: 4, bloqueadoHastaMs: 0 }, 1000);
    expect(estado).toEqual({ fallos: 5, bloqueadoHastaMs: 31_000 });
    expect(segundosRestantes(estado, 1000)).toBe(30);
    expect(segundosRestantes(estado, 31_000)).toBe(0);
    expect(segundosRestantes(FRENO_INICIAL, 1000)).toBe(0);
    expect(segundosRestantes({ fallos: 9, bloqueadoHastaMs: 9e12 }, 0)).toBe(1800);
  });

  it.each(['no es json', '{}', '{"fallos":-1,"bloqueadoHastaMs":0}', 'null'])(
    'un archivo alterado falla cerrado: %s',
    (contenido) => {
      expect(analizarFreno(contenido, 1000)).toEqual({ fallos: 5, bloqueadoHastaMs: 31_000 });
    },
  );

  it('lee un archivo válido', () => {
    expect(analizarFreno('{"fallos":2,"bloqueadoHastaMs":0}', 1000)).toEqual({
      fallos: 2,
      bloqueadoHastaMs: 0,
    });
  });
});

describe('Detector de inactividad', () => {
  it('vence al llegar al límite, y la actividad lo reinicia', () => {
    const detector = new DetectorInactividad(1000, 0);
    expect(detector.venció(999)).toBe(false);
    expect(detector.venció(1000)).toBe(true);
    detector.registrarActividad(1000);
    expect(detector.venció(1999)).toBe(false);
    detector.cambiarLimite(500);
    expect(detector.venció(1500)).toBe(true);
  });
});

describe('Primer inicio', () => {
  it('crea la bóveda desbloqueada, con la configuración por defecto', async () => {
    const boveda = servicio();
    expect(boveda.estado()).toBe('sin-boveda');
    expect(await boveda.crear(CONTRASENA, false)).toEqual({ resultado: 'creada' });
    expect(boveda.estado()).toBe('desbloqueada');
    expect(boveda.configuracion()).toMatchObject({ bloqueoMinutos: 15, tema: 'system' });
    expect(readdirSync(carpeta).sort()).toEqual(['boveda.db', 'boveda.sellada']);
  });

  it.each([
    ['corta', 'abc', 'corta'],
    ['débil', 'aaaaaaaaaaaaaaaa', 'debil'],
  ])('rechaza una contraseña %s sin crear nada', async (_nombre, contrasena, motivo) => {
    const boveda = servicio();
    expect(await boveda.crear(contrasena, false)).toEqual({ resultado: 'rechazada', motivo });
    expect(readdirSync(carpeta)).toEqual([]);
    expect(boveda.estado()).toBe('sin-boveda');
  });

  it('nunca pisa una bóveda existente', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    const antes = readFileSync(path.join(carpeta, 'boveda.sellada'));
    expect(await boveda.crear(OTRA, false)).toEqual({
      resultado: 'rechazada',
      motivo: 'ya-existe',
    });
    expect(readFileSync(path.join(carpeta, 'boveda.sellada')).equals(antes)).toBe(true);
  });

  it('si se bloquea durante la creación, queda creada pero bloqueada', async () => {
    const boveda = servicio();
    const creando = boveda.crear(CONTRASENA, false);
    // Espera a que la creación arranque antes de pedir el bloqueo.
    await Promise.resolve();
    await Promise.resolve();
    boveda.bloquear();
    expect(await creando).toEqual({ resultado: 'creada' });
    expect(boveda.estado()).toBe('bloqueada');
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
  });

  it('un fallo al crear no deja archivos', async () => {
    const boveda = servicio();
    // Una carpeta en lugar del archivo hace fallar la creación de la base.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(carpeta, 'boveda.db.nueva'));
    await expect(boveda.crear(CONTRASENA, false)).rejects.toThrow();
    expect(boveda.estado()).toBe('sin-boveda');
  });
});

describe('Desbloqueo', () => {
  async function creada() {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.bloquear();
    return boveda;
  }

  it('abre con la contraseña correcta y conserva los datos', async () => {
    const boveda = await creada();
    expect(boveda.estado()).toBe('bloqueada');
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
    expect(boveda.configuracion().bloqueoMinutos).toBe(15);
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
  });

  it('avisa al desbloquear, con la configuración', async () => {
    const alDesbloquear = vi.fn();
    const boveda = servicio({ alDesbloquear });
    await boveda.crear(CONTRASENA, false);
    expect(alDesbloquear).toHaveBeenCalledWith(expect.objectContaining({ tema: 'system' }));
  });

  it('rechaza una contraseña incorrecta sin detalles', async () => {
    const boveda = await creada();
    const resultado = await boveda.desbloquear(OTRA);
    expect(resultado).toEqual({ resultado: 'rechazada', esperaSegundos: 0 });
    expect(boveda.estado()).toBe('bloqueada');
  });

  it('aplica el freno, sobrevive a un reinicio y se reinicia al acertar', async () => {
    let ahora = 1_000_000;
    const reloj = () => ahora;
    const boveda = servicio({ ahora: reloj });
    await boveda.crear(CONTRASENA, false);
    boveda.bloquear();

    for (let i = 0; i < 4; i++) {
      expect(await boveda.desbloquear(OTRA)).toEqual({ resultado: 'rechazada', esperaSegundos: 0 });
    }
    expect(await boveda.desbloquear(OTRA)).toEqual({ resultado: 'rechazada', esperaSegundos: 30 });

    // Con la espera vigente se rechaza hasta la contraseña correcta, sin evaluarla.
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({
      resultado: 'rechazada',
      esperaSegundos: 30,
    });

    const reiniciada = servicio({ ahora: reloj });
    expect(reiniciada.esperaSegundos()).toBe(30);

    ahora += 30_000;
    expect(await reiniciada.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
    expect(reiniciada.esperaSegundos()).toBe(0);
    expect(existsSync(path.join(carpeta, 'intentos.json'))).toBe(false);
  });

  it('un archivo sellado con parámetros rebajados no abre, y no se pisa', async () => {
    const boveda = await creada();
    const ruta = path.join(carpeta, 'boveda.sellada');
    const sellada = JSON.parse(readFileSync(ruta, 'utf8')) as { kdf: { memoriaKiB: number } };
    sellada.kdf.memoriaKiB = 1024;
    const alterada = JSON.stringify(sellada);
    writeFileSync(ruta, alterada);

    expect(boveda.estado()).toBe('danada');
    expect((await boveda.desbloquear(CONTRASENA)).resultado).toBe('rechazada');
    expect(boveda.estado()).toBe('danada');
    expect(readFileSync(ruta, 'utf8')).toBe(alterada);
  });

  it.each(['boveda.db', 'boveda.sellada'])(
    'si falta %s queda dañada, nunca como bóveda nueva',
    async (faltante) => {
      const boveda = await creada();
      rmSync(path.join(carpeta, faltante));
      expect(boveda.estado()).toBe('danada');
      expect(await boveda.crear(OTRA, false)).toEqual({
        resultado: 'rechazada',
        motivo: 'ya-existe',
      });
    },
  );

  it('un temporal de boveda.sellada a medio escribir no deja la bóveda inutilizable', async () => {
    await creada();
    writeFileSync(path.join(carpeta, 'boveda.sellada.tmp-abc123'), '{"formato":"qat');
    const boveda = servicio();
    expect(readdirSync(carpeta).some((n) => n.includes('.tmp-'))).toBe(false);
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
  });
});

describe('Configuración persistida', () => {
  it('el tema y los minutos sobreviven a un bloqueo', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.cambiarConfiguracion({ tema: 'dark', bloqueoMinutos: 30 });
    boveda.bloquear();
    expect(() => boveda.configuracion()).toThrow(BovedaBloqueada);
    await boveda.desbloquear(CONTRASENA);
    expect(boveda.configuracion()).toMatchObject({ tema: 'dark', bloqueoMinutos: 30 });
  });
});

describe('Copia y restauración', () => {
  const destino = () => path.join(carpeta, 'copia.qatlas');
  const lapida = (proyectoId: string) => ({
    proyectoId,
    eliminadoEn: '2026-10-01T00:00:00.000Z',
  });

  it('la copia se hace con la bóveda abierta, que sigue desbloqueada', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    expect(boveda.estado()).toBe('desbloqueada');
    expect(existsSync(destino())).toBe(true);
  });

  it('bloqueada no se puede copiar ni restaurar sobre la bóveda actual', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    boveda.bloquear();
    expect(() => {
      boveda.crearCopia(destino());
    }).toThrow(BovedaBloqueada);
    await expect(boveda.restaurar(destino(), CONTRASENA)).rejects.toThrow(BovedaBloqueada);
  });

  it('restaura los datos de la copia, y después abre con la contraseña de la copia', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.cambiarConfiguracion({ bloqueoMinutos: 42 });
    boveda.crearCopia(destino());
    boveda.cambiarConfiguracion({ bloqueoMinutos: 7 });

    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'restaurada' });
    expect(boveda.estado()).toBe('desbloqueada');
    expect(boveda.configuracion().bloqueoMinutos).toBe(42);

    boveda.bloquear();
    expect(await boveda.desbloquear(CONTRASENA)).toEqual({ resultado: 'desbloqueada' });
  });

  it('en un equipo nuevo restaura sin bóveda previa', async () => {
    const original = servicio();
    await original.crear(CONTRASENA, false);
    const copia = path.join(os.tmpdir(), `qatlas-copia-${path.basename(carpeta)}.qatlas`);
    original.crearCopia(copia);
    original.bloquear();
    rmSync(path.join(carpeta, 'boveda.db'));
    rmSync(path.join(carpeta, 'boveda.sellada'));

    const nueva = servicio();
    expect(nueva.estado()).toBe('sin-boveda');
    expect(await nueva.restaurar(copia, CONTRASENA)).toEqual({ resultado: 'restaurada' });
    expect(nueva.estado()).toBe('desbloqueada');
    rmSync(copia);
  });

  it('con la contraseña incorrecta, la bóveda actual queda intacta y abierta', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    boveda.cambiarConfiguracion({ bloqueoMinutos: 7 });

    expect(await boveda.restaurar(destino(), OTRA)).toEqual({ resultado: 'rechazada' });
    expect(boveda.configuracion().bloqueoMinutos).toBe(7);
    expect(existsSync(path.join(carpeta, 'boveda.db.nueva'))).toBe(false);
  });

  it('una copia alterada se rechaza y la bóveda actual queda intacta', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    const bytes = readFileSync(destino());
    bytes.fill(0xff, bytes.length - 2000, bytes.length - 1000);
    writeFileSync(destino(), bytes);

    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'rechazada' });
    expect(boveda.configuracion().bloqueoMinutos).toBe(15);
    expect(existsSync(path.join(carpeta, 'boveda.db.nueva'))).toBe(false);
  });

  it('un archivo que no es una copia se rechaza', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    writeFileSync(destino(), 'esto no es una copia');
    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'rechazada' });
  });

  it('combina las lápidas de la bóveda y de la copia, y recién después purga (ADR 009)', async () => {
    const boveda = servicio({ tablasDeProyecto: ['evidencia'] });
    await boveda.crear(CONTRASENA, false);
    // Base con datos de tres proyectos; "viejo" ya estaba eliminado al hacer la copia.
    const base = (boveda as unknown as { base: import('@qatlas/db').BaseCifrada }).base;
    base.exec('CREATE TABLE evidencia (proyecto_id TEXT, dato TEXT);');
    base.exec("INSERT INTO evidencia VALUES ('viejo', 'v'), ('reciente', 'r'), ('vivo', 'x');");
    boveda.registrarLapidas([lapida('viejo')]);
    boveda.crearCopia(destino());

    // Después de la copia se elimina "reciente": esa lápida solo está en la bóveda actual.
    boveda.registrarLapidas([lapida('reciente')]);

    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'restaurada' });

    const restaurada = (boveda as unknown as { base: import('@qatlas/db').BaseCifrada }).base;
    expect(restaurada.prepare('SELECT proyecto_id AS id FROM evidencia').all()).toEqual([
      { id: 'vivo' },
    ]);
    expect(
      boveda
        .lapidas()
        .map((l) => l.proyectoId)
        .sort(),
    ).toEqual(['reciente', 'viejo']);
  });

  it('un error inesperado se propaga y no deja la instalación a medias', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    // Una carpeta en lugar del archivo hace fallar la escritura de la base nueva.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(path.join(carpeta, 'boveda.db.nueva'));
    await expect(boveda.restaurar(destino(), CONTRASENA)).rejects.toThrow();
    expect(boveda.configuracion().bloqueoMinutos).toBe(15);
  });

  it('restaura una bóveda dañada', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.crearCopia(destino());
    boveda.bloquear();
    rmSync(path.join(carpeta, 'boveda.sellada'));
    expect(boveda.estado()).toBe('danada');
    expect(await boveda.restaurar(destino(), CONTRASENA)).toEqual({ resultado: 'restaurada' });
    expect(boveda.estado()).toBe('desbloqueada');
  });

  it('mientras restaura o desbloquea, un bloqueo gana', async () => {
    const boveda = servicio();
    await boveda.crear(CONTRASENA, false);
    boveda.bloquear();
    const desbloqueando = boveda.desbloquear(CONTRASENA);
    // Espera a que el desbloqueo arranque antes de pedir el bloqueo.
    await Promise.resolve();
    await Promise.resolve();
    boveda.bloquear();
    await desbloqueando;
    expect(boveda.estado()).toBe('bloqueada');
  });
});
