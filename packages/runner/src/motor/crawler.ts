import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { BrowserContext, CDPSession, Page, Request, Response } from 'playwright-core';
import { decidirUrlSinResolver, type PoliticaDeRed } from '../red/reglas';
import {
  analizarCookie,
  coincideExclusion,
  consoleErrorRelevante,
  hallazgoDeEstado,
  hallazgosDeRendimiento,
  claveDeMensaje,
  hostDe,
  SEVERIDAD,
  severidadDeAccesibilidad,
  UMBRALES,
  type HallazgoDetectado,
} from './chequeos';
import type { Vigilancia } from './motor';
import { Frontera, normalizarUrl, sinQuery } from './urls';

/**
 * El crawler y los chequeos de cada página (especificación 6.3). Corre en el runner, con el navegador
 * detrás del proxy. Lo que puede traer contenido de la página viaja solo en `detalle`, que el proceso
 * principal guarda cifrado.
 */

export interface OpcionesRastreo {
  urlBase: string;
  politica: PoliticaDeRed;
  maxPaginas: number;
  maxProfundidad: number;
  maxMinutos: number;
  maxRps: number;
  exclusiones: readonly string[];
  timeoutPaginaMs: number;
  soloLectura: boolean;
}

export interface PaginaVisitada {
  url: string;
  status: number | null;
  tiempoCargaMs: number | null;
  profundidad: number;
}

export interface EventosRastreo {
  alPagina: (pagina: PaginaVisitada) => void;
  alHallazgo: (hallazgo: HallazgoDetectado) => void;
}

export interface ResultadoRastreo {
  paginasVisitadas: number;
  linksExcluidos: number;
  detenido: 'max-paginas' | 'max-tiempo' | null;
  /** Cobertura no alcanzada: botones que no se tocaron por solo lectura. */
  noRecorridosSoloLectura: number;
  /** Cobertura no alcanzada: links y botones que coinciden con una exclusión. */
  noRecorridosExclusiones: number;
  urlsDescartadas: number;
}

/** Lo que se espera a que la red quede inactiva, como mucho. Las SPAs siguen pidiendo cosas. */
const ESPERA_RED_INACTIVA_MS = 5000;
const CLICS_POR_PAGINA = 10;
const ESPERA_LCP_MS = 150;
const MUNDO_AISLADO = 'qatlas';
const TAGS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const requerir = createRequire(import.meta.url);
let fuenteAxe: string | undefined;
const axe = (): string =>
  (fuenteAxe ??= readFileSync(requerir.resolve('axe-core/axe.min.js'), 'utf8'));

const esperar = (ms: number) =>
  new Promise((listo) => {
    setTimeout(listo, ms);
  });

/**
 * Corre código en un mundo aislado: comparte el DOM con la página, pero no sus variables. La página no
 * ve nada de esto ni lo puede alterar, y su CSP no lo bloquea (ADR 021).
 */
async function enMundoAislado<T>(cdp: CDPSession, expresion: string): Promise<T | null> {
  try {
    const { frameTree } = await cdp.send('Page.getFrameTree');
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: MUNDO_AISLADO,
    });
    const respuesta = await cdp.send('Runtime.evaluate', {
      expression: expresion,
      contextId: executionContextId,
      awaitPromise: true,
      returnByValue: true,
    });
    if (respuesta.exceptionDetails) return null;
    return respuesta.result.value as T;
  } catch {
    return null;
  }
}

interface Datos {
  respuestas: {
    url: string;
    estado: number;
    principal: boolean;
    bloqueada: boolean;
    cookies: string[];
  }[];
  fallidas: { url: string; error: string }[];
  consola: { tipo: string; texto: string }[];
  excepciones: string[];
  pesoBytes: number;
  requestsLentas: number;
  pendientes: Promise<unknown>[];
}

const datosVacios = (): Datos => ({
  respuestas: [],
  fallidas: [],
  consola: [],
  excepciones: [],
  pesoBytes: 0,
  requestsLentas: 0,
  pendientes: [],
});

/** El proxy marca sus propios rechazos: no son errores del sitio. */
const ENCABEZADO_BLOQUEO = 'x-qatlas-bloqueado';

function escuchar(pagina: Page, datos: () => Datos): void {
  pagina.on('response', (respuesta: Response) => {
    const actual = datos();
    actual.pendientes.push(
      respuesta.headersArray().then(
        (encabezados) => {
          actual.respuestas.push({
            url: respuesta.url(),
            estado: respuesta.status(),
            principal:
              respuesta.request().isNavigationRequest() && respuesta.frame() === pagina.mainFrame(),
            bloqueada: encabezados.some((e) => e.name.toLowerCase() === ENCABEZADO_BLOQUEO),
            cookies: encabezados
              .filter((e) => e.name.toLowerCase() === 'set-cookie')
              .map((e) => e.value),
          });
        },
        () => undefined,
      ),
    );
  });
  pagina.on('requestfailed', (solicitud: Request) => {
    datos().fallidas.push({ url: solicitud.url(), error: solicitud.failure()?.errorText ?? '' });
  });
  pagina.on('requestfinished', (solicitud: Request) => {
    const actual = datos();
    const { responseEnd } = solicitud.timing();
    // La página misma ya cuenta como «carga»: acá solo los recursos.
    if (responseEnd > UMBRALES.requestMs && !solicitud.isNavigationRequest()) {
      actual.requestsLentas += 1;
    }
    actual.pendientes.push(
      solicitud.sizes().then(
        (tamanos) => {
          actual.pesoBytes += tamanos.responseBodySize + tamanos.responseHeadersSize;
        },
        () => undefined,
      ),
    );
  });
  pagina.on('console', (mensaje) => {
    datos().consola.push({ tipo: mensaje.type(), texto: mensaje.text() });
  });
  pagina.on('pageerror', (error) => {
    datos().excepciones.push(error.message);
  });
}

interface Accesibilidad {
  id: string;
  impacto: string | null;
  ayuda: string;
  nodos: string[];
}

const EXPRESION_AXE = `axe.run(document, {
  runOnly: { type: 'tag', values: ${JSON.stringify(TAGS_WCAG)} },
  resultTypes: ['violations'],
}).then((r) => r.violations.map((v) => ({
  id: v.id,
  impacto: v.impact,
  ayuda: v.help,
  nodos: v.nodes.slice(0, 10).map((n) => String(n.target[0]).slice(0, 200)),
})))`;

const EXPRESION_MEDICION = `new Promise((listo) => {
  const navegacion = performance.getEntriesByType('navigation')[0];
  const carga = navegacion && navegacion.loadEventEnd > 0 ? navegacion.loadEventEnd : null;
  let lcp = null;
  try {
    new PerformanceObserver((lista) => {
      const entradas = lista.getEntries();
      lcp = entradas[entradas.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
  setTimeout(() => listo({ carga, lcp }), ${ESPERA_LCP_MS});
})`;

const EXPRESION_PAGINA = `(() => {
  const textos = (el) => [el.textContent, el.getAttribute('aria-label'), el.id, el.getAttribute('name'),
    el.getAttribute('title'), el.getAttribute('data-testid')].filter(Boolean).map((t) => String(t).trim());
  const links = [...document.querySelectorAll('a[href], area[href]')].map((a) => ({
    href: a.href, textos: textos(a),
  }));
  const botones = [...document.querySelectorAll('button, [role=button], input[type=button], input[type=submit]')]
    .filter((b) => b.offsetParent !== null);
  return {
    links,
    botones: botones.map((b, indice) => ({
      indice,
      textos: textos(b),
      // Un botón que envía un formulario nunca se toca: escribiría.
      envia: Boolean(b.form) && (b.type === 'submit' || (b.tagName === 'BUTTON' && !b.getAttribute('type'))),
    })),
    contrasena: Boolean(document.querySelector('input[type=password]')),
    seguro: window.isSecureContext,
  };
})()`;

interface Analisis {
  links: { href: string; textos: string[] }[];
  botones: { indice: number; textos: string[]; envia: boolean }[];
  contrasena: boolean;
  seguro: boolean;
}

const SELECTOR_BOTONES = 'button, [role=button], input[type=button], input[type=submit]';

/** Recorre el sitio dentro del alcance y analiza cada página una vez. */
export async function rastrear(
  contexto: BrowserContext,
  vigilancia: Vigilancia,
  opciones: OpcionesRastreo,
  eventos: EventosRastreo,
  ahora: () => number = Date.now,
): Promise<ResultadoRastreo> {
  const limite = ahora() + opciones.maxMinutos * 60_000;
  const pausa = 1000 / opciones.maxRps;
  let ultimaNavegacion = 0;
  const frontera = new Frontera();
  const resultado: ResultadoRastreo = {
    paginasVisitadas: 0,
    linksExcluidos: 0,
    detenido: null,
    noRecorridosSoloLectura: 0,
    noRecorridosExclusiones: 0,
    urlsDescartadas: 0,
  };

  const pagina = await contexto.newPage();
  const cdp = await contexto.newCDPSession(pagina);
  let datos = datosVacios();
  escuchar(pagina, () => datos);

  /** El límite de requests por segundo, sobre navegaciones y clics (ADR 021). */
  const respetarRitmo = async () => {
    const espera = ultimaNavegacion + pausa - ahora();
    if (espera > 0) await esperar(espera);
    ultimaNavegacion = ahora();
  };
  const redInactiva = () =>
    pagina
      .waitForLoadState('networkidle', {
        timeout: Math.min(ESPERA_RED_INACTIVA_MS, opciones.timeoutPaginaMs),
      })
      .catch(() => undefined);

  // Lo ya analizado, también por la URL final de una redirección (RN-ESC-04).
  const analizadas = new Set<string>();
  const base = normalizarUrl(opciones.urlBase);
  if (base) frontera.agregar(base, 0, null);

  for (let pendiente = frontera.siguiente(); pendiente; pendiente = frontera.siguiente()) {
    if (resultado.paginasVisitadas >= opciones.maxPaginas) {
      resultado.detenido = 'max-paginas';
      break;
    }
    if (ahora() >= limite) {
      resultado.detenido = 'max-tiempo';
      break;
    }
    if (analizadas.has(pendiente.url)) continue;
    analizadas.add(pendiente.url);

    datos = datosVacios();
    vigilancia.reiniciar();
    await respetarRitmo();
    let estado: number | null = null;
    let navego = false;
    try {
      const respuesta = await pagina.goto(pendiente.url, {
        timeout: opciones.timeoutPaginaMs,
        waitUntil: 'load',
      });
      estado = respuesta?.status() ?? null;
      navego = true;
    } catch {
      // Un destino bloqueado o que no responde: lo dicen el registro y los chequeos de abajo.
    }
    await redInactiva();
    await Promise.allSettled(datos.pendientes);

    // Si la navegación falló, la pestaña puede seguir mostrando la página anterior.
    const final = (navego ? normalizarUrl(pagina.url()) : null) ?? pendiente.url;
    // Una redirección dentro del alcance: los hallazgos son de donde terminó, y se analiza una vez.
    const finalEnAlcance =
      final !== pendiente.url && decidirUrlSinResolver(final, opciones.politica).permitida;
    if (finalEnAlcance) {
      frontera.marcarVista(final);
      if (analizadas.has(final)) continue;
      analizadas.add(final);
    }
    const url = sinQuery(finalEnAlcance ? final : pendiente.url);
    const principal = datos.respuestas.filter((r) => r.principal).at(-1);
    const bloqueadosPorNosotros = [
      ...vigilancia.bloqueadas(),
      ...datos.respuestas.filter((r) => r.bloqueada).map((r) => r.url),
    ];

    const medicion =
      estado !== null && estado < 400 && !principal?.bloqueada
        ? await enMundoAislado<{ carga: number | null; lcp: number | null }>(
            cdp,
            EXPRESION_MEDICION,
          )
        : null;
    resultado.paginasVisitadas += 1;
    eventos.alPagina({
      url: pendiente.url,
      status: principal?.bloqueada ? null : estado,
      tiempoCargaMs: medicion?.carga ?? null,
      profundidad: pendiente.profundidad,
    });

    const reportar = (hallazgo: HallazgoDetectado) => {
      eventos.alHallazgo(hallazgo);
    };

    // Recursos que bloqueamos nosotros: informativo, una vez por host.
    for (const host of new Set(bloqueadosPorNosotros.map(hostDe).filter(Boolean))) {
      reportar({
        tipo: 'recurso-externo-bloqueado',
        severidad: SEVERIDAD['recurso-externo-bloqueado'],
        url,
        urlOrigen: null,
        clave: host,
        titulo: `Recurso fuera del alcance bloqueado: ${host}`,
        detalle: '',
      });
    }
    if (principal?.bloqueada || estado === null) continue;

    const deEstado = hallazgoDeEstado(
      estado,
      url,
      pendiente.origen ? sinQuery(pendiente.origen) : null,
    );
    if (deEstado) {
      reportar(deEstado);
      continue;
    }

    // Recursos con error y requests fallidas, salvo lo que cortamos nosotros.
    const bloqueadas = new Set(bloqueadosPorNosotros);
    for (const respuesta of datos.respuestas) {
      if (respuesta.principal || respuesta.bloqueada || respuesta.estado < 400) continue;
      reportar({
        tipo: 'recurso-con-error',
        severidad: SEVERIDAD['recurso-con-error'],
        url,
        urlOrigen: null,
        clave: `${respuesta.estado} ${new URL(respuesta.url).pathname}`,
        titulo: `Un recurso responde ${respuesta.estado}`,
        detalle: respuesta.url,
      });
    }
    for (const fallida of datos.fallidas) {
      if (bloqueadas.has(fallida.url)) continue;
      // Lo que cortamos nosotros (alcance o solo lectura), lo que abortó una navegación y el
      // contenido mixto, que es su propio hallazgo.
      if (
        fallida.error === 'net::ERR_ABORTED' ||
        fallida.error.startsWith('net::ERR_BLOCKED_BY_CLIENT') ||
        fallida.error === 'mixed-content'
      ) {
        continue;
      }
      reportar({
        tipo: 'recurso-con-error',
        severidad: SEVERIDAD['recurso-con-error'],
        url,
        urlOrigen: null,
        clave: `fallida ${fallida.error}`,
        titulo: 'Una request falló',
        detalle: `${fallida.error} ${fallida.url}`,
      });
    }

    for (const excepcion of datos.excepciones) {
      reportar({
        tipo: 'error-javascript',
        severidad: SEVERIDAD['error-javascript'],
        url,
        urlOrigen: null,
        clave: claveDeMensaje(excepcion),
        titulo: 'Excepción de JavaScript no capturada',
        detalle: excepcion.slice(0, 1000),
      });
    }
    const hostsBloqueados = [...new Set(bloqueadosPorNosotros.map(hostDe))];
    for (const mensaje of datos.consola) {
      if (mensaje.tipo !== 'error') continue;
      if (!consoleErrorRelevante(mensaje.texto, [...bloqueadosPorNosotros, ...hostsBloqueados])) {
        continue;
      }
      reportar({
        tipo: 'console-error',
        severidad: SEVERIDAD['console-error'],
        url,
        urlOrigen: null,
        clave: claveDeMensaje(mensaje.texto),
        titulo: 'console.error en la página',
        detalle: mensaje.texto.slice(0, 1000),
      });
    }
    if (datos.consola.some((m) => m.texto.includes('Mixed Content'))) {
      reportar({
        tipo: 'contenido-mixto',
        severidad: SEVERIDAD['contenido-mixto'],
        url,
        urlOrigen: null,
        clave: 'contenido-mixto',
        titulo: 'Contenido mixto: la página HTTPS pide recursos por HTTP',
        detalle: datos.consola
          .filter((m) => m.texto.includes('Mixed Content'))
          .map((m) => m.texto)
          .join('\n')
          .slice(0, 1000),
      });
    }

    const https = pendiente.url.startsWith('https:');
    const cookies = new Set<string>();
    for (const respuesta of datos.respuestas) {
      for (const encabezado of respuesta.cookies) {
        const cookie = analizarCookie(encabezado, https);
        if (!cookie || cookies.has(cookie.nombre)) continue;
        cookies.add(cookie.nombre);
        const faltan = [cookie.faltaHttpOnly && 'HttpOnly', cookie.faltaSecure && 'Secure'].filter(
          Boolean,
        );
        reportar({
          tipo: 'cookie-insegura',
          severidad: SEVERIDAD['cookie-insegura'],
          url,
          urlOrigen: null,
          clave: cookie.nombre,
          titulo: `Cookie de sesión sin ${faltan.join(' ni ')}`,
          detalle: '',
        });
      }
    }

    for (const hallazgo of hallazgosDeRendimiento(url, {
      cargaMs: medicion?.carga ?? null,
      lcpMs: medicion?.lcp ?? null,
      pesoBytes: datos.pesoBytes,
      requestsLentas: datos.requestsLentas,
    })) {
      reportar(hallazgo);
    }

    await enMundoAislado(cdp, axe());
    const violaciones = (await enMundoAislado<Accesibilidad[]>(cdp, EXPRESION_AXE)) ?? [];
    for (const violacion of violaciones) {
      reportar({
        tipo: 'accesibilidad',
        severidad: severidadDeAccesibilidad(violacion.impacto),
        url,
        urlOrigen: null,
        clave: violacion.id,
        titulo: `Accesibilidad: ${violacion.ayuda.slice(0, 200)}`,
        detalle: violacion.nodos.join('\n'),
      });
    }

    const analisis = await enMundoAislado<Analisis>(cdp, EXPRESION_PAGINA);
    if (!analisis) continue;
    if (analisis.contrasena && !analisis.seguro) {
      reportar({
        tipo: 'login-sin-cifrar',
        severidad: SEVERIDAD['login-sin-cifrar'],
        url,
        urlOrigen: null,
        clave: 'contrasena-sin-cifrar',
        titulo: 'Formulario de login sobre HTTP',
        detalle: '',
      });
    }

    const encolar = (href: string) => {
      const siguiente = normalizarUrl(href);
      if (!siguiente || pendiente.profundidad + 1 > opciones.maxProfundidad) return;
      if (!decidirUrlSinResolver(siguiente, opciones.politica).permitida) return;
      if (frontera.agregar(siguiente, pendiente.profundidad + 1, pendiente.url) === 'trampa') {
        resultado.urlsDescartadas += 1;
      }
    };
    for (const link of analisis.links) {
      if (coincideExclusion([link.href, ...link.textos], opciones.exclusiones)) {
        resultado.linksExcluidos += 1;
        resultado.noRecorridosExclusiones += 1;
        continue;
      }
      encolar(link.href);
    }

    // Botones (TS-05): en solo lectura, ninguno. Si no, los que no envían un formulario ni coinciden
    // con una exclusión, de a uno, para descubrir rutas de una SPA.
    if (opciones.soloLectura) {
      resultado.noRecorridosSoloLectura += analisis.botones.length;
      continue;
    }
    let clics = 0;
    for (const boton of analisis.botones) {
      if (boton.envia || coincideExclusion(boton.textos, opciones.exclusiones)) {
        resultado.noRecorridosExclusiones += 1;
        continue;
      }
      if (clics >= CLICS_POR_PAGINA || ahora() >= limite) break;
      clics += 1;
      await respetarRitmo();
      try {
        await pagina.locator(SELECTOR_BOTONES).nth(boton.indice).click({ timeout: 2000 });
        await redInactiva();
      } catch {
        continue;
      }
      const despues = normalizarUrl(pagina.url());
      if (despues && despues !== final) {
        encolar(despues);
        await respetarRitmo();
        await pagina
          .goto(pendiente.url, { timeout: opciones.timeoutPaginaMs })
          .catch(() => undefined);
        await redInactiva();
      }
    }
  }
  if (!resultado.detenido && frontera.quedan > 0) resultado.detenido = 'max-paginas';
  resultado.urlsDescartadas = frontera.descartadasPorTrampa;
  await pagina.close().catch(() => undefined);
  return resultado;
}
