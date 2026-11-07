/**
 * TS-06 con el login asistido: la contraseña que la persona escribe en la ventana nunca queda en el
 * estado de sesión, en el perfil del navegador, en la base ni en los logs.
 *
 * Corre los servicios reales (bóveda, proyectos y ejecuciones) y el runner real (`crearRunner`), pero en
 * este proceso: así Playwright maneja la ventana visible y escribe el canario como contraseña. En la app,
 * el runner es un `utilityProcess` y su ventana no tiene un puerto por donde manejarla, a propósito. El
 * sandbox guarda la contraseña en localStorage al enviar el formulario, para que el control sea real.
 *
 * Las esperas son por señales: la ventana pidió la pantalla de login, el sandbox mostró el segundo
 * factor, la ejecución terminó. Nunca por tiempo.
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium, type BrowserContext } from 'playwright-core';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import type { MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
import {
  HOST_SITIO,
  iniciarSandbox,
  MAPA_DE_HOSTS,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type {
  LanzadorDeProcesos,
  ProcesoRunner,
  ServicioEjecuciones,
} from '../apps/desktop/src/main/ejecuciones/servicio';
import {
  abrirNavegadorVisible,
  ARGUMENTOS_CHROMIUM,
  type NavegadorVisible,
} from '../packages/runner/src/motor/motor';
import { crearRunner } from '../packages/runner/src/motor/runner';
import { iniciarProxy } from '../packages/runner/src/red/proxy';
import { restaurarEntorno, vigilarEntorno } from './entorno';

/** La contraseña del usuario del sandbox es el canario: es única y se busca byte a byte. */
const CANARIO = USUARIOS_APP.admin.clave;
const CONTRASENA_BOVEDA = 'tigre-morado-bajo-la-lluvia-73';

const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

/** Cada archivo debajo de una carpeta, con el canario en UTF-8 o UTF-16 (como guarda Chromium). */
function archivosConCanario(carpeta: string): string[] {
  const agujas = [Buffer.from(CANARIO, 'utf8'), Buffer.from(CANARIO, 'utf16le')];
  const encontrados: string[] = [];
  const recorrer = (actual: string) => {
    let nombres: string[];
    try {
      nombres = readdirSync(actual);
    } catch {
      return;
    }
    for (const nombre of nombres) {
      const ruta = path.join(actual, nombre);
      let datos: Buffer;
      try {
        if (statSync(ruta).isDirectory()) {
          recorrer(ruta);
          continue;
        }
        datos = readFileSync(ruta);
      } catch {
        // Un archivo que Chromium tiene bloqueado o que se borró mientras se leía.
        continue;
      }
      if (agujas.some((aguja) => datos.includes(aguja))) {
        encontrados.push(path.relative(carpeta, ruta));
      }
    }
  };
  recorrer(carpeta);
  return encontrados;
}

// Lo mismo que el alias de Vitest y de electron-vite: el driver de Drizzle importa 'better-sqlite3', y
// QAtlas usa la variante con SQLCipher (ADR 006). Antes de cargar los servicios, y solo en este proceso.
registerHooks({
  resolve: (especificador, contexto, siguiente) =>
    siguiente(
      especificador === 'better-sqlite3' ? 'better-sqlite3-multiple-ciphers' : especificador,
      contexto,
    ),
});
/** Los perfiles de la ventana del asistido que hay en la carpeta de la ejecución. */
const perfilesDeVentana = (carpeta: string): string[] =>
  readdirSync(carpeta).filter((nombre) => nombre.startsWith('asistido-'));

const CREDENCIAL_PROXY = { usuario: 'ejecucion', clave: 'clave-de-prueba-de-un-solo-uso' };

/**
 * Entra con el formulario del sandbox en una pestaña del contexto, con la página interna del gestor de
 * contraseñas abierta en otra, y devuelve lo que el gestor registró: su decisión al enviar.
 */
async function decisionDelGestor(contexto: BrowserContext, origen: string): Promise<string> {
  const internos = await contexto.newPage();
  await internos.goto('chrome://password-manager-internals/');
  const pagina = await contexto.newPage();
  await pagina.goto(`${origen}/app/login`);
  await pagina.locator('#usuario').fill(USUARIOS_APP.admin.usuario);
  await pagina.locator('#clave').fill(CANARIO);
  await pagina.locator('button[type=submit]').click();
  await pagina.locator('#menu-usuario').waitFor();
  // Después de la navegación, el gestor decide si ofrece guardar: esa línea llega sola.
  await expect
    .poll(() => internos.locator('body').innerText(), { timeout: 15_000 })
    .toContain('AskUserOrSavePassword');
  return internos.locator('body').innerText();
}

const servicios = async () => ({
  ...(await import('../apps/desktop/src/main/boveda/servicio')),
  ...(await import('../apps/desktop/src/main/proyectos/servicio')),
  ...(await import('../apps/desktop/src/main/ejecuciones/servicio')),
});

test.describe.configure({ mode: 'serial', timeout: 240_000 });
vigilarEntorno(test);

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0 });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

test('TS-06: lo que se escribe en la ventana del login asistido no queda en ningún lado', async () => {
  const { ServicioBoveda, ServicioProyectos, ServicioEjecuciones: Ejecuciones } = await servicios();
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts06-'));
  const carpetaBoveda = path.join(raiz, 'boveda');
  // La carpeta de la ejecución, que en la app está en la carpeta de datos (ADR 018). El temporal del
  // proceso apunta ahí también, como en la app, para revisar todo junto.
  const temporal = mkdtempSync(path.join(raiz, 'tmp-'));
  const entornoAntes = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = temporal;
  process.env.TMP = temporal;
  process.env.TMPDIR = temporal;

  const logs: string[] = [];
  const originales = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
  };
  for (const nivel of ['log', 'warn', 'error', 'info'] as const) {
    console[nivel] = (...partes: unknown[]) => {
      logs.push(partes.map(String).join(' '));
    };
  }

  let visible: NavegadorVisible | undefined;
  const boveda = new ServicioBoveda({ carpeta: carpetaBoveda });
  let ejecuciones: ServicioEjecuciones | undefined;
  try {
    await boveda.crear(CONTRASENA_BOVEDA, false);
    const proyectos = new ServicioProyectos(boveda, (id) => {
      ejecuciones?.descartarSesiones(id);
    });

    const lanzador: LanzadorDeProcesos = {
      iniciarProxy: async (datos, alRegistrar) => {
        const proxy = await iniciarProxy({ ...datos, alRegistrar, resolver });
        return {
          puerto: proxy.puerto,
          alCaer: () => undefined,
          detener: () => {
            void proxy.cerrar();
          },
        };
      },
      iniciarRunner: () => {
        const eventos = new EventEmitter();
        // `postMessage` clona: acá también, ida y vuelta.
        const runner = crearRunner({
          enviar: (mensaje: MensajeDelRunner) => {
            eventos.emit('mensaje', structuredClone(mensaje));
          },
          alTerminar: () => {
            eventos.emit('salir');
          },
          carpetaPerfil: temporal,
          abrirVisible: async (proxy) => {
            visible = await abrirNavegadorVisible(proxy, temporal);
            return visible;
          },
        });
        const proceso: ProcesoRunner = {
          enviar: (mensaje: MensajeAlRunner) => {
            runner.recibir(structuredClone(mensaje));
          },
          alMensaje: (oyente) => eventos.on('mensaje', oyente),
          alSalir: (oyente) => eventos.on('salir', oyente),
          detener: () => {
            eventos.emit('salir');
          },
        };
        return proceso;
      },
      limpiarPerfil: () => undefined,
    };
    ejecuciones = new Ejecuciones(boveda, proyectos, lanzador);

    const origen = `http://${HOST_SITIO}:${sitio.puerto}`;
    const entrada = {
      ...PROYECTO_POR_DEFECTO,
      nombre: 'Sandbox',
      descripcion: '',
      urlBase: `${origen}/app/inicio`,
      dominios: [HOST_SITIO],
      puertosLocales: [],
      exclusiones: [...EXCLUSIONES_POR_DEFECTO],
      selectoresSensibles: [],
      dominiosAutenticacion: [],
      permitirLoginHttp: true,
      maxRps: 20,
    };
    const { declaracion } = proyectos.validar(entrada);
    if (!declaracion) throw new Error('El proyecto de prueba no es válido');
    const creado = proyectos.crear(entrada, { aceptada: true, ...declaracion });
    if (creado.resultado !== 'creado') throw new Error(JSON.stringify(creado));
    const credencial = proyectos.guardarCredencial({
      proyectoId: creado.id,
      nombre: 'Con segundo factor',
      rol: 'admin',
      estrategia: 'asistido',
      usuario: '',
      urlLogin: `${origen}/app/login-mfa`,
      pasosLogin: [],
      indicadorExito: { tipo: 'aparece', selector: '#menu-usuario' },
    });
    if (credencial.resultado !== 'guardada') throw new Error(JSON.stringify(credencial));

    const lanzada = ejecuciones.lanzarEscaneo(creado.id, credencial.credencialId);
    if (lanzada.resultado !== 'encolada') throw new Error(lanzada.motivo);

    // 1. La ventana pidió la pantalla de login: la persona (Playwright) escribe.
    await expect
      .poll(() => sitio.registro.rutas.includes('/app/login-mfa'), { timeout: 60_000 })
      .toBe(true);
    const pagina = visible?.contexto.pages()[0];
    if (!pagina) throw new Error('No se abrió la ventana');
    // El perfil de la ventana es propio y va a la carpeta de la ejecución (se borra al cerrar, paso 6).
    expect(perfilesDeVentana(temporal)).toHaveLength(1);
    await pagina.locator('#usuario').fill(USUARIOS_APP.admin.usuario);
    await pagina.locator('#clave').fill(CANARIO);
    await pagina.locator('button[type=submit]').click();

    // 2. El sandbox pidió el segundo factor. Con la ventana todavía abierta, el perfil no lo tiene.
    await expect
      .poll(() => sitio.autenticacion.registro.segundoFactor, { timeout: 30_000 })
      .toBeGreaterThan(0);
    expect(archivosConCanario(temporal)).toEqual([]);
    sitio.autenticacion.aprobarSegundoFactor();

    // 3. Entró y escaneó.
    const id = lanzada.ejecucionId;
    const estado = () => ejecuciones?.listar(creado.id).find((e) => e.id === id)?.estado;
    await expect.poll(estado, { timeout: 180_000 }).toBe('finalizada');
    expect(sitio.autenticacion.registro.logins).toEqual([{ via: 'mfa', rol: 'admin' }]);

    const detalle = ejecuciones.detalle(id);
    const tipos = detalle?.hallazgos.map((h) => `${h.tipo} ${new URL(h.url).pathname}`) ?? [];
    expect(tipos).toContain('secreto-en-almacenamiento /app/login-mfa');
    expect(tipos).toContain('parametro-sensible /app/compartir');

    // 4. El estado de sesión guardado, descifrado, no tiene la contraseña ni la entrada que la tenía.
    const sesion = (
      ejecuciones as unknown as {
        sesionGuardada: (p: string, c: string) => unknown;
      }
    ).sesionGuardada(creado.id, credencial.credencialId);
    expect(sesion).not.toBeNull();
    expect(JSON.stringify(sesion)).not.toContain(CANARIO);
    expect(JSON.stringify(sesion)).not.toContain('clave-recordada');
    expect(JSON.stringify(sesion)).toContain('app_sesion');

    // 5. La base, leída descifrada, tabla por tabla, y sus archivos en disco.
    const contenido = boveda.conAcceso((base) => {
      const tablas = base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[];
      return tablas.map(({ name }) =>
        JSON.stringify(base.prepare(`SELECT * FROM "${name}"`).all()),
      );
    });
    expect(contenido.join('\n')).not.toContain(CANARIO);
    expect(contenido.join('\n')).toContain('secreto-en-almacenamiento');
    expect(archivosConCanario(carpetaBoveda)).toEqual([]);

    // 6. Los logs, y el temporal después de cerrar la ventana.
    expect(logs.join('\n')).not.toContain(CANARIO);
    expect(archivosConCanario(temporal)).toEqual([]);
    expect(perfilesDeVentana(temporal)).toEqual([]);
  } finally {
    Object.assign(console, originales);
    await visible?.cerrar();
    boveda.bloquear();
    restaurarEntorno(entornoAntes);
    rmSync(raiz, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('la ventana del asistido no ofrece guardar la contraseña: el gestor de Chromium está apagado', async () => {
  const origen = `http://${HOST_SITIO}:${sitio.puerto}`;
  const proxy = await iniciarProxy({
    politica: {
      urlBase: `${origen}/app/inicio`,
      dominios: [HOST_SITIO],
      sistemaInterno: false,
      puertosLocales: [],
    },
    credencial: CREDENCIAL_PROXY,
    alRegistrar: () => undefined,
    resolver,
  });
  const datosProxy = { servidor: `http://127.0.0.1:${proxy.puerto}`, ...CREDENCIAL_PROXY };
  try {
    // Control positivo: el mismo login, con un perfil persistente sin esas preferencias, sí lo ofrece
    // (los contextos de `launch` son de incógnito: ahí el gestor no registra nada). Si la página interna
    // dejara de registrar la decisión, este test fallaría acá.
    const perfilNormal = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts06-normal-'));
    try {
      const normal = await chromium.launchPersistentContext(perfilNormal, {
        channel: 'chromium',
        headless: false,
        chromiumSandbox: true,
        args: [...ARGUMENTOS_CHROMIUM],
        proxy: {
          server: datosProxy.servidor,
          username: datosProxy.usuario,
          password: datosProxy.clave,
        },
      });
      try {
        const registro = await decisionDelGestor(normal, origen);
        expect(registro).toContain('Decision: ASK the user');
        expect(registro).toContain('Show password prompt');
      } finally {
        await normal.close();
      }
    } finally {
      rmSync(perfilNormal, { recursive: true, force: true, maxRetries: 3 });
    }

    const carpetaVentana = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts06-ventana-'));
    const visible = await abrirNavegadorVisible(datosProxy, carpetaVentana);
    try {
      const registro = await decisionDelGestor(visible.contexto, origen);
      expect(registro).toContain('Saving disabled');
      expect(registro).toContain('Decision: DROP the password');
      expect(registro).not.toContain('ASK the user');
      expect(registro).not.toContain('Show password prompt');
      expect(registro).toContain('Leak detection disabled');
    } finally {
      await visible.cerrar();
      expect(readdirSync(carpetaVentana)).toEqual([]);
      rmSync(carpetaVentana, { recursive: true, force: true, maxRetries: 3 });
    }
  } finally {
    await proxy.cerrar();
  }
});
