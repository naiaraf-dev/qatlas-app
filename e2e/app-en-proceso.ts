/**
 * La app sin Electron, en el proceso del test: los servicios reales (bóveda, proyectos, ejecuciones y
 * evidencias), el proxy real y el runner real (`crearRunner`), como en `ts-06-login-asistido.e2e.ts`. Así
 * un E2E maneja la ventana del login asistido y lee lo que la app guardó. La app no tiene ningún
 * comportamiento especial para tests.
 *
 * Lo usan TS-01 y los E2E de evidencias (semana 7b).
 */
import { EventEmitter } from 'node:events';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { expect } from '@playwright/test';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import type { MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
import {
  HOST_SITIO,
  MAPA_DE_HOSTS,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type {
  LanzadorDeProcesos,
  ProcesoRunner,
  ServicioEjecuciones,
} from '../apps/desktop/src/main/ejecuciones/servicio';
import type { Redactor } from '../apps/desktop/src/main/ejecuciones/redaccion';
import { abrirNavegadorVisible, type NavegadorVisible } from '../packages/runner/src/motor/motor';
import { crearRunner } from '../packages/runner/src/motor/runner';
import { iniciarProxy } from '../packages/runner/src/red/proxy';
import { restaurarEntorno } from './entorno';

export const CONTRASENA_BOVEDA = 'tigre-morado-bajo-la-lluvia-73';

/** Un valor en las formas en que suele quedar escrito. */
export function codificaciones(valor: string): { nombre: string; bytes: Buffer }[] {
  const utf8 = Buffer.from(valor, 'utf8');
  const textos: [string, string][] = [
    ['tal cual', valor],
    ['base64', utf8.toString('base64')],
    ['base64 sin relleno', utf8.toString('base64').replace(/=+$/, '')],
    ['base64url', utf8.toString('base64url')],
    ['codificado para URL', encodeURIComponent(valor)],
    ['hex', utf8.toString('hex')],
    ['HEX', utf8.toString('hex').toUpperCase()],
  ];
  return [
    ...textos.map(([nombre, texto]) => ({ nombre, bytes: Buffer.from(texto, 'utf8') })),
    { nombre: 'UTF-16', bytes: Buffer.from(valor, 'utf16le') },
  ];
}

/** Dónde aparece un valor en un texto: el nombre de cada codificación encontrada. */
export const enTexto = (texto: string, valor: string): string[] =>
  codificaciones(valor)
    .filter(({ bytes }) => Buffer.from(texto, 'utf8').includes(bytes))
    .map(({ nombre }) => nombre);

/** Cada archivo debajo de una carpeta con el valor en alguna codificación: «ruta (codificación)». */
export function archivosCon(carpeta: string, valor: string): string[] {
  const agujas = codificaciones(valor);
  const encontrados: string[] = [];
  const recorrer = (actual: string) => {
    let nombres: string[];
    try {
      nombres = readdirSync(actual);
    } catch {
      return;
    }
    for (const nombre of nombres) {
      const ruta = path.join(actual, nombre);
      try {
        if (statSync(ruta).isDirectory()) {
          recorrer(ruta);
          continue;
        }
        const datos = readFileSync(ruta);
        for (const { nombre: codificacion, bytes } of agujas) {
          if (datos.includes(bytes))
            encontrados.push(`${path.relative(carpeta, ruta)} (${codificacion})`);
        }
      } catch {
        // Un archivo que se borró mientras se leía.
      }
    }
  };
  recorrer(carpeta);
  return encontrados;
}

// El driver de Drizzle importa 'better-sqlite3' y QAtlas usa la variante con SQLCipher.
registerHooks({
  resolve: (especificador, contexto, siguiente) =>
    siguiente(
      especificador === 'better-sqlite3' ? 'better-sqlite3-multiple-ciphers' : especificador,
      contexto,
    ),
});
export const servicios = async () => ({
  ...(await import('../apps/desktop/src/main/boveda/servicio')),
  ...(await import('../apps/desktop/src/main/proyectos/servicio')),
  ...(await import('../apps/desktop/src/main/ejecuciones/servicio')),
  ...(await import('../apps/desktop/src/main/ejecuciones/redaccion-guardada')),
  ...(await import('../apps/desktop/src/main/evidencias/servicio')),
  ...(await import('../apps/desktop/src/main/registro')),
});

const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

export const PASOS = [
  { accion: 'rellenar' as const, selector: '#usuario', origen: 'usuario' as const },
  { accion: 'rellenar' as const, selector: '#clave', origen: 'secreto' as const },
  { accion: 'click' as const, selector: 'button[type=submit]' },
];
export const INDICADOR = { tipo: 'aparece' as const, selector: '#menu-usuario' };

export interface OpcionesProyecto {
  selectoresSensibles?: string[];
  modoDatosSensibles?: boolean;
  maxPaginas?: number;
  maxProfundidad?: number;
}

/**
 * Todo lo necesario para correr la app sin Electron en una carpeta del test. `redactor` solo lo cambia el
 * control positivo de TS-01.
 */
export async function armar(raiz: string, sitio: SandboxActivo, redactor?: Redactor) {
  const s = await servicios();
  const datos = path.join(raiz, 'datos');
  const temporal = path.join(raiz, 'tmp');
  mkdirSync(temporal, { recursive: true });
  s.iniciarRegistro({ carpeta: path.join(datos, 'logs') });

  let visible: NavegadorVisible | undefined;
  const runnersVivos = new Set<{ terminado: boolean }>();
  const actuales: { evidencias?: InstanceType<typeof s.ServicioEvidencias> } = {};
  const boveda = new s.ServicioBoveda({
    carpeta: datos,
    alAbrir: (base, maestra) => {
      s.redactarLoGuardado(base, maestra);
      actuales.evidencias?.alAbrir(base);
    },
    antesDeBloquear: (base) => {
      // Se crea más abajo; este callback corre recién al bloquear.
      ejecuciones.alBloquearse(base);
    },
    alBloquear: () => {
      actuales.evidencias?.alBloquear();
    },
  });
  await boveda.crear(CONTRASENA_BOVEDA, false);
  const proyectos = new s.ServicioProyectos(boveda, (id) => {
    ejecuciones.descartarSesiones(id);
  });
  const evidencias = new s.ServicioEvidencias(boveda, proyectos, datos, redactor);
  actuales.evidencias = evidencias;
  const lanzador: LanzadorDeProcesos = {
    iniciarProxy: async (datosProxy, alRegistrar) => {
      const proxy = await iniciarProxy({ ...datosProxy, alRegistrar, resolver });
      return {
        puerto: proxy.puerto,
        alCaer: () => undefined,
        detener: () => {
          void proxy.cerrar();
        },
      };
    },
    iniciarRunner: () => {
      const eventos = new EventEmitter();
      const estado = { terminado: false };
      runnersVivos.add(estado);
      const runner = crearRunner({
        enviar: (mensaje: MensajeDelRunner) => {
          // `postMessage` clona: lo que llega al otro lado es una copia.
          eventos.emit('mensaje', structuredClone(mensaje));
        },
        alTerminar: () => {
          estado.terminado = true;
          eventos.emit('salir');
        },
        carpetaPerfil: temporal,
        abrirVisible: async (proxy) => {
          visible = await abrirNavegadorVisible(proxy, temporal);
          return visible;
        },
      });
      const proceso: ProcesoRunner = {
        enviar: (mensaje: MensajeAlRunner) => {
          runner.recibir(structuredClone(mensaje));
        },
        alMensaje: (oyente) => eventos.on('mensaje', oyente),
        alSalir: (oyente) => {
          if (estado.terminado) oyente();
          else eventos.on('salir', oyente);
        },
        detener: () => {
          eventos.emit('salir');
        },
      };
      return proceso;
    },
    limpiarPerfil: () => undefined,
  };
  const ejecuciones: ServicioEjecuciones = new s.ServicioEjecuciones(
    boveda,
    proyectos,
    lanzador,
    undefined,
    undefined,
    redactor,
    evidencias,
  );

  const origen = `http://${HOST_SITIO}:${sitio.puerto}`;
  const crearProyecto = (
    nombre: string,
    inicio: string,
    dominiosAutenticacion: string[],
    opciones: OpcionesProyecto = {},
  ) => {
    const entrada = {
      ...PROYECTO_POR_DEFECTO,
      nombre,
      descripcion: '',
      urlBase: `${origen}${inicio}`,
      dominios: [HOST_SITIO],
      puertosLocales: [],
      exclusiones: [...EXCLUSIONES_POR_DEFECTO],
      selectoresSensibles: opciones.selectoresSensibles ?? [],
      modoDatosSensibles: opciones.modoDatosSensibles ?? false,
      dominiosAutenticacion,
      permitirLoginHttp: true,
      maxRps: 20,
      maxPaginas: opciones.maxPaginas ?? 30,
      maxProfundidad: opciones.maxProfundidad ?? 3,
    };
    const { declaracion } = proyectos.validar(entrada);
    if (!declaracion) throw new Error(`El proyecto ${nombre} no es válido`);
    const creado = proyectos.crear(entrada, { aceptada: true, ...declaracion });
    if (creado.resultado !== 'creado') throw new Error(JSON.stringify(creado));
    return creado.id;
  };
  const credencial = (
    proyectoId: string,
    rol: string,
    estrategia: 'formulario' | 'sso' | 'token-url' | 'asistido',
    urlLogin: string,
    secreto?: string,
  ) => {
    const res = proyectos.guardarCredencial({
      proyectoId,
      nombre: rol,
      rol,
      estrategia,
      usuario:
        estrategia === 'formulario' || estrategia === 'sso' ? USUARIOS_APP.admin.usuario : '',
      urlLogin,
      pasosLogin: estrategia === 'formulario' || estrategia === 'sso' ? PASOS : [],
      indicadorExito: INDICADOR,
      ...(secreto === undefined ? {} : { secreto }),
    });
    if (res.resultado !== 'guardada') throw new Error(JSON.stringify(res));
    return res.credencialId;
  };
  /** Lanza y espera a que la ejecución figure terminada (con su perfil ya borrado). */
  const escanear = async (proyectoId: string, credencialId: string | null) => {
    const lanzada = ejecuciones.lanzarEscaneo(proyectoId, credencialId);
    if (lanzada.resultado !== 'encolada') throw new Error(JSON.stringify(lanzada));
    const id = lanzada.ejecucionId;
    await expect
      .poll(() => ejecuciones.listar(proyectoId).find((e) => e.id === id)?.estado, {
        timeout: 240_000,
      })
      .toBe('finalizada');
    return id;
  };
  /** Lo que la interfaz recibiría de cada evidencia de una ejecución: imágenes, fotogramas y textos. */
  const evidenciasDe = async (ejecucionId: string) => {
    const lista = evidencias.listar(ejecucionId);
    const capturas: Buffer[] = [];
    const fotogramas: Buffer[] = [];
    const textos: { tipo: string; texto: string }[] = [];
    for (const evidencia of lista) {
      const vista = await evidencias.vista(evidencia.id);
      if (!vista) throw new Error(`No se pudo abrir la evidencia ${evidencia.tipo}`);
      if (vista.tipo === 'imagen') capturas.push(Buffer.from(vista.datos));
      else if (vista.tipo === 'texto') textos.push({ tipo: evidencia.tipo, texto: vista.texto });
      else {
        for (let i = 0; i < vista.tiempos.length; i++) {
          const fotograma = await evidencias.fotograma(evidencia.id, i);
          if (!fotograma) throw new Error('Fotograma ilegible');
          fotogramas.push(Buffer.from(fotograma.datos));
        }
      }
    }
    return { lista, capturas, fotogramas, textos };
  };
  return {
    s,
    boveda,
    proyectos,
    ejecuciones,
    evidencias,
    origen,
    datos,
    temporal,
    crearProyecto,
    credencial,
    escanear,
    evidenciasDe,
    ventana: () => visible,
    runnersTerminados: () => [...runnersVivos].every((r) => r.terminado),
  };
}

export type AppEnProceso = Awaited<ReturnType<typeof armar>>;

/** Captura la consola mientras corre `cuerpo`: los logs del proceso también se revisan. */
export async function conConsolaCapturada<T>(cuerpo: (logs: string[]) => Promise<T>): Promise<T> {
  const logs: string[] = [];
  const originales = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  for (const nivel of ['log', 'warn', 'error', 'info'] as const) {
    console[nivel] = (...partes: unknown[]) => {
      logs.push(partes.map(String).join(' '));
    };
  }
  try {
    return await cuerpo(logs);
  } finally {
    Object.assign(console, originales);
  }
}

/** El TEMP del proceso va a la carpeta del test, como en la app va a la de la ejecución. */
export async function conTemporal<T>(temporal: string, cuerpo: () => Promise<T>): Promise<T> {
  const antes = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  mkdirSync(temporal, { recursive: true });
  process.env.TEMP = temporal;
  process.env.TMP = temporal;
  process.env.TMPDIR = temporal;
  try {
    return await cuerpo();
  } finally {
    restaurarEntorno(antes);
  }
}
