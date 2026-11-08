/**
 * TS-10 parcial, sobre las evidencias (semana 7b, ADR 035 y 038). El formato v2 necesita dos cosas para
 * descifrar un archivo: la clave del proyecto y la semilla de la evidencia, que vive solo en su fila.
 *
 * - Borrada la semilla (retención o modo datos sensibles), una copia del archivo no se descifra, aunque
 *   la clave del proyecto siga viva.
 * - Eliminado el proyecto, sus evidencias no se descifran, aunque el archivo y la semilla se hubieran
 *   copiado antes.
 *
 * Control positivo en los dos: con lo mismo todavía disponible, la copia sí se descifra. Así el test no
 * puede pasar porque el archivo estaba vacío o porque la lectura falla por otra razón.
 */
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { crearDescifradorArchivo } from '@qatlas/crypto';
import { insertarEjecucion, leerEvidenciaParaDescifrar } from '@qatlas/db';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ServicioBoveda } from '../apps/desktop/src/main/boveda/servicio';
import { carpetaEvidencias } from '../apps/desktop/src/main/evidencias/almacen';
import { ServicioEvidencias } from '../apps/desktop/src/main/evidencias/servicio';
import { ServicioProyectos } from '../apps/desktop/src/main/proyectos/servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const MARCA = Buffer.from(['captura', 'con', 'datos', 'inventados', '3391'].join('-'));
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 5, 0, 0, 0, 2, 0xd0]),
  MARCA,
]);

let carpeta: string;
let copias: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;
let evidencias: ServicioEvidencias;

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts10-'));
  copias = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts10-copias-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
  evidencias = new ServicioEvidencias(boveda, proyectos, carpeta);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
  rmSync(copias, { recursive: true, force: true, maxRetries: 3 });
});

function crearProyecto(nombre: string): string {
  const entrada = {
    ...PROYECTO_POR_DEFECTO,
    nombre,
    descripcion: '',
    urlBase: 'https://app.lexora.test/',
    dominios: ['app.lexora.test'],
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

/** Una captura guardada por el camino real, y una copia de su archivo y de su semilla. */
async function capturaCopiada(proyectoId: string, tipo: 'captura' | 'snapshot-dom' = 'captura') {
  const ejecucionId = crypto.randomUUID();
  boveda.conAcceso((base) => {
    insertarEjecucion(base, {
      id: ejecucionId,
      proyectoId,
      tipo: 'escaneo',
      objetivoId: proyectoId,
      navegador: 'chromium',
      estado: 'en-curso',
      resumen: {},
      credencialId: null,
      rol: null,
    });
  });
  const ev = evidencias.iniciar({
    ejecucionId,
    proyectoId,
    modoSensible: false,
    comparador: () => null,
    enviarAlRunner: () => undefined,
  });
  ev.recibir({ tipo: 'tramo-inicio', tramo: 1 });
  if (tipo === 'captura') {
    ev.recibir({ tipo: 'captura', tramo: 1, enmascarados: 0, datos: new Uint8Array(PNG) });
  } else {
    ev.recibir({
      tipo: 'traza',
      evento: { clase: 'snapshot', t: 1, tramo: 1, html: MARCA.toString(), enmascarados: 0 },
    });
  }
  await ev.terminar(false);
  const vista = evidencias.listar(ejecucionId).find((e) => e.tipo === tipo);
  if (!vista) throw new Error('sin evidencia');
  const fila = boveda.conAcceso((base) => leerEvidenciaParaDescifrar(base, vista.id));
  if (!fila) throw new Error('sin fila');
  // Lo que un atacante podría haber copiado antes: el archivo y, en el peor caso, la semilla.
  const copia = path.join(copias, fila.archivo);
  copyFileSync(path.join(carpetaEvidencias(carpeta), fila.archivo), copia);
  return { id: vista.id, copia, semilla: Buffer.from(fila.semilla) };
}

async function descifrar(clave: Buffer, id: string, semilla: Buffer, archivo: string) {
  const partes: Buffer[] = [];
  await pipeline(
    Readable.from([readFileSync(archivo)]),
    crearDescifradorArchivo(clave, id, semilla),
    new Writable({
      write(trozo: Buffer, _c, listo) {
        partes.push(trozo);
        listo();
      },
    }),
  );
  return Buffer.concat(partes);
}

describe('TS-10 · Evidencias: borrado criptográfico por evidencia (EVI-06)', () => {
  it('control positivo: con la clave del proyecto y la semilla, la copia se descifra', async () => {
    const proyectoId = crearProyecto('Lexora');
    const { id, copia, semilla } = await capturaCopiada(proyectoId);
    const datos = await proyectos.conClaveProyecto(proyectoId, (clave) =>
      descifrar(Buffer.from(clave), id, semilla, copia),
    );
    expect(datos.includes(MARCA)).toBe(true);
  });

  it('borrada la semilla, la copia del archivo no se descifra aunque la clave del proyecto siga viva', async () => {
    const proyectoId = crearProyecto('Lexora');
    const { id, copia, semilla } = await capturaCopiada(proyectoId, 'snapshot-dom');
    // Control positivo, con lo mismo todavía disponible.
    const antes = await proyectos.conClaveProyecto(proyectoId, (clave) =>
      descifrar(Buffer.from(clave), id, semilla, copia),
    );
    expect(antes.includes(MARCA)).toBe(true);

    // El borrado por una vía real: el modo datos sensibles, eliminando lo que no cumple (f6).
    expect(evidencias.resolverModoSensible(proyectoId, 'eliminar')).toEqual({ cantidad: 1 });
    expect(boveda.conAcceso((base) => leerEvidenciaParaDescifrar(base, id))).toBeNull();
    expect(
      readdirSync(carpetaEvidencias(carpeta)).filter((n) => n === path.basename(copia)),
    ).toEqual([]);

    // La clave del proyecto sigue viva; la semilla ya no está. Ninguna otra la reemplaza.
    for (const otra of [
      Buffer.alloc(32),
      Buffer.alloc(32, 0xff),
      crypto.getRandomValues(Buffer.alloc(32)),
    ]) {
      await expect(
        proyectos.conClaveProyecto(proyectoId, (clave) =>
          descifrar(Buffer.from(clave), id, otra, copia),
        ),
      ).rejects.toMatchObject({ codigo: 'AUTENTICACION' });
    }
    // Y la copia no tiene el contenido en claro.
    expect(readFileSync(copia).includes(MARCA)).toBe(false);
  });

  it('eliminado el proyecto, ni con la semilla copiada se descifra; el control con otro proyecto sí', async () => {
    const eliminado = crearProyecto('Lexora');
    const vivo = crearProyecto('Otro');
    const delEliminado = await capturaCopiada(eliminado);
    const delVivo = await capturaCopiada(vivo);
    expect(proyectos.eliminar(eliminado, 'Lexora')).toEqual({ resultado: 'eliminado' });
    evidencias.despuesDeEliminarProyecto();

    // Su archivo ya no está en la carpeta; el del otro proyecto, sí.
    expect(readdirSync(carpetaEvidencias(carpeta))).toEqual([path.basename(delVivo.copia)]);
    // Sin su clave no hay con qué descifrar: la envoltura se destruyó con el proyecto.
    expect(() => {
      proyectos.conClaveProyecto(eliminado, () => undefined);
    }).toThrow();
    // Tampoco con la clave de otro proyecto, ni con la semilla copiada.
    await expect(
      proyectos.conClaveProyecto(vivo, (clave) =>
        descifrar(Buffer.from(clave), delEliminado.id, delEliminado.semilla, delEliminado.copia),
      ),
    ).rejects.toMatchObject({ codigo: 'AUTENTICACION' });
    // Control: el proyecto vivo sigue leyendo lo suyo.
    const datos = await proyectos.conClaveProyecto(vivo, (clave) =>
      descifrar(Buffer.from(clave), delVivo.id, delVivo.semilla, delVivo.copia),
    );
    expect(datos.includes(MARCA)).toBe(true);
  });
});
