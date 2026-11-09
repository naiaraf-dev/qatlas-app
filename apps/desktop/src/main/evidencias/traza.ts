import type { EventoTraza } from '@qatlas/runner';
import {
  contarRedacciones,
  type OpcionesRedaccion,
  type RegistroRedaccion,
  type TextoRedactado,
} from '@qatlas/redaction';
import type { Redactor } from '../ejecuciones/redaccion';

/**
 * La traza de QAtlas (ADR 037): eventos del escaneo en líneas JSON, cada campo con texto del sitio
 * redactado en el proceso principal antes de cifrarse. No es el formato de Playwright, cuya traza escribe
 * en disco en claro mientras graba. No lleva imágenes ni cuerpos de respuestas: las capturas y el video
 * se enlazan por su ID, y los snapshots del DOM son evidencias aparte.
 *
 * El HAR (EVI-03) sale de los mismos eventos de red: sin cuerpos de respuesta.
 *
 * Sin Electron, para probarlo con Vitest.
 */

export const VERSION_TRAZA = 1;
export const CABECERA_TRAZA = { formato: 'qatlas-traza', version: VERSION_TRAZA } as const;

export interface Redacciones {
  origen: string;
  registros: RegistroRedaccion[];
}

export interface LineaRedactada {
  linea: Record<string, unknown>;
  redacciones: Redacciones[];
  secretos: number;
}

type EventoRed = Extract<EventoTraza, { clase: 'red' }>;

export interface RedRedactada {
  t: number;
  tramo: number | null;
  metodo: string;
  url: TextoRedactado;
  tipoRecurso: string;
  estado: number | null;
  encabezadosSolicitud: { nombre: string; valor: TextoRedactado }[];
  encabezadosRespuesta: { nombre: string; valor: TextoRedactado }[];
  cuerpoSolicitud: TextoRedactado | null;
  tipoContenidoSolicitud: string | null;
  error: string | null;
  duracionMs: number | null;
}

/** Los nombres de encabezados y los métodos no se redactan, pero sí se limitan a caracteres de token. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,200}$/;
const comoToken = (texto: string): string => (TOKEN.test(texto) ? texto : '[no-token]');

export function redactarRed(
  evento: EventoRed,
  redactor: Redactor,
  opciones: OpcionesRedaccion,
): { red: RedRedactada; redacciones: Redacciones[] } {
  const url = redactor.url(evento.url, opciones);
  const salida = redactor.encabezados(evento.encabezadosSolicitud, opciones);
  const entrada = redactor.encabezados(evento.encabezadosRespuesta, opciones);
  const cuerpo =
    evento.cuerpoSolicitud === null
      ? null
      : redactor.cuerpo(evento.cuerpoSolicitud, evento.tipoContenidoSolicitud, opciones);
  const tipoContenido =
    evento.tipoContenidoSolicitud === null
      ? null
      : redactor.texto(evento.tipoContenidoSolicitud, opciones);
  const error = evento.error === null ? null : redactor.texto(evento.error, opciones);
  return {
    red: {
      t: evento.t,
      tramo: evento.tramo,
      metodo: comoToken(evento.metodo),
      url: url.texto,
      tipoRecurso: comoToken(evento.tipoRecurso),
      estado: evento.estado,
      encabezadosSolicitud: salida.encabezados.map((e) => ({ ...e, nombre: comoToken(e.nombre) })),
      encabezadosRespuesta: entrada.encabezados.map((e) => ({ ...e, nombre: comoToken(e.nombre) })),
      cuerpoSolicitud: cuerpo?.texto ?? null,
      tipoContenidoSolicitud: tipoContenido?.texto ?? null,
      error: error?.texto ?? null,
      duracionMs: evento.duracionMs,
    },
    redacciones: [
      { origen: 'red.url', registros: url.registros },
      { origen: 'red.encabezados', registros: [...salida.registros, ...entrada.registros] },
      { origen: 'red.cuerpo', registros: cuerpo?.registros ?? [] },
      {
        origen: 'red.otros',
        registros: [...(tipoContenido?.registros ?? []), ...(error?.registros ?? [])],
      },
    ].filter((r) => r.registros.length > 0),
  };
}

const sumar = (redacciones: readonly Redacciones[]): number =>
  redacciones.reduce((total, r) => total + contarRedacciones(r.registros), 0);

/**
 * Un evento de la traza, redactado. El snapshot no pasa por acá: va a su propia evidencia, y en la traza
 * queda solo su ID (`lineaDeSnapshot`).
 */
export function redactarEvento(
  evento: Exclude<EventoTraza, { clase: 'snapshot' }>,
  redactor: Redactor,
  opciones: OpcionesRedaccion,
): LineaRedactada & { red?: RedRedactada } {
  switch (evento.clase) {
    case 'navegacion': {
      const url = redactor.url(evento.url, opciones);
      const redacciones = [{ origen: 'traza.navegacion', registros: url.registros }];
      return {
        linea: { clase: evento.clase, t: evento.t, tramo: evento.tramo, url: url.texto },
        redacciones,
        secretos: sumar(redacciones),
      };
    }
    case 'accion': {
      const objetivo = redactor.texto(evento.objetivo, opciones);
      const redacciones = [{ origen: 'traza.accion', registros: objetivo.registros }];
      return {
        linea: {
          clase: evento.clase,
          t: evento.t,
          tramo: evento.tramo,
          accion: evento.accion,
          objetivo: objetivo.texto,
        },
        redacciones,
        secretos: sumar(redacciones),
      };
    }
    case 'consola':
    case 'excepcion': {
      const texto = redactor.texto(evento.texto, opciones);
      const redacciones = [{ origen: `traza.${evento.clase}`, registros: texto.registros }];
      return {
        linea: {
          clase: evento.clase,
          t: evento.t,
          tramo: evento.tramo,
          ...(evento.clase === 'consola' ? { nivel: comoToken(evento.nivel) } : {}),
          texto: texto.texto,
        },
        redacciones,
        secretos: sumar(redacciones),
      };
    }
    case 'red': {
      const { red, redacciones } = redactarRed(evento, redactor, opciones);
      return {
        linea: { clase: 'red', ...red },
        redacciones,
        secretos: sumar(redacciones),
        red,
      };
    }
  }
}

export const lineaDeSnapshot = (t: number, tramo: number, evidenciaId: string) => ({
  clase: 'snapshot',
  t,
  tramo,
  evidenciaId,
});

/** El comienzo y el final del HAR: las entradas van en el medio, separadas por comas. */
export const INICIO_HAR =
  '{"log":{"version":"1.2","creator":{"name":"QAtlas","version":"1"},"comment":"Sin cuerpos de respuesta (EVI-03). Texto redactado.","entries":[';
export const FIN_HAR = ']}}';

/** Una entrada del HAR 1.2 desde un evento de red ya redactado. */
export function entradaHar(red: RedRedactada, inicioEjecucion: number): Record<string, unknown> {
  const tiempo = red.duracionMs ?? 0;
  const tipo = red.encabezadosRespuesta.find((e) => e.nombre.toLowerCase() === 'content-type');
  return {
    startedDateTime: new Date(inicioEjecucion + red.t).toISOString(),
    time: tiempo,
    request: {
      method: red.metodo,
      url: red.url,
      httpVersion: '',
      cookies: [],
      headers: red.encabezadosSolicitud.map(({ nombre, valor }) => ({
        name: nombre,
        value: valor,
      })),
      queryString: [],
      headersSize: -1,
      bodySize: red.cuerpoSolicitud === null ? 0 : -1,
      ...(red.cuerpoSolicitud === null
        ? {}
        : {
            postData: {
              mimeType: red.tipoContenidoSolicitud ?? '',
              text: red.cuerpoSolicitud,
            },
          }),
    },
    response: {
      status: red.estado ?? 0,
      statusText: '',
      httpVersion: '',
      cookies: [],
      headers: red.encabezadosRespuesta.map(({ nombre, valor }) => ({
        name: nombre,
        value: valor,
      })),
      content: {
        size: -1,
        mimeType: tipo?.valor ?? '',
        comment: 'Cuerpo no guardado (EVI-03).',
      },
      redirectURL: '',
      headersSize: -1,
      bodySize: -1,
      ...(red.error === null ? {} : { _error: red.error }),
    },
    cache: {},
    timings: { send: 0, wait: tiempo, receive: 0 },
  };
}
