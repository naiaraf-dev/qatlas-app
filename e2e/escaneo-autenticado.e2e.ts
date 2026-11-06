/**
 * El escaneo autenticado de punta a punta, a nivel del runner (como `escaneo-oraculo.e2e.ts`): Chromium
 * real, el proxy del escaneo y uno de login aparte, contra la zona con login del sandbox, con nombres.
 * Compara con la sección `autenticado` de `hallazgos-esperados.json`.
 *
 * El vencimiento no depende del tiempo: el sandbox vence la sesión a las N páginas (`maximoPaginas`).
 * Los límites de logins y la pausa son del proceso principal: están en `ejecuciones.test.ts`.
 */
import { expect, test } from '@playwright/test';
import type { Browser } from 'playwright-core';
import { EXCLUSIONES_POR_DEFECTO } from '@qatlas/shared';
import {
  HOST_IDP,
  HOST_PORTAL,
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  USUARIO_BASICA,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type { HallazgoDetectado } from '../packages/runner/src/motor/chequeos';
import { rastrear, type PaginaVisitada } from '../packages/runner/src/motor/crawler';
import { GestorDeSesion, type MotivoLogin } from '../packages/runner/src/motor/gestor-sesion';
import { abrirNavegador } from '../packages/runner/src/motor/motor';
import {
  EXCLUSIONES_DE_CIERRE,
  type DatosAutenticacion,
  type ResultadoLogin,
} from '../packages/runner/src/motor/sesion';
import { iniciarProxy, type RegistroConexion } from '../packages/runner/src/red/proxy';
import { vigilarEntorno } from './entorno';
import { compararConOraculo, resumenLegible, type Esperado } from './oraculo';
import { readFileSync } from 'node:fs';
import path from 'node:path';

interface Escenario {
  estrategia: DatosAutenticacion['estrategia'];
  inicio: string;
  urlLogin?: string;
  rol?: 'admin' | 'lector';
  dominiosAutenticacion?: string[];
  paginas: Record<string, number>;
  noVisita?: string[];
  hallazgos: Esperado[];
}

const { autenticado } = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dirname, '../apps/sandbox-site/hallazgos-esperados.json'),
    'utf8',
  ),
) as {
  autenticado: {
    noVisitaNunca: string[];
    escenarios: Record<string, Escenario>;
    vencimiento: { maximoPaginas: number };
  };
};

const CREDENCIAL_PROXY = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };
const PASOS = [
  { accion: 'rellenar' as const, selector: '#usuario', origen: 'usuario' as const },
  { accion: 'rellenar' as const, selector: '#clave', origen: 'secreto' as const },
  { accion: 'click' as const, selector: 'button[type=submit]' },
];
const INDICADOR = { tipo: 'aparece' as const, selector: '#menu-usuario' };

const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

interface Resultado {
  paginas: PaginaVisitada[];
  hallazgos: HallazgoDetectado[];
  logins: MotivoLogin[];
  sesiones: ResultadoLogin[];
  escaneoProxy: RegistroConexion[];
  detenido: string | null;
}

/** Un escaneo autenticado con el gestor de sesión del runner, como lo arma `runner.ts`. */
async function escanear(
  sitio: SandboxActivo,
  escenario: Escenario,
  secreto: string,
  usuario: string,
): Promise<Resultado> {
  const origen = `http://${HOST_SITIO}:${sitio.puerto}`;
  const politica = {
    urlBase: `${origen}${escenario.inicio}`,
    dominios: [HOST_SITIO],
    sistemaInterno: false,
    puertosLocales: [],
  };
  const politicaLogin = {
    ...politica,
    dominios: [HOST_SITIO, ...(escenario.dominiosAutenticacion ?? [])],
  };
  const resultado: Resultado = {
    paginas: [],
    hallazgos: [],
    logins: [],
    sesiones: [],
    escaneoProxy: [],
    detenido: null,
  };
  const proxy = await iniciarProxy({
    politica,
    credencial: CREDENCIAL_PROXY,
    alRegistrar: (r) => resultado.escaneoProxy.push(r),
    resolver,
  });
  let navegador: Browser | undefined;
  const proxiesDeLogin: { cerrar: () => Promise<void> }[] = [];
  try {
    navegador = await abrirNavegador({
      politica,
      proxy: { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL_PROXY },
      timeoutPaginaMs: 10_000,
    });
    const datos: DatosAutenticacion = {
      estrategia: escenario.estrategia,
      urlLogin: `${origen}${escenario.urlLogin ?? '/app/login'}`,
      pasos: escenario.estrategia === 'formulario' || escenario.estrategia === 'sso' ? PASOS : [],
      indicador: escenario.estrategia === 'basica' ? null : INDICADOR,
      usuario,
      dominiosAutenticacion: escenario.dominiosAutenticacion ?? [],
      sesionMaxMs: null,
    };
    const gestor = new GestorDeSesion(navegador, {
      datos,
      politicaDelEscaneo: politica,
      soloLectura: true,
      alRegistrar: () => undefined,
      timeoutMs: 10_000,
      urlBase: politica.urlBase,
      abrirVisible: () => Promise.reject(new Error('Sin ventana en este test')),
      pedirLogin: async (motivo, reintento) => {
        if (reintento) return null;
        resultado.logins.push(motivo);
        const login = await iniciarProxy({
          politica: politicaLogin,
          credencial: CREDENCIAL_PROXY,
          alRegistrar: () => undefined,
          resolver,
        });
        proxiesDeLogin.push(login);
        return {
          proxy: { servidor: `http://127.0.0.1:${login.puerto}`, ...CREDENCIAL_PROXY },
          politica: politicaLogin,
          secreto: new TextEncoder().encode(secreto),
        };
      },
      informarSesion: (r) => resultado.sesiones.push(r),
      alHallazgo: (h) => resultado.hallazgos.push(h),
    });
    if (!(await gestor.iniciar(null))) throw new Error('No entró');
    const { contexto, vigilancia } = gestor.actual();
    const rastreo = await rastrear(
      contexto,
      vigilancia,
      {
        urlBase: politica.urlBase,
        politica,
        maxPaginas: 50,
        maxProfundidad: 4,
        maxMinutos: 5,
        maxRps: 50,
        exclusiones: [...EXCLUSIONES_POR_DEFECTO, ...EXCLUSIONES_DE_CIERRE],
        timeoutPaginaMs: 10_000,
        soloLectura: true,
      },
      {
        alPagina: (p) => resultado.paginas.push(p),
        alHallazgo: (h) => resultado.hallazgos.push(h),
      },
      Date.now,
      gestor,
    );
    resultado.detenido = rastreo.detenido;
    await gestor.cerrar();
  } finally {
    await navegador?.close();
    await proxy.cerrar();
    await Promise.all(proxiesDeLogin.map((p) => p.cerrar()));
  }
  return resultado;
}

const ruta = (url: string) => new URL(url).pathname;

function comprobarEscenario(escenario: Escenario, resultado: Resultado) {
  const visitadas = Object.fromEntries(resultado.paginas.map((p) => [ruta(p.url), p.status]));
  expect(visitadas).toMatchObject(escenario.paginas);
  for (const nunca of [...autenticado.noVisitaNunca, ...(escenario.noVisita ?? [])]) {
    expect(Object.keys(visitadas), nunca).not.toContain(nunca);
  }
  const comparacion = compararConOraculo(escenario.hallazgos, resultado.hallazgos);
  const resumen = resumenLegible(comparacion);
  expect(comparacion.faltantes, resumen).toEqual([]);
  expect(comparacion.conOtraSeveridad, resumen).toEqual([]);
  expect(comparacion.inesperados, resumen).toEqual([]);
  // Ningún hallazgo sale de una pantalla de login: solo el de la contraseña guardada, que es del login.
  expect(
    resultado.hallazgos.filter(
      (h) => /\/(login|sso|entrar)/.test(ruta(h.url)) && h.tipo !== 'secreto-en-almacenamiento',
    ),
  ).toEqual([]);
  expect(resultado.detenido).toBeNull();
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });
vigilarEntorno(test);

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

test('formulario, admin: recorre lo suyo, nunca el login ni «Salir»', async () => {
  const escenario = autenticado.escenarios.admin as Escenario;
  const resultado = await escanear(
    sitio,
    escenario,
    USUARIOS_APP.admin.clave,
    USUARIOS_APP.admin.usuario,
  );
  comprobarEscenario(escenario, resultado);
  expect(resultado.logins).toEqual(['inicial']);
  expect(sitio.autenticacion.registro.rutasConSesion).not.toContain('/app/salir');
  // El estado guardado no tiene la contraseña.
  expect(JSON.stringify(resultado.sesiones)).not.toContain(USUARIOS_APP.admin.clave);
});

test('formulario, lector: un 403 por rol no es una sesión vencida', async () => {
  const escenario = autenticado.escenarios.lector as Escenario;
  const resultado = await escanear(
    sitio,
    escenario,
    USUARIOS_APP.lector.clave,
    USUARIOS_APP.lector.usuario,
  );
  comprobarEscenario(escenario, resultado);
  expect(resultado.logins).toEqual(['inicial']);
});

test('autenticación básica: las credenciales van solas en cada pedido', async () => {
  const escenario = autenticado.escenarios.basica as Escenario;
  const resultado = await escanear(sitio, escenario, USUARIO_BASICA.clave, USUARIO_BASICA.usuario);
  comprobarEscenario(escenario, resultado);
  expect(resultado.logins).toEqual(['inicial']);
});

test.describe('con la sesión que vence a mitad del escaneo', () => {
  let vence: SandboxActivo;

  test.beforeAll(async () => {
    vence = await iniciarSandbox({
      puerto: 0,
      sesion: { maximoPaginas: autenticado.vencimiento.maximoPaginas },
    });
  });

  test.afterAll(async () => {
    await vence.cerrar();
  });

  test('formulario: confirma, vuelve a entrar, y la página vuelve a la cola sin hallazgos del login', async () => {
    const escenario = autenticado.escenarios.admin as Escenario;
    const resultado = await escanear(
      vence,
      escenario,
      USUARIOS_APP.admin.clave,
      USUARIOS_APP.admin.usuario,
    );
    comprobarEscenario(escenario, resultado);
    expect(resultado.logins[0]).toBe('inicial');
    expect(resultado.logins.slice(1).length).toBeGreaterThan(0);
    expect(new Set(resultado.logins.slice(1))).toEqual(new Set(['vencida']));
    expect(vence.autenticacion.registro.vencidas.length).toBeGreaterThan(0);
  });

  test('SSO: la redirección al proveedor es la señal, y el escaneo nunca sale por el proveedor', async () => {
    const escenario = autenticado.escenarios.sso as Escenario;
    const antes = vence.autenticacion.registro.logins.length;
    const resultado = await escanear(
      vence,
      escenario,
      USUARIOS_APP.admin.clave,
      USUARIOS_APP.admin.usuario,
    );
    comprobarEscenario(escenario, resultado);
    expect(resultado.logins).toContain('vencida');
    const nuevos = vence.autenticacion.registro.logins.slice(antes);
    expect(new Set(nuevos.map((l) => l.via))).toEqual(new Set(['sso']));
    // El proxy del escaneo nunca dejó pasar una conexión al proveedor.
    expect(
      resultado.escaneoProxy.filter((r) => r.permitida && r.destino.startsWith(HOST_IDP)),
    ).toEqual([]);
    // Las cookies del proveedor no quedan en el estado del escaneo.
    expect(JSON.stringify(resultado.sesiones)).not.toContain('idp_sesion');
  });

  test('enlace con token: vuelve a entrar con el mismo enlace, que nunca queda en el estado', async () => {
    const escenario = autenticado.escenarios.enlace as Escenario;
    const enlace = vence.autenticacion.emitirEnlace('lector', { reutilizable: true });
    const token = new URL(enlace).searchParams.get('token') ?? '';
    const resultado = await escanear(
      vence,
      { ...escenario, dominiosAutenticacion: [HOST_PORTAL] },
      enlace,
      '',
    );
    comprobarEscenario(escenario, resultado);
    expect(resultado.logins).toContain('vencida');
    expect(JSON.stringify(resultado.sesiones)).not.toContain(token);
    expect(JSON.stringify(resultado.hallazgos)).not.toContain(token);
  });
});
