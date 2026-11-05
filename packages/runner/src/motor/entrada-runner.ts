import { tmpdir } from 'node:os';
import type { Browser } from 'playwright-core';
import { MensajeAlRunner, type MensajeDelRunner } from '../protocolo';
import { instalarAgente } from '../red/agente';
import { causaDeFalla, detalleDeFalla, perfilDemasiadoLargo } from './diagnostico';
import { rastrear } from './crawler';
import { abrirContexto, abrirNavegador, probarLogin } from './motor';

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

async function terminar(codigo: number): Promise<void> {
  await navegador?.close().catch(() => undefined);
  process.exit(codigo);
}

async function ejecutar(mensaje: Exclude<MensajeAlRunner, { tipo: 'cancelar' }>): Promise<void> {
  const { configuracion } = mensaje;
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
  if (perfilDemasiadoLargo(tmpdir(), process.platform)) {
    if (mensaje.tipo === 'login') mensaje.secreto.fill(0);
    enviar({ tipo: 'navegador-no-disponible', causa: 'perfil-ruta-larga', detalle: '' });
    return;
  }
  try {
    navegador = await abrirNavegador(configuracion);
  } catch (error) {
    if (mensaje.tipo === 'login') mensaje.secreto.fill(0);
    const texto = error instanceof Error ? error.message : '';
    enviar({
      tipo: 'navegador-no-disponible',
      causa: causaDeFalla(texto),
      detalle: detalleDeFalla(texto),
    });
    return;
  }

  if (mensaje.tipo === 'escaneo') {
    const { contexto, vigilancia } = await abrirContexto(navegador, configuracion.politica, {
      soloLectura: mensaje.soloLectura,
      alRegistrar,
    });
    const resultado = await rastrear(
      contexto,
      vigilancia,
      {
        urlBase: configuracion.politica.urlBase,
        politica: configuracion.politica,
        maxPaginas: mensaje.maxPaginas,
        maxProfundidad: mensaje.maxProfundidad,
        maxMinutos: mensaje.maxMinutos,
        maxRps: mensaje.maxRps,
        exclusiones: mensaje.exclusiones,
        timeoutPaginaMs: configuracion.timeoutPaginaMs,
        soloLectura: mensaje.soloLectura,
      },
      {
        alPagina: (pagina) => {
          enviar({
            tipo: 'pagina',
            url: pagina.url,
            status: pagina.status,
            tiempoCargaMs: pagina.tiempoCargaMs === null ? null : Math.round(pagina.tiempoCargaMs),
            profundidad: pagina.profundidad,
          });
        },
        alHallazgo: (hallazgo) => {
          enviar({ tipo: 'hallazgo', hallazgo });
        },
      },
    );
    enviar({
      tipo: 'escaneo-terminado',
      ...resultado,
      websocketDescartados: vigilancia.websocketDescartados(),
    });
    return;
  }
  // El login necesita escribir: solo lectura no aplica a este contexto (6.2).
  const { contexto } = await abrirContexto(navegador, configuracion.politica, {
    soloLectura: false,
    alRegistrar,
  });
  const funciono = await probarLogin(contexto, {
    urlLogin: mensaje.urlLogin,
    pasos: mensaje.pasos,
    indicador: mensaje.indicador,
    usuario: mensaje.usuario,
    secreto: mensaje.secreto,
    timeoutMs: configuracion.timeoutPaginaMs,
  });
  enviar({ tipo: 'login-terminado', funciono });
}

puerto.on('message', ({ data }) => {
  const mensaje = MensajeAlRunner.safeParse(data);
  if (!mensaje.success) {
    enviar({ tipo: 'rechazado' });
    void terminar(1);
    return;
  }
  if (mensaje.data.tipo === 'cancelar') {
    void terminar(0);
    return;
  }
  ejecutar(mensaje.data).then(
    () => terminar(0),
    () => terminar(1),
  );
});
