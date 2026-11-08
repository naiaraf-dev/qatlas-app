/**
 * TS-01, el secreto canario (versión de la semana 7), y TS-13 parcial.
 *
 * Un proyecto con credenciales cuyo secreto es un canario único. Se ejecutan: probar login, un escaneo sin
 * login sobre las páginas que filtran el canario, escaneos autenticados con las cuatro estrategias
 * (formulario, SSO, enlace con token y asistido, donde la persona escribe el canario en la ventana),
 * bloqueo y desbloqueo, y copia de seguridad y restauración. Después se busca el canario, en sus
 * codificaciones comunes, en todos los archivos (datos, logs, copia, temporales y perfiles), en la base
 * descifrada campo por campo (salvo el secreto de la credencial, que es el único lugar donde debe estar,
 * cifrado), en lo que recibe la interfaz y en la consola. Cero apariciones en claro.
 *
 * Control positivo: el mismo escaneo con la redacción apagada encuentra el canario. Así este test no
 * puede pasar por la razón equivocada (por ejemplo, porque nada se guardó).
 *
 * Corre los servicios y el runner reales en este proceso, como `ts-06-login-asistido.e2e.ts`, para manejar
 * la ventana del asistido. La app no tiene ningún comportamiento especial para tests.
 */
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { EXCLUSIONES_POR_DEFECTO, PROYECTO_POR_DEFECTO } from '@qatlas/shared';
import type { MensajeAlRunner, MensajeDelRunner } from '@qatlas/runner';
import type { TextoRedactado } from '@qatlas/redaction';
import {
  HOST_IDP,
  HOST_SITIO,
  iniciarSandbox,
  JWT_DE_PRUEBA,
  MAPA_DE_HOSTS,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type {
  LanzadorDeProcesos,
  ProcesoRunner,
  ServicioEjecuciones,
} from '../apps/desktop/src/main/ejecuciones/servicio';
import type { Redactor } from '../apps/desktop/src/main/ejecuciones/redaccion';
import { abrirNavegadorVisible, type NavegadorVisible } from '../packages/runner/src/motor/motor';
import { crearRunner } from '../packages/runner/src/motor/runner';
import { iniciarProxy } from '../packages/runner/src/red/proxy';
import { restaurarEntorno, vigilarEntorno } from './entorno';

const CONTRASENA_BOVEDA = 'tigre-morado-bajo-la-lluvia-73';
/** Único en cada corrida: si aparece, vino de acá. */
const CANARIO = `CANARIO-ts01-${randomUUID().slice(0, 8)}`;

/** El canario en las formas en que suele quedar escrito. */
function codificaciones(valor: string): { nombre: string; bytes: Buffer }[] {
  const utf8 = Buffer.from(valor, 'utf8');
  const textos: [string, string][] = [
    ['tal cual', valor],
    ['base64', utf8.toString('base64')],
    ['base64 sin relleno', utf8.toString('base64').replace(/=+$/, '')],
    ['base64url', utf8.toString('base64url')],
    ['codificado para URL', encodeURIComponent(valor)],
    ['hex', utf8.toString('hex')],
    ['HEX', utf8.toString('hex').toUpperCase()],
  ];
  return [
    ...textos.map(([nombre, texto]) => ({ nombre, bytes: Buffer.from(texto, 'utf8') })),
    { nombre: 'UTF-16', bytes: Buffer.from(valor, 'utf16le') },
  ];
}

/** Dónde aparece el canario en un texto: el nombre de cada codificación encontrada. */
const enTexto = (texto: string, valor = CANARIO) =>
  codificaciones(valor)
    .filter(({ bytes }) => Buffer.from(texto, 'utf8').includes(bytes))
    .map(({ nombre }) => nombre);

/** Cada archivo debajo de una carpeta con el canario en alguna codificación: «ruta (codificación)». */
function archivosConCanario(carpeta: string): string[] {
  const agujas = codificaciones(CANARIO);
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
      try {
        if (statSync(ruta).isDirectory()) {
          recorrer(ruta);
          continue;
        }
        const datos = readFileSync(ruta);
        for (const { nombre: codificacion, bytes } of agujas) {
          if (datos.includes(bytes))
            encontrados.push(`${path.relative(carpeta, ruta)} (${codificacion})`);
        }
      } catch {
        // Un archivo que se borró mientras se leía.
      }
    }
  };
  recorrer(carpeta);
  return encontrados;
}

// Como en TS-06: el driver de Drizzle importa 'better-sqlite3' y QAtlas usa la variante con SQLCipher.
registerHooks({
  resolve: (especificador, contexto, siguiente) =>
    siguiente(
      especificador === 'better-sqlite3' ? 'better-sqlite3-multiple-ciphers' : especificador,
      contexto,
    ),
});
const servicios = async () => ({
  ...(await import('../apps/desktop/src/main/boveda/servicio')),
  ...(await import('../apps/desktop/src/main/proyectos/servicio')),
  ...(await import('../apps/desktop/src/main/ejecuciones/servicio')),
  ...(await import('../apps/desktop/src/main/ejecuciones/redaccion-guardada')),
  ...(await import('../apps/desktop/src/main/registro')),
});

const resolver = (host: string) => {
  const ip = MAPA_DE_HOSTS[host];
  return ip ? Promise.resolve([ip]) : Promise.reject(new Error('ENOTFOUND'));
};

const PASOS = [
  { accion: 'rellenar' as const, selector: '#usuario', origen: 'usuario' as const },
  { accion: 'rellenar' as const, selector: '#clave', origen: 'secreto' as const },
  { accion: 'click' as const, selector: 'button[type=submit]' },
];
const INDICADOR = { tipo: 'aparece' as const, selector: '#menu-usuario' };

test.describe.configure({ mode: 'serial', timeout: 600_000 });
vigilarEntorno(test);

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, canario: CANARIO });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

/**
 * Todo lo necesario para correr la app sin Electron en una carpeta del test. `redactor` solo lo cambia el
 * control positivo.
 */
async function armar(raiz: string, redactor?: Redactor) {
  const s = await servicios();
  const datos = path.join(raiz, 'datos');
  const temporal = path.join(raiz, 'tmp');
  mkdirSync(temporal, { recursive: true });
  s.iniciarRegistro({ carpeta: path.join(datos, 'logs') });

  let visible: NavegadorVisible | undefined;
  const runnersVivos = new Set<{ terminado: boolean }>();
  const boveda = new s.ServicioBoveda({
    carpeta: datos,
    alAbrir: (base, maestra) => {
      s.redactarLoGuardado(base, maestra);
    },
    antesDeBloquear: (base) => {
      // Se crea más abajo; este callback corre recién al bloquear.
      ejecuciones.alBloquearse(base);
    },
  });
  await boveda.crear(CONTRASENA_BOVEDA, false);
  const proyectos = new s.ServicioProyectos(boveda, (id) => {
    ejecuciones.descartarSesiones(id);
  });
  const lanzador: LanzadorDeProcesos = {
    iniciarProxy: async (datosProxy, alRegistrar) => {
      const proxy = await iniciarProxy({ ...datosProxy, alRegistrar, resolver });
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
      const estado = { terminado: false };
      runnersVivos.add(estado);
      const runner = crearRunner({
        enviar: (mensaje: MensajeDelRunner) => {
          eventos.emit('mensaje', structuredClone(mensaje));
        },
        alTerminar: () => {
          estado.terminado = true;
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
        alSalir: (oyente) => {
          if (estado.terminado) oyente();
          else eventos.on('salir', oyente);
        },
        detener: () => {
          eventos.emit('salir');
        },
      };
      return proceso;
    },
    limpiarPerfil: () => undefined,
  };
  const ejecuciones: ServicioEjecuciones = new s.ServicioEjecuciones(
    boveda,
    proyectos,
    lanzador,
    undefined,
    undefined,
    redactor,
  );

  const origen = `http://${HOST_SITIO}:${sitio.puerto}`;
  const crearProyecto = (nombre: string, inicio: string, dominiosAutenticacion: string[]) => {
    const entrada = {
      ...PROYECTO_POR_DEFECTO,
      nombre,
      descripcion: '',
      urlBase: `${origen}${inicio}`,
      dominios: [HOST_SITIO],
      puertosLocales: [],
      exclusiones: [...EXCLUSIONES_POR_DEFECTO],
      selectoresSensibles: [],
      dominiosAutenticacion,
      permitirLoginHttp: true,
      maxRps: 20,
      maxPaginas: 30,
      maxProfundidad: 3,
    };
    const { declaracion } = proyectos.validar(entrada);
    if (!declaracion) throw new Error(`El proyecto ${nombre} no es válido`);
    const creado = proyectos.crear(entrada, { aceptada: true, ...declaracion });
    if (creado.resultado !== 'creado') throw new Error(JSON.stringify(creado));
    return creado.id;
  };
  const credencial = (
    proyectoId: string,
    rol: string,
    estrategia: 'formulario' | 'sso' | 'token-url' | 'asistido',
    urlLogin: string,
    secreto?: string,
  ) => {
    const res = proyectos.guardarCredencial({
      proyectoId,
      nombre: rol,
      rol,
      estrategia,
      usuario:
        estrategia === 'formulario' || estrategia === 'sso' ? USUARIOS_APP.admin.usuario : '',
      urlLogin,
      pasosLogin: estrategia === 'formulario' || estrategia === 'sso' ? PASOS : [],
      indicadorExito: INDICADOR,
      ...(secreto === undefined ? {} : { secreto }),
    });
    if (res.resultado !== 'guardada') throw new Error(JSON.stringify(res));
    return res.credencialId;
  };
  /** Lanza y espera a que la ejecución figure terminada (con su perfil ya borrado). */
  const escanear = async (proyectoId: string, credencialId: string | null) => {
    const lanzada = ejecuciones.lanzarEscaneo(proyectoId, credencialId);
    if (lanzada.resultado !== 'encolada') throw new Error(JSON.stringify(lanzada));
    const id = lanzada.ejecucionId;
    await expect
      .poll(() => ejecuciones.listar(proyectoId).find((e) => e.id === id)?.estado, {
        timeout: 240_000,
      })
      .toBe('finalizada');
    return id;
  };
  return {
    s,
    boveda,
    proyectos,
    ejecuciones,
    origen,
    datos,
    temporal,
    crearProyecto,
    credencial,
    escanear,
    ventana: () => visible,
    runnersTerminados: () => [...runnersVivos].every((r) => r.terminado),
  };
}

/** La base descifrada: cada tabla, y cada campo cifrado con la clave del proyecto, salvo el secreto. */
function baseDescifrada(app: Awaited<ReturnType<typeof armar>>): string {
  const { boveda, proyectos, s } = app;
  return boveda.conAcceso((base) => {
    const partes: string[] = [];
    const tablas = (
      base.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map(({ name }) => name);
    for (const tabla of tablas) {
      // Lo único que se excluye: el secreto de la credencial, cifrado, que es donde debe estar.
      const filas = base.prepare(`SELECT * FROM "${tabla}"`).all() as Record<string, unknown>[];
      partes.push(
        JSON.stringify(
          filas.map((fila) => (tabla === 'credencial' ? { ...fila, secreto: '<excluido>' } : fila)),
        ),
      );
    }
    const proyectosIds = (base.prepare('SELECT id FROM proyecto').all() as { id: string }[]).map(
      (p) => p.id,
    );
    for (const proyectoId of proyectosIds) {
      const ocurrencias = base
        .prepare(
          'SELECT id, detalle_cifrado FROM hallazgo_ocurrencia WHERE proyecto_id = ? AND detalle_cifrado IS NOT NULL',
        )
        .all(proyectoId) as { id: string; detalle_cifrado: Buffer }[];
      const paginas = base
        .prepare(
          'SELECT ejecucion_id, url_completa_cifrada FROM pagina_visitada WHERE proyecto_id = ? AND url_completa_cifrada IS NOT NULL',
        )
        .all(proyectoId) as { ejecucion_id: string; url_completa_cifrada: Buffer }[];
      partes.push(
        ...proyectos.descifrarDatos(proyectoId, [
          ...ocurrencias.map((o) => ({
            contexto: s.contextoDetalle(proyectoId, o.id),
            sellado: o.detalle_cifrado,
          })),
          ...paginas.map((p) => ({
            contexto: s.contextoUrlPagina(proyectoId, p.ejecucion_id),
            sellado: p.url_completa_cifrada,
          })),
        ]),
      );
    }
    return partes.join('\n');
  });
}

/** Captura la consola mientras corre `cuerpo`: los logs del proceso también se revisan. */
async function conConsolaCapturada<T>(cuerpo: (logs: string[]) => Promise<T>): Promise<T> {
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
  try {
    return await cuerpo(logs);
  } finally {
    Object.assign(console, originales);
  }
}

/** El TEMP del proceso va a la carpeta del test, como en la app va a la de la ejecución. */
async function conTemporal<T>(temporal: string, cuerpo: () => Promise<T>): Promise<T> {
  const antes = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  mkdirSync(temporal, { recursive: true });
  process.env.TEMP = temporal;
  process.env.TMP = temporal;
  process.env.TMPDIR = temporal;
  try {
    return await cuerpo();
  } finally {
    restaurarEntorno(antes);
  }
}

test('TS-01: el canario no aparece en claro en ningún archivo, ni en la base, ni en la interfaz, ni en los logs', async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts01-'));
  let abierta: Awaited<ReturnType<typeof armar>> | undefined;
  try {
    await conConsolaCapturada(async (logs) => {
      await conTemporal(path.join(raiz, 'tmp'), async () => {
        const app = await armar(raiz);
        abierta = app;
        const { origen, ejecuciones, credencial, crearProyecto, escanear } = app;

        // Las fugas, sin login. El proyecto tiene una credencial con el canario: la redacción lo conoce.
        const fugas = crearProyecto('Fugas', '/fugas', []);
        credencial(fugas, 'admin', 'formulario', `${origen}/app/login`, CANARIO);
        // La app con login, con las cuatro estrategias. Todas entran con el canario.
        const appSandbox = crearProyecto('App', '/app/inicio', [HOST_IDP]);
        const formulario = credencial(
          appSandbox,
          'admin',
          'formulario',
          `${origen}/app/login`,
          CANARIO,
        );
        const sso = credencial(appSandbox, 'admin-sso', 'sso', `${origen}/app/sso`, CANARIO);
        const enlace = credencial(
          appSandbox,
          'admin-enlace',
          'token-url',
          '',
          sitio.autenticacion.emitirEnlace('admin', { reutilizable: true, token: CANARIO }),
        );
        const asistido = credencial(
          appSandbox,
          'admin-asistido',
          'asistido',
          `${origen}/app/login`,
        );

        // 1. Probar login.
        expect(await ejecuciones.probarLogin(appSandbox, formulario)).toEqual({
          resultado: 'funciono',
        });

        // 2. Escaneo sin login de las páginas que filtran el canario.
        const sinLogin = await escanear(fugas, null);
        const detalleFugas = ejecuciones.detalle(sinLogin);
        // Se capturó y se redactó: el test no pasa porque no se guardó nada.
        const textos = JSON.stringify(detalleFugas);
        expect(textos).toContain('[REDACTADO:credencial]');
        expect(textos).toContain('[REDACTADO:jwt]');
        expect(textos).toContain('[REDACTADO:clave-privada]');
        expect(detalleFugas?.hallazgos.some((h) => h.secretosRedactados > 0)).toBe(true);
        // TS-13: el log del backend imprimió el canario y un JWT, y QAtlas los guardó redactados.
        expect(sitio.registroBackend.join('\n')).toContain(CANARIO);
        const registroBackend = detalleFugas?.hallazgos.filter((h) =>
          h.url.endsWith('/fugas/registro'),
        );
        expect(registroBackend?.map((h) => h.detalle)).toEqual(
          expect.arrayContaining([
            '[api] login de ana con clave=[REDACTADO:campo]',
            '[api] emitido el token [REDACTADO:jwt]',
          ]),
        );

        // 3. Escaneos autenticados con las cuatro estrategias.
        const conLogin = [
          await escanear(appSandbox, formulario),
          await escanear(appSandbox, sso),
          await escanear(appSandbox, enlace),
        ];
        // El asistido: la persona escribe el canario en la ventana.
        const lanzada = ejecuciones.lanzarEscaneo(appSandbox, asistido);
        if (lanzada.resultado !== 'encolada') throw new Error(lanzada.motivo);
        await expect
          .poll(() => app.ventana()?.contexto.pages()[0]?.url() ?? '', { timeout: 60_000 })
          .toContain('/app/login');
        const ventana = app.ventana()?.contexto.pages()[0];
        if (!ventana) throw new Error('No se abrió la ventana');
        await ventana.locator('#usuario').fill(USUARIOS_APP.admin.usuario);
        await ventana.locator('#clave').fill(CANARIO);
        await ventana.locator('button[type=submit]').click();
        await expect
          .poll(
            () => ejecuciones.listar(appSandbox).find((e) => e.id === lanzada.ejecucionId)?.estado,
            { timeout: 240_000 },
          )
          .toBe('finalizada');
        conLogin.push(lanzada.ejecucionId);
        // Entraron de verdad: la página de depuración, con sesión, imprimió el canario y quedó redactada.
        for (const id of conLogin) {
          const detalle = ejecuciones.detalle(id);
          expect(detalle?.paginas.map((p) => new URL(p.url).pathname)).toContain('/app/depuracion');
          expect(detalle?.hallazgos.find((h) => h.url.endsWith('/app/depuracion'))?.detalle).toBe(
            'sesión de admin con la clave [REDACTADO:credencial]',
          );
        }

        // 4. Bloqueo y desbloqueo. 5. Copia de seguridad y restauración.
        app.boveda.bloquear();
        await app.boveda.desbloquear(CONTRASENA_BOVEDA);
        const copia = path.join(raiz, 'copia.qatlas');
        app.boveda.crearCopia(copia);
        expect(await app.boveda.restaurar(copia, CONTRASENA_BOVEDA)).toEqual({
          resultado: 'restaurada',
        });

        // La búsqueda. Primero, que todo terminó: ningún runner ni navegador sigue escribiendo.
        expect(app.runnersTerminados()).toBe(true);
        const lugares: Record<string, string[]> = {
          archivos: archivosConCanario(raiz),
          'base descifrada': enTexto(baseDescifrada(app)),
          interfaz: enTexto(
            JSON.stringify([
              ...[sinLogin, ...conLogin].map((id) => ejecuciones.detalle(id)),
              ejecuciones.listar(fugas),
              ejecuciones.listar(appSandbox),
              ejecuciones.conexionesRecientes(500),
              app.proyectos.obtener(appSandbox),
            ]),
          ),
          logs: enTexto(logs.join('\n')),
        };
        expect(lugares).toEqual({ archivos: [], 'base descifrada': [], interfaz: [], logs: [] });
        // Y el JWT del log del backend (TS-13), tampoco.
        expect(enTexto(baseDescifrada(app), JWT_DE_PRUEBA)).toEqual([]);
        // Los logs técnicos existen y se revisaron: no es que estuvieran vacíos.
        expect(readdirSync(path.join(app.datos, 'logs'))).toContain('qatlas.log');
        app.boveda.bloquear();
      });
    });
  } finally {
    // Si el test falló antes, la base sigue abierta: se cierra para poder borrar la carpeta.
    abierta?.boveda.bloquear();
    rmSync(raiz, { recursive: true, force: true, maxRetries: 3 });
  }
});

test('control positivo: con la redacción apagada, el mismo escaneo deja el canario en la base', async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts01-control-'));
  let abierta: Awaited<ReturnType<typeof armar>> | undefined;
  /** No redacta nada: solo para este control. La app usa siempre el de verdad. */
  const sinRedactar: Redactor = {
    texto: (texto) => ({ texto: texto as TextoRedactado, registros: [] }),
    url: (url) => ({ texto: url as TextoRedactado, registros: [] }),
    secuencia: (textos) =>
      textos.map((texto) => ({ texto: texto as TextoRedactado, registros: [] })),
    encabezados: (encabezados) => ({
      encabezados: encabezados.map(({ nombre, valor }) => ({
        nombre,
        valor: valor as TextoRedactado,
      })),
      registros: [],
    }),
    cuerpo: (cuerpo) => ({ texto: cuerpo as TextoRedactado, registros: [] }),
  };
  try {
    await conTemporal(path.join(raiz, 'tmp'), async () => {
      const app = await armar(raiz, sinRedactar);
      abierta = app;
      const fugas = app.crearProyecto('Fugas', '/fugas', []);
      app.credencial(fugas, 'admin', 'formulario', `${app.origen}/app/login`, CANARIO);
      await app.escanear(fugas, null);
      expect(enTexto(baseDescifrada(app))).toContain('tal cual');
      app.boveda.bloquear();
    });
  } finally {
    // Si el test falló antes, la base sigue abierta: se cierra para poder borrar la carpeta.
    abierta?.boveda.bloquear();
    rmSync(raiz, { recursive: true, force: true, maxRetries: 3 });
  }
});
