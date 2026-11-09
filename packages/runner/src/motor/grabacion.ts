import type { CDPSession, Page, Request } from 'playwright-core';
import type { EventoTraza, MensajeDelRunner, OpcionesEvidencias } from '../protocolo';

/**
 * Las evidencias de un escaneo, del lado del runner (semana 7b, ADR 035 a 038). Nada se escribe en
 * disco: los fotogramas del screencast, las capturas y los eventos de la traza viajan en memoria al
 * proceso principal, que los redacta y los cifra. El runner nunca recibe claves.
 *
 * Solo se graba la página del crawler. El login corre en otro contexto, que nunca se graba (EVI-01).
 */

/** Fotogramas enviados y todavía sin confirmar. Pasado esto, se descartan y se cuentan (f5). */
export const MAX_FOTOGRAMAS_EN_VUELO = 20;
const CALIDAD_FOTOGRAMA = 70;
const TAMANO_FOTOGRAMA = { width: 1280, height: 720 };
const LIMITE_CAPTURA_MS = 10_000;
const LIMITE_LECTURA_MS = 5_000;
/** El snapshot se corta acá: más que esto no sirve para leer y agranda la traza. */
export const MAX_SNAPSHOT = 1_000_000;
const MAX_CUERPO_SOLICITUD = 65_536;
const MAX_ENCABEZADOS = 150;
const MAX_VALOR_ENCABEZADO = 8192;

const SELECTOR_CAMPOS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
const SELECTOR_CONTRASENAS = 'input[type=password]';
/** Cuánto se espera la respuesta del proceso principal sobre qué tapar. Sin respuesta, no hay captura. */
const LIMITE_MASCARAS_MS = 5_000;
export const MAX_TEXTOS_CAPTURA = 2000;
const MAX_TEXTO_CAPTURA = 5000;

/**
 * El texto visible de cada elemento (el propio, sin el de sus hijos) y el valor de los campos, con un
 * XPath para taparlo sin tocar el DOM. Corre en el mundo aislado: la página no lo ve (ADR 036).
 */
export const EXPRESION_TEXTOS_VISIBLES = `(() => {
  const salida = [];
  const xpath = (el) => {
    const partes = [];
    for (let n = el; n && n.nodeType === Node.ELEMENT_NODE; n = n.parentElement) {
      let i = 1;
      for (let h = n.previousElementSibling; h; h = h.previousElementSibling) if (h.tagName === n.tagName) i += 1;
      partes.unshift(n.tagName.toLowerCase() + '[' + i + ']');
    }
    return '/' + partes.join('/');
  };
  const visible = (el) => {
    const caja = el.getBoundingClientRect();
    return caja.width > 0 && caja.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  for (const el of document.querySelectorAll('body *')) {
    if (salida.length >= ${MAX_TEXTOS_CAPTURA}) break;
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName) || !visible(el)) continue;
    let texto = '';
    for (const hijo of el.childNodes) if (hijo.nodeType === Node.TEXT_NODE) texto += hijo.nodeValue;
    if ((el.tagName === 'INPUT' && el.type !== 'password') || el.tagName === 'TEXTAREA') texto += ' ' + el.value;
    texto = texto.trim();
    if (texto) salida.push({ xpath: xpath(el), texto: texto.slice(0, ${MAX_TEXTO_CAPTURA}) });
  }
  return salida;
})()`;

type Enviar = (mensaje: MensajeDelRunner) => void;
type EnMundoAislado = <T>(cdp: CDPSession, expresion: string) => Promise<T | null>;

const conLimite = <T>(promesa: Promise<T>, ms: number): Promise<T> => {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  promesa.catch(() => undefined);
  return Promise.race([
    promesa,
    new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(() => {
        rechazar(new Error('limite'));
      }, ms);
    }),
  ]).finally(() => {
    clearTimeout(temporizador);
  });
};

const recortar = (texto: string, maximo: number): string =>
  texto.length > maximo ? texto.slice(0, maximo) : texto;

const encabezados = (lista: { name: string; value: string }[]) =>
  lista.slice(0, MAX_ENCABEZADOS).map(({ name, value }) => ({
    nombre: recortar(name, 200),
    valor: recortar(value, MAX_VALOR_ENCABEZADO),
  }));

/**
 * El snapshot del DOM como texto (ADR 037), armado en un mundo aislado: ahí los selectores funcionan
 * sobre el DOM vivo. Se vacían los valores de las contraseñas, de los campos ocultos y de los selectores
 * sensibles (con el modo datos sensibles, todos los campos), y se omiten el contenido de los scripts y
 * de los estilos, los comentarios y los manejadores `on*`. Un selector que no es CSS válido no se puede
 * aplicar acá: entonces no hay snapshot (falla cerrado).
 */
export function expresionSnapshot(
  selectoresSensibles: readonly string[],
  enmascararFormularios: boolean,
): string {
  return `(() => {
  const selectores = ${JSON.stringify(selectoresSensibles)};
  for (const s of selectores) { try { document.createDocumentFragment().querySelector(s); } catch { return null; } }
  const todos = ${JSON.stringify(enmascararFormularios)};
  const MAX = ${MAX_SNAPSHOT};
  const VACIOS = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
  const SIN_CONTENIDO = new Set(['script','style','noscript','template','iframe','object']);
  const CAMPOS = new Set(['input','textarea','select','option']);
  let salida = '';
  let enmascarados = 0;
  let cortado = false;
  const escapar = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const atributo = (t) => escapar(t).replace(/"/g, '&quot;');
  const sensible = (el) => selectores.some((s) => { try { return el.matches(s); } catch { return true; } });
  const campoTapado = (el) => {
    const tipo = (el.getAttribute('type') || '').toLowerCase();
    return todos || tipo === 'password' || tipo === 'hidden';
  };
  const agregar = (t) => {
    if (cortado) return;
    if (salida.length + t.length > MAX) { cortado = true; salida += '<!-- qatlas: snapshot cortado -->'; return; }
    salida += t;
  };
  const recorrer = (nodo) => {
    if (cortado) return;
    if (nodo.nodeType === Node.TEXT_NODE) { agregar(escapar(nodo.nodeValue || '')); return; }
    if (nodo.nodeType !== Node.ELEMENT_NODE) return;
    const el = nodo;
    const tag = el.tagName.toLowerCase();
    const tapar = sensible(el);
    const campo = CAMPOS.has(tag);
    const tapado = tapar || (campo && campoTapado(el)) || (todos && el.isContentEditable);
    let atributos = '';
    for (const a of el.attributes) {
      const nombre = a.name.toLowerCase();
      if (nombre.startsWith('on')) continue;
      if (tapado && (nombre === 'value' || nombre === 'placeholder' || nombre === 'title' || nombre === 'alt' || nombre === 'aria-label')) continue;
      if (nombre === 'srcdoc') continue;
      atributos += ' ' + a.name + '="' + atributo(a.value) + '"';
    }
    if (campo && !tapado && tag === 'input' && el.value !== el.getAttribute('value')) {
      atributos += ' data-qatlas-valor="' + atributo(String(el.value)) + '"';
    }
    if (tapado) { enmascarados += 1; atributos += ' data-qatlas-enmascarado=""'; }
    agregar('<' + tag + atributos + '>');
    if (VACIOS.has(tag)) return;
    if (tapado) { agregar('[ENMASCARADO]'); }
    else if (!SIN_CONTENIDO.has(tag)) { for (const hijo of el.childNodes) recorrer(hijo); }
    agregar('</' + tag + '>');
  };
  recorrer(document.documentElement);
  return { html: salida, enmascarados };
})()`;
}

export class Grabacion {
  private tramo: number | null = null;
  private contador = 0;
  private inicioTramo = 0;
  private enVuelo = 0;
  /** Descartados desde el último fotograma enviado: viajan con el siguiente, para ubicar el hueco. */
  private perdidosPendientes = 0;
  private perdidosDelTramo = 0;
  private capturas = 0;
  private paginas = new WeakSet<Page>();
  private readonly tramoDe = new WeakMap<Request, number | null>();
  private readonly pendientes = new Set<Promise<unknown>>();
  private readonly inicio: number;
  /** Quien espera la respuesta del principal sobre qué tapar en la captura. Hay una a la vez. */
  private esperaDeMascaras: ((indices: readonly number[] | null) => void) | null = null;

  constructor(
    private readonly opciones: OpcionesEvidencias,
    private readonly enviar: Enviar,
    private readonly enMundoAislado: EnMundoAislado,
    private readonly ahora: () => number = Date.now,
  ) {
    this.inicio = ahora();
  }

  private t(): number {
    return Math.max(0, this.ahora() - this.inicio);
  }

  /** El proceso principal confirma lo que ya escribió: libera lugar para más fotogramas. */
  procesados(fotogramas: number): void {
    this.enVuelo = Math.max(0, this.enVuelo - fotogramas);
  }

  /** La respuesta del principal: qué textos tienen un secreto y hay que tapar (EVI-04). */
  mascaras(indices: readonly number[]): void {
    const espera = this.esperaDeMascaras;
    this.esperaDeMascaras = null;
    espera?.(indices);
  }

  /**
   * Los elementos con un secreto a la vista: el principal pasa su texto por la redacción, con las
   * credenciales del proyecto, y dice cuáles tapar. Sin respuesta a tiempo, null: no hay captura.
   */
  private async secretosALaVista(cdp: CDPSession, tramo: number): Promise<string[] | null> {
    const elementos =
      (await conLimite(
        this.enMundoAislado<{ xpath: string; texto: string }[]>(cdp, EXPRESION_TEXTOS_VISIBLES),
        LIMITE_LECTURA_MS,
      ).catch(() => null)) ?? null;
    if (!elementos) return null;
    if (elementos.length === 0) return [];
    const respuesta = new Promise<readonly number[] | null>((listo) => {
      this.esperaDeMascaras = listo;
    });
    this.enviar({ tipo: 'textos-de-captura', tramo, textos: elementos.map((e) => e.texto) });
    const indices = await conLimite(respuesta, LIMITE_MASCARAS_MS).catch(() => null);
    this.esperaDeMascaras = null;
    if (!indices) return null;
    return indices.flatMap((i) => {
      const elemento = elementos[i];
      return elemento ? [elemento.xpath] : [];
    });
  }

  /** Cada página nueva del crawler. El screencast, solo si hay video. */
  async vincular(pagina: Page): Promise<void> {
    if (this.paginas.has(pagina)) return;
    this.paginas.add(pagina);
    if (this.opciones.traza) this.escucharTraza(pagina);
    if (!this.opciones.video) return;
    try {
      await conLimite(
        pagina.screencast.start({
          size: TAMANO_FOTOGRAMA,
          quality: CALIDAD_FOTOGRAMA,
          onFrame: ({ data }) => {
            this.alFotograma(data);
          },
        }),
        LIMITE_LECTURA_MS,
      );
    } catch {
      // Sin screencast no hay video de esta página; el escaneo sigue.
    }
  }

  private alFotograma(datos: Buffer): void {
    if (this.tramo === null) return;
    if (this.enVuelo >= MAX_FOTOGRAMAS_EN_VUELO) {
      this.perdidosPendientes += 1;
      this.perdidosDelTramo += 1;
      return;
    }
    this.enVuelo += 1;
    this.enviar({
      tipo: 'fotograma',
      tramo: this.tramo,
      t: Math.max(0, this.ahora() - this.inicioTramo),
      perdidosAntes: this.perdidosPendientes,
      datos: new Uint8Array(datos),
    });
    this.perdidosPendientes = 0;
  }

  iniciarTramo(url: string): void {
    this.contador += 1;
    this.tramo = this.contador;
    this.inicioTramo = this.ahora();
    this.perdidosPendientes = 0;
    this.perdidosDelTramo = 0;
    this.enviar({ tipo: 'tramo-inicio', tramo: this.tramo });
    this.evento({ clase: 'navegacion', t: this.t(), tramo: this.tramo, url: recortar(url, 2048) });
  }

  /**
   * Al terminar la página: la captura y el snapshot si tuvo hallazgos, y el fin del tramo. El proceso
   * principal decide si conserva el video (severidad media o mayor, o un error de navegación).
   */
  async terminarTramo(
    pagina: Page,
    cdp: CDPSession,
    { hallazgos, errorNavegacion }: { hallazgos: number; errorNavegacion: boolean },
  ): Promise<void> {
    const tramo = this.tramo;
    if (tramo === null) return;
    if (hallazgos > 0 && !errorNavegacion) {
      await this.capturar(pagina, cdp, tramo);
      await this.snapshot(cdp, tramo);
    }
    await this.esperarTraza();
    this.tramo = null;
    this.enviar({
      tipo: 'tramo-fin',
      tramo,
      errorNavegacion,
      perdidos: this.perdidosDelTramo,
      perdidosAlFinal: this.perdidosPendientes,
    });
    this.perdidosPendientes = 0;
  }

  accion(objetivo: string): void {
    this.evento({
      clase: 'accion',
      t: this.t(),
      tramo: this.tramo,
      accion: 'click',
      objetivo: recortar(objetivo, 300),
    });
  }

  /**
   * Capturas: nunca se descartan (f5). Con los campos de contraseña y los selectores sensibles tapados
   * (EVI-02), y también los elementos donde el detector encontró un secreto a la vista (EVI-04).
   */
  private async capturar(pagina: Page, cdp: CDPSession, tramo: number): Promise<void> {
    if (!this.opciones.capturas || this.capturas >= this.opciones.maxCapturas) return;
    try {
      const conSecretos = await this.secretosALaVista(cdp, tramo);
      // Sin saber qué tiene secretos, la captura podría mostrar uno: no se toma.
      if (!conSecretos) return;
      const selectores = [
        SELECTOR_CONTRASENAS,
        ...this.opciones.selectoresSensibles,
        ...(this.opciones.enmascararFormularios ? [SELECTOR_CAMPOS] : []),
        ...conSecretos.map((xpath) => `xpath=${xpath}`),
      ];
      const mascaras = selectores.map((s) => pagina.locator(s));
      let enmascarados = 0;
      for (const mascara of mascaras) {
        enmascarados += await conLimite(mascara.count(), LIMITE_LECTURA_MS);
      }
      const datos = await pagina.screenshot({
        type: 'png',
        mask: mascaras,
        maskColor: '#202020',
        animations: 'disabled',
        caret: 'hide',
        timeout: LIMITE_CAPTURA_MS,
      });
      this.capturas += 1;
      this.enviar({
        tipo: 'captura',
        tramo,
        enmascarados,
        datos: new Uint8Array(datos),
      });
    } catch {
      // Un selector inválido o una página que no responde: sin captura, nunca una sin tapar.
    }
  }

  private async snapshot(cdp: CDPSession, tramo: number): Promise<void> {
    if (!this.opciones.snapshots) return;
    const resultado = await conLimite(
      this.enMundoAislado<{ html: string; enmascarados: number } | null>(
        cdp,
        expresionSnapshot(this.opciones.selectoresSensibles, this.opciones.enmascararFormularios),
      ),
      LIMITE_CAPTURA_MS,
    ).catch(() => null);
    if (!resultado) return;
    this.evento({
      clase: 'snapshot',
      t: this.t(),
      tramo,
      html: recortar(resultado.html, MAX_SNAPSHOT + 100),
      enmascarados: resultado.enmascarados,
    });
  }

  private evento(evento: EventoTraza): void {
    if (!this.opciones.traza && evento.clase !== 'snapshot') return;
    this.enviar({ tipo: 'traza', evento });
  }

  private escucharTraza(pagina: Page): void {
    pagina.on('request', (solicitud) => {
      this.tramoDe.set(solicitud, this.tramo);
    });
    const alTerminar = (solicitud: Request, fallo: string | null) => {
      const tramo = this.tramoDe.get(solicitud) ?? this.tramo;
      const t = this.t();
      const promesa = (async () => {
        const [salida, respuesta] = await Promise.all([
          conLimite(solicitud.headersArray(), LIMITE_LECTURA_MS).catch(() => []),
          conLimite(solicitud.response(), LIMITE_LECTURA_MS).catch(() => null),
        ]);
        const entrada = respuesta
          ? await conLimite(respuesta.headersArray(), LIMITE_LECTURA_MS).catch(() => [])
          : [];
        const cuerpo = solicitud.postData();
        const tipoContenido =
          salida.find((e) => e.name.toLowerCase() === 'content-type')?.value ?? null;
        const { responseEnd } = solicitud.timing();
        this.evento({
          clase: 'red',
          t,
          tramo,
          metodo: recortar(solicitud.method(), 16),
          url: recortar(solicitud.url(), 4096),
          tipoRecurso: recortar(solicitud.resourceType(), 30),
          estado: respuesta?.status() ?? null,
          encabezadosSolicitud: encabezados(salida),
          encabezadosRespuesta: encabezados(entrada),
          cuerpoSolicitud: cuerpo === null ? null : recortar(cuerpo, MAX_CUERPO_SOLICITUD),
          tipoContenidoSolicitud: tipoContenido === null ? null : recortar(tipoContenido, 200),
          error: fallo === null ? null : recortar(fallo, 200),
          duracionMs: responseEnd >= 0 ? Math.round(responseEnd) : null,
        });
      })().catch(() => undefined);
      this.pendientes.add(promesa);
      void promesa.finally(() => this.pendientes.delete(promesa));
    };
    pagina.on('requestfinished', (solicitud) => {
      alTerminar(solicitud, null);
    });
    pagina.on('requestfailed', (solicitud) => {
      alTerminar(solicitud, solicitud.failure()?.errorText ?? 'fallida');
    });
    pagina.on('console', (mensaje) => {
      this.evento({
        clase: 'consola',
        t: this.t(),
        tramo: this.tramo,
        nivel: recortar(mensaje.type(), 20),
        texto: recortar(mensaje.text(), 2000),
      });
    });
    pagina.on('pageerror', (error) => {
      this.evento({
        clase: 'excepcion',
        t: this.t(),
        tramo: this.tramo,
        texto: recortar(error.message, 2000),
      });
    });
  }

  /** Lo que la red todavía está terminando de leer, acotado. */
  private async esperarTraza(): Promise<void> {
    await conLimite(Promise.allSettled([...this.pendientes]), LIMITE_LECTURA_MS).catch(
      () => undefined,
    );
  }

  /** Al final del escaneo: el screencast se para y la traza termina de salir. */
  async cerrar(paginas: readonly Page[]): Promise<void> {
    await this.esperarTraza();
    if (!this.opciones.video) return;
    await Promise.all(
      paginas.map((p) => conLimite(p.screencast.stop(), LIMITE_LECTURA_MS).catch(() => undefined)),
    );
  }
}
