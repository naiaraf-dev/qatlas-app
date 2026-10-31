/**
 * RN-PRY-04 y TS-10 sobre la base real: un secreto de credencial solo existe cifrado en su campo. No
 * aparece en otra columna, en la auditoría, en el archivo ni en la salida de ningún canal, y al
 * eliminar el proyecto no queda con qué descifrarlo.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { abrirClaveProyecto, descifrarCampo, ErrorCripto } from '@qatlas/crypto';
import type { BaseCifrada } from '@qatlas/db';
import {
  EXCLUSIONES_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  type ProyectoEntrada,
} from '@qatlas/shared';
import { ServicioBoveda } from '../apps/desktop/src/main/boveda/servicio';
import { contextoSecreto, ServicioProyectos } from '../apps/desktop/src/main/proyectos/servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const CANARIO = 'CANARIO-secreto-de-credencial-7f3a';
const CANARIO_NUEVO = 'CANARIO-secreto-reemplazado-91bc';

const ENTRADA: ProyectoEntrada = {
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Lexora',
  descripcion: '',
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.lexora.test'],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
};

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;

/** Formas en que el valor podría aparecer aunque no sea como texto. */
const formas = (valor: string) => [
  valor,
  Buffer.from(valor).toString('base64'),
  Buffer.from(valor).toString('hex'),
  Buffer.from(valor, 'utf16le').toString('latin1'),
];

/** Todas las filas de todas las tablas, con la base abierta. */
function volcar(base: BaseCifrada, omitir: { tabla: string; columna: string }[] = []) {
  const tablas = base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  const salida: Record<string, string> = {};
  for (const { name } of tablas) {
    const filas = base.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[];
    salida[name] = JSON.stringify(
      filas.map((fila) =>
        Object.fromEntries(
          Object.entries(fila)
            .filter(([col]) => !omitir.some((o) => o.tabla === name && o.columna === col))
            .map(([col, valor]) => [
              col,
              Buffer.isBuffer(valor) ? valor.toString('latin1') : valor,
            ]),
        ),
      ),
    );
  }
  return salida;
}

function archivosDeLaCarpeta(): Buffer[] {
  return readdirSync(carpeta).map((nombre) => readFileSync(path.join(carpeta, nombre)));
}

function crearConCredencial() {
  const { declaracion } = proyectos.validar(ENTRADA);
  if (!declaracion) throw new Error('Entrada no válida');
  const creado = proyectos.crear(ENTRADA, { aceptada: true, ...declaracion });
  if (creado.resultado !== 'creado') throw new Error('No se creó');
  const guardada = proyectos.guardarCredencial({
    proyectoId: creado.id,
    nombre: 'Prueba',
    usuario: 'ana@example.com',
    urlLogin: 'https://app.lexora.test/login',
    pasosLogin: [{ accion: 'rellenar', selector: '#clave', origen: 'secreto' }],
    secreto: CANARIO,
  });
  if (guardada.resultado !== 'guardada') throw new Error('No se guardó');
  return { id: creado.id, credencialId: guardada.credencialId };
}

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-secreto-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('El secreto solo existe en su campo cifrado', () => {
  it('no aparece en ninguna tabla, ni siquiera en el propio campo', () => {
    crearConCredencial();
    const volcado = boveda.conAcceso((base) => volcar(base));
    expect(Object.keys(volcado)).toEqual(
      expect.arrayContaining(['proyecto', 'credencial', 'autorizacion', 'auditoria']),
    );
    const todo = Object.values(volcado).join('\n');
    for (const forma of formas(CANARIO)) expect(todo).not.toContain(forma);
  });

  it('no aparece en la auditoría, tampoco después de reemplazarlo', () => {
    const { id, credencialId } = crearConCredencial();
    proyectos.reemplazarSecreto(id, credencialId, CANARIO_NUEVO);
    const { auditoria } = boveda.conAcceso((base) => volcar(base));
    for (const canario of [CANARIO, CANARIO_NUEVO]) {
      for (const forma of formas(canario)) expect(auditoria).not.toContain(forma);
    }
    expect(auditoria).toContain('credencial.reemplazar_secreto');
    // Tampoco el indicio de un largo o un valor: el detalle tiene solo el ID del proyecto.
    expect(auditoria).not.toMatch(/secreto"?:/);
  });

  it('no aparece en los archivos de la carpeta de datos', () => {
    crearConCredencial();
    boveda.bloquear();
    for (const contenido of archivosDeLaCarpeta()) {
      for (const forma of formas(CANARIO)) expect(contenido.includes(forma)).toBe(false);
    }
  });

  it('no aparece en lo que reciben los canales', () => {
    const { id, credencialId } = crearConCredencial();
    const salida = JSON.stringify([proyectos.listar(), proyectos.obtener(id)]);
    for (const forma of formas(CANARIO)) expect(salida).not.toContain(forma);
    // Ni el valor cifrado, que tampoco le sirve a la interfaz.
    expect(salida).not.toContain('"secreto":');
    expect(salida).toContain(credencialId);
    expect(salida).toContain('"secretoConfigurado":true');
  });

  it('no queda en la base después de reemplazarlo: el campo es otro y el viejo ya no abre', () => {
    const { id, credencialId } = crearConCredencial();
    const leer = () =>
      boveda.conAcceso(
        (base) =>
          (
            base.prepare('SELECT secreto FROM credencial WHERE id = ?').get(credencialId) as {
              secreto: Buffer;
            }
          ).secreto,
      );
    const viejo = leer();
    proyectos.reemplazarSecreto(id, credencialId, CANARIO_NUEVO);
    expect(leer().equals(viejo)).toBe(false);
    expect(leer().includes(Buffer.from(CANARIO_NUEVO))).toBe(false);
  });
});

describe('TS-10: eliminar el proyecto', () => {
  it('borra la clave envuelta y los datos, y un valor guardado antes queda ilegible', () => {
    const { id, credencialId } = crearConCredencial();
    const { envuelta, secreto } = boveda.conAcceso((base) => ({
      envuelta: (
        base.prepare('SELECT clave_proyecto_cifrada AS c FROM proyecto WHERE id = ?').get(id) as {
          c: Buffer;
        }
      ).c,
      secreto: (
        base.prepare('SELECT secreto AS s FROM credencial WHERE id = ?').get(credencialId) as {
          s: Buffer;
        }
      ).s,
    }));

    expect(proyectos.eliminar(id, 'Lexora')).toEqual({ resultado: 'eliminado' });

    const todo = boveda.conAcceso((base) => {
      expect(base.pragma('freelist_count', { simple: true })).toBe(0);
      return Object.values(volcar(base)).join('\n');
    });
    expect(todo).not.toContain(envuelta.toString('latin1'));
    expect(todo).not.toContain(secreto.toString('latin1'));
    expect(todo).not.toContain('app.lexora.test');
    expect(todo).not.toContain('ana@example.com');
    expect(todo).not.toContain('Lexora');
    expect(todo).toContain(id); // la lápida y la auditoría, solo con el UUID

    // Otra clave no abre lo que se guardó antes.
    const otra = Buffer.alloc(32, 7);
    expect(() => descifrarCampo(otra, contextoSecreto(id, credencialId), secreto)).toThrow(
      ErrorCripto,
    );
  });

  it('una copia anterior todavía lo contiene, pero al restaurar se purga (ADR 009)', async () => {
    const { id } = crearConCredencial();
    const copia = path.join(carpeta, 'copia.qatlas');
    boveda.crearCopia(copia);
    proyectos.eliminar(id, 'Lexora');

    expect(await boveda.restaurar(copia, CONTRASENA)).toEqual({ resultado: 'restaurada' });

    expect(proyectos.listar()).toEqual([]);
    const todo = boveda.conAcceso((base) => Object.values(volcar(base)).join('\n'));
    expect(todo).not.toContain('app.lexora.test');
    expect(boveda.lapidas().map((l) => l.proyectoId)).toEqual([id]);
  });

  it('la clave envuelta solo se abre con la maestra de la bóveda y atada a su proyecto', () => {
    const { id } = crearConCredencial();
    boveda.conAcceso((base, maestra) => {
      const { c } = base
        .prepare('SELECT clave_proyecto_cifrada AS c FROM proyecto WHERE id = ?')
        .get(id) as { c: Buffer };
      expect(abrirClaveProyecto(maestra, id, c)).toHaveLength(32);
      expect(() => abrirClaveProyecto(maestra, 'otro-id', c)).toThrow(ErrorCripto);
    });
  });
});
