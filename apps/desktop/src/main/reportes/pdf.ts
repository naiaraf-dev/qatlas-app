/**
 * El PDF de un reporte con el Chromium de Electron (`printToPDF`), aislado (ADR 048):
 *
 * - Una ventana oculta, con `SECURE_WEB_PREFERENCES` y sin JavaScript, en una sesión propia en memoria (sin
 *   `persist:`): no comparte caché, cookies ni permisos con la interfaz, y se descarta al terminar.
 * - El documento lo sirve el protocolo `app://` **de esa sesión**, desde memoria: nada se escribe en disco.
 *   Todo otro pedido se cancela y se cuenta; si hubo alguno, falla cerrado.
 * - Después: los metadatos de `/Info` se borran en el lugar (`limpiarMetadatosPdf`), y solo pueden quedar
 *   las fuentes empaquetadas (Inter y JetBrains Mono). Si aparece otra, falla cerrado.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { BrowserWindow, session } from 'electron';
import { SECURE_WEB_PREFERENCES } from '../security/web-preferences';
import { limpiarMetadatosPdf, PdfNoLimpiable } from './pdf-limpieza';
import { CSP_DOCUMENTO, fuentesDelPdf, type FuentesEmbebidas } from './plantillas';

const DOCUMENTO = 'app://reporte/documento.html';
const TIEMPO_MAXIMO_MS = 30_000;
/** Las fuentes que pueden quedar en el PDF: las nuestras, nunca una del sistema. */
const FUENTE_PERMITIDA = /^(QAtlas|Inter|JetBrains)/;

let fuentes: FuentesEmbebidas | undefined;

/** Inter y JetBrains Mono, del paquete que ya usa la interfaz. Sin ellas no hay PDF. */
export function fuentesEmpaquetadas(): FuentesEmbebidas {
  if (fuentes) return fuentes;
  const requerir = createRequire(import.meta.url);
  fuentes = {
    inter: readFileSync(
      requerir.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    ),
    mono: readFileSync(
      requerir.resolve(
        '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
      ),
    ),
  };
  return fuentes;
}

export async function renderizarPdf(html: string): Promise<Buffer> {
  const sesion = session.fromPartition(`qatlas-pdf-${randomUUID()}`, { cache: false });
  let otrosPedidos = 0;
  sesion.setPermissionRequestHandler((_wc, _permiso, responder) => {
    responder(false);
  });
  sesion.setPermissionCheckHandler(() => false);
  sesion.webRequest.onBeforeRequest((detalles, responder) => {
    const propio = detalles.url === DOCUMENTO;
    if (!propio) otrosPedidos++;
    responder({ cancel: !propio });
  });
  sesion.protocol.handle('app', (pedido) =>
    pedido.url === DOCUMENTO
      ? new Response(html, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': CSP_DOCUMENTO,
            'X-Content-Type-Options': 'nosniff',
          },
        })
      : new Response(null, { status: 404 }),
  );
  const ventana = new BrowserWindow({
    show: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      session: sesion,
      javascript: false,
      devTools: false,
    },
  });
  try {
    const listo = ventana.loadURL(DOCUMENTO);
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      listo,
      new Promise((_, rechazar) => {
        temporizador = setTimeout(() => {
          rechazar(new PdfNoLimpiable('la página no cargó a tiempo'));
        }, TIEMPO_MAXIMO_MS);
      }),
    ]).finally(() => {
      clearTimeout(temporizador);
    });
    const crudo = await ventana.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: false,
      generateTaggedPDF: false,
      generateDocumentOutline: false,
    });
    if (otrosPedidos > 0) throw new PdfNoLimpiable('el documento pidió recursos externos');
    const limpio = limpiarMetadatosPdf(crudo);
    // Todo reporte tiene texto: sin fuentes identificables no se puede afirmar que no usó una del sistema.
    const usadas = fuentesDelPdf(limpio);
    if (usadas.length === 0) throw new PdfNoLimpiable('no se pudieron identificar las fuentes');
    if (usadas.some((f) => !FUENTE_PERMITIDA.test(f))) {
      throw new PdfNoLimpiable('usó una fuente del sistema o una sin nombre');
    }
    return limpio;
  } finally {
    ventana.destroy();
    sesion.protocol.unhandle('app');
    await sesion.clearStorageData();
  }
}
