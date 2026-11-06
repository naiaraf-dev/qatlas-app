import { tmpdir } from 'node:os';
import type { Browser } from 'playwright-core';
import { MensajeAlRunner, type MensajeDelRunner } from '../protocolo';
import { instalarAgente } from '../red/agente';
import { causaDeFalla, detalleDeFalla, perfilDemasiadoLargo } from './diagnostico';
import { rastrear, type OpcionesRastreo } from './crawler';
import { GestorDeSesion, type DatosDeLogin } from './gestor-sesion';
import { abrirContexto, abrirNavegador, abrirNavegadorVisible } from './motor';
import { EXCLUSIONES_DE_CIERRE, iniciarSesion, type ResultadoLogin } from './sesion';

/**
 * Punto de entrada del runner: un `utilityProcess` por ejecución (ADR 017). Recibe solo la
 * configuración y, para un login, el secreto. No conoce la bóveda ni las claves. Al terminar, el
 * proceso se va, y con él lo que quedó en su memoria.
 */

interface PuertoPadre {
  postMessage(mensaje: unknown): void;
  on(evento: 'message', oyente: (evento: { data: unknown }) => void): void;
}

const puerto = (process as unknown as { parentPort: PuertoPadre }).parentPort;
const enviar = (mensaje: MensajeDelRunner): void => {
  puerto.postMessage(mensaje);
};

// Lista vacía: el runner no necesita red propia. Playwright habla con Chromium por un pipe.
instalarAgente(new Set(), ({ destino, regla }) => {
  enviar({ tipo: 'conexion', proceso: 'runner', destino, permitida: false, regla });
});

let navegador: Browser | undefined;
/** Quien espera la respuesta a un `necesita-login`. Hay uno a la vez. */
let esperaDeLogin: ((datos: DatosDeLogin | null) => void) | null = null;

async function terminar(codigo: number): Promise<void> {
  esperaDeLogin?.(null);
  await navegador?.close().catch(() => undefined);
  process.exit(codigo);
}

function pedirLogin(
  motivo: 'inicial' | 'planificada' | 'vencida',
  reintento: boolean,
): Promise<DatosDeLogin | null> {
  return new Promise((resolver) => {
    esperaDeLogin = resolver;
    enviar({ tipo: 'necesita-login', motivo, reintento });
  });
}

function informarSesion(resultado: ResultadoLogin): void {
  if (resultado.resultado === 'ok') {
    enviar({
      tipo: 'sesion',
      resultado: 'ok',
      estado: resultado.estado,
      urlComprobacion: resultado.urlComprobacion,
    });
  } else {
    enviar({ tipo: 'sesion', resultado: resultado.resultado });
  }
}

const alRegistrar = ({
  destino,
  permitida,
  regla,
}: {
  destino: string;
  permitida: boolean;
  regla: string;
}): void => {
  enviar({ tipo: 'conexion', proceso: 'navegador', destino, permitida, regla });
};

type Trabajo = Extract<MensajeAlRunner, { tipo: 'escaneo' | 'probar-login' }>;

async function ejecutar(mensaje: Trabajo): Promise<void> {
  const { configuracion } = mensaje;
  const borrarSecreto = () => {
    if (mensaje.tipo === 'probar-login') mensaje.secreto?.fill(0);
  };
  if (perfilDemasiadoLargo(tmpdir(), process.platform)) {
    borrarSecreto();
    enviar({ tipo: 'navegador-no-disponible', causa: 'perfil-ruta-larga', detalle: '' });
    return;
  }
  try {
    navegador = await abrirNavegador(configuracion);
  } catch (error) {
    borrarSecreto();
    const texto = error instanceof Error ? error.message : '';
    enviar({
      tipo: 'navegador-no-disponible',
      causa: causaDeFalla(texto),
      detalle: detalleDeFalla(texto),
    });
    return;
  }

  if (mensaje.tipo === 'probar-login') {
    // El proxy del navegador es el de login; el estado se filtra al alcance del escaneo.
    const resultado = await iniciarSesion(navegador, {
      datos: mensaje.autenticacion,
      proxy: configuracion.proxy,
      politica: configuracion.politica,
      secreto: mensaje.secreto,
      timeoutMs: configuracion.timeoutPaginaMs,
      alRegistrar,
      abrirVisible: abrirNavegadorVisible,
      politicaDelEscaneo: mensaje.politicaDelEscaneo,
      origenBase: new URL(mensaje.politicaDelEscaneo.urlBase).origin,
    });
    informarSesion(resultado);
    enviar({
      tipo: 'login-terminado',
      resultado: resultado.resultado === 'ok' ? 'funciono' : resultado.resultado,
    });
    return;
  }

  const opciones: OpcionesRastreo = {
    urlBase: configuracion.politica.urlBase,
    politica: configuracion.politica,
    maxPaginas: mensaje.maxPaginas,
    maxProfundidad: mensaje.maxProfundidad,
    maxMinutos: mensaje.maxMinutos,
    maxRps: mensaje.maxRps,
    // Con sesión, nunca se toca un «cerrar sesión» (ADR 027).
    exclusiones: mensaje.autenticacion
      ? [...mensaje.exclusiones, ...EXCLUSIONES_DE_CIERRE]
      : mensaje.exclusiones,
    timeoutPaginaMs: configuracion.timeoutPaginaMs,
    soloLectura: mensaje.soloLectura,
  };
  const eventos = {
    alPagina: (pagina: {
      url: string;
      status: number | null;
      tiempoCargaMs: number | null;
      profundidad: number;
    }) => {
      enviar({
        tipo: 'pagina',
        url: pagina.url,
        status: pagina.status,
        tiempoCargaMs: pagina.tiempoCargaMs === null ? null : Math.round(pagina.tiempoCargaMs),
        profundidad: pagina.profundidad,
      });
    },
    alHallazgo: (hallazgo: Extract<MensajeDelRunner, { tipo: 'hallazgo' }>['hallazgo']) => {
      enviar({ tipo: 'hallazgo', hallazgo });
    },
  };

  if (!mensaje.autenticacion) {
    const { contexto, vigilancia } = await abrirContexto(navegador, configuracion.politica, {
      soloLectura: mensaje.soloLectura,
      alRegistrar,
    });
    const resultado = await rastrear(contexto, vigilancia, opciones, eventos);
    enviar({
      tipo: 'escaneo-terminado',
      ...resultado,
      websocketDescartados: vigilancia.websocketDescartados(),
    });
    return;
  }

  const gestor = new GestorDeSesion(navegador, {
    datos: mensaje.autenticacion,
    politicaDelEscaneo: configuracion.politica,
    soloLectura: mensaje.soloLectura,
    alRegistrar,
    timeoutMs: configuracion.timeoutPaginaMs,
    urlBase: configuracion.politica.urlBase,
    abrirVisible: abrirNavegadorVisible,
    pedirLogin,
    informarSesion,
    alHallazgo: eventos.alHallazgo,
  });
  const vacio = {
    paginasVisitadas: 0,
    linksExcluidos: 0,
    noRecorridosSoloLectura: 0,
    noRecorridosExclusiones: 0,
    urlsDescartadas: 0,
    websocketDescartados: 0,
  };
  if (!(await gestor.iniciar(mensaje.sesionPrevia))) {
    enviar({ tipo: 'escaneo-terminado', ...vacio, detenido: 'sesion' });
    return;
  }
  const { contexto, vigilancia } = gestor.actual();
  const resultado = await rastrear(contexto, vigilancia, opciones, eventos, Date.now, gestor);
  enviar({
    tipo: 'escaneo-terminado',
    ...resultado,
    websocketDescartados: gestor.websocketDescartados(),
  });
  await gestor.cerrar();
}

puerto.on('message', ({ data }) => {
  const mensaje = MensajeAlRunner.safeParse(data);
  if (!mensaje.success) {
    enviar({ tipo: 'rechazado' });
    void terminar(1);
    return;
  }
  const { data: recibido } = mensaje;
  switch (recibido.tipo) {
    case 'cancelar':
      void terminar(0);
      return;
    case 'datos-login': {
      const espera = esperaDeLogin;
      esperaDeLogin = null;
      if (espera)
        espera({ proxy: recibido.proxy, politica: recibido.politica, secreto: recibido.secreto });
      else recibido.secreto?.fill(0);
      return;
    }
    case 'login-denegado': {
      const espera = esperaDeLogin;
      esperaDeLogin = null;
      espera?.(null);
      return;
    }
    default:
      ejecutar(recibido).then(
        () => terminar(0),
        () => terminar(1),
      );
  }
});
