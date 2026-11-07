import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EXCLUSIONES_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  type ProyectoEntrada,
} from '@qatlas/shared';
import type { MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
import type { ProgresoEjecucion } from '@qatlas/shared';
import { leerAuditoria } from '@qatlas/db';
import { conectarActividad, DetectorInactividad } from '../boveda/inactividad';
import { ServicioBoveda } from '../boveda/servicio';
import { ServicioProyectos } from '../proyectos/servicio';
import { ServicioEjecuciones, type LanzadorDeProcesos, type ProcesoRunner } from './servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const SECRETO = 'CANARIO-secreto-de-prueba-77';

const ENTRADA: ProyectoEntrada = {
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Lexora',
  descripcion: '',
  urlBase: 'http://localhost:5173/',
  dominios: ['localhost'],
  puertosLocales: [3000],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
  dominiosAutenticacion: [],
};
const PASOS = [{ accion: 'click' as const, selector: 'button' }];

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;
let ejecuciones: ServicioEjecuciones;
let registro: string[];
let falloProxy: boolean;
let mensajes: MensajeAlRunner[];
let caerProxy: (() => void) | undefined;
let alRegistrarProxy:
  ((r: { destino: string; permitida: boolean; regla: string }) => void) | undefined;
let proxyYaCaido: boolean;
let progresos: ProgresoEjecucion[];
/** Los dominios de cada proxy que se levantó: el del escaneo y los de login. */
let politicasProxy: string[][];
let runnerActual: { emitir: (m: MensajeDelRunner) => void; salir: () => void } | undefined;

const lanzador: LanzadorDeProcesos = {
  iniciarProxy: (datos, alRegistrar) => {
    registro.push('proxy');
    politicasProxy.push([...datos.politica.dominios]);
    alRegistrarProxy = alRegistrar;
    if (falloProxy) return Promise.reject(new Error('sin proxy'));
    return Promise.resolve({
      puerto: 49152,
      alCaer: (oyente) => {
        caerProxy = oyente;
        if (proxyYaCaido) oyente();
      },
      detener: () => {
        registro.push('proxy-detenido');
      },
    });
  },
  iniciarRunner: () => {
    registro.push('runner');
    const eventos = new EventEmitter();
    const proceso: ProcesoRunner = {
      enviar: (mensaje) => {
        // `postMessage` clona: lo que llega al otro lado es una copia.
        mensajes.push(structuredClone(mensaje));
        if (mensaje.tipo === 'cancelar') eventos.emit('salir');
      },
      alMensaje: (oyente) => eventos.on('mensaje', oyente),
      alSalir: (oyente) => eventos.on('salir', oyente),
      detener: () => {
        registro.push('runner-detenido');
        eventos.emit('salir');
      },
    };
    runnerActual = {
      emitir: (m) => eventos.emit('mensaje', m),
      salir: () => eventos.emit('salir'),
    };
    return proceso;
  },
  limpiarPerfil: () => {
    registro.push('perfil-borrado');
  },
};

const terminado = (
  paginasVisitadas: number,
  linksExcluidos: number,
): Extract<MensajeDelRunner, { tipo: 'escaneo-terminado' }> => ({
  tipo: 'escaneo-terminado',
  paginasVisitadas,
  linksExcluidos,
  detenido: null,
  noRecorridosSoloLectura: 0,
  noRecorridosExclusiones: 0,
  urlsDescartadas: 0,
  websocketDescartados: 0,
});

const pausa = () =>
  new Promise((listo) => {
    setTimeout(listo, 5);
  });

function crearProyecto(nombre = 'Lexora'): string {
  const entrada = { ...ENTRADA, nombre };
  const { declaracion } = proyectos.validar(entrada);
  if (!declaracion) throw new Error('Entrada inválida');
  const res = proyectos.crear(entrada, { aceptada: true, ...declaracion });
  if (res.resultado !== 'creado') throw new Error('No se creó');
  return res.id;
}

function lanzar(proyectoId: string): string {
  const res = ejecuciones.lanzarEscaneo(proyectoId);
  if (res.resultado !== 'encolada') throw new Error(res.motivo);
  return res.ejecucionId;
}

const estado = (proyectoId: string, id: string) =>
  ejecuciones.listar(proyectoId).find((e) => e.id === id);

let roles = 0;

function guardarCredencial(proyectoId: string, conIndicador = true): string {
  roles += 1;
  const res = proyectos.guardarCredencial({
    proyectoId,
    nombre: 'Prueba',
    rol: `rol-${roles}`,
    estrategia: 'formulario',
    usuario: 'ana@example.com',
    urlLogin: 'http://localhost:5173/login',
    pasosLogin: PASOS,
    secreto: SECRETO,
    indicadorExito: conIndicador ? { tipo: 'aparece', selector: '#panel' } : null,
  });
  if (res.resultado !== 'guardada') throw new Error('No se guardó');
  return res.credencialId;
}

beforeEach(async () => {
  registro = [];
  politicasProxy = [];
  mensajes = [];
  falloProxy = false;
  proxyYaCaido = false;
  caerProxy = undefined;
  runnerActual = undefined;
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ejecuciones-'));
  // `ejecuciones` se asigna enseguida: el servicio de bóveda lo llama recién al bloquear.
  boveda = new ServicioBoveda({
    carpeta,
    antesDeBloquear: (base) => {
      ejecuciones.alBloquearse(base);
    },
    alDesbloquear: (_config, base) => {
      ejecuciones.recuperar(base);
    },
  });
  proyectos = new ServicioProyectos(boveda);
  progresos = [];
  ejecuciones = new ServicioEjecuciones(boveda, proyectos, lanzador, Date.now, (p) =>
    progresos.push(p),
  );
  await boveda.crear(CONTRASENA, false);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Antes de lanzar', () => {
  it('sin autorización vigente no se encola nada', () => {
    const id = crearProyecto();
    proyectos.actualizar(id, { ...ENTRADA, urlBase: 'http://localhost:5174/' });
    expect(ejecuciones.lanzarEscaneo(id)).toEqual({
      resultado: 'rechazada',
      motivo: 'sin-autorizacion',
    });
    expect(ejecuciones.listar(id)).toEqual([]);
    expect(registro).toEqual([]);
  });

  it('un proyecto que no existe tampoco', () => {
    expect(ejecuciones.lanzarEscaneo('00000000-0000-4000-8000-000000000000').resultado).toBe(
      'rechazada',
    );
  });

  it('con la bóveda bloqueada, falla', () => {
    const id = crearProyecto();
    boveda.bloquear();
    expect(() => ejecuciones.lanzarEscaneo(id)).toThrow('La bóveda está bloqueada.');
  });
});

describe('RN-EJE-02: fallar cerrado', () => {
  it('si el proxy no arranca, el runner nunca se lanza', async () => {
    falloProxy = true;
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    expect(registro).not.toContain('runner');
    expect(registro).toContain('perfil-borrado');
    expect(estado(proyecto, id)).toMatchObject({
      estado: 'fallida',
      resumen: { motivo: 'proxy-no-inicio' },
    });
  });

  it('si reportó su puerto y se cae antes de abrir el navegador, se cayó, y el runner no se lanza', async () => {
    proxyYaCaido = true;
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    expect(registro).not.toContain('runner');
    expect(registro).toContain('proxy-detenido');
    expect(registro).toContain('perfil-borrado');
    expect(estado(proyecto, id)).toMatchObject({
      estado: 'fallida',
      resumen: { motivo: 'proxy-caido' },
    });
  });

  it('el proxy arranca siempre antes que el runner', async () => {
    lanzar(crearProyecto());
    await pausa();
    expect(registro.slice(0, 2)).toEqual(['proxy', 'runner']);
  });

  it('si el proxy se cae durante la ejecución, se aborta', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    caerProxy?.();
    expect(estado(proyecto, id)).toMatchObject({
      estado: 'fallida',
      resumen: { motivo: 'proxy-caido' },
    });
    expect(mensajes.at(-1)).toEqual({ tipo: 'cancelar' });
  });

  it('si el runner se cae, se aborta y se limpia todo', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.salir();
    await pausa();
    expect(estado(proyecto, id)?.resumen.motivo).toBe('runner-caido');
    expect(registro).toContain('proxy-detenido');
    expect(registro).toContain('perfil-borrado');
  });

  it('si el navegador no está, la ejecución falla', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir({ tipo: 'navegador-no-disponible', causa: 'ruta', detalle: '' });
    expect(estado(proyecto, id)?.resumen.motivo).toBe('navegador-no-disponible');
  });
});

describe('RN-EJE-01 y la cola', () => {
  it('no puede haber dos en curso del mismo proyecto', async () => {
    const proyecto = crearProyecto();
    lanzar(proyecto);
    expect(ejecuciones.lanzarEscaneo(proyecto)).toEqual({
      resultado: 'rechazada',
      motivo: 'ya-en-curso',
    });
    await pausa();
    expect(ejecuciones.lanzarEscaneo(proyecto).resultado).toBe('rechazada');
    expect(ejecuciones.listar(proyecto)).toHaveLength(1);
  });

  it('la de otro proyecto espera en la cola, y arranca cuando termina la primera', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const primera = lanzar(a);
    await pausa();
    const segunda = lanzar(b);
    await pausa();
    expect(estado(b, segunda)?.estado).toBe('encolada');
    expect(registro.filter((r) => r === 'runner')).toHaveLength(1);

    runnerActual?.emitir(terminado(2, 1));
    await pausa();
    expect(estado(a, primera)).toMatchObject({
      estado: 'finalizada',
      resumen: { paginasVisitadas: 2, linksExcluidos: 1, motivo: null },
    });
    expect(estado(b, segunda)?.estado).toBe('en-curso');
  });

  it('una ejecución terminada no impide lanzar otra', async () => {
    const proyecto = crearProyecto();
    lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(terminado(1, 0));
    expect(ejecuciones.lanzarEscaneo(proyecto).resultado).toBe('encolada');
  });

  it('una encolada se puede cancelar', () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    lanzar(a);
    const segunda = lanzar(b);
    expect(ejecuciones.cancelar(segunda)).toEqual({ resultado: 'cancelada' });
    expect(estado(b, segunda)?.estado).toBe('cancelada');
    expect(ejecuciones.cancelar(segunda)).toEqual({ resultado: 'ya-terminada' });
  });
});

describe('Cancelar y limpiar', () => {
  it('cancelar corta el runner, detiene el proxy y borra el perfil', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    expect(ejecuciones.cancelar(id)).toEqual({ resultado: 'cancelada' });
    await pausa();
    expect(mensajes.at(-1)).toEqual({ tipo: 'cancelar' });
    expect(registro).toContain('proxy-detenido');
    expect(registro).toContain('perfil-borrado');
    expect(estado(proyecto, id)).toMatchObject({
      estado: 'cancelada',
      resumen: { motivo: 'usuario' },
    });
  });

  it('el mensaje al runner lleva la configuración, y no la clave ni la bóveda', async () => {
    lanzar(crearProyecto());
    await pausa();
    const mensaje = mensajes.find((m) => m.tipo === 'escaneo');
    expect(mensaje).toBeDefined();
    const texto = JSON.stringify(mensaje);
    expect(texto).not.toMatch(/clave_?proyecto|maestra|boveda|sellada/i);
    expect(texto).not.toContain(carpeta.replaceAll('\\', '\\\\'));
    expect(mensaje).toMatchObject({
      configuracion: { politica: { puertosLocales: [3000], dominios: ['localhost'] } },
    });
  });

  it('la credencial del proxy es distinta en cada ejecución', async () => {
    const proyecto = crearProyecto();
    const primera = lanzar(proyecto);
    await pausa();
    ejecuciones.cancelar(primera);
    await pausa();
    lanzar(proyecto);
    await pausa();
    const claves = mensajes.flatMap((m) =>
      m.tipo === 'escaneo' ? [m.configuracion.proxy.clave] : [],
    );
    expect(claves).toHaveLength(2);
    expect(claves[0]).not.toBe(claves[1]);
  });
});

describe('Bloqueo', () => {
  it('bloquear cancela lo que esté en curso y la cola, y lo guarda antes de cerrar la base', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const primera = lanzar(a);
    await pausa();
    const segunda = lanzar(b);
    alRegistrarProxy?.({
      destino: 'evil.example:443',
      permitida: false,
      regla: 'fuera-de-dominios',
    });
    boveda.bloquear();
    expect(registro).toContain('runner');
    await boveda.desbloquear(CONTRASENA);
    expect(estado(a, primera)).toMatchObject({
      estado: 'cancelada',
      resumen: { motivo: 'bloqueo', conexionesBloqueadas: 1 },
    });
    expect(estado(b, segunda)).toMatchObject({
      estado: 'cancelada',
      resumen: { motivo: 'bloqueo' },
    });
    expect(ejecuciones.detalle(primera)?.conexiones).toHaveLength(1);
  });

  it('nada se relanza solo al desbloquear', async () => {
    const proyecto = crearProyecto();
    lanzar(proyecto);
    await pausa();
    boveda.bloquear();
    registro.length = 0;
    await boveda.desbloquear(CONTRASENA);
    await pausa();
    expect(registro).toEqual([]);
  });

  it('lo que quedó sin terminar por un cierre abrupto se marca interrumpido', () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    // Como si la app se hubiera cortado: una instancia nueva, sin la ejecución en memoria.
    boveda.conAcceso((base) => {
      ejecuciones.recuperar(base);
    });
    expect(estado(proyecto, id)).toMatchObject({
      estado: 'fallida',
      resumen: { motivo: 'interrumpida' },
    });
  });
});

describe('Resultados del escaneo', () => {
  const DETALLE = 'CANARIO-detalle-de-consola-que-no-va-en-claro';
  const hallazgo = (
    extra: Partial<Extract<MensajeDelRunner, { tipo: 'hallazgo' }>['hallazgo']> = {},
  ) =>
    ({
      tipo: 'hallazgo',
      hallazgo: {
        tipo: 'console-error',
        severidad: 'baja',
        url: 'http://localhost:5173/consola',
        urlOrigen: null,
        clave: 'Error #',
        titulo: 'console.error en la página',
        detalle: DETALLE,
        ...extra,
      },
    }) satisfies MensajeDelRunner;
  const pagina = (url: string): MensajeDelRunner => ({
    tipo: 'pagina',
    url,
    status: 200,
    tiempoCargaMs: 120,
    profundidad: 1,
  });

  const filasEnClaro = () =>
    boveda.conAcceso((base) =>
      JSON.stringify([
        base.prepare('SELECT * FROM hallazgo').all(),
        base.prepare('SELECT id, url, url_origen FROM hallazgo_ocurrencia').all(),
        base.prepare('SELECT id, url FROM pagina_visitada').all(),
      ]),
    );

  it('cada página queda registrada y el progreso se informa en vivo', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(pagina('http://localhost:5173/'));
    runnerActual?.emitir(pagina('http://localhost:5173/panel'));
    expect(progresos.at(-1)).toEqual({
      ejecucionId: id,
      estado: 'en-curso',
      paginaActual: 'http://localhost:5173/panel',
      paginasVisitadas: 2,
      hallazgos: 0,
      conexionesBloqueadas: 0,
      espera: null,
    });
    runnerActual?.emitir(terminado(2, 0));
    expect(progresos.at(-1)?.estado).toBe('finalizada');
    expect(ejecuciones.detalle(id)?.paginas).toEqual([
      { url: 'http://localhost:5173/', status: 200, tiempoCargaMs: 120, profundidad: 1 },
      { url: 'http://localhost:5173/panel', status: 200, tiempoCargaMs: 120, profundidad: 1 },
    ]);
  });

  it('una página con query: en claro va sin ella; la completa, cifrada', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(pagina('http://localhost:5173/buscar?token=CANARIO-token-en-query'));
    expect(ejecuciones.detalle(id)?.paginas[0]?.url).toBe('http://localhost:5173/buscar');
    expect(filasEnClaro()).not.toContain('CANARIO-token-en-query');
    boveda.conAcceso((base) => {
      const fila = base.prepare('SELECT url_completa_cifrada AS c FROM pagina_visitada').get() as {
        c: Buffer;
      };
      expect(fila.c.includes(Buffer.from('CANARIO'))).toBe(false);
    });
  });

  it('el detalle de un hallazgo se guarda cifrado y se muestra descifrado', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(hallazgo());
    expect(progresos.at(-1)?.hallazgos).toBe(1);
    expect(filasEnClaro()).not.toContain(DETALLE);
    boveda.conAcceso((base) => {
      const { c } = base.prepare('SELECT detalle_cifrado AS c FROM hallazgo_ocurrencia').get() as {
        c: Buffer;
      };
      expect(c.includes(Buffer.from('CANARIO'))).toBe(false);
    });
    expect(ejecuciones.detalle(id)?.hallazgos).toEqual([
      {
        id: expect.any(String) as string,
        tipo: 'console-error',
        severidad: 'baja',
        titulo: 'console.error en la página',
        url: 'http://localhost:5173/consola',
        urlOrigen: null,
        detalle: DETALLE,
      },
    ]);
  });

  it('la estructura de la semana 8 queda lista: clave guardada, huella vacía, estado nuevo', async () => {
    const proyecto = crearProyecto();
    lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(hallazgo({ tipo: 'accesibilidad', clave: 'image-alt', detalle: '' }));
    boveda.conAcceso((base) => {
      expect(
        base
          .prepare('SELECT clave, huella, estado, primera_vez_en IS NOT NULL AS f FROM hallazgo')
          .get(),
      ).toEqual({ clave: 'image-alt', huella: null, estado: 'nuevo', f: 1 });
      expect(base.prepare('SELECT detalle_cifrado FROM hallazgo_ocurrencia').get()).toEqual({
        detalle_cifrado: null,
      });
    });
  });

  it('el resumen guarda lo que el escaneo no cubrió', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(hallazgo());
    runnerActual?.emitir({
      ...terminado(3, 2),
      detenido: 'max-tiempo',
      noRecorridosSoloLectura: 4,
      noRecorridosExclusiones: 5,
      urlsDescartadas: 6,
      websocketDescartados: 7,
    });
    expect(estado(proyecto, id)?.resumen).toMatchObject({
      paginasVisitadas: 3,
      linksExcluidos: 2,
      hallazgos: 1,
      detenido: 'max-tiempo',
      noRecorridosSoloLectura: 4,
      noRecorridosExclusiones: 5,
      urlsDescartadas: 6,
      websocketDescartados: 7,
    });
  });

  it('una ejecución de antes de esta semana se lee con los campos nuevos en cero', () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    boveda.conAcceso((base) => {
      base.prepare('UPDATE ejecucion SET resumen = ? WHERE id = ?').run(
        JSON.stringify({
          paginasVisitadas: 1,
          linksExcluidos: 0,
          conexionesPermitidas: 0,
          conexionesBloqueadas: 0,
          motivo: null,
        }),
        id,
      );
    });
    expect(estado(proyecto, id)?.resumen).toMatchObject({ hallazgos: 0, detenido: null });
  });

  it('el escaneo manda al runner la profundidad y el tiempo máximo del proyecto', async () => {
    lanzar(crearProyecto());
    await pausa();
    expect(mensajes.find((m) => m.tipo === 'escaneo')).toMatchObject({
      maxProfundidad: 5,
      maxMinutos: 30,
    });
  });

  it('eliminar el proyecto purga páginas, hallazgos y ocurrencias, y el detalle queda ilegible', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(pagina('http://localhost:5173/'));
    runnerActual?.emitir(hallazgo());
    runnerActual?.emitir(terminado(1, 0));
    proyectos.eliminar(proyecto, 'Lexora');
    expect(ejecuciones.detalle(id)).toBeNull();
    boveda.conAcceso((base) => {
      for (const tabla of ['hallazgo', 'hallazgo_ocurrencia', 'pagina_visitada']) {
        expect((base.prepare(`SELECT count(*) AS n FROM ${tabla}`).get() as { n: number }).n).toBe(
          0,
        );
      }
    });
  });
});

describe('Monitor de conexiones', () => {
  it('cada conexión queda registrada con su regla, y el resumen las cuenta', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    alRegistrarProxy?.({ destino: 'localhost:5173', permitida: true, regla: 'loopback-declarado' });
    alRegistrarProxy?.({
      destino: 'evil.example:80',
      permitida: false,
      regla: 'fuera-de-dominios',
    });
    runnerActual?.emitir({
      tipo: 'conexion',
      proceso: 'navegador',
      destino: 'otro.example:443',
      permitida: false,
      regla: 'fuera-de-dominios',
    });
    runnerActual?.emitir(terminado(1, 0));

    const detalle = ejecuciones.detalle(id);
    expect(detalle?.ejecucion.resumen).toMatchObject({
      conexionesPermitidas: 1,
      conexionesBloqueadas: 2,
    });
    expect(detalle?.conexiones.map((c) => [c.destino, c.proceso, c.permitida, c.regla])).toEqual([
      ['localhost:5173', 'proxy', true, 'loopback-declarado'],
      ['evil.example:80', 'proxy', false, 'fuera-de-dominios'],
      ['otro.example:443', 'navegador', false, 'fuera-de-dominios'],
    ]);
    expect(ejecuciones.conexionesRecientes(10)).toHaveLength(3);
  });

  it('una conexión que llega después del «terminé» también queda registrada', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    runnerActual?.emitir(terminado(1, 0));
    alRegistrarProxy?.({
      destino: 'tarde.example:80',
      permitida: false,
      regla: 'fuera-de-dominios',
    });
    const detalle = ejecuciones.detalle(id);
    expect(detalle?.ejecucion.resumen.conexionesBloqueadas).toBe(1);
    expect(detalle?.conexiones.map((c) => c.destino)).toEqual(['tarde.example:80']);
  });

  it('una conexión tardía con la bóveda bloqueada no rompe nada', async () => {
    const proyecto = crearProyecto();
    lanzar(proyecto);
    await pausa();
    boveda.bloquear();
    expect(() => {
      alRegistrarProxy?.({ destino: 'tarde.example:80', permitida: false, regla: 'x' });
    }).not.toThrow();
  });

  it('un sitio que martilla no llena la base, pero el resumen lo cuenta', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    for (let i = 0; i < 2100; i++) {
      alRegistrarProxy?.({ destino: 'evil.example:80', permitida: false, regla: 'x' });
    }
    runnerActual?.emitir(terminado(1, 0));
    expect(estado(proyecto, id)?.resumen.conexionesBloqueadas).toBe(2100);
    expect(ejecuciones.conexionesRecientes(500)).toHaveLength(500);
    boveda.conAcceso((base) => {
      const { n } = base.prepare('SELECT count(*) AS n FROM conexion').get() as { n: number };
      expect(n).toBe(2000);
    });
  });

  it('eliminar el proyecto purga sus ejecuciones y sus conexiones', async () => {
    const proyecto = crearProyecto();
    const id = lanzar(proyecto);
    await pausa();
    alRegistrarProxy?.({ destino: 'evil.example:80', permitida: false, regla: 'x' });
    runnerActual?.emitir(terminado(1, 0));
    proyectos.eliminar(proyecto, 'Lexora');
    expect(ejecuciones.detalle(id)).toBeNull();
    expect(ejecuciones.conexionesRecientes(10)).toEqual([]);
  });

  it('cortar por proyecto corta solo el suyo', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const id = lanzar(a);
    await pausa();
    ejecuciones.cortarDeProyecto(b);
    expect(estado(a, id)?.estado).toBe('en-curso');
    ejecuciones.cortarDeProyecto(a);
    expect(estado(a, id)).toMatchObject({
      estado: 'cancelada',
      resumen: { motivo: 'autorizacion-no-vigente' },
    });
  });
});

describe('Probar login', () => {
  const responderLogin = async (funciono: boolean) => {
    await pausa();
    runnerActual?.emitir({ tipo: 'login-terminado', resultado: funciono ? 'funciono' : 'fallo' });
  };

  it('sin indicador de éxito no se abre nada', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto, false);
    expect(await ejecuciones.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'fallo',
      motivo: 'sin-indicador',
    });
    expect(registro).toEqual([]);
  });

  it('funcionó', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const resultado = ejecuciones.probarLogin(proyecto, credencial);
    await responderLogin(true);
    expect(await resultado).toEqual({ resultado: 'funciono' });
  });

  it('falló, con un motivo genérico', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const resultado = ejecuciones.probarLogin(proyecto, credencial);
    await responderLogin(false);
    expect(await resultado).toEqual({ resultado: 'fallo', motivo: 'no-confirmado' });
  });

  it('sin autorización no descifra nada', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    proyectos.actualizar(proyecto, { ...ENTRADA, puertosLocales: [3001] });
    expect(await ejecuciones.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'fallo',
      motivo: 'sin-autorizacion',
    });
    expect(mensajes).toEqual([]);
  });

  it('con otra ejecución en curso, no corre', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    lanzar(proyecto);
    await pausa();
    expect(await ejecuciones.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'fallo',
      motivo: 'ocupado',
    });
  });

  it('el secreto llega una vez, solo en el mensaje de login', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const resultado = ejecuciones.probarLogin(proyecto, credencial);
    await responderLogin(true);
    await resultado;
    const conSecreto = mensajes.filter(
      (m) => m.tipo === 'probar-login' && Buffer.from(m.secreto ?? []).toString() === SECRETO,
    );
    expect(conSecreto).toHaveLength(1);
    expect(mensajes.filter((m) => m.tipo !== 'probar-login')).toEqual([{ tipo: 'cancelar' }]);
  });

  it('si el proxy no arranca, el secreto ni se descifra', async () => {
    falloProxy = true;
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    expect(await ejecuciones.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'fallo',
      motivo: 'no-se-pudo-ejecutar',
    });
    expect(mensajes).toEqual([]);
  });

  it('una credencial de otro proyecto no corre', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const credencial = guardarCredencial(a);
    expect((await ejecuciones.probarLogin(b, credencial)).resultado).toBe('fallo');
    expect(registro).toEqual([]);
  });

  it('el secreto no queda en la auditoría', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const resultado = ejecuciones.probarLogin(proyecto, credencial);
    await responderLogin(true);
    await resultado;
    boveda.conAcceso((base) => {
      expect(JSON.stringify(leerAuditoria(base))).not.toContain(SECRETO);
    });
  });
});

describe('Probar login: límite de intentos', () => {
  const MINUTO = 60_000;
  let ahora: number;
  const conReloj = () => new ServicioEjecuciones(boveda, proyectos, lanzador, () => ahora);

  async function intentar(servicio: ServicioEjecuciones, proyecto: string, credencial: string) {
    const resultado = servicio.probarLogin(proyecto, credencial);
    await pausa();
    runnerActual?.emitir({ tipo: 'login-terminado', resultado: 'fallo' });
    return resultado;
  }
  const logins = () => mensajes.filter((m) => m.tipo === 'probar-login');

  beforeEach(() => {
    ahora = Date.parse('2026-11-01T12:00:00.000Z');
  });

  it('el cuarto intento en 15 minutos no se hace, y dice cuánto falta', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    for (let i = 0; i < 3; i++) {
      expect(await intentar(servicio, proyecto, credencial)).toEqual({
        resultado: 'fallo',
        motivo: 'no-confirmado',
      });
      ahora += MINUTO;
    }
    registro.length = 0;
    expect(await servicio.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'limite',
      esperaSegundos: 12 * 60,
    });
    expect(logins()).toHaveLength(3);
    // Ni proxy, ni runner, ni una fila más en las ejecuciones.
    expect(registro).toEqual([]);
    expect(servicio.listar(proyecto)).toHaveLength(3);
  });

  it('un intento exitoso también cuenta', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    for (let i = 0; i < 3; i++) {
      const resultado = servicio.probarLogin(proyecto, credencial);
      await pausa();
      runnerActual?.emitir({ tipo: 'login-terminado', resultado: 'funciono' });
      expect(await resultado).toEqual({ resultado: 'funciono' });
    }
    expect((await servicio.probarLogin(proyecto, credencial)).resultado).toBe('limite');
  });

  it('la ventana se mueve: al vencer el intento más viejo, se libera uno solo', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    await intentar(servicio, proyecto, credencial);
    ahora += 10 * MINUTO;
    await intentar(servicio, proyecto, credencial);
    await intentar(servicio, proyecto, credencial);
    ahora += 5 * MINUTO - 1000;
    expect(await servicio.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'limite',
      esperaSegundos: 1,
    });
    ahora += 1001;
    expect((await intentar(servicio, proyecto, credencial)).resultado).toBe('fallo');
    expect((await servicio.probarLogin(proyecto, credencial)).resultado).toBe('limite');
  });

  it('es por credencial: otra del mismo proyecto no se ve afectada', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const una = guardarCredencial(proyecto);
    const otra = guardarCredencial(proyecto);
    for (let i = 0; i < 3; i++) await intentar(servicio, proyecto, una);
    expect((await servicio.probarLogin(proyecto, una)).resultado).toBe('limite');
    expect((await intentar(servicio, proyecto, otra)).resultado).toBe('fallo');
  });

  it('sobrevive a un reinicio y a un bloqueo: vive en la base', async () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const servicio = conReloj();
    for (let i = 0; i < 3; i++) await intentar(servicio, proyecto, credencial);
    boveda.bloquear();
    await boveda.desbloquear(CONTRASENA);
    expect((await conReloj().probarLogin(proyecto, credencial)).resultado).toBe('limite');
  });

  it('reemplazar el secreto no lo reinicia: el sistema probado sigue contando', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    for (let i = 0; i < 3; i++) await intentar(servicio, proyecto, credencial);
    proyectos.reemplazarSecreto(proyecto, credencial, 'otro-secreto-de-prueba');
    expect((await servicio.probarLogin(proyecto, credencial)).resultado).toBe('limite');
  });

  it('lo que no llegó al sistema probado no cuenta', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    falloProxy = true;
    for (let i = 0; i < 5; i++) {
      expect(await servicio.probarLogin(proyecto, credencial)).toEqual({
        resultado: 'fallo',
        motivo: 'no-se-pudo-ejecutar',
      });
    }
    falloProxy = false;
    expect((await intentar(servicio, proyecto, credencial)).resultado).toBe('fallo');
  });

  it('el intento queda registrado antes de mandar el secreto', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    const resultado = servicio.probarLogin(proyecto, credencial);
    await pausa();
    const filas = boveda.conAcceso(
      (base) => base.prepare('SELECT count(*) AS n FROM intento_login').get() as { n: number },
    );
    expect(filas.n).toBe(1);
    expect(logins()).toHaveLength(1);
    runnerActual?.emitir({ tipo: 'login-terminado', resultado: 'fallo' });
    await resultado;
  });

  it('eliminar el proyecto purga sus intentos', async () => {
    const servicio = conReloj();
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto);
    await intentar(servicio, proyecto, credencial);
    proyectos.eliminar(proyecto, 'Lexora');
    const filas = boveda.conAcceso(
      (base) => base.prepare('SELECT count(*) AS n FROM intento_login').get() as { n: number },
    );
    expect(filas.n).toBe(0);
  });
});

describe('Actividad (pendiente de la semana 4)', () => {
  it('cada evento de entrada reinicia el contador', () => {
    const emisor = new EventEmitter();
    let ahora = 0;
    const detector = new DetectorInactividad(60_000, 0);
    conectarActividad(emisor, detector, () => ahora);

    ahora = 40_000;
    emisor.emit('input-event');
    ahora = 70_000;
    expect(detector.venció(ahora)).toBe(false);
    ahora = 100_000;
    expect(detector.venció(ahora)).toBe(true);
  });

  it('sin eventos, vence', () => {
    const emisor = new EventEmitter();
    const detector = new DetectorInactividad(60_000, 0);
    conectarActividad(emisor, detector, () => 0);
    expect(detector.venció(60_000)).toBe(true);
  });
});

describe('Carpeta de perfiles', () => {
  it('un perfil huérfano se borra, sin tocar lo demás', async () => {
    // Se importa acá: el módulo usa Electron, que en Vitest no existe.
    const dato = path.join(carpeta, 'boveda.db');
    const huerfano = path.join(carpeta, 'perfiles', 'cortada');
    mkdirSync(huerfano, { recursive: true });
    writeFileSync(path.join(huerfano, 'x'), 'y');
    // También el perfil de la ventana del asistido, que va adentro de la carpeta de la ejecución.
    const ventana = path.join(huerfano, 'asistido-abc123', 'Default');
    mkdirSync(ventana, { recursive: true });
    writeFileSync(path.join(ventana, 'Preferences'), '{}');
    const { limpiarPerfilesHuerfanos } = await import('./perfiles');
    limpiarPerfilesHuerfanos(carpeta);
    expect(readdirSync(path.join(carpeta, 'perfiles'))).toEqual([]);
    expect(dato).toContain('boveda.db');
    expect(readdirSync(carpeta)).toContain('boveda.db');
  });

  it('sin carpeta de perfiles, no falla', async () => {
    const { limpiarPerfilesHuerfanos } = await import('./perfiles');
    expect(() => {
      limpiarPerfilesHuerfanos(path.join(carpeta, 'no-existe'));
    }).not.toThrow();
  });

  it('la carpeta del perfil es corta: en Linux, Chromium crea ahí un socket Unix', async () => {
    const { carpetaPerfil } = await import('./perfiles');
    const ruta = carpetaPerfil('/datos', '12345678-1234-4234-8234-123456789012');
    expect(path.basename(ruta)).toBe('12345678');
  });

  it('el entorno de un proceso de la ejecución es una lista cerrada', async () => {
    const { entornoMinimo } = await import('./perfiles');
    const entorno = entornoMinimo(
      {
        SystemRoot: 'C:\\Windows',
        SystemDrive: 'C:',
        SECRETO_DEL_PADRE: 'x',
        NODE_OPTIONS: 'y',
        DEBUG: 'pw:*',
      },
      { TEMP: 'z' },
    );
    expect(entorno).toEqual({ SystemRoot: 'C:\\Windows', SystemDrive: 'C:', TEMP: 'z' });
  });
});

describe('Escaneo autenticado (ADR 025 a 027)', () => {
  const MINUTO = 60_000;
  let ahora: number;
  let servicio: ServicioEjecuciones;
  const ESTADO = {
    cookies: [
      {
        name: 'app_sesion',
        value: 'valor-de-sesion-inventado-55',
        domain: 'localhost',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      },
    ],
    origins: [],
  };

  beforeEach(() => {
    ahora = Date.parse('2026-11-01T12:00:00.000Z');
    servicio = new ServicioEjecuciones(
      boveda,
      proyectos,
      lanzador,
      () => ahora,
      (p) => progresos.push(p),
    );
  });

  function proyectoConAuth(): string {
    const entrada = { ...ENTRADA, dominiosAutenticacion: ['idp.example.test'] };
    const { declaracion } = proyectos.validar(entrada);
    if (!declaracion) throw new Error('Entrada inválida');
    const res = proyectos.crear(entrada, { aceptada: true, ...declaracion });
    if (res.resultado !== 'creado') throw new Error('No se creó');
    return res.id;
  }

  function credencialDe(proyectoId: string, estrategia: 'formulario' | 'asistido' | 'token-url') {
    roles += 1;
    const comunes = {
      proyectoId,
      nombre: 'Prueba',
      rol: `rol-${roles}`,
      usuario: estrategia === 'formulario' ? 'ana@example.com' : '',
      urlLogin: 'http://localhost:5173/login',
      pasosLogin: estrategia === 'formulario' ? PASOS : [],
      indicadorExito: { tipo: 'aparece' as const, selector: '#panel' },
    };
    const res =
      estrategia === 'asistido'
        ? proyectos.guardarCredencial({ ...comunes, estrategia })
        : proyectos.guardarCredencial({
            ...comunes,
            estrategia,
            secreto:
              estrategia === 'token-url'
                ? 'http://localhost:5173/entrar?token=CANARIO-token-77'
                : SECRETO,
          });
    if (res.resultado !== 'guardada') throw new Error(JSON.stringify(res));
    return res.credencialId;
  }

  async function lanzarCon(proyectoId: string, credencialId: string) {
    const res = servicio.lanzarEscaneo(proyectoId, credencialId);
    if (res.resultado !== 'encolada') throw new Error(res.motivo);
    await pausa();
    return res.ejecucionId;
  }

  const pedir = async (motivo: 'inicial' | 'planificada' | 'vencida', reintento = false) => {
    mensajes.length = 0;
    runnerActual?.emitir({ tipo: 'necesita-login', motivo, reintento });
    await pausa();
    return mensajes.find((m) => m.tipo === 'datos-login' || m.tipo === 'login-denegado');
  };
  const entro = async () => {
    runnerActual?.emitir({
      tipo: 'sesion',
      resultado: 'ok',
      estado: ESTADO,
      urlComprobacion: 'http://localhost:5173/panel',
    });
    await pausa();
  };
  const resumen = (proyectoId: string, id: string) =>
    servicio.listar(proyectoId).find((e) => e.id === id);

  it('el escaneo lleva la autenticación sin el secreto, y el rol queda en la ejecución', async () => {
    const proyecto = proyectoConAuth();
    const credencial = credencialDe(proyecto, 'formulario');
    const id = await lanzarCon(proyecto, credencial);
    const escaneo = mensajes.find((m) => m.tipo === 'escaneo');
    expect(escaneo).toMatchObject({
      autenticacion: {
        estrategia: 'formulario',
        dominiosAutenticacion: ['idp.example.test'],
        sesionMaxMs: null,
        permitirLoginHttp: false,
      },
      sesionPrevia: null,
    });
    expect(JSON.stringify(escaneo)).not.toContain(SECRETO);
    // El proxy del escaneo no conoce los dominios de autenticación.
    expect(politicasProxy).toEqual([['localhost']]);
    expect(resumen(proyecto, id)?.rol).toMatch(/^rol-/);
  });

  it('el login levanta un proxy aparte, con los dominios de autenticación, y lo apaga', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    const datos = await pedir('inicial');
    if (datos?.tipo !== 'datos-login') throw new Error('sin datos');
    expect(Buffer.from(datos.secreto ?? []).toString()).toBe(SECRETO);
    expect(politicasProxy).toEqual([['localhost'], ['localhost', 'idp.example.test']]);
    registro.length = 0;
    await entro();
    expect(registro).toEqual(['proxy-detenido']);
    expect(resumen(proyecto, id)?.estado).toBe('en-curso');
  });

  it('tope por ejecución: cuenta solo los logins por sesión vencida (reloj controlado)', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    await pedir('inicial');
    await entro();
    // Separados por 16 minutos: el límite por credencial no interviene.
    for (let i = 0; i < 3; i++) {
      ahora += 16 * MINUTO;
      expect((await pedir('vencida'))?.tipo).toBe('datos-login');
      await entro();
    }
    ahora += 16 * MINUTO;
    expect((await pedir('vencida'))?.tipo).toBe('login-denegado');
    runnerActual?.emitir({ ...terminado(5, 0), detenido: 'sesion' });
    await pausa();
    expect(resumen(proyecto, id)).toMatchObject({
      estado: 'finalizada',
      resumen: { motivo: 'limite-logins', detenido: 'sesion', logins: 4, loginsInesperados: 3 },
    });
  });

  it('las renovaciones planificadas no cuentan para el tope, pero sí para el límite por credencial', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    await pedir('inicial');
    await entro();
    for (let i = 0; i < 2; i++) {
      ahora += MINUTO;
      expect((await pedir('planificada'))?.tipo).toBe('datos-login');
      await entro();
    }
    // Tres logins en 15 minutos: la tercera renovación no se hace, y el escaneo sigue con su sesión.
    ahora += MINUTO;
    expect((await pedir('planificada'))?.tipo).toBe('login-denegado');
    expect(resumen(proyecto, id)?.estado).toBe('en-curso');
    // Pasada la ventana, una sesión vencida sí entra, y es la primera inesperada.
    ahora += 15 * MINUTO;
    expect((await pedir('vencida'))?.tipo).toBe('datos-login');
    await entro();
    runnerActual?.emitir(terminado(9, 0));
    await pausa();
    expect(resumen(proyecto, id)).toMatchObject({
      estado: 'finalizada',
      resumen: { motivo: null, logins: 4, renovaciones: 2, loginsInesperados: 1 },
    });
  });

  it('un login que funciona y vuelve a dar sesión vencida enseguida cuenta: el bucle se corta', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    await pedir('inicial');
    await entro();
    // Cada login entra, y lo primero que hace el escaneo es encontrar la sesión vencida otra vez.
    // El reloj avanza solo para que el límite por credencial no lo corte antes que el tope.
    const respuestas: (string | undefined)[] = [];
    for (let i = 0; i < 4; i++) {
      ahora += 16 * MINUTO;
      const respuesta = await pedir('vencida');
      respuestas.push(respuesta?.tipo);
      if (respuesta?.tipo === 'datos-login') await entro();
    }
    expect(respuestas).toEqual(['datos-login', 'datos-login', 'datos-login', 'login-denegado']);
    runnerActual?.emitir({ ...terminado(1, 0), detenido: 'sesion' });
    await pausa();
    expect(resumen(proyecto, id)?.resumen).toMatchObject({
      motivo: 'limite-logins',
      loginsInesperados: 3,
    });
  });

  it('el bucle sin tiempo de por medio lo corta antes el límite por credencial', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    await pedir('inicial');
    await entro();
    expect((await pedir('vencida'))?.tipo).toBe('datos-login');
    await entro();
    expect((await pedir('vencida'))?.tipo).toBe('datos-login');
    await entro();
    expect((await pedir('vencida'))?.tipo).toBe('login-denegado');
    runnerActual?.emitir({ ...terminado(1, 0), detenido: 'sesion' });
    await pausa();
    expect(resumen(proyecto, id)?.resumen.motivo).toBe('limite-logins');
  });

  it('un login fallido al empezar termina la ejecución sin páginas: fallida', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'formulario'));
    await pedir('inicial');
    runnerActual?.emitir({ tipo: 'sesion', resultado: 'fallo' });
    await pausa();
    expect((await pedir('inicial', true))?.tipo).toBe('login-denegado');
    runnerActual?.emitir({ ...terminado(0, 0), detenido: 'sesion' });
    await pausa();
    expect(resumen(proyecto, id)).toMatchObject({
      estado: 'fallida',
      resumen: { motivo: 'login-fallido' },
    });
  });

  it('el asistido no manda secreto, no cuenta intentos y, si la sesión vence, pausa', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'asistido'));
    expect(await pedir('inicial')).toMatchObject({ tipo: 'datos-login', secreto: null });
    expect(progresos.at(-1)?.espera).toBe('login-asistido');
    await entro();
    expect(progresos.at(-1)?.espera).toBeNull();
    expect(await pedir('vencida')).toBeUndefined();
    expect(resumen(proyecto, id)?.estado).toBe('pausada');
    expect(progresos.at(-1)).toMatchObject({ estado: 'pausada', espera: 'sesion-vencida' });
    // Pausada retiene la cola: otro proyecto espera.
    const otro = crearProyecto('Otro');
    const encolada = servicio.lanzarEscaneo(otro, null);
    expect(encolada.resultado).toBe('encolada');
    expect(servicio.reanudar(id)).toEqual({ resultado: 'reanudada' });
    await pausa();
    expect(mensajes.find((m) => m.tipo === 'datos-login')).toMatchObject({ secreto: null });
    expect(resumen(proyecto, id)?.estado).toBe('en-curso');
    expect(servicio.reanudar(id)).toEqual({ resultado: 'no-pausada' });
    boveda.conAcceso((base) => {
      expect(base.prepare('SELECT count(*) AS n FROM intento_login').get()).toEqual({ n: 0 });
    });
  });

  it('una pausa sin reanudar se cancela a los 15 minutos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const proyecto = proyectoConAuth();
      const res = servicio.lanzarEscaneo(proyecto, credencialDe(proyecto, 'asistido'));
      if (res.resultado !== 'encolada') throw new Error(res.motivo);
      await vi.advanceTimersByTimeAsync(10);
      runnerActual?.emitir({ tipo: 'necesita-login', motivo: 'vencida', reintento: false });
      await vi.advanceTimersByTimeAsync(10);
      expect(resumen(proyecto, res.ejecucionId)?.estado).toBe('pausada');
      mensajes.length = 0;
      await vi.advanceTimersByTimeAsync(14 * MINUTO);
      expect(mensajes).toEqual([]);
      await vi.advanceTimersByTimeAsync(MINUTO);
      expect(mensajes).toEqual([{ tipo: 'login-denegado' }]);
      runnerActual?.emitir({ ...terminado(3, 0), detenido: 'sesion' });
      await vi.advanceTimersByTimeAsync(10);
      expect(resumen(proyecto, res.ejecucionId)?.resumen.motivo).toBe('pausa-vencida');
    } finally {
      vi.useRealTimers();
    }
  });

  it('un enlace que ya no sirve a mitad del escaneo pausa y pide uno nuevo', async () => {
    const proyecto = proyectoConAuth();
    const id = await lanzarCon(proyecto, credencialDe(proyecto, 'token-url'));
    await pedir('inicial');
    await entro();
    ahora += 16 * MINUTO;
    await pedir('vencida');
    runnerActual?.emitir({ tipo: 'sesion', resultado: 'fallo' });
    await pausa();
    expect(await pedir('vencida', true)).toBeUndefined();
    expect(progresos.at(-1)).toMatchObject({ estado: 'pausada', espera: 'enlace-vencido' });
    expect(resumen(proyecto, id)?.estado).toBe('pausada');
  });

  it('la sesión queda cifrada en memoria, la usa el próximo escaneo y se descarta con un cambio', async () => {
    const proyecto = proyectoConAuth();
    const credencial = credencialDe(proyecto, 'formulario');
    await lanzarCon(proyecto, credencial);
    await pedir('inicial');
    await entro();
    const guardadas = (servicio as unknown as { sesiones: Map<string, { sellado: Buffer }> })
      .sesiones;
    expect(guardadas.size).toBe(1);
    for (const { sellado } of guardadas.values()) {
      expect(sellado.toString('latin1')).not.toContain('valor-de-sesion-inventado-55');
    }
    runnerActual?.emitir(terminado(1, 0));
    await pausa();

    ahora += 10 * MINUTO;
    mensajes.length = 0;
    await lanzarCon(proyecto, credencial);
    expect(mensajes.find((m) => m.tipo === 'escaneo')).toMatchObject({
      sesionPrevia: {
        estado: ESTADO,
        urlComprobacion: 'http://localhost:5173/panel',
        edadMs: 10 * MINUTO,
      },
    });
    runnerActual?.emitir(terminado(1, 0));
    await pausa();

    servicio.descartarSesiones(proyecto);
    mensajes.length = 0;
    await lanzarCon(proyecto, credencial);
    expect(mensajes.find((m) => m.tipo === 'escaneo')).toMatchObject({ sesionPrevia: null });
  });

  it('a las 12 horas la sesión guardada ya no se usa, y bloquear la borra', async () => {
    const proyecto = proyectoConAuth();
    const credencial = credencialDe(proyecto, 'formulario');
    await lanzarCon(proyecto, credencial);
    await pedir('inicial');
    await entro();
    runnerActual?.emitir(terminado(1, 0));
    await pausa();
    ahora += 12 * 60 * MINUTO;
    mensajes.length = 0;
    await lanzarCon(proyecto, credencial);
    expect(mensajes.find((m) => m.tipo === 'escaneo')).toMatchObject({ sesionPrevia: null });
    await pedir('inicial');
    await entro();
    // La bóveda de estos tests avisa a otra instancia: se llama directo, como lo hace el aviso.
    boveda.conAcceso((base) => {
      servicio.alBloquearse(base);
    });
    const guardadas = (servicio as unknown as { sesiones: Map<string, unknown> }).sesiones;
    expect(guardadas.size).toBe(0);
  });

  it('una credencial sin indicador no se puede usar para escanear', () => {
    const proyecto = crearProyecto();
    const credencial = guardarCredencial(proyecto, false);
    expect(servicio.lanzarEscaneo(proyecto, credencial)).toEqual({
      resultado: 'rechazada',
      motivo: 'credencial-no-usable',
    });
  });
});

describe('Básica: llega en la fase 2 (ADR 025)', () => {
  /** Una credencial básica de antes, como la que trae una copia: con secreto e indicador. */
  function basicaExistente(proyectoId: string): string {
    const id = guardarCredencial(proyectoId);
    boveda.conAcceso((base) => {
      base
        .prepare("UPDATE credencial SET estrategia = 'basica', pasos_login = '[]' WHERE id = ?")
        .run(id);
    });
    return id;
  }

  it('no se lanza ni se prueba, lo dice, y no abre ningún proceso', async () => {
    const proyecto = crearProyecto();
    const credencial = basicaExistente(proyecto);
    expect(proyectos.obtener(proyecto)?.credenciales[0]?.estrategia).toBe('basica');
    expect(ejecuciones.lanzarEscaneo(proyecto, credencial)).toEqual({
      resultado: 'rechazada',
      motivo: 'estrategia-no-disponible',
    });
    expect(await ejecuciones.probarLogin(proyecto, credencial)).toEqual({
      resultado: 'fallo',
      motivo: 'estrategia-no-disponible',
    });
    expect(registro).toEqual([]);
    expect(ejecuciones.listar(proyecto)).toEqual([]);
  });
});
