import type { IndicadorExito, PasoLogin } from '@qatlas/shared';
import type { BrowserContext, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { esperarIndicador, presupuestoProbarLogin, probarLogin } from './motor';

/**
 * La prueba de login con una página falsa: el orden de lo que pasa en el navegador se fija acá, sin
 * depender de cuánto tarde el CI. Cada caso reproduce una carrera o un cuelgue concreto.
 */

const LOGIN = 'http://sitio.example.test/login';
const PANEL = 'http://sitio.example.test/panel';
const PASOS: PasoLogin[] = [
  { accion: 'rellenar', selector: '#usuario', origen: 'usuario' },
  { accion: 'rellenar', selector: '#clave', origen: 'secreto' },
  { accion: 'click', selector: 'button[type=submit]' },
];
const POR_URL: IndicadorExito = { tipo: 'url', patron: `${PANEL}*` };
const APARECE: IndicadorExito = { tipo: 'aparece', selector: 'a.salir' };
const DESAPARECE: IndicadorExito = { tipo: 'desaparece', selector: 'form.login' };
const TIMEOUT_MS = 300;
const nunca = <T>() => new Promise<T>(() => undefined);

/** Lo que muestra la página en un momento: la URL, si cargó y qué elementos se ven. */
interface Documento {
  url: string;
  completo: boolean;
  visibles: string[];
}

interface Guion {
  /** El documento después de cada click en el botón de enviar, en orden. El último queda. */
  despuesDeEnviar: Documento[];
  /** Cada cuánto pasa al siguiente documento del guion. */
  pasoMs?: number;
  cierreCuelga?: boolean;
  aperturaCuelga?: boolean;
  lecturaCuelga?: boolean;
}

function paginaFalsa(guion: Guion) {
  let actual: Documento = { url: LOGIN, completo: true, visibles: ['form.login'] };
  const estado = { cerrada: false };
  const enviar = () => {
    const [primero, ...resto] = guion.despuesDeEnviar;
    if (primero) actual = primero;
    let i = 0;
    const avanzar = () => {
      const siguiente = resto[i++];
      if (!siguiente) return;
      actual = siguiente;
      setTimeout(avanzar, guion.pasoMs ?? 50);
    };
    setTimeout(avanzar, guion.pasoMs ?? 50);
  };
  const locator = (selector: string) => ({
    first: () => ({
      click: () => {
        enviar();
        return Promise.resolve();
      },
      fill: () => Promise.resolve(),
      waitFor: () => Promise.resolve(),
      isVisible: () =>
        guion.lecturaCuelga
          ? nunca<boolean>()
          : Promise.resolve(actual.visibles.includes(selector)),
    }),
    evaluateAll: () =>
      guion.lecturaCuelga
        ? nunca()
        : Promise.resolve({
            completo: actual.completo,
            visibles: actual.visibles.includes(selector),
          }),
  });
  const pagina = {
    setDefaultTimeout: () => undefined,
    goto: () => Promise.resolve(null),
    url: () => actual.url,
    locator,
    close: () => {
      if (guion.cierreCuelga) return nunca<undefined>();
      estado.cerrada = true;
      return Promise.resolve();
    },
  } as unknown as Page;
  const contexto = {
    newPage: () => (guion.aperturaCuelga ? nunca<Page>() : Promise.resolve(pagina)),
  } as unknown as BrowserContext;
  return { pagina, contexto, estado };
}

const opciones = (indicador: IndicadorExito) => ({
  urlLogin: LOGIN,
  pasos: PASOS,
  indicador,
  usuario: 'ana',
  secreto: new TextEncoder().encode('clave-de-prueba-inventada'),
  timeoutMs: TIMEOUT_MS,
});

const panel: Documento = { url: PANEL, completo: true, visibles: ['a.salir'] };
const enBlanco = (url: string): Documento => ({ url, completo: false, visibles: [] });
const loginDeNuevo: Documento = { url: LOGIN, completo: true, visibles: ['form.login'] };

/** Corre `probarLogin` y mide cuánto tardó. Falla si pasa del presupuesto, en lugar de colgarse. */
async function cronometrar(guion: Guion, indicador: IndicadorExito) {
  const { contexto, estado } = paginaFalsa(guion);
  const inicio = Date.now();
  const limite = presupuestoProbarLogin({ pasos: PASOS, timeoutMs: TIMEOUT_MS });
  const resultado = await Promise.race([
    probarLogin(contexto, opciones(indicador)),
    new Promise<'colgado'>((listo) => {
      setTimeout(() => {
        listo('colgado');
      }, limite + 1000);
    }),
  ]);
  return { resultado, ms: Date.now() - inicio, limite, estado };
}

describe('probarLogin: la navegación ya ocurrió cuando se empieza a mirar', () => {
  // El sitio redirige al panel durante el click, antes de la primera lectura del indicador. Mirar
  // primero el estado actual lo ve; esperar «la próxima navegación» no la vería nunca.
  for (const indicador of [POR_URL, APARECE, DESAPARECE]) {
    it(`${indicador.tipo}: da verde`, async () => {
      const { resultado, estado } = await cronometrar({ despuesDeEnviar: [panel] }, indicador);
      expect(resultado).toBe(true);
      expect(estado.cerrada).toBe(true);
    });
  }
});

describe('probarLogin: nada lo cuelga más allá de su presupuesto', () => {
  it('un cierre de la página que no termina no cuelga el resultado', async () => {
    const r = await cronometrar({ despuesDeEnviar: [panel], cierreCuelga: true }, POR_URL);
    expect(r.resultado).toBe(true);
    expect(r.ms).toBeLessThanOrEqual(r.limite);
  });

  it('una página que no se abre: falla a tiempo', async () => {
    const r = await cronometrar({ despuesDeEnviar: [panel], aperturaCuelga: true }, POR_URL);
    expect(r.resultado).toBe(false);
    expect(r.ms).toBeLessThanOrEqual(r.limite);
  });

  for (const indicador of [APARECE, DESAPARECE]) {
    it(`${indicador.tipo}: una lectura que no responde falla a tiempo`, async () => {
      const r = await cronometrar({ despuesDeEnviar: [panel], lecturaCuelga: true }, indicador);
      expect(r.resultado).toBe(false);
      expect(r.ms).toBeLessThanOrEqual(r.limite);
    });
  }
});

describe('desaparece: nunca da verde por la razón equivocada', () => {
  it('una contraseña mala: el formulario «desaparece» mientras navega y vuelve. Falla', async () => {
    const { resultado } = await cronometrar(
      { despuesDeEnviar: [enBlanco(LOGIN), loginDeNuevo] },
      DESAPARECE,
    );
    expect(resultado).toBe(false);
  });

  it('un documento sin terminar de cargar no es evidencia', async () => {
    const { resultado } = await cronometrar({ despuesDeEnviar: [enBlanco(PANEL)] }, DESAPARECE);
    expect(resultado).toBe(false);
  });

  it('un error de lectura (el documento cambió en el medio) no es un éxito', async () => {
    const { pagina } = paginaFalsa({ despuesDeEnviar: [] });
    const rota = {
      ...pagina,
      locator: () => ({ evaluateAll: () => Promise.reject(new Error('contexto destruido')) }),
    } as unknown as Page;
    expect(await esperarIndicador(rota, DESAPARECE, 200)).toBe(false);
  });
});
