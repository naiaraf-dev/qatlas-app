/**
 * Reportes de bug y exportación guiada (3.9, 6.5, CU-05, ADR 048), en el proceso principal, con el destino, el
 * PDF y las capturas simulados. Datos inventados; el canario es el secreto de una credencial del proyecto.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agregarPaginaVisitada,
  insertarEjecucion,
  leerAuditoria,
  registrarAparicion,
  type BaseCifrada,
} from '@qatlas/db';
import { redactarTexto, type TextoRedactado } from '@qatlas/redaction';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import { ServicioBoveda } from '../boveda/servicio';
import { contextoDetalle } from '../ejecuciones/servicio';
import { evidenciasEnReportes } from '../evidencias/retencion';
import { ServicioProyectos } from '../proyectos/servicio';
import type { Destinos } from './destino';
import { chunksDePng, codificarPng, decodificarPng, type ImagenRgba } from './png';
import { ServicioReportes } from './servicio';
import { leerZip } from './zip';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const CANARIO = ['CANARIO', 'reporte', '8f3a', 'b21c'].join('-');
const t = (texto: string): TextoRedactado => redactarTexto(texto).texto;

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;
let escritos: { nombre: string; datos: Buffer }[];
let sincronizado: boolean;
let htmlDelPdf: string[];
let capturas: Map<string, Buffer>;

const destinos: Destinos = {
  elegir: (nombre) => Promise.resolve({ ruta: `destino-falso/${nombre}`, sincronizado }),
  escribir: (ruta, datos) => {
    escritos.push({ nombre: ruta, datos: Buffer.from(datos) });
    return Promise.resolve();
  },
};

const servicio = () =>
  new ServicioReportes({
    boveda,
    proyectos,
    evidencias: {
      capturaPng: (id) =>
        Promise.resolve(capturas.get(id) ? Buffer.from(capturas.get(id) ?? []) : null),
    },
    destinos,
    renderizarPdf: (html) => {
      htmlDelPdf.push(html);
      return Promise.resolve(Buffer.from('%PDF-falso'));
    },
    fuentes: () => ({ inter: Buffer.from('inter'), mono: Buffer.from('mono') }),
  });

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-reportes-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
  escritos = [];
  sincronizado = false;
  htmlDelPdf = [];
  capturas = new Map();
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

function crearProyecto(nombre = 'Lexora'): string {
  const entrada = {
    ...PROYECTO_POR_DEFECTO,
    nombre,
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
  const credencial = proyectos.guardarCredencial({
    proyectoId: creado.id,
    nombre: 'Prueba',
    rol: 'admin',
    estrategia: 'formulario',
    usuario: 'ana@example.com',
    urlLogin: 'http://localhost:5173/login',
    pasosLogin: [{ accion: 'click', selector: 'button' }],
    secreto: CANARIO,
    indicadorExito: { tipo: 'aparece', selector: '#panel' },
  });
  if (credencial.resultado !== 'guardada') throw new Error('sin credencial');
  return creado.id;
}

/** Un PNG RGBA de prueba: rojo a la izquierda, verde a la derecha. */
const PNG = codificarPng({
  ancho: 20,
  alto: 10,
  datos: Uint8Array.from(
    { length: 20 * 10 * 4 },
    (_, i) => [i % 80 < 40 ? 200 : 30, i % 80 < 40 ? 30 : 200, 30, 255][i % 4] ?? 0,
  ),
});

/** Un hallazgo con una aparición (detalle cifrado) y, si se pide, una captura de su página. */
function hallazgo(
  proyectoId: string,
  datos: { tipo?: string; detalle?: string; conCaptura?: boolean; secretos?: number } = {},
): { hallazgoId: string; ocurrenciaId: string; capturaId: string | null } {
  return boveda.conAcceso((base: BaseCifrada) => {
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
    const paginaId = agregarPaginaVisitada(base, {
      proyectoId,
      ejecucionId,
      url: t('http://localhost:5173/excepcion-js'),
      urlCompletaCifrada: null,
      statusHttp: 200,
      tiempoCargaMs: 10,
      profundidad: 0,
    });
    const ocurrenciaId = crypto.randomUUID();
    const hallazgoId = registrarAparicion(
      base,
      {
        proyectoId,
        ejecucionId,
        tipo: datos.tipo ?? 'error-javascript',
        severidad: 'alta',
        titulo: t('Excepción de JavaScript no capturada'),
        url: t('http://localhost:5173/excepcion-js'),
        clave: t(`msj:${ocurrenciaId}`),
        huella: `h1:${ocurrenciaId}`,
        alcance: t('http://localhost:5173/excepcion-js'),
        versionNormalizacion: 2,
        estado: 'nuevo',
        estadoPrevio: null,
        aparicion: 'nueva',
        ocurrencia: {
          id: ocurrenciaId,
          urlOrigen: null,
          detalleCifrado: proyectos.cifrarDato(
            proyectoId,
            contextoDetalle(proyectoId, ocurrenciaId),
            datos.detalle ?? 'Error: Excepción plantada en el sandbox',
          ),
          secretosRedactados: datos.secretos ?? 0,
          paginaVisitadaId: paginaId,
        },
      },
      null,
    );
    let capturaId: string | null = null;
    if (datos.conCaptura) {
      capturaId = crypto.randomUUID();
      const ahora = new Date().toISOString();
      base
        .prepare(
          `INSERT INTO evidencia (id, created_at, updated_at, proyecto_id, ejecucion_id, pagina_visitada_id, tipo,
             archivo, semilla, tamano) VALUES (?, ?, ?, ?, ?, ?, 'captura', ?, ?, ?)`,
        )
        .run(
          capturaId,
          ahora,
          ahora,
          proyectoId,
          ejecucionId,
          paginaId,
          `${capturaId}.qev`,
          Buffer.alloc(32),
          PNG.length,
        );
      capturas.set(capturaId, PNG);
    }
    return { hallazgoId, ocurrenciaId, capturaId };
  });
}

const todoEnClaro = () =>
  boveda.conAcceso((base) =>
    JSON.stringify(
      ['reporte_bug', 'reporte_hallazgo', 'exportacion', 'auditoria', 'hallazgo'].map((tabla) =>
        base.prepare(`SELECT * FROM ${tabla}`).all(),
      ),
    ),
  );

describe('Crear un reporte (CU-05)', () => {
  it('precargado desde el hallazgo; el hallazgo pasa a reportado; el contenido va cifrado', () => {
    const proyecto = crearProyecto();
    const { hallazgoId } = hallazgo(proyecto, { conCaptura: true });
    const creado = servicio().crear([hallazgoId]);
    if (creado.resultado !== 'creado') throw new Error(creado.motivo);
    const reporte = servicio().obtener(creado.reporteId);
    expect(reporte?.contenido.titulo).toBe('[/excepcion-js] Excepción de JavaScript no capturada');
    expect(reporte?.contenido.pasos).toEqual(['Abrir http://localhost:5173/excepcion-js']);
    expect(reporte?.contenido.obtenido).toContain('Excepción plantada en el sandbox');
    expect(reporte?.hallazgos.map((h) => h.estado)).toEqual(['reportado']);
    expect(todoEnClaro()).not.toContain('Pasos');
    expect(todoEnClaro()).not.toContain('Excepción plantada');
    const crear = boveda
      .conAcceso((b) => leerAuditoria(b))
      .find((a) => a.accion === 'reporte.crear');
    expect(crear?.detalle).toEqual({ proyectoId: proyecto, cantidad: 1 });
  });

  it('no desde un descartado, ni con hallazgos de dos proyectos', () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const enA = hallazgo(a).hallazgoId;
    const enB = hallazgo(b).hallazgoId;
    expect(servicio().crear([enA, enB])).toEqual({
      resultado: 'rechazada',
      motivo: 'otro-proyecto',
    });
    boveda.conAcceso((base) =>
      base.prepare(`UPDATE hallazgo SET estado = 'descartado' WHERE id = ?`).run(enA),
    );
    expect(servicio().crear([enA])).toEqual({ resultado: 'rechazada', motivo: 'no-corresponde' });
  });
});

describe('Guardar: redacción y detector en el texto del reporte (EVI-04, TS-01)', () => {
  it('el secreto de una credencial escrito en el reporte se redacta, cuenta como alerta y no queda en claro', () => {
    const proyecto = crearProyecto();
    const { hallazgoId } = hallazgo(proyecto);
    const creado = servicio().crear([hallazgoId]);
    if (creado.resultado !== 'creado') throw new Error('no se creó');
    const actual = servicio().obtener(creado.reporteId);
    if (!actual) throw new Error('sin reporte');
    const guardado = servicio().guardar(creado.reporteId, {
      severidad: 'critica',
      contenido: { ...actual.contenido, obtenido: `Se ve la clave ${CANARIO} en la pantalla` },
    });
    expect(guardado?.alertasDetector).toBeGreaterThan(0);
    expect(guardado?.contenido.obtenido).not.toContain(CANARIO);
    expect(servicio().obtener(creado.reporteId)?.contenido.obtenido).not.toContain(CANARIO);
    expect(todoEnClaro()).not.toContain(CANARIO);
  });
});

describe('Exportar (3.9)', () => {
  function reporteCon(opciones: Parameters<typeof hallazgo>[1] = {}) {
    const proyecto = crearProyecto();
    const h = hallazgo(proyecto, opciones);
    const creado = servicio().crear([h.hallazgoId]);
    if (creado.resultado !== 'creado') throw new Error('no se creó');
    return { proyecto, reporteId: creado.reporteId, ...h };
  }

  it('RN-REP-01: sin ninguna evidencia no se exporta; el detalle de la aparición sí cuenta como evidencia', async () => {
    const { reporteId, ocurrenciaId } = reporteCon();
    expect(await servicio().exportar(reporteId, 'markdown', [], false)).toEqual({
      resultado: 'rechazada',
      motivo: 'sin-evidencia',
    });
    expect(await servicio().exportar(reporteId, 'markdown', [ocurrenciaId], false)).toEqual({
      resultado: 'exportado',
    });
    const markdown = escritos[0]?.datos.toString('utf8') ?? '';
    expect(markdown).toContain('Sin capturas: la evidencia es el detalle de cada aparición.');
    expect(markdown).toContain('Excepción plantada en el sandbox');
  });

  it('una evidencia que no es del reporte se rechaza', async () => {
    const { reporteId } = reporteCon();
    expect(await servicio().exportar(reporteId, 'markdown', [crypto.randomUUID()], false)).toEqual({
      resultado: 'rechazada',
      motivo: 'evidencia-ajena',
    });
  });

  it('RN-REP-03: con secretos redactados sin revisar pide confirmación explícita, y la registra', async () => {
    const { reporteId, ocurrenciaId } = reporteCon({ secretos: 2 });
    expect(await servicio().exportar(reporteId, 'markdown', [ocurrenciaId], false)).toEqual({
      resultado: 'rechazada',
      motivo: 'requiere-confirmacion',
    });
    expect(escritos).toHaveLength(0);
    expect(await servicio().exportar(reporteId, 'markdown', [ocurrenciaId], true)).toEqual({
      resultado: 'exportado',
    });
    expect(
      boveda.conAcceso((b) => b.prepare('SELECT alertas_confirmadas AS a FROM exportacion').get()),
    ).toEqual({ a: 1 });
  });

  it('el registro y la auditoría dicen qué, cuándo, en qué formato y si estaba sincronizado; nunca la ruta', async () => {
    sincronizado = true;
    const { reporteId, ocurrenciaId, proyecto } = reporteCon();
    await servicio().exportar(reporteId, 'markdown', [ocurrenciaId], false);
    const fila = boveda.conAcceso((b) => b.prepare('SELECT * FROM exportacion').get()) as Record<
      string,
      unknown
    >;
    expect(fila).toMatchObject({ formato: 'markdown', destino_sincronizado: 1 });
    expect(JSON.stringify(fila)).not.toContain('destino-falso');
    const auditoria = boveda
      .conAcceso((b) => leerAuditoria(b))
      .find((a) => a.accion === 'reporte.exportar');
    expect(auditoria?.detalle).toEqual({ proyectoId: proyecto, campos: ['markdown'], cantidad: 1 });
    expect(todoEnClaro()).not.toContain('destino-falso');
  });

  it('ZIP: nombres por ID, «no está cifrado», y la captura sin metadatos aunque el original los traiga', async () => {
    const { reporteId, capturaId } = reporteCon({ conCaptura: true });
    if (!capturaId) throw new Error('sin captura');
    await servicio().exportar(reporteId, 'zip', [capturaId], false);
    const entradas = leerZip(escritos[0]?.datos ?? Buffer.alloc(0));
    expect(entradas.map((e) => e.nombre)).toEqual([
      'reporte.md',
      'leeme.txt',
      `evidencias/${capturaId}.png`,
    ]);
    expect(entradas[1]?.datos.toString('utf8')).toContain('no está cifrado');
    expect(chunksDePng(entradas[2]?.datos ?? Buffer.alloc(0))).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(entradas[0]?.datos.toString('utf8')).toContain(`](evidencias/${capturaId}.png)`);
  });

  it('PDF: el documento tiene CSP, título genérico, nada de afuera, y las imágenes y fuentes adentro', async () => {
    const { reporteId, capturaId } = reporteCon({ conCaptura: true });
    if (!capturaId) throw new Error('sin captura');
    await servicio().exportar(reporteId, 'pdf', [capturaId], false);
    const [html] = htmlDelPdf;
    expect(html).toContain('<title>Reporte de QAtlas</title>');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/\b(src|href)="https?:/);
    expect(html).not.toMatch(/url\(https?:/);
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).not.toMatch(/<script/i);
  });

  it('un PDF que no se pudo generar no sale (falla cerrado)', async () => {
    const { reporteId, ocurrenciaId } = reporteCon();
    const fallido = new ServicioReportes({
      boveda,
      proyectos,
      evidencias: { capturaPng: () => Promise.resolve(null) },
      destinos,
      renderizarPdf: () => Promise.reject(new Error('no se pudo limpiar')),
      fuentes: () => ({ inter: Buffer.alloc(0), mono: Buffer.alloc(0) }),
    });
    expect(await fallido.exportar(reporteId, 'pdf', [ocurrenciaId], false)).toEqual({
      resultado: 'rechazada',
      motivo: 'no-se-pudo-generar',
    });
    expect(escritos).toHaveLength(0);
  });
});

describe('Captura anotada: tapar destruye, en el proceso principal', () => {
  const pixel = (img: ImagenRgba, x: number, y: number) => [
    ...img.datos.subarray((y * img.ancho + x) * 4, (y * img.ancho + x) * 4 + 4),
  ];

  it('aunque la interfaz mande la imagen sin tapar, lo pedido sale tapado y sin metadatos', async () => {
    const proyecto = crearProyecto();
    const { hallazgoId, capturaId } = hallazgo(proyecto, { conCaptura: true });
    const creado = servicio().crear([hallazgoId]);
    if (creado.resultado !== 'creado' || !capturaId) throw new Error('sin reporte');
    expect(
      await servicio().exportarCaptura(creado.reporteId, capturaId, PNG, [
        { x: 2, y: 2, ancho: 6, alto: 6 },
      ]),
    ).toEqual({
      resultado: 'exportado',
    });
    const salida = escritos[0]?.datos ?? Buffer.alloc(0);
    expect(chunksDePng(salida)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const img = decodificarPng(salida);
    expect(pixel(img, 4, 4)).toEqual([0, 0, 0, 255]);
    // Control: fuera del recuadro, la imagen es la original.
    expect(pixel(img, 15, 4)).toEqual([30, 200, 30, 255]);
  });

  it('otra captura, otro tamaño o algo que no es PNG: se rechaza', async () => {
    const proyecto = crearProyecto();
    const { hallazgoId, capturaId } = hallazgo(proyecto, { conCaptura: true });
    const creado = servicio().crear([hallazgoId]);
    if (creado.resultado !== 'creado' || !capturaId) throw new Error('sin reporte');
    const chica = codificarPng({ ancho: 2, alto: 2, datos: new Uint8Array(16) });
    expect(
      await servicio().exportarCaptura(creado.reporteId, crypto.randomUUID(), PNG, []),
    ).toMatchObject({ motivo: 'evidencia-ajena' });
    expect(await servicio().exportarCaptura(creado.reporteId, capturaId, chica, [])).toMatchObject({
      motivo: 'imagen-invalida',
    });
    expect(
      await servicio().exportarCaptura(creado.reporteId, capturaId, Buffer.from('<svg/>'), []),
    ).toMatchObject({
      motivo: 'imagen-invalida',
    });
    expect(escritos).toHaveLength(0);
  });
});

describe('Retención y borrado criptográfico', () => {
  it('EVI-06: las evidencias de hallazgos incluidos en reportes no vencen; control: las otras sí', () => {
    const proyecto = crearProyecto();
    const reportado = hallazgo(proyecto, { conCaptura: true });
    const suelto = hallazgo(proyecto, { conCaptura: true });
    servicio().crear([reportado.hallazgoId]);
    const protegidas = boveda.conAcceso((b) => evidenciasEnReportes(b));
    expect(protegidas.has(reportado.capturaId ?? '')).toBe(true);
    expect(protegidas.has(suelto.capturaId ?? '')).toBe(false);
  });

  it('TS-10: al eliminar el proyecto, sus reportes y exportaciones desaparecen', async () => {
    const proyecto = crearProyecto();
    const { hallazgoId, ocurrenciaId } = hallazgo(proyecto);
    const creado = servicio().crear([hallazgoId]);
    if (creado.resultado !== 'creado') throw new Error('no se creó');
    await servicio().exportar(creado.reporteId, 'markdown', [ocurrenciaId], false);
    proyectos.eliminar(proyecto, 'Lexora');
    for (const tabla of ['reporte_bug', 'reporte_hallazgo', 'exportacion']) {
      expect(
        boveda.conAcceso((b) => b.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get()),
        tabla,
      ).toEqual({ n: 0 });
    }
    expect(servicio().obtener(creado.reporteId)).toBeNull();
  });
});
