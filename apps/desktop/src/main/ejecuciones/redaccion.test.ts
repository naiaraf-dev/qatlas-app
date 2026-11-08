/**
 * La redacción en el proceso principal (ADR 030 a 034), con la bóveda y los servicios reales y un runner
 * de mentira. Todos los secretos son inventados.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agregarConexiones,
  agregarHallazgo,
  agregarPaginaVisitada,
  leerRedacciones,
} from '@qatlas/db';
import type { TextoRedactado } from '@qatlas/redaction';
import type { MensajeDelRunner } from '@qatlas/runner';
import { PROYECTO_POR_DEFECTO, EXCLUSIONES_POR_DEFECTO } from '@qatlas/shared';
import { ServicioBoveda } from '../boveda/servicio';
import { ServicioProyectos } from '../proyectos/servicio';
import { redactarLoGuardado } from './redaccion-guardada';
import { VERSION_REDACCION } from './redaccion';
import {
  contextoDetalle,
  contextoUrlPagina,
  ServicioEjecuciones,
  type LanzadorDeProcesos,
  type ProcesoRunner,
} from './servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const CANARIO = 'CANARIO-redaccion-4b7e1f';
const JWT = [
  Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
  Buffer.from('{"sub":"ana-prueba"}').toString('base64url'),
  'Prueba0Qatlas0Firma0Ficticia0Larga00000',
].join('.');
/** Lo que un test puede usar como texto ya redactado de antes (simula datos de semanas anteriores). */
const comoViejo = (texto: string) => texto as TextoRedactado;

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;
let ejecuciones: ServicioEjecuciones;
let emitir: ((mensaje: MensajeDelRunner) => void) | undefined;
const vivos = new Set<EventEmitter>();

const lanzador: LanzadorDeProcesos = {
  iniciarProxy: () =>
    Promise.resolve({ puerto: 49152, alCaer: () => undefined, detener: () => undefined }),
  iniciarRunner: () => {
    const eventos = new EventEmitter();
    let salio = false;
    vivos.add(eventos);
    eventos.once('salir', () => {
      salio = true;
      vivos.delete(eventos);
    });
    const proceso: ProcesoRunner = {
      enviar: (mensaje) => {
        if (mensaje.tipo === 'cancelar') eventos.emit('salir');
      },
      alMensaje: (oyente) => eventos.on('mensaje', oyente),
      alSalir: (oyente) => {
        if (salio) oyente();
        else eventos.on('salir', oyente);
      },
      detener: () => eventos.emit('salir'),
    };
    emitir = (m) => eventos.emit('mensaje', m);
    return proceso;
  },
  limpiarPerfil: () => undefined,
};

const pausa = () =>
  new Promise((listo) => {
    setTimeout(listo, 5);
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
  if (!declaracion) throw new Error('Entrada inválida');
  const res = proyectos.crear(entrada, { aceptada: true, ...declaracion });
  if (res.resultado !== 'creado') throw new Error('No se creó');
  const credencial = proyectos.guardarCredencial({
    proyectoId: res.id,
    nombre: 'Prueba',
    rol: 'admin',
    estrategia: 'formulario',
    usuario: 'ana@example.com',
    urlLogin: 'http://localhost:5173/login',
    pasosLogin: [],
    secreto: CANARIO,
    indicadorExito: { tipo: 'aparece', selector: '#panel' },
  });
  if (credencial.resultado !== 'guardada') throw new Error('No se guardó la credencial');
  return res.id;
}

async function lanzar(proyectoId: string): Promise<string> {
  const res = ejecuciones.lanzarEscaneo(proyectoId);
  if (res.resultado !== 'encolada') throw new Error(res.motivo);
  await pausa();
  return res.ejecucionId;
}

const hallazgoDeConsola = (
  detalle: string,
  url = 'http://localhost:5173/consola',
): MensajeDelRunner => ({
  tipo: 'hallazgo',
  hallazgo: {
    tipo: 'console-error',
    severidad: 'baja',
    url,
    urlOrigen: null,
    clave: 'sin-uso',
    titulo: 'console.error en la página',
    detalle,
  },
});

/** Todo lo de la base, descifrado: filas en claro y los campos cifrados de las ejecuciones. */
function todoDescifrado(proyectoId: string): string {
  return boveda.conAcceso((base) => {
    const tablas = (
      base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
    // Solo lo del proyecto: las tablas con proyecto_id, filtradas; el proyecto, por su ID.
    const filas = tablas
      .filter((t) => t !== 'credencial')
      .map((t) => {
        const columnas = (
          base.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]
        ).map((c) => c.name);
        const filtro =
          t === 'proyecto' ? 'id' : columnas.includes('proyecto_id') ? 'proyecto_id' : null;
        return JSON.stringify(
          filtro
            ? base.prepare(`SELECT * FROM "${t}" WHERE ${filtro} = ?`).all(proyectoId)
            : base.prepare(`SELECT * FROM "${t}"`).all(),
        );
      });
    const ocurrencias = base
      .prepare(
        'SELECT id, detalle_cifrado FROM hallazgo_ocurrencia WHERE detalle_cifrado IS NOT NULL AND proyecto_id = ?',
      )
      .all(proyectoId) as { id: string; detalle_cifrado: Buffer }[];
    const paginas = base
      .prepare(
        'SELECT ejecucion_id, url_completa_cifrada FROM pagina_visitada WHERE url_completa_cifrada IS NOT NULL AND proyecto_id = ?',
      )
      .all(proyectoId) as { ejecucion_id: string; url_completa_cifrada: Buffer }[];
    const descifrados = proyectos.descifrarDatos(proyectoId, [
      ...ocurrencias.map((o) => ({
        contexto: contextoDetalle(proyectoId, o.id),
        sellado: o.detalle_cifrado,
      })),
      ...paginas.map((p) => ({
        contexto: contextoUrlPagina(proyectoId, p.ejecucion_id),
        sellado: p.url_completa_cifrada,
      })),
    ]);
    return [...filas, ...descifrados].join('\n');
  });
}

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-redaccion-'));
  boveda = new ServicioBoveda({
    carpeta,
    antesDeBloquear: (base) => {
      ejecuciones.alBloquearse(base);
    },
  });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
  ejecuciones = new ServicioEjecuciones(boveda, proyectos, lanzador);
});

afterEach(async () => {
  boveda.bloquear();
  for (const eventos of [...vivos]) eventos.emit('salir');
  await pausa();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Lo que llega del runner se redacta antes de guardarse (ADR 032)', () => {
  it('el secreto de la credencial y un JWT, en cada campo; el aviso y el registro sin el valor', async () => {
    const proyecto = crearProyecto();
    const id = await lanzar(proyecto);
    emitir?.({
      tipo: 'pagina',
      url: `http://localhost:5173/entrar?token=x&ref=${CANARIO}`,
      status: 200,
      tiempoCargaMs: 10,
      profundidad: 0,
    });
    emitir?.({
      tipo: 'hallazgo',
      hallazgo: {
        tipo: 'recurso-con-error',
        severidad: 'media',
        url: `http://localhost:5173/s/${CANARIO}/ver`,
        urlOrigen: `http://localhost:5173/?k=${CANARIO}`,
        clave: `404 /s/${CANARIO}/ver`,
        titulo: `Recurso con error ${CANARIO}`,
        detalle: `GET falló con Authorization: Bearer ${JWT}`,
      },
    });
    emitir?.({
      tipo: 'conexion',
      proceso: 'navegador',
      destino: `${CANARIO}.example.test:443`,
      permitida: false,
      regla: 'fuera-de-dominio',
    });
    emitir?.(hallazgoDeConsola(`login falló para ${CANARIO} con ${JWT}`));
    await pausa();

    const todo = todoDescifrado(proyecto);
    expect(todo).not.toContain(CANARIO);
    expect(todo).not.toContain(JWT);
    expect(todo).toContain('[REDACTADO:credencial]');
    expect(todo).toContain('[REDACTADO:jwt]');

    const detalle = ejecuciones.detalle(id);
    const [recurso, consola] = detalle?.hallazgos ?? [];
    expect(recurso?.secretosRedactados).toBe(5);
    expect(consola).toMatchObject({
      detalle: 'login falló para [REDACTADO:credencial] con [REDACTADO:jwt]',
      secretosRedactados: 2,
    });
    expect(detalle?.paginas[0]?.url).toBe('http://localhost:5173/entrar');
    // La exportación (semana 9) pedirá revisarlos (RN-REP-03).
    boveda.conAcceso((base) => {
      expect(
        base
          .prepare('SELECT revision_pendiente AS r FROM hallazgo_ocurrencia ORDER BY rowid')
          .all(),
      ).toEqual([{ r: 1 }, { r: 1 }]);
    });
    // El registro dice dónde y por qué regla, nunca el valor.
    const registro = boveda.conAcceso((base) => leerRedacciones(base, proyecto));
    expect(JSON.stringify(registro)).not.toContain(CANARIO);
    expect(registro.map((r) => `${r.origen}:${r.regla}`)).toEqual(
      expect.arrayContaining([
        'pagina.url:secreto-de-credencial',
        'hallazgo.detalle:jwt',
        'hallazgo.detalle:secreto-de-credencial',
        'hallazgo.clave:secreto-de-credencial',
      ]),
    );
  });

  it('la clave de un mensaje es un HMAC del texto redactado, propio de cada proyecto', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    const claves = async (proyecto: string) => {
      const id = await lanzar(proyecto);
      emitir?.(hallazgoDeConsola('TypeError: x es 3'));
      emitir?.(hallazgoDeConsola('TypeError: x es 4'));
      emitir?.(hallazgoDeConsola('Otro error'));
      await pausa();
      emitir?.({
        tipo: 'escaneo-terminado',
        paginasVisitadas: 1,
        linksExcluidos: 0,
        detenido: null,
        noRecorridosSoloLectura: 0,
        noRecorridosExclusiones: 0,
        urlsDescartadas: 0,
        websocketDescartados: 0,
      });
      await pausa();
      return boveda.conAcceso((base) =>
        (
          base
            .prepare('SELECT clave FROM hallazgo WHERE ejecucion_id = ? ORDER BY rowid')
            .all(id) as {
            clave: string;
          }[]
        ).map((f) => f.clave),
      );
    };
    const deA = await claves(a);
    const deB = await claves(b);
    expect(deA[0]).toMatch(/^msj:[0-9a-f]{32}$/);
    // El mismo problema da la misma clave; uno distinto, otra.
    expect(deA[0]).toBe(deA[1]);
    expect(deA[2]).not.toBe(deA[0]);
    // En otro proyecto, otra clave: sin la clave del proyecto no se puede probar candidatos.
    expect(deB[0]).not.toBe(deA[0]);
  });

  it('un secreto partido en dos mensajes consecutivos se redacta en los dos', async () => {
    const proyecto = crearProyecto();
    const id = await lanzar(proyecto);
    emitir?.(hallazgoDeConsola(`la clave empieza con ${CANARIO.slice(0, 11)}`));
    emitir?.(hallazgoDeConsola(`${CANARIO.slice(11)} y termina acá`));
    await pausa();
    const hallazgos = ejecuciones.detalle(id)?.hallazgos ?? [];
    expect(hallazgos.map((h) => [h.detalle, h.secretosRedactados])).toEqual([
      ['la clave empieza con [REDACTADO:credencial]', 1],
      ['[REDACTADO:credencial] y termina acá', 1],
    ]);
    expect(todoDescifrado(proyecto)).not.toContain(CANARIO.slice(0, 11));
  });
});

describe('Lo guardado antes de la semana 7 se redacta al abrir la base (ADR 033)', () => {
  /** Datos como los de antes: sin redactar, con la clave vieja (SHA-256 sin clave). */
  async function datosViejos(proyectoId: string): Promise<void> {
    // Una ejecución real, terminada; sus datos se escriben como antes de la semana 7.
    const ejecucionId = await lanzar(proyectoId);
    emitir?.({
      tipo: 'escaneo-terminado',
      paginasVisitadas: 0,
      linksExcluidos: 0,
      detenido: null,
      noRecorridosSoloLectura: 0,
      noRecorridosExclusiones: 0,
      urlsDescartadas: 0,
      websocketDescartados: 0,
    });
    await pausa();
    boveda.conAcceso((base) => {
      const completa = proyectos.cifrarDato(
        proyectoId,
        contextoUrlPagina(proyectoId, ejecucionId),
        `http://localhost:5173/p?token=${CANARIO}`,
      );
      agregarPaginaVisitada(base, {
        proyectoId,
        ejecucionId,
        url: comoViejo(`http://localhost:5173/p/${CANARIO}`),
        urlCompletaCifrada: completa,
        statusHttp: 200,
        tiempoCargaMs: 1,
        profundidad: 0,
      });
      const ocurrenciaId = crypto.randomUUID();
      agregarHallazgo(
        base,
        {
          proyectoId,
          ejecucionId,
          tipo: 'console-error',
          severidad: 'baja',
          titulo: comoViejo('console.error en la página'),
          descripcion: comoViejo('console.error en la página'),
          url: comoViejo(`http://localhost:5173/c?ref=${CANARIO}`),
          clave: comoViejo('msj:0123456789abcdef'),
        },
        {
          id: ocurrenciaId,
          urlOrigen: null,
          detalleCifrado: proyectos.cifrarDato(
            proyectoId,
            contextoDetalle(proyectoId, ocurrenciaId),
            `falló con ${CANARIO} y ${JWT}`,
          ),
          secretosRedactados: 0,
        },
      );
      agregarConexiones(base, [
        {
          proyectoId,
          ejecucionId,
          fecha: new Date().toISOString(),
          proceso: 'navegador',
          destino: comoViejo(`${CANARIO}.example.test:443`),
          permitida: false,
          regla: 'fuera-de-dominio',
        },
      ]);
      base.prepare('UPDATE proyecto SET redaccion_version = 0 WHERE id = ?').run(proyectoId);
    });
  }

  const conMaestra = <T>(
    fn: (base: Parameters<Parameters<ServicioBoveda['conAcceso']>[0]>[0], maestra: Buffer) => T,
  ) => boveda.conAcceso(fn);

  it('redacta todo, recalcula las claves como HMAC y marca el proyecto', async () => {
    const proyecto = crearProyecto();
    await datosViejos(proyecto);
    expect(todoDescifrado(proyecto)).toContain(CANARIO);

    expect(conMaestra((base, maestra) => redactarLoGuardado(base, maestra))).toEqual({
      proyectos: 1,
      fallidos: 0,
    });
    const todo = todoDescifrado(proyecto);
    expect(todo).not.toContain(CANARIO);
    expect(todo).not.toContain(JWT);
    expect(todo).not.toContain('msj:0123456789abcdef');
    boveda.conAcceso((base) => {
      expect(base.prepare('SELECT clave FROM hallazgo').get()).toEqual({
        clave: expect.stringMatching(/^msj:[0-9a-f]{32}$/) as string,
      });
      expect(
        base
          .prepare(
            'SELECT secretos_redactados AS s, revision_pendiente AS r FROM hallazgo_ocurrencia',
          )
          .get(),
      ).toEqual({ s: 3, r: 1 });
      expect(base.prepare('SELECT redaccion_version AS v FROM proyecto').get()).toEqual({
        v: VERSION_REDACCION,
      });
    });
    expect(
      JSON.stringify(boveda.conAcceso((base) => leerRedacciones(base, proyecto))),
    ).not.toContain(CANARIO);

    // Idempotente: otra pasada no encuentra nada que hacer.
    const antes = todoDescifrado(proyecto);
    boveda.conAcceso((base) => {
      base.prepare('UPDATE proyecto SET redaccion_version = 0').run();
    });
    conMaestra((base, maestra) => redactarLoGuardado(base, maestra));
    // Lo descifrado es igual; cambian solo las marcas de tiempo y los bytes cifrados (nonce nuevo).
    const comparable = (texto: string) =>
      texto
        .replace(/"(?:created_at|updated_at)":"[^"]+"/g, '')
        .replace(/\{"type":"Buffer","data":\[[^\]]*\]\}/g, '<cifrado>');
    expect(comparable(todoDescifrado(proyecto))).toBe(comparable(antes));
  });

  it('si se corta a mitad de camino, lo hecho queda, lo cortado no se toca, y el próximo desbloqueo termina', async () => {
    const a = crearProyecto('A');
    const b = crearProyecto('B');
    await datosViejos(a);
    await datosViejos(b);
    const resultado = conMaestra((base, maestra) =>
      redactarLoGuardado(base, maestra, {
        antesDeCadaProyecto: (id) => {
          if (id === b) throw new Error('corte simulado');
        },
      }),
    );
    expect(resultado).toEqual({ proyectos: 1, fallidos: 1 });
    expect(todoDescifrado(a)).not.toContain(CANARIO);
    // B quedó exactamente como estaba: la transacción se revirtió.
    expect(todoDescifrado(b)).toContain(CANARIO);
    boveda.conAcceso((base) => {
      expect(
        base.prepare('SELECT id, redaccion_version AS v FROM proyecto ORDER BY nombre').all(),
      ).toEqual([
        { id: a, v: VERSION_REDACCION },
        { id: b, v: 0 },
      ]);
    });

    // El próximo desbloqueo, con el enganche de la app, termina el trabajo.
    boveda.bloquear();
    const otra = new ServicioBoveda({
      carpeta,
      alAbrir: (base, maestra) => {
        redactarLoGuardado(base, maestra);
      },
    });
    await otra.desbloquear(CONTRASENA);
    boveda = otra;
    proyectos = new ServicioProyectos(otra);
    expect(todoDescifrado(b)).not.toContain(CANARIO);
  });
});
