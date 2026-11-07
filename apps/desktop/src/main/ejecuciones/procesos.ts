import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { utilityProcess } from 'electron';
import { MensajeDelRunner } from '@qatlas/runner';
import { carpetaPerfil, entornoMinimo, variablesDePantalla } from './perfiles';
import { conectarProxy } from './proxy-proceso';
import type { LanzadorDeProcesos, ProcesoRunner } from './servicio';

const TIEMPO_INICIO_PROXY_MS = 10_000;

export interface OpcionesLanzador {
  carpetaDatos: string;
  carpetaCompilada: string;
  /** Dónde están los navegadores. `undefined`: el lugar por defecto de Playwright, en desarrollo. */
  rutaNavegadores: string | undefined;
}

export function crearLanzador({
  carpetaDatos,
  carpetaCompilada,
  rutaNavegadores,
}: OpcionesLanzador): LanzadorDeProcesos {
  return {
    iniciarProxy: (datos, alRegistrar) =>
      conectarProxy(
        utilityProcess.fork(path.join(carpetaCompilada, 'proceso-proxy.js'), [], {
          serviceName: 'qatlas-proxy',
          stdio: 'ignore',
          env: entornoMinimo(process.env, {}),
        }),
        datos,
        alRegistrar,
        TIEMPO_INICIO_PROXY_MS,
      ),

    iniciarRunner: (ejecucionId) => {
      const perfil = carpetaPerfil(carpetaDatos, ejecucionId);
      mkdirSync(perfil, { recursive: true, mode: 0o700 });
      const hijo = utilityProcess.fork(path.join(carpetaCompilada, 'proceso-runner.js'), [], {
        serviceName: 'qatlas-runner',
        stdio: 'ignore',
        // Lo que el navegador escriba con una ruta relativa cae en el perfil, y se borra con él.
        cwd: perfil,
        env: entornoMinimo(process.env, {
          // La ventana del login asistido, en Linux (ADR 028). Solo el runner.
          ...variablesDePantalla(process.env, process.platform),
          // Playwright crea ahí el perfil y sus archivos: nada va al temporal del sistema (ADR 018).
          TEMP: perfil,
          TMP: perfil,
          TMPDIR: perfil,
          ...(rutaNavegadores ? { PLAYWRIGHT_BROWSERS_PATH: rutaNavegadores } : {}),
        }),
      });
      const oyentesDeSalida: (() => void)[] = [];
      let salio = false;
      hijo.once('exit', () => {
        salio = true;
        for (const oyente of oyentesDeSalida) oyente();
      });
      const proceso: ProcesoRunner = {
        enviar: (mensaje) => {
          hijo.postMessage(mensaje);
        },
        alMensaje: (oyente) => {
          hijo.on('message', (crudo: unknown) => {
            const mensaje = MensajeDelRunner.safeParse(crudo);
            if (mensaje.success) oyente(mensaje.data);
          });
        },
        alSalir: (oyente) => {
          if (salio) oyente();
          else oyentesDeSalida.push(oyente);
        },
        detener: () => {
          if (!salio) hijo.kill();
        },
      };
      return proceso;
    },

    limpiarPerfil: (ejecucionId) => {
      rmSync(carpetaPerfil(carpetaDatos, ejecucionId), {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    },
  };
}
