import type { Browser } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { GestorDeSesion, type MotivoLogin, type OpcionesGestor } from './gestor-sesion';
import type { DatosAutenticacion, EstadoSesion, ResultadoLogin } from './sesion';

/**
 * El gestor de sesión con un navegador de mentira y un reloj controlado: cuándo renueva, cuándo usa
 * una sesión guardada y qué tiempo queda fuera del máximo. El navegador real está en los E2E.
 */

const MINUTO = 60_000;
const ESTADO: EstadoSesion = { cookies: [], origins: [] };

function navegadorFalso(indicadorVisible: () => boolean) {
  const contextos: { cerrado: boolean }[] = [];
  const pagina = {
    goto: () => Promise.resolve({ status: () => 200 }),
    url: () => 'https://app.lexora.test/panel',
    locator: () => ({ first: () => ({ isVisible: () => Promise.resolve(indicadorVisible()) }) }),
    close: () => Promise.resolve(),
  };
  const navegador = {
    newContext: () => {
      const registro = { cerrado: false };
      contextos.push(registro);
      return Promise.resolve({
        route: () => Promise.resolve(),
        routeWebSocket: () => Promise.resolve(),
        newPage: () => Promise.resolve(pagina),
        close: () => {
          registro.cerrado = true;
          return Promise.resolve();
        },
      });
    },
  };
  return { navegador: navegador as unknown as Browser, contextos };
}

function armar(
  datos: Partial<DatosAutenticacion>,
  {
    indicador = () => true,
    denegar = new Set<MotivoLogin>(),
  }: { indicador?: () => boolean; denegar?: Set<MotivoLogin> } = {},
) {
  let ahora = Date.parse('2026-11-01T12:00:00.000Z');
  const pedidos: MotivoLogin[] = [];
  const { navegador, contextos } = navegadorFalso(indicador);
  const opciones: OpcionesGestor = {
    datos: {
      estrategia: 'formulario',
      urlLogin: 'https://app.lexora.test/login',
      pasos: [],
      indicador: { tipo: 'aparece', selector: '#menu' },
      usuario: 'ana@example.com',
      dominiosAutenticacion: [],
      sesionMaxMs: null,
      permitirLoginHttp: true,
      ...datos,
    },
    politicaDelEscaneo: {
      urlBase: 'https://app.lexora.test/',
      dominios: ['app.lexora.test'],
      sistemaInterno: false,
      puertosLocales: [],
    },
    soloLectura: true,
    alRegistrar: () => undefined,
    timeoutMs: 1000,
    urlBase: 'https://app.lexora.test/',
    abrirVisible: () => Promise.reject(new Error('sin ventana')),
    pedirLogin: (motivo) => {
      pedidos.push(motivo);
      if (denegar.has(motivo)) return Promise.resolve(null);
      return Promise.resolve({
        proxy: { servidor: 'http://127.0.0.1:1', usuario: 'u', clave: 'c' },
        politica: {
          urlBase: 'https://app.lexora.test/',
          dominios: ['app.lexora.test'],
          sistemaInterno: false,
          puertosLocales: [],
        },
        secreto: new Uint8Array([1, 2, 3]),
      });
    },
    informarSesion: () => undefined,
    alHallazgo: () => undefined,
    ahora: () => ahora,
    // Un login tarda dos minutos en este reloj.
    entrar: (): Promise<ResultadoLogin> => {
      ahora += 2 * MINUTO;
      return Promise.resolve({
        resultado: 'ok',
        estado: ESTADO,
        urlComprobacion: 'https://app.lexora.test/panel',
        secretosEnAlmacenamiento: [],
      });
    },
  };
  const gestor = new GestorDeSesion(navegador, opciones);
  return {
    gestor,
    pedidos,
    contextos,
    avanzar: (ms: number) => {
      ahora += ms;
    },
  };
}

describe('GestorDeSesion (ADR 026 y 027)', () => {
  it('sin sesión guardada entra; con una vigente y activa, no', async () => {
    const sin = armar({});
    expect(await sin.gestor.iniciar(null)).toBe(true);
    expect(sin.pedidos).toEqual(['inicial']);

    const con = armar({});
    expect(
      await con.gestor.iniciar({
        estado: ESTADO,
        urlComprobacion: 'https://x.test/',
        edadMs: MINUTO,
      }),
    ).toBe(true);
    expect(con.pedidos).toEqual([]);
  });

  it('una sesión guardada que ya no responde se descarta y se entra de nuevo', async () => {
    const { gestor, pedidos } = armar({}, { indicador: () => false });
    expect(
      await gestor.iniciar({ estado: ESTADO, urlComprobacion: 'https://x.test/', edadMs: 0 }),
    ).toBe(true);
    expect(pedidos).toEqual(['inicial']);
  });

  it('una sesión guardada más vieja que la duración máxima ni se prueba', async () => {
    const { gestor, pedidos } = armar({ sesionMaxMs: 10 * MINUTO });
    await gestor.iniciar({
      estado: ESTADO,
      urlComprobacion: 'https://x.test/',
      edadMs: 9 * MINUTO,
    });
    expect(pedidos).toEqual(['inicial']);
  });

  it('renueva un minuto antes de la duración máxima, con un contexto nuevo', async () => {
    const { gestor, pedidos, contextos, avanzar } = armar({ sesionMaxMs: 10 * MINUTO });
    await gestor.iniciar(null);
    const primera = gestor.actual().generacion;
    avanzar(8 * MINUTO);
    expect(await gestor.antesDePagina()).toBe(true);
    expect(pedidos).toEqual(['inicial']);
    avanzar(MINUTO);
    expect(await gestor.antesDePagina()).toBe(true);
    expect(pedidos).toEqual(['inicial', 'planificada']);
    expect(gestor.actual().generacion).toBe(primera + 1);
    expect(contextos.filter((c) => c.cerrado)).toHaveLength(1);
  });

  it('si la renovación se niega, sigue con la sesión que tiene y no vuelve a pedir', async () => {
    const { gestor, pedidos, avanzar } = armar(
      { sesionMaxMs: 10 * MINUTO },
      { denegar: new Set(['planificada']) },
    );
    await gestor.iniciar(null);
    avanzar(9 * MINUTO);
    expect(await gestor.antesDePagina()).toBe(true);
    avanzar(MINUTO);
    expect(await gestor.antesDePagina()).toBe(true);
    expect(pedidos).toEqual(['inicial', 'planificada']);
  });

  it('una sesión vencida que se niega detiene el escaneo', async () => {
    const { gestor } = armar({}, { indicador: () => false, denegar: new Set(['vencida']) });
    await gestor.iniciar(null);
    expect(await gestor.confirmarYRenovar()).toBe('detener');
  });

  it('el tiempo de los logins queda fuera del tiempo máximo', async () => {
    const { gestor } = armar({}, { indicador: () => false });
    await gestor.iniciar(null);
    expect(gestor.tiempoFuera()).toBe(2 * MINUTO);
    expect(await gestor.confirmarYRenovar()).toBe('renovada');
    expect(gestor.tiempoFuera()).toBe(4 * MINUTO);
  });

  it('con la básica no hay sesión que vencer ni pantalla de login', () => {
    const { gestor } = armar({ estrategia: 'basica' });
    expect(
      gestor.sospechar({
        urlFinal: null,
        estado: 401,
        bloqueadaPorNosotros: false,
        navegacionesBloqueadas: [],
        formularioDeLogin: false,
      }),
    ).toBe(false);
    // Su URL es una página protegida más: se recorre.
    expect(gestor.esUrlDeLogin('https://app.lexora.test/login')).toBe(false);
    expect(armar({}).gestor.esUrlDeLogin('https://app.lexora.test/login?x=1')).toBe(true);
  });
});
