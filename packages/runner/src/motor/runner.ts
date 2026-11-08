import { tmpdir } from 'node:os';
import type { Browser } from 'playwright-core';
import { recortar, redactarTexto, redactarUrl } from '@qatlas/redaction';
import { MensajeAlRunner, type MensajeDelRunner } from '../protocolo';
import { causaDeFalla, detalleDeFalla, perfilDemasiadoLargo } from './diagnostico';
import { enMundoAislado, rastrear, type OpcionesRastreo } from './crawler';
import { Grabacion } from './grabacion';
import { GestorDeSesion, type DatosDeLogin } from './gestor-sesion';
import {
  abrirContexto,
  abrirNavegador,
  abrirNavegadorVisible,
  type NavegadorVisible,
} from './motor';
import { EXCLUSIONES_DE_CIERRE, iniciarSesion, type ResultadoLogin } from './sesion';

/**
 * Lo que hace el runner con cada mensaje, aparte de cómo llegan: en la app, por el «parentPort» de un
 * «utilityProcess» (entrada-runner.ts). Así un E2E puede correr exactamente esto en su proceso y
 * manejar la ventana del login asistido (TS-06).
 */
export interface OpcionesRunner {
  enviar: (mensaje: MensajeDelRunner) => void;
  /** Al terminar, con el código de salida. En la app, el proceso se va. */
  alTerminar: (codigo: number) => void;
  /**
   * La carpeta de la ejecución, dentro de la carpeta de datos (ADR 018): ahí va el perfil de la ventana
   * del asistido. En la app es el directorio de trabajo que le da el proceso principal.
   */
  carpetaPerfil: string;
  abrirVisible?: (proxy: Parameters<typeof abrirNavegadorVisible>[0]) => Promise<NavegadorVisible>;
}

type Hallazgo = Extract<MensajeDelRunner, { tipo: 'hallazgo' }>['hallazgo'];

/** Primera capa de redacción de un hallazgo, con los largos del protocolo. */
function redactarHallazgo(hallazgo: Hallazgo): Hallazgo {
  return {
    ...hallazgo,
    url: recortar(redactarUrl(hallazgo.url).texto, 2048),
    urlOrigen:
      hallazgo.urlOrigen === null ? null : recortar(redactarUrl(hallazgo.urlOrigen).texto, 2048),
    clave: recortar(redactarTexto(hallazgo.clave).texto, 300),
    titulo: recortar(redactarTexto(hallazgo.titulo).texto, 300),
    detalle: recortar(redactarTexto(hallazgo.detalle).texto, 2000),
  };
}

export function crearRunner({
  enviar,
  alTerminar,
  carpetaPerfil,
  abrirVisible = (proxy) => abrirNavegadorVisible(proxy, carpetaPerfil),
}: OpcionesRunner): {
  recibir: (data: unknown) => void;
} {
  let navegador: Browser | undefined;
  /** La ventana del asistido abierta, si hay: al terminar se cierra también (su perfil se borra con ella). */
  let ventana: NavegadorVisible | undefined;
  const abrirYRecordar = async (
    proxy: Parameters<typeof abrirNavegadorVisible>[0],
  ): Promise<NavegadorVisible> => {
    const abierta = await abrirVisible(proxy);
    ventana = abierta;
    return {
      contexto: abierta.contexto,
      cerrar: async () => {
        if (ventana === abierta) ventana = undefined;
        await abierta.cerrar();
      },
    };
  };
  /** Las evidencias del escaneo en curso: recibe las confirmaciones del proceso principal. */
  let grabacion: Grabacion | undefined;
  /** Quien espera la respuesta a un `necesita-login`. Hay uno a la vez. */
  let esperaDeLogin: ((datos: DatosDeLogin | null) => void) | null = null;

  async function terminar(codigo: number): Promise<void> {
    esperaDeLogin?.(null);
    // Los dos navegadores, y se espera a que terminen: el proceso principal borra el perfil cuando
    // este proceso sale, y nada tiene que seguir escribiendo ahí.
    await Promise.all([ventana?.cerrar(), navegador?.close().catch(() => undefined)]);
    alTerminar(codigo);
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
    } else if (resultado.resultado === 'ventana-no-disponible') {
      enviar({ tipo: 'ventana-no-disponible', causa: resultado.causa, detalle: resultado.detalle });
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
        abrirVisible: abrirYRecordar,
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
        // Primera capa de redacción (ADR 032): los patrones genéricos, antes de salir del runner. La
        // garantía es la del proceso principal, que además conoce los secretos de las credenciales.
        enviar({
          tipo: 'pagina',
          url: recortar(redactarUrl(pagina.url).texto, 2048),
          status: pagina.status,
          tiempoCargaMs: pagina.tiempoCargaMs === null ? null : Math.round(pagina.tiempoCargaMs),
          profundidad: pagina.profundidad,
        });
      },
      alHallazgo: (hallazgo: Extract<MensajeDelRunner, { tipo: 'hallazgo' }>['hallazgo']) => {
        enviar({ tipo: 'hallazgo', hallazgo: redactarHallazgo(hallazgo) });
      },
    };

    grabacion = new Grabacion(mensaje.evidencias, enviar, enMundoAislado);

    if (!mensaje.autenticacion) {
      const { contexto, vigilancia } = await abrirContexto(navegador, configuracion.politica, {
        soloLectura: mensaje.soloLectura,
        alRegistrar,
      });
      const resultado = await rastrear(
        contexto,
        vigilancia,
        opciones,
        eventos,
        Date.now,
        undefined,
        grabacion,
      );
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
      abrirVisible: abrirYRecordar,
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
    const resultado = await rastrear(
      contexto,
      vigilancia,
      opciones,
      eventos,
      Date.now,
      gestor,
      grabacion,
    );
    enviar({
      tipo: 'escaneo-terminado',
      ...resultado,
      websocketDescartados: gestor.websocketDescartados(),
    });
    await gestor.cerrar();
  }

  const recibir = (data: unknown): void => {
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
      case 'evidencia-procesada':
        grabacion?.procesados(recibido.fotogramas);
        return;
      default:
        ejecutar(recibido).then(
          () => terminar(0),
          () => terminar(1),
        );
    }
  };
  return { recibir };
}
