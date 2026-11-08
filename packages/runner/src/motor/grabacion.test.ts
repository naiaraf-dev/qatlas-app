import type { CDPSession, Page } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { MensajeDelRunner, OpcionesEvidencias } from '../protocolo';
import { Grabacion, MAX_FOTOGRAMAS_EN_VUELO } from './grabacion';

/**
 * La grabación del lado del runner, con una página falsa: el orden de los fotogramas y de las
 * confirmaciones se fija acá, sin depender de cuánto tarde nada (f5).
 */

const OPCIONES: OpcionesEvidencias = {
  video: true,
  snapshots: false,
  capturas: true,
  traza: false,
  selectoresSensibles: ['.dni'],
  enmascararFormularios: false,
  maxCapturas: 200,
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1]);

function paginaFalsa(opciones: { capturaFalla?: boolean } = {}) {
  let alFotograma: ((f: { data: Buffer }) => void) | undefined;
  const mascaras: string[][] = [];
  const pagina = {
    on: () => undefined,
    screencast: {
      start: (o: { onFrame: (f: { data: Buffer }) => void }) => {
        alFotograma = o.onFrame;
        return Promise.resolve({});
      },
      stop: () => Promise.resolve(),
    },
    locator: (selector: string) => ({ selector, count: () => Promise.resolve(1) }),
    screenshot: (o: { mask: { selector: string }[] }) => {
      mascaras.push(o.mask.map((m) => m.selector));
      return opciones.capturaFalla ? Promise.reject(new Error('selector')) : Promise.resolve(PNG);
    },
  } as unknown as Page;
  return {
    pagina,
    fotograma: () => alFotograma?.({ data: JPEG }),
    mascaras,
  };
}

const cdp = {} as CDPSession;
const sinMundo = () => Promise.resolve(null);

function grabar(opciones = OPCIONES) {
  const enviados: MensajeDelRunner[] = [];
  const grabacion = new Grabacion(opciones, (m) => enviados.push(m), sinMundo);
  return { grabacion, enviados };
}

describe('Fotogramas (f5)', () => {
  it('con el principal atrasado se descartan, se cuentan y el siguiente dice dónde', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina, fotograma } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    for (let i = 0; i < MAX_FOTOGRAMAS_EN_VUELO + 5; i++) fotograma();
    const fotogramas = () =>
      enviados.filter(
        (m): m is Extract<MensajeDelRunner, { tipo: 'fotograma' }> => m.tipo === 'fotograma',
      );
    expect(fotogramas()).toHaveLength(MAX_FOTOGRAMAS_EN_VUELO);
    // El principal confirma tres: entran tres más; el primero lleva los cinco perdidos.
    grabacion.procesados(3);
    fotograma();
    fotograma();
    expect(fotogramas()).toHaveLength(MAX_FOTOGRAMAS_EN_VUELO + 2);
    expect(fotogramas().map((m) => m.perdidosAntes)).toEqual([
      ...Array<number>(MAX_FOTOGRAMAS_EN_VUELO).fill(0),
      5,
      0,
    ]);
    fotograma();
    fotograma(); // descartado: ya no hay lugar
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 0, errorNavegacion: false });
    expect(enviados.at(-1)).toEqual({
      tipo: 'tramo-fin',
      tramo: 1,
      errorNavegacion: false,
      perdidos: 6,
      perdidosAlFinal: 1,
    });
  });

  it('las capturas salen aunque los fotogramas se estén descartando', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina, fotograma } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    for (let i = 0; i < MAX_FOTOGRAMAS_EN_VUELO * 2; i++) fotograma();
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 1, errorNavegacion: false });
    expect(enviados.filter((m) => m.tipo === 'captura')).toHaveLength(1);
  });

  it('fuera de un tramo no se manda nada', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina, fotograma } = paginaFalsa();
    await grabacion.vincular(pagina);
    fotograma();
    expect(enviados).toEqual([]);
  });

  it('sin video (modo datos sensibles) no hay screencast', async () => {
    const { grabacion, enviados } = grabar({ ...OPCIONES, video: false });
    const { pagina, fotograma } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    fotograma();
    expect(enviados.filter((m) => m.tipo === 'fotograma')).toEqual([]);
  });
});

describe('Capturas (EVI-02 y EVI-05)', () => {
  it('tapan las contraseñas y los selectores sensibles; solo de páginas con hallazgos', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina, mascaras } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/a');
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 0, errorNavegacion: false });
    grabacion.iniciarTramo('http://app.example.test/b');
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 2, errorNavegacion: false });
    expect(mascaras).toEqual([['input[type=password]', '.dni']]);
    expect(enviados.find((m) => m.tipo === 'captura')).toMatchObject({ tramo: 2, enmascarados: 2 });
  });

  it('con el modo datos sensibles, además todos los campos de formulario', async () => {
    const { grabacion } = grabar({ ...OPCIONES, enmascararFormularios: true });
    const { pagina, mascaras } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 1, errorNavegacion: false });
    expect(mascaras[0]).toContain(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
    );
  });

  it('si no se puede tapar (un selector inválido), no hay captura: nunca una sin tapar', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina } = paginaFalsa({ capturaFalla: true });
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 1, errorNavegacion: false });
    expect(enviados.filter((m) => m.tipo === 'captura')).toEqual([]);
  });

  it('respeta el máximo de capturas', async () => {
    const { grabacion, enviados } = grabar({ ...OPCIONES, maxCapturas: 1 });
    const { pagina } = paginaFalsa();
    await grabacion.vincular(pagina);
    for (const ruta of ['a', 'b', 'c']) {
      grabacion.iniciarTramo(`http://app.example.test/${ruta}`);
      await grabacion.terminarTramo(pagina, cdp, { hallazgos: 1, errorNavegacion: false });
    }
    expect(enviados.filter((m) => m.tipo === 'captura')).toHaveLength(1);
  });

  it('una página que no navegó no tiene captura: mostraría la anterior', async () => {
    const { grabacion, enviados } = grabar();
    const { pagina } = paginaFalsa();
    await grabacion.vincular(pagina);
    grabacion.iniciarTramo('http://app.example.test/');
    await grabacion.terminarTramo(pagina, cdp, { hallazgos: 1, errorNavegacion: true });
    expect(enviados.filter((m) => m.tipo === 'captura')).toEqual([]);
  });
});
