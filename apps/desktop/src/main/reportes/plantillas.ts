/**
 * El contenido de un reporte de bug y cómo se arma cada formato (6.5.2, ADR 048). Funciones puras, sin
 * `electron`: se prueban con Vitest.
 *
 * - **Precargado:** título, pasos, esperado y obtenido salen de los hallazgos y de sus ocurrencias, ya
 *   redactados. El entorno, sin datos del equipo de la persona (6.5.2).
 * - **HTML del PDF:** un solo documento, sin scripts, con CSP restrictiva. Imágenes y fuentes adentro, como
 *   `data:`, en una ventana aparte que nunca carga nada de afuera. Título genérico: «Reporte de QAtlas».
 * - **Markdown:** texto. Las imágenes van solo en el ZIP, referidas por su ID.
 */
import type { SeveridadHallazgo, TipoHallazgo } from '@qatlas/shared';

export interface ContenidoReporte {
  titulo: string;
  pasos: string[];
  esperado: string;
  obtenido: string;
  entorno: {
    url: string;
    navegador: string;
    viewport: string;
    fecha: string;
    ejecucionId: string;
  };
}

export interface HallazgoParaPrellenar {
  id: string;
  tipo: TipoHallazgo;
  severidad: SeveridadHallazgo;
  titulo: string;
  url: string;
}

export interface OcurrenciaParaPrellenar {
  hallazgoId: string;
  ejecucionId: string;
  url: string;
  urlOrigen: string | null;
  fecha: string;
  /** Ya redactado (ADR 032). */
  detalle: string | null;
}

export const ORDEN_SEVERIDAD: readonly SeveridadHallazgo[] = [
  'critica',
  'alta',
  'media',
  'baja',
  'informativa',
];

export const NAVEGADOR = 'Chromium, el navegador de pruebas de QAtlas';
// Playwright no fija otro: es el tamaño de la ventana de cada página escaneada.
export const VIEWPORT = '1280 × 720';

const ESPERADO: Partial<Record<TipoHallazgo, string>> = {
  'error-http': 'La página responde sin error (un estado HTTP menor que 400).',
  'link-roto': 'El link lleva a una página que existe.',
  'recurso-con-error': 'Cada recurso de la página carga sin error.',
  'error-javascript': 'La página carga sin excepciones de JavaScript.',
  'console-error': 'La página no escribe errores en la consola.',
  accesibilidad: 'La página cumple WCAG 2.1 AA.',
  rendimiento: 'La página carga dentro de los umbrales de rendimiento.',
  'cookie-insegura': 'Las cookies de sesión tienen HttpOnly y Secure.',
  'contenido-mixto': 'Una página HTTPS solo pide recursos por HTTPS.',
  'login-sin-cifrar': 'La contraseña se envía solo por HTTPS.',
  'parametro-sensible': 'Ningún token ni clave viaja en la URL.',
  'secreto-en-almacenamiento': 'El sitio no guarda secretos en el navegador.',
};

/** La ruta de una URL ya redactada, para un título. Si no se puede leer, tal cual. */
export function rutaDe(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function severidadMayor(severidades: readonly SeveridadHallazgo[]): SeveridadHallazgo {
  return ORDEN_SEVERIDAD.find((s) => severidades.includes(s)) ?? 'informativa';
}

/** El borrador del reporte, a partir de los hallazgos y sus ocurrencias (la más nueva primero). */
export function prellenar(
  hallazgos: readonly HallazgoParaPrellenar[],
  ocurrencias: readonly OcurrenciaParaPrellenar[],
): ContenidoReporte {
  const [primero] = hallazgos;
  if (!primero) throw new Error('Un reporte necesita al menos un hallazgo');
  const ultima = ocurrencias[0];
  const pasos: string[] = [];
  for (const h of hallazgos) {
    const o = ocurrencias.find((x) => x.hallazgoId === h.id);
    if (h.tipo === 'link-roto' && o?.urlOrigen) {
      pasos.push(`Abrir ${o.urlOrigen}`, `Seguir el link a ${o.url}`);
    } else {
      pasos.push(`Abrir ${o?.url ?? h.url}`);
    }
  }
  const detalles = hallazgos
    .map((h) => {
      const detalle = ocurrencias.find((o) => o.hallazgoId === h.id && o.detalle)?.detalle;
      return detalle ? `${h.titulo}: ${detalle.slice(0, 500)}` : h.titulo;
    })
    .join('\n');
  return {
    titulo:
      hallazgos.length === 1
        ? `[${rutaDe(primero.url)}] ${primero.titulo}`
        : `[${String(hallazgos.length)} hallazgos] ${primero.titulo}`,
    pasos: [...new Set(pasos)],
    esperado: [
      ...new Set(hallazgos.map((h) => ESPERADO[h.tipo] ?? 'La página no tiene el problema.')),
    ].join('\n'),
    obtenido: detalles,
    entorno: {
      url: ultima?.url ?? primero.url,
      navegador: NAVEGADOR,
      viewport: VIEWPORT,
      fecha: ultima?.fecha ?? '',
      ejecucionId: ultima?.ejecucionId ?? '',
    },
  };
}

export interface EvidenciaEnReporte {
  id: string;
  /** Una captura (imagen) o el detalle redactado de una ocurrencia (texto). */
  clase: 'captura' | 'detalle';
  /** Para el detalle: el texto, ya redactado. */
  texto?: string;
  /** Para una captura: el nombre dentro del ZIP, por ID (EXP-06). */
  archivo?: string;
}

const NOMBRE_SEVERIDAD: Record<SeveridadHallazgo, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  informativa: 'Informativa',
};

/**
 * El reporte en Markdown. Las capturas, solo si van en el ZIP (`conImagenes`): referidas por su nombre
 * por ID. Sin el ZIP, la lista dice que hay capturas y dónde conseguirlas.
 */
export function aMarkdown(
  contenido: ContenidoReporte,
  severidad: SeveridadHallazgo,
  evidencias: readonly EvidenciaEnReporte[],
  conImagenes: boolean,
): string {
  const lineas = [
    `# ${contenido.titulo}`,
    '',
    `**Severidad:** ${NOMBRE_SEVERIDAD[severidad]}`,
    '',
    '## Pasos para reproducir',
    '',
    ...contenido.pasos.map((p, i) => `${String(i + 1)}. ${p}`),
    '',
    '## Esperado',
    '',
    contenido.esperado,
    '',
    '## Obtenido',
    '',
    contenido.obtenido,
    '',
    '## Entorno',
    '',
    `- URL: ${contenido.entorno.url}`,
    `- Navegador: ${contenido.entorno.navegador}`,
    `- Ventana: ${contenido.entorno.viewport}`,
    `- Fecha: ${contenido.entorno.fecha}`,
    `- Ejecución: ${contenido.entorno.ejecucionId}`,
    '',
    '## Evidencia',
    '',
  ];
  const capturas = evidencias.filter((e) => e.clase === 'captura');
  if (capturas.length === 0)
    lineas.push('Sin capturas: la evidencia es el detalle de cada aparición.', '');
  for (const e of evidencias) {
    if (e.clase === 'detalle') {
      lineas.push('```text', (e.texto ?? '').replaceAll('```', "'''"), '```', '');
    } else if (conImagenes && e.archivo) {
      lineas.push(`![Captura ${e.id}](${e.archivo})`, '');
    } else {
      lineas.push(`- Captura ${e.id}: incluida en el ZIP del reporte.`, '');
    }
  }
  lineas.push('---', 'Generado con QAtlas. Los datos sensibles se redactaron antes de exportar.');
  return lineas.join('\n');
}

/** Para el HTML: todo texto del reporte se escapa. Nunca se interpreta como HTML (ENT-05). */
export function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface FuentesEmbebidas {
  /** Inter y JetBrains Mono, en woff2 (las de la app). Nunca fuentes del sistema. */
  inter: Buffer;
  mono: Buffer;
}

/** La CSP del documento del PDF: nada de afuera, ningún script. Imágenes y fuentes solo como `data:`. */
export const CSP_DOCUMENTO =
  "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

/**
 * El HTML del PDF. Las fuentes son las únicas que puede usar: sin familias genéricas de respaldo, así
 * Chromium no cae en una del sistema. Lo verifica la generación del PDF (`fuentesDelPdf`).
 */
export function aHtml(
  contenido: ContenidoReporte,
  severidad: SeveridadHallazgo,
  evidencias: readonly (EvidenciaEnReporte & { png?: Buffer })[],
  fuentes: FuentesEmbebidas,
): string {
  const e = escaparHtml;
  const fuente = (familia: string, datos: Buffer) =>
    `@font-face{font-family:'${familia}';src:url(data:font/woff2;base64,${datos.toString('base64')}) format('woff2');font-weight:100 900;}`;
  const bloques = evidencias
    .map((ev) =>
      ev.clase === 'detalle'
        ? `<pre>${e(ev.texto ?? '')}</pre>`
        : ev.png
          ? `<figure><img alt="Captura ${e(ev.id)}" src="data:image/png;base64,${ev.png.toString('base64')}"><figcaption>Captura ${e(ev.id)}</figcaption></figure>`
          : '',
    )
    .join('');
  const sinCaptura = evidencias.some((ev) => ev.clase === 'captura')
    ? ''
    : '<p>Sin capturas: la evidencia es el detalle de cada aparición.</p>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP_DOCUMENTO}">
<title>Reporte de QAtlas</title>
<style>
${fuente('QAtlas Inter', fuentes.inter)}${fuente('QAtlas Mono', fuentes.mono)}
body{font-family:'QAtlas Inter';color:#1a1a2e;margin:24px;font-size:12px;line-height:1.5}
h1{font-size:20px;margin:0 0 8px}h2{font-size:14px;margin:20px 0 6px}
pre{font-family:'QAtlas Mono';font-size:10px;white-space:pre-wrap;word-break:break-word;background:#f3f3f8;padding:8px;border-radius:4px}
img{max-width:100%;border:1px solid #ccc}figure{margin:12px 0}figcaption{font-size:10px;color:#555}
.pie{margin-top:24px;font-size:10px;color:#555}
</style></head><body>
<h1>${e(contenido.titulo)}</h1>
<p><strong>Severidad:</strong> ${e(NOMBRE_SEVERIDAD[severidad])}</p>
<h2>Pasos para reproducir</h2><ol>${contenido.pasos.map((p) => `<li>${e(p)}</li>`).join('')}</ol>
<h2>Esperado</h2><p>${e(contenido.esperado).replaceAll('\n', '<br>')}</p>
<h2>Obtenido</h2><p>${e(contenido.obtenido).replaceAll('\n', '<br>')}</p>
<h2>Entorno</h2><ul>
<li>URL: ${e(contenido.entorno.url)}</li><li>Navegador: ${e(contenido.entorno.navegador)}</li>
<li>Ventana: ${e(contenido.entorno.viewport)}</li><li>Fecha: ${e(contenido.entorno.fecha)}</li>
<li>Ejecución: ${e(contenido.entorno.ejecucionId)}</li></ul>
<h2>Evidencia</h2>${sinCaptura}${bloques}
<p class="pie">Generado con QAtlas. Los datos sensibles se redactaron antes de exportar.</p>
</body></html>`;
}

/** Los nombres de las fuentes embebidas en un PDF (`/BaseFont`, sin el prefijo del subconjunto). */
export function fuentesDelPdf(pdf: Uint8Array): string[] {
  const texto = Buffer.from(pdf).toString('latin1');
  return [
    ...new Set(
      [...texto.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([^\s/<>[\]()]+)/g)].map((m) => m[1] ?? ''),
    ),
  ];
}
