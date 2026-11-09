/**
 * El servicio de evidencias con una bóveda real: qué se conserva, qué se descarta, los huecos de video
 * (f5), los topes, la retención (EVI-06) y el modo datos sensibles (f6). Sin runner: los mensajes se
 * entregan como los mandaría.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { insertarEjecucion, leerAuditoria } from '@qatlas/db';
import type { MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import { ServicioBoveda } from '../boveda/servicio';
import { ServicioProyectos } from '../proyectos/servicio';
import { carpetaEvidencias } from './almacen';
import { LIMITES_EVIDENCIAS, ServicioEvidencias, type EvidenciasDeEjecucion } from './servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const MARCA = ['pixeles', 'de', 'la', 'pagina', '5521'].join('-');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(MARCA)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  Buffer.from('IHDR'),
  Buffer.from([0, 0, 5, 0, 0, 0, 2, 0xd0]),
  Buffer.from(MARCA),
]);

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;
let evidencias: ServicioEvidencias;
let alRunner: MensajeAlRunner[];
let ahora: number;

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
  return creado.id;
}

function ejecucion(proyectoId: string): { id: string; ev: EvidenciasDeEjecucion } {
  const id = crypto.randomUUID();
  boveda.conAcceso((base) => {
    insertarEjecucion(base, {
      id,
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
    ejecucionId: id,
    proyectoId,
    modoSensible: false,
    comparador: () => null,
    enviarAlRunner: (m) => alRunner.push(m),
  });
  return { id, ev };
}

type Mensaje = Parameters<EvidenciasDeEjecucion['recibir']>[0];
const tramoInicio = (tramo: number): Mensaje => ({ tipo: 'tramo-inicio', tramo });
const tramoFin = (tramo: number, extra: Partial<Extract<Mensaje, { tipo: 'tramo-fin' }>> = {}) =>
  ({
    tipo: 'tramo-fin',
    tramo,
    errorNavegacion: false,
    perdidos: 0,
    perdidosAlFinal: 0,
    ...extra,
  }) as Mensaje;
const fotograma = (tramo: number, t: number, perdidosAntes = 0): Mensaje => ({
  tipo: 'fotograma',
  tramo,
  t,
  perdidosAntes,
  datos: new Uint8Array(JPEG),
});
const captura = (tramo: number): Mensaje => ({
  tipo: 'captura',
  tramo,
  enmascarados: 1,
  datos: new Uint8Array(PNG),
});

const archivos = () => {
  try {
    return readdirSync(carpetaEvidencias(carpeta));
  } catch {
    return [];
  }
};

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-evidencias-'));
  alRunner = [];
  ahora = Date.now();
  // El servicio de esta corrida, no el del test anterior: se crea después de la bóveda.
  const actual: { evidencias?: ServicioEvidencias } = {};
  boveda = new ServicioBoveda({
    carpeta,
    alAbrir: (base) => {
      actual.evidencias?.alAbrir(base);
    },
  });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
  evidencias = new ServicioEvidencias(boveda, proyectos, carpeta, undefined, () => ahora);
  actual.evidencias = evidencias;
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 3 });
});

describe('Video por tramos (EVI-07, f2)', () => {
  it('una página con un hallazgo de severidad media o mayor conserva su video', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    ev.recibir(fotograma(1, 100));
    ev.alHallazgo('media');
    ev.recibir(tramoFin(1));
    const resumen = await ev.terminar(false);
    expect(resumen.videos).toBe(1);
    const [video] = evidencias.listar(id).filter((e) => e.tipo === 'video');
    expect(video).toMatchObject({ fotogramas: 2, duracionMs: 100, puedeTenerDatosSensibles: true });
  });

  it('una página solo con hallazgos bajos no deja video, ni archivo', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    ev.alHallazgo('baja');
    ev.alHallazgo('informativa');
    ev.recibir(tramoFin(1));
    expect((await ev.terminar(false)).videos).toBe(0);
    expect(evidencias.listar(id).filter((e) => e.tipo === 'video')).toEqual([]);
    expect(archivos()).toEqual([]);
  });

  it('un error de navegación conserva el tramo, y uno abierto se conserva si falló el navegador', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    ev.recibir(tramoFin(1, { errorNavegacion: true }));
    ev.recibir(tramoInicio(2));
    ev.recibir(fotograma(2, 0));
    // Sin `tramo-fin`: el runner se cayó a mitad de la página.
    expect((await ev.terminar(true)).videos).toBe(2);
  });

  it('un tramo abierto al terminar sin error del navegador se descarta', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    expect((await ev.terminar(false)).videos).toBe(0);
    expect(archivos()).toEqual([]);
  });
});

describe('Fotogramas perdidos (f5)', () => {
  it('el video registra cuántos se perdieron y dónde, y el visor lo muestra', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    ev.recibir(fotograma(1, 400, 5));
    ev.recibir(tramoFin(1, { errorNavegacion: true, perdidos: 7, perdidosAlFinal: 2 }));
    const resumen = await ev.terminar(false);
    expect(resumen.fotogramasPerdidos).toBe(7);
    const [video] = evidencias.listar(id).filter((e) => e.tipo === 'video');
    expect(video?.fotogramasPerdidos).toBe(7);
    const vista = await evidencias.vista(video?.id ?? '');
    expect(vista).toMatchObject({
      tipo: 'video',
      tiempos: [0, 400],
      fotogramasPerdidos: 7,
      huecos: [
        { t: 400, cantidad: 5 },
        { t: 400, cantidad: 2 },
      ],
    });
  });

  it('cada fotograma se confirma al runner recién escrito, también los que no entran', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(fotograma(9, 0)); // de un tramo que no está abierto
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    await ev.terminar(false);
    expect(alRunner).toEqual([
      { tipo: 'evidencia-procesada', fotogramas: 1 },
      { tipo: 'evidencia-procesada', fotogramas: 1 },
    ]);
  });

  it('las capturas nunca se descartan: con el principal atrasado, esperan su turno', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    // Todo llega de una vez, sin esperar a que se escriba nada: así se ve un principal atrasado.
    for (let i = 0; i < 40; i++) {
      ev.recibir(fotograma(1, i * 10));
      ev.recibir(captura(1));
    }
    ev.recibir(tramoFin(1));
    const resumen = await ev.terminar(false);
    expect(resumen.capturas).toBe(40);
    expect(evidencias.listar(id).filter((e) => e.tipo === 'captura')).toHaveLength(40);
  });
});

describe('Lo que se guarda y lo que se muestra', () => {
  it('la captura se ve en bytes validados, y nada de la página está en claro en el disco', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(captura(1));
    ev.recibir(fotograma(1, 0));
    ev.alHallazgo('alta');
    ev.recibir(tramoFin(1));
    await ev.terminar(false);
    for (const nombre of archivos()) {
      expect(readFileSync(path.join(carpetaEvidencias(carpeta), nombre)).includes(MARCA)).toBe(
        false,
      );
    }
    const [lista] = evidencias.listar(id).filter((e) => e.tipo === 'captura');
    const vista = await evidencias.vista(lista?.id ?? '');
    expect(vista?.tipo).toBe('imagen');
    expect(vista?.tipo === 'imagen' && Buffer.from(vista.datos).equals(PNG)).toBe(true);
  });

  it('lo que no tiene la firma esperada no se guarda', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir({ tipo: 'captura', tramo: 1, enmascarados: 0, datos: new Uint8Array(JPEG) });
    ev.recibir({ tipo: 'fotograma', tramo: 1, t: 0, perdidosAntes: 0, datos: new Uint8Array(PNG) });
    ev.alHallazgo('critica');
    ev.recibir(tramoFin(1));
    const resumen = await ev.terminar(false);
    expect(resumen.capturas).toBe(0);
    expect(resumen.videos).toBe(0);
  });

  it('la traza y el HAR se guardan al terminar, redactados', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    const token = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJhbmEifQ', 'firma-77'].join('.');
    ev.recibir({
      tipo: 'traza',
      evento: { clase: 'consola', t: 1, tramo: null, nivel: 'log', texto: `token ${token}` },
    } satisfies MensajeDelRunner);
    ev.recibir({
      tipo: 'traza',
      evento: {
        clase: 'red',
        t: 2,
        tramo: null,
        metodo: 'GET',
        url: 'http://localhost:5173/',
        tipoRecurso: 'document',
        estado: 200,
        encabezadosSolicitud: [{ nombre: 'Authorization', valor: `Bearer ${token}` }],
        encabezadosRespuesta: [],
        cuerpoSolicitud: null,
        tipoContenidoSolicitud: null,
        error: null,
        duracionMs: 5,
      },
    });
    const resumen = await ev.terminar(false);
    expect(resumen.secretosRedactados).toBeGreaterThan(0);
    const lista = evidencias.listar(id);
    const traza = lista.find((e) => e.tipo === 'traza');
    const har = lista.find((e) => e.tipo === 'har');
    expect(traza).toMatchObject({ entradas: 2, revisionPendiente: true });
    expect(har).toMatchObject({ entradas: 1 });
    for (const evidencia of [traza, har]) {
      const vista = await evidencias.vista(evidencia?.id ?? '');
      expect(vista?.tipo).toBe('texto');
      expect(JSON.stringify(vista)).not.toContain(token);
    }
  });

  it('el tope de capturas se informa y no se pasa', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    for (let i = 0; i <= LIMITES_EVIDENCIAS.capturasPorEjecucion; i++) ev.recibir(captura(1));
    const resumen = await ev.terminar(false);
    expect(resumen.capturas).toBe(LIMITES_EVIDENCIAS.capturasPorEjecucion);
    expect(resumen.topesAlcanzados).toEqual(['capturas']);
  }, 60_000);

  it('al bloquear, lo que no llegó a la base se borra', async () => {
    const { ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    await new Promise((listo) => setTimeout(listo, 50));
    expect(archivos()).toHaveLength(1);
    evidencias.alBloquear();
    await expect.poll(archivos).toEqual([]);
  });
});

describe('Retención (EVI-06)', () => {
  it('al desbloquear, lo vencido se elimina con borrado criptográfico y queda en la auditoría', async () => {
    const proyectoId = crearProyecto();
    const { id, ev } = ejecucion(proyectoId);
    ev.recibir(tramoInicio(1));
    ev.recibir(captura(1));
    ev.recibir(captura(1));
    await ev.terminar(false);
    expect(archivos()).toHaveLength(2);

    // 89 días después: todavía no.
    ahora += 89 * 24 * 60 * 60_000;
    boveda.bloquear();
    await boveda.desbloquear(CONTRASENA);
    expect(evidencias.listar(id)).toHaveLength(2);

    // 91 días: vencen.
    ahora += 2 * 24 * 60 * 60_000;
    boveda.bloquear();
    await boveda.desbloquear(CONTRASENA);
    expect(evidencias.listar(id)).toEqual([]);
    expect(archivos()).toEqual([]);
    const auditoria = boveda.conAcceso((base) => leerAuditoria(base));
    expect(auditoria).toContainEqual(
      expect.objectContaining({
        accion: 'evidencias.retencion',
        entidadId: proyectoId,
        detalle: { cantidad: 2 },
      }),
    );
  });

  it('los días son los de la bóveda', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    ev.recibir(tramoInicio(1));
    ev.recibir(captura(1));
    await ev.terminar(false);
    boveda.cambiarConfiguracion({ retencionDias: 7 });
    ahora += 8 * 24 * 60 * 60_000;
    boveda.bloquear();
    await boveda.desbloquear(CONTRASENA);
    expect(evidencias.listar(id)).toEqual([]);
  });
});

describe('Modo datos sensibles sobre lo que ya existe (f6)', () => {
  async function conVideoYSnapshot() {
    const proyectoId = crearProyecto();
    const { id, ev } = ejecucion(proyectoId);
    ev.recibir(tramoInicio(1));
    ev.recibir(fotograma(1, 0));
    ev.recibir(captura(1));
    ev.recibir({
      tipo: 'traza',
      evento: { clase: 'snapshot', t: 1, tramo: 1, html: '<p>hola</p>', enmascarados: 0 },
    });
    ev.alHallazgo('alta');
    ev.recibir(tramoFin(1));
    await ev.terminar(false);
    return { proyectoId, id };
  }

  it('cuenta los videos y snapshots que no cumplen', async () => {
    const { proyectoId } = await conVideoYSnapshot();
    expect(evidencias.noCumplenModoSensible(proyectoId)).toEqual({ videos: 1, snapshots: 1 });
  });

  it('eliminar: se borran con su semilla y su archivo; la captura queda; la auditoría tiene la cantidad', async () => {
    const { proyectoId, id } = await conVideoYSnapshot();
    const antes = archivos().length;
    expect(evidencias.resolverModoSensible(proyectoId, 'eliminar')).toEqual({ cantidad: 2 });
    expect(evidencias.listar(id).map((e) => e.tipo)).toContain('captura');
    expect(evidencias.listar(id).some((e) => e.tipo === 'video' || e.tipo === 'snapshot-dom')).toBe(
      false,
    );
    expect(archivos()).toHaveLength(antes - 2);
    expect(evidencias.noCumplenModoSensible(proyectoId)).toEqual({ videos: 0, snapshots: 0 });
    const auditoria = boveda.conAcceso((base) => leerAuditoria(base));
    expect(auditoria).toContainEqual(
      expect.objectContaining({
        accion: 'evidencias.modo-sensible-eliminar',
        detalle: { cantidad: 2 },
      }),
    );
  });

  it('conservar: quedan como están, y también queda en la auditoría', async () => {
    const { proyectoId } = await conVideoYSnapshot();
    expect(evidencias.resolverModoSensible(proyectoId, 'conservar')).toEqual({ cantidad: 2 });
    expect(evidencias.noCumplenModoSensible(proyectoId)).toEqual({ videos: 1, snapshots: 1 });
    const auditoria = boveda.conAcceso((base) => leerAuditoria(base));
    expect(auditoria).toContainEqual(
      expect.objectContaining({
        accion: 'evidencias.modo-sensible-conservar',
        detalle: { cantidad: 2 },
      }),
    );
  });
});

describe('Secretos a la vista en la captura (EVI-04)', () => {
  it('dice qué textos visibles tienen un secreto, sin guardar nada', async () => {
    const { id, ev } = ejecucion(crearProyecto());
    const token = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJhbmEifQ', 'firma-22'].join('.');
    ev.recibir({
      tipo: 'textos-de-captura',
      tramo: 1,
      textos: ['Hola', `token ${token}`, 'Ficha de cliente'],
    });
    expect(alRunner).toEqual([{ tipo: 'tapar-en-captura', indices: [1] }]);
    await ev.terminar(false);
    expect(evidencias.listar(id)).toEqual([]);
  });
});
