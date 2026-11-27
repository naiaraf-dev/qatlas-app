/**
 * La fusión de lo guardado antes de la semana 8 (ADR 047): un hallazgo por aparición, sin huella, pasa a uno
 * por huella. Gana la última decisión de una persona, y la fusión queda en la auditoría con IDs y cantidades.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agregarHallazgo, insertarEjecucion, leerAuditoria, type BaseCifrada } from '@qatlas/db';
import { redactarTexto, type TextoRedactado } from '@qatlas/redaction';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import { ServicioBoveda } from '../boveda/servicio';
import { contextoDetalle } from '../ejecuciones/servicio';
import { ServicioProyectos } from '../proyectos/servicio';
import { fusionarLoGuardado, VERSION_HUELLAS } from './huellas-guardadas';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const t = (texto: string): TextoRedactado => redactarTexto(texto).texto;

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-huellas-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

function crearProyecto(): string {
  const entrada = {
    ...PROYECTO_POR_DEFECTO,
    nombre: 'Lexora',
    descripcion: '',
    urlBase: 'http://localhost:5173/',
    dominios: ['localhost'],
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

/** Como lo guardaba la semana 7: una fila por aparición, sin huella. */
function legado(
  base: BaseCifrada,
  proyectoId: string,
  datos: {
    tipo: string;
    url: string;
    clave: string;
    detalle?: string;
    estado?: string;
    decisionEn?: string;
  },
): string {
  const ejecucionId = crypto.randomUUID();
  insertarEjecucion(base, {
    id: ejecucionId,
    proyectoId,
    tipo: 'escaneo',
    objetivoId: proyectoId,
    navegador: 'chromium',
    estado: 'finalizada',
    resumen: {},
    credencialId: null,
    rol: null,
  });
  const ocurrenciaId = crypto.randomUUID();
  const detalleCifrado = datos.detalle
    ? proyectos.cifrarDato(proyectoId, contextoDetalle(proyectoId, ocurrenciaId), t(datos.detalle))
    : null;
  agregarHallazgo(
    base,
    {
      proyectoId,
      ejecucionId,
      tipo: datos.tipo,
      severidad: 'baja',
      titulo: t('Un problema'),
      descripcion: t('Un problema'),
      url: t(datos.url),
      clave: t(datos.clave),
    },
    { id: ocurrenciaId, urlOrigen: null, detalleCifrado, secretosRedactados: 0 },
  );
  const { id } = base.prepare('SELECT id FROM hallazgo ORDER BY rowid DESC LIMIT 1').get() as {
    id: string;
  };
  base
    .prepare('UPDATE hallazgo SET estado = ?, decision_en = ? WHERE id = ?')
    .run(datos.estado ?? 'nuevo', datos.decisionEn ?? null, id);
  return id;
}

const filas = (base: BaseCifrada) =>
  base
    .prepare(
      `SELECT h.id, h.estado, h.huella, (SELECT COUNT(*) FROM hallazgo_ocurrencia o WHERE o.hallazgo_id = h.id) AS veces
       FROM hallazgo h ORDER BY h.rowid`,
    )
    .all() as { id: string; estado: string; huella: string | null; veces: number }[];

describe('Fusión de lo guardado antes de la semana 8', () => {
  it('los duplicados se fusionan en el más antiguo, con sus ocurrencias', () => {
    const proyecto = crearProyecto();
    boveda.conAcceso((base, maestra) => {
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      const primero = legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/producto/12',
        clave: 'image-alt',
      });
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/producto/98',
        clave: 'image-alt',
      });
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/carrito',
        clave: 'image-alt',
      });

      expect(fusionarLoGuardado(base, maestra)).toEqual({ proyectos: 1, fallidos: 0 });
      const resultado = filas(base);
      expect(resultado.map((f) => f.veces)).toEqual([2, 1]);
      expect(resultado[0]?.id).toBe(primero);
      expect(resultado.every((f) => /^h1:/.test(f.huella ?? ''))).toBe(true);
      // La primera aparición es «nueva»; la que se le sumó, «recurrente».
      expect(
        base
          .prepare(
            'SELECT aparicion FROM hallazgo_ocurrencia WHERE hallazgo_id = ? ORDER BY created_at, rowid',
          )
          .all(primero),
      ).toEqual([{ aparicion: 'nueva' }, { aparicion: 'recurrente' }]);
    });
  });

  it('un mensaje con otro hash de bundle se fusiona: la clave se recalcula con la normalización v2', () => {
    const proyecto = crearProyecto();
    boveda.conAcceso((base, maestra) => {
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      for (const hash of ['3f9ac2be', 'b7e01dfa']) {
        legado(base, proyecto, {
          tipo: 'console-error',
          url: 'http://localhost:5173/x',
          clave: `msj:viejo-${hash}`,
          detalle: `TypeError: x is undefined at main.${hash}.js:1:2`,
        });
      }
      fusionarLoGuardado(base, maestra);
      expect(filas(base).map((f) => f.veces)).toEqual([2]);
    });
  });

  it('con estados distintos gana la última decisión de una persona; la auditoría lleva IDs y cantidad', () => {
    const proyecto = crearProyecto();
    boveda.conAcceso((base, maestra) => {
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      const url = 'http://localhost:5173/x';
      const primero = legado(base, proyecto, {
        tipo: 'accesibilidad',
        url,
        clave: 'image-alt',
        estado: 'confirmado',
        decisionEn: '2026-11-01T10:00:00Z',
      });
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url,
        clave: 'image-alt',
        estado: 'descartado',
        decisionEn: '2026-11-02T10:00:00Z',
      });
      legado(base, proyecto, { tipo: 'accesibilidad', url, clave: 'image-alt' });
      fusionarLoGuardado(base, maestra);
      expect(filas(base)).toMatchObject([{ id: primero, estado: 'descartado', veces: 3 }]);
      const fusion = leerAuditoria(base).filter((a) => a.accion === 'hallazgo.fusionar');
      expect(fusion).toHaveLength(1);
      expect(fusion[0]).toMatchObject({
        entidad: 'hallazgo',
        entidadId: primero,
        detalle: { proyectoId: proyecto, cantidad: 3 },
      });
      expect(Object.keys(fusion[0]?.detalle ?? {}).sort()).toEqual(['cantidad', 'proyectoId']);
    });
  });

  it('idempotente: una segunda pasada no cambia nada; y la versión queda anotada', () => {
    const proyecto = crearProyecto();
    boveda.conAcceso((base, maestra) => {
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/x',
        clave: 'image-alt',
      });
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/x',
        clave: 'image-alt',
      });
      fusionarLoGuardado(base, maestra);
      const antes = filas(base);
      expect(fusionarLoGuardado(base, maestra)).toEqual({ proyectos: 0, fallidos: 0 });
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      fusionarLoGuardado(base, maestra);
      expect(filas(base)).toEqual(antes);
      expect(base.prepare('SELECT huellas_version AS v FROM proyecto').get()).toEqual({
        v: VERSION_HUELLAS,
      });
    });
  });

  it('si se corta a mitad de un proyecto, queda como estaba y se rehace después', () => {
    const proyecto = crearProyecto();
    boveda.conAcceso((base, maestra) => {
      base.prepare('UPDATE proyecto SET huellas_version = 0').run();
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/x',
        clave: 'image-alt',
      });
      legado(base, proyecto, {
        tipo: 'accesibilidad',
        url: 'http://localhost:5173/x',
        clave: 'image-alt',
      });
      const antes = filas(base);
      let primera = true;
      const cortar = () => {
        if (primera) {
          primera = false;
          throw new Error('corte');
        }
      };
      expect(fusionarLoGuardado(base, maestra, { antesDeCadaProyecto: cortar })).toEqual({
        proyectos: 0,
        fallidos: 1,
      });
      expect(filas(base)).toEqual(antes);
      expect(fusionarLoGuardado(base, maestra)).toEqual({ proyectos: 1, fallidos: 0 });
      expect(filas(base).map((f) => f.veces)).toEqual([2]);
    });
  });
});
