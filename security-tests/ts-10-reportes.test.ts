/**
 * TS-10 sobre los reportes (semana 9a, ADR 048). El contenido de un reporte de bug se cifra con la clave del
 * proyecto y su contexto (`reporte:<proyecto>:<reporte>`): eliminado el proyecto, desaparecen sus reportes y
 * su registro de exportaciones, y una copia del contenido hecha antes ya no se descifra.
 *
 * Control positivo: el otro proyecto, vivo, sigue leyendo su reporte; y el contenido en claro sí tiene la
 * marca que la copia cifrada no muestra.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertarReporte, registrarExportacion } from '@qatlas/db';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import { ServicioBoveda } from '../apps/desktop/src/main/boveda/servicio';
import { ServicioProyectos } from '../apps/desktop/src/main/proyectos/servicio';
import { contextoReporte } from '../apps/desktop/src/main/reportes/servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const MARCA = ['reporte', 'con', 'datos', 'inventados', '6614'].join('-');

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts10-reportes-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

function crearProyecto(nombre: string): string {
  const entrada = {
    ...PROYECTO_POR_DEFECTO,
    nombre,
    descripcion: '',
    urlBase: 'https://example.test/',
    dominios: ['example.test'],
    puertosLocales: [],
    exclusiones: [...EXCLUSIONES_POR_DEFECTO],
    selectoresSensibles: [],
    dominiosAutenticacion: [],
  };
  const { declaracion } = proyectos.validar(entrada);
  if (!declaracion) throw new Error('inválido');
  const creado = proyectos.crear(entrada, { aceptada: true, ...declaracion });
  if (creado.resultado !== 'creado') throw new Error('no se creó');
  return creado.id;
}

/** Un reporte cifrado como lo cifra `ServicioReportes`, con una exportación registrada. */
function reporte(proyectoId: string): { id: string; sellado: Buffer } {
  const id = crypto.randomUUID();
  const sellado = proyectos.cifrarDato(
    proyectoId,
    contextoReporte(proyectoId, id),
    JSON.stringify({ titulo: MARCA }),
  );
  boveda.conAcceso((base) => {
    insertarReporte(base, {
      id,
      proyectoId,
      severidad: 'alta',
      contenidoCifrado: sellado,
      alertasDetector: 0,
      hallazgoIds: [],
    });
    registrarExportacion(base, {
      id: crypto.randomUUID(),
      proyectoId,
      reporteId: id,
      formato: 'markdown',
      nivel: 'texto-y-capturas',
      evidenciasIncluidas: [],
      destinoSincronizado: false,
      alertasConfirmadas: false,
    });
  });
  return { id, sellado: Buffer.from(sellado) };
}

const filas = (tabla: string, proyectoId: string) =>
  boveda.conAcceso(
    (base) =>
      (
        base
          .prepare(`SELECT COUNT(*) AS n FROM ${tabla} WHERE proyecto_id = ?`)
          .get(proyectoId) as {
          n: number;
        }
      ).n,
  );

describe('TS-10 · Reportes: borrado criptográfico con el proyecto', () => {
  it('la copia del contenido está cifrada; control: en claro tiene la marca', () => {
    const p = crearProyecto('Lexora');
    const { id, sellado } = reporte(p);
    expect(sellado.toString('latin1')).not.toContain(MARCA);
    const [claro] = proyectos.descifrarDatos(p, [{ contexto: contextoReporte(p, id), sellado }]);
    expect(claro).toContain(MARCA);
  });

  it('eliminado el proyecto, sus reportes y exportaciones desaparecen y la copia no se descifra', () => {
    const eliminado = crearProyecto('Lexora');
    const vivo = crearProyecto('Otro');
    const delEliminado = reporte(eliminado);
    const delVivo = reporte(vivo);
    expect(proyectos.eliminar(eliminado, 'Lexora')).toEqual({ resultado: 'eliminado' });

    for (const tabla of ['reporte_bug', 'reporte_hallazgo', 'exportacion']) {
      expect(filas(tabla, eliminado), tabla).toBe(0);
    }
    expect(filas('reporte_bug', vivo)).toBe(1);
    expect(filas('exportacion', vivo)).toBe(1);

    // Sin su clave no hay con qué descifrar; tampoco con la del otro proyecto.
    const copia = {
      contexto: contextoReporte(eliminado, delEliminado.id),
      sellado: delEliminado.sellado,
    };
    expect(() => proyectos.descifrarDatos(eliminado, [copia])).toThrow();
    expect(() => proyectos.descifrarDatos(vivo, [copia])).toThrow();
    // Control: el proyecto vivo sigue leyendo lo suyo.
    const [suyo] = proyectos.descifrarDatos(vivo, [
      { contexto: contextoReporte(vivo, delVivo.id), sellado: delVivo.sellado },
    ]);
    expect(suyo).toContain(MARCA);
  });
});
