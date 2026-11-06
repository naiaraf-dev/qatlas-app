/**
 * Ejecuciones en la app real: procesos de verdad, proxy, navegador y monitor (TS-03, TS-04, TS-05,
 * RN-EJE-01, RN-EJE-02, EVI-01). Sin ningún comportamiento especial para tests: el sandbox se usa en
 * `127.0.0.1`, con los dominios que aceptaría cualquier proyecto. Requiere `npm run build` antes.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import type { QatlasApi } from '@qatlas/shared';
import {
  CREDENCIALES_DE_PRUEBA,
  HOSTS_DE_FUGA,
  iniciarSandbox,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import { vigilarEntorno } from './entorno';
import { lanzarApp } from './lanzar';

// El service worker no se registra, así que su destino nunca se intenta.
const HOSTS_DE_FUGA_DEL_RECORRIDO = HOSTS_DE_FUGA.filter((host) => host !== 'sw.fuga.invalid');

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
// Menos que el timeout por página del proyecto de prueba, para que la visita no se corte antes.
const DEMORA_LENTA_MS = 4000;
const SONDA = path.resolve(import.meta.dirname, 'fixtures/sonda-utility.cjs');

let carpeta: string;
let app: ElectronApplication;
let page: Page;
let sitio: SandboxActivo;

test.describe.configure({ mode: 'serial', timeout: 150_000 });
vigilarEntorno(test);

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) => page.getByLabel(etiqueta, { exact: true });
const boton = (nombre: string) => page.getByRole('button', { name: nombre, exact: true });
const siguiente = () => boton('Siguiente').click();
const ejecuciones = () =>
  page.getByRole('list', { name: 'Ejecuciones del proyecto' }).locator(':scope > li');

async function crearProyecto(nombre: string, puertos: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await boton('Crear proyecto').click();
  await entrada('Nombre').fill(nombre);
  await entrada('URL base').fill(`${sitio.url}/`);
  await siguiente();
  await expect(entrada('Dominios permitidos')).toHaveValue('127.0.0.1');
  if (puertos) await entrada('Puertos locales adicionales').fill(puertos);
  await siguiente();
  await entrada('Solicitudes por segundo').fill('5');
  await entrada('Timeout por página (segundos)').fill('5');
  // Todo el sandbox está a un link de la raíz: así cada ejecución tarda menos.
  await entrada('Profundidad').fill('1');
  await siguiente();
  await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
  await boton('Crear proyecto').click();
  await expect(titulo(nombre)).toBeVisible();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
}

/** Los procesos de la ejecución, por su nombre de servicio. Electron los conoce: la app no agrega nada. */
const pidsDe = (servicio: string) =>
  app.evaluate(
    ({ app: electronApp }, nombre) =>
      electronApp
        .getAppMetrics()
        .filter((m) => m.type === 'Utility' && m.name === nombre)
        .map((m) => m.pid),
    servicio,
  );

/**
 * Lanza una ejecución y espera a que aparezca en la lista. Sin esto, `ejecuciones().first()` todavía es
 * la ejecución anterior, y lo que se espera de ella puede cumplirse enseguida.
 */
async function lanzarEjecucion(): Promise<void> {
  const antes = await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const proyectos = await qatlas.proyectos.listar();
    const id = proyectos.ok ? proyectos.data[0]?.id : undefined;
    if (!id) return 0;
    const lista = await qatlas.ejecuciones.listar({ proyectoId: id });
    return lista.ok ? lista.data.length : 0;
  });
  await boton('Lanzar ejecución').click();
  await expect(ejecuciones()).toHaveCount(antes + 1);
}

/**
 * La señal de que la ejecución está en curso con el navegador abierto: el sandbox recibió el pedido de
 * la página lenta, y lo retiene `DEMORA_LENTA_MS`. Todo lo que el test haga después ocurre en ese lapso.
 */
async function lanzarHastaPaginaLenta(): Promise<void> {
  const vistas = sitio.registro.rutas.filter((ruta) => ruta === '/lenta').length;
  await lanzarEjecucion();
  await expect
    .poll(() => sitio.registro.rutas.filter((ruta) => ruta === '/lenta').length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(vistas);
}

function archivosCon(raiz: string, canario: string): string[] {
  if (!existsSync(raiz)) return [];
  return (readdirSync(raiz, { recursive: true }) as string[]).filter((nombre) => {
    const ruta = path.join(raiz, nombre);
    try {
      if (!statSync(ruta).isFile()) return false;
      const bytes = readFileSync(ruta);
      return bytes.includes(canario) || bytes.includes(Buffer.from(canario, 'utf16le'));
    } catch {
      return false;
    }
  });
}

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, demoraLentaMs: DEMORA_LENTA_MS });
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-ejecuciones-'));
  // Un perfil de una ejecución cortada, de antes de que arrancara esta instancia.
  const huerfano = path.join(carpeta, 'QAtlas', 'perfiles', 'cortada');
  mkdirSync(huerfano, { recursive: true });
  writeFileSync(path.join(huerfano, 'resto'), 'dato-ficticio');
  ({ app, page } = await lanzarApp(electron, carpeta));
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await entrada('Repetí la contraseña').fill(CONTRASENA);
  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await boton('Crear bóveda').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test.afterAll(async () => {
  await app.close();
  await sitio.cerrar();
  rmSync(carpeta, { recursive: true, force: true, maxRetries: 5 });
});

test('al arrancar se borran los perfiles de una ejecución cortada', () => {
  expect(readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);
});

test('un utilityProcess con entorno explícito no hereda el del proceso principal', async () => {
  // Lo que el ADR 017 afirma. Si una versión de Electron lo cambia, esto lo muestra.
  const resultado = await app.evaluate(
    ({ utilityProcess }, sonda) =>
      new Promise<Record<string, unknown>>((listo) => {
        process.env.CENTINELA_DEL_PRINCIPAL = 'ficticio';
        const hijo = utilityProcess.fork(sonda, [], {
          stdio: 'ignore',
          env: { SOLO_ESTA: '1' },
        });
        hijo.on('message', (mensaje: Record<string, unknown>) => {
          listo(mensaje);
          hijo.kill();
        });
      }),
    SONDA,
  );
  expect(resultado).toEqual({ centinela: false, soloEsta: true, tieneRedElectron: true });
});

test('el proyecto declara un puerto extra, y queda en la declaración', async () => {
  await crearProyecto('Sandbox', String(sitio.puertoApi));
  await expect(page.getByText(String(sitio.puertoApi), { exact: true })).toBeVisible();
});

test('una ejecución abre la URL base, sigue los links y no deja salir nada', async () => {
  await lanzarEjecucion();
  await expect(ejecuciones().first()).toContainText('Ejecución: Finalizada', { timeout: 120_000 });
  await expect(ejecuciones().first()).toContainText(/Páginas: \d\d? · Links excluidos: \d/);
  await expect(ejecuciones().first()).toContainText(/Bloqueadas: [1-9]/);
  expect(sitio.registro.api.length).toBeGreaterThan(0);
  expect(sitio.registro.fugas).toEqual([]);
  expect(sitio.registro.puertoNoDeclarado).toEqual([]);
  expect(sitio.registro.serviceWorkers).toEqual([]);
  // Pasó por /webrtc: nada salió por UDP, en la app real.
  expect(sitio.registro.udp).toEqual([]);
  // TS-05: el recorrido no visitó las trampas ni dejó pasar el POST automático.
  expect(sitio.registro.trampas).toEqual([]);
  expect(sitio.registro.posts).toEqual([]);
});

test('al terminar no queda el perfil, ni el proxy, ni el runner', async () => {
  await expect.poll(() => readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);
  await expect.poll(() => pidsDe('qatlas-proxy')).toEqual([]);
  await expect.poll(() => pidsDe('qatlas-runner')).toEqual([]);
});

test('el resumen muestra cada conexión bloqueada con su regla', async () => {
  await boton('Ver resultado').click();
  const bloqueadas = page.getByRole('region', { name: 'Conexiones bloqueadas de la ejecución' });
  await expect(bloqueadas).toContainText('analitica.fuga.test');
  await expect(bloqueadas).toContainText('fuera-de-dominios');
  await expect(bloqueadas).toContainText(
    `127.0.0.1:${sitio.puertoTrampa} · puerto-local-no-declarado`,
  );
  await expect(bloqueadas).toContainText('redireccion.fuga.test');
  await expect(bloqueadas).toContainText('ws.fuga.example');
  await expect(bloqueadas).toContainText('solo-lectura');
});

test('el monitor no tiene ruido: ningún destino que el sitio no haya pedido', async () => {
  const proyectoId = await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const res = await qatlas.proyectos.listar();
    return res.ok ? res.data[0]?.id : undefined;
  });
  const detalle = await page.evaluate(async (id) => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const lista = await qatlas.ejecuciones.listar({ proyectoId: id as string });
    if (!lista.ok || !lista.data[0]) return null;
    const res = await qatlas.ejecuciones.detalle({ ejecucionId: lista.data[0].id });
    return res.ok ? res.data : null;
  }, proyectoId);
  const hosts = new Set(detalle?.conexiones.map((c) => c.destino.split(':')[0]));
  expect([...hosts].sort()).toEqual([...HOSTS_DE_FUGA_DEL_RECORRIDO, '127.0.0.1'].sort());
});

test('Privacidad y conexiones muestra lo mismo, y sin rutas', async () => {
  await boton('Privacidad y conexiones').click();
  await boton('Actualizar').click();
  const tabla = page.getByRole('table');
  await expect(tabla).toContainText('fuera-de-dominios');
  await expect(tabla).toContainText('Bloqueada');
  await expect(tabla).toContainText('Permitida');
  await expect(tabla).toContainText(`127.0.0.1:${sitio.puerto}`);
  const texto = (await tabla.textContent()) ?? '';
  expect(texto).not.toContain('/fuga');
  expect(texto).not.toContain('/datos');
});

test('TS-03: el proceso principal no abre conexiones propias durante una ejecución', async () => {
  await app.evaluate(() => {
    const { Socket } = process.getBuiltinModule('node:net');
    const estado = globalThis as unknown as { conexiones: string[]; original: unknown };
    estado.conexiones = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- se guarda para reponerlo
    estado.original = Socket.prototype.connect;
    Socket.prototype.connect = function (this: unknown, ...args: unknown[]) {
      estado.conexiones.push(JSON.stringify(args[0]));
      return (estado.original as (...a: unknown[]) => unknown).apply(this, args);
    } as typeof Socket.prototype.connect;
    // Control: si conectara, el registro lo vería.
    new Socket().connect({ host: '127.0.0.1', port: 1 }).on('error', () => undefined);
  });
  expect(
    await app.evaluate(() => (globalThis as unknown as { conexiones: string[] }).conexiones.length),
  ).toBe(1);

  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await page.getByRole('button', { name: /Sandbox/ }).click();
  await lanzarEjecucion();
  await expect(ejecuciones().first()).toContainText('Ejecución: Finalizada', { timeout: 120_000 });

  const conexiones = await app.evaluate(() => {
    const estado = globalThis as unknown as { conexiones: string[]; original: never };
    process.getBuiltinModule('node:net').Socket.prototype.connect = estado.original;
    return estado.conexiones;
  });
  expect(conexiones).toHaveLength(1);
  // Todo lo que le llegó al sitio fue a su propio nombre.
  expect([...new Set(sitio.registro.hosts)]).toEqual(['127.0.0.1']);
});

test('RN-EJE-01: mientras corre, no se lanza otra del mismo proyecto', async () => {
  const proyectoId = await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    const res = await qatlas.proyectos.listar();
    return res.ok ? res.data[0]?.id : undefined;
  });
  await lanzarHastaPaginaLenta();
  await expect(ejecuciones().first()).toContainText('Ejecución: En curso');
  await expect(boton('Lanzar ejecución')).toBeDisabled();
  const segunda = await page.evaluate(async (id) => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    return qatlas.ejecuciones.lanzarEscaneo({ proyectoId: id as string, credencialId: null });
  }, proyectoId);
  expect(segunda).toEqual({ ok: true, data: { resultado: 'rechazada', motivo: 'ya-en-curso' } });
  await boton('Cancelar ejecución').click();
  await expect(ejecuciones().first()).toContainText('Ejecución: Cancelada');
  await expect(ejecuciones().first()).toContainText('La cancelaste.');
  await expect.poll(() => pidsDe('qatlas-runner')).toEqual([]);
  await expect.poll(() => pidsDe('qatlas-proxy')).toEqual([]);
  await expect.poll(() => readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);
});

test('el perfil vive dentro de la carpeta de datos mientras corre, no en el temporal', async () => {
  await lanzarHastaPaginaLenta();
  const perfiles = path.join(carpeta, 'QAtlas', 'perfiles');
  expect(readdirSync(perfiles)).toHaveLength(1);
  const [ejecucion] = readdirSync(perfiles);
  await expect
    .poll(() =>
      readdirSync(path.join(perfiles, ejecucion as string)).some((n) => n.startsWith('playwright')),
    )
    .toBe(true);
  await boton('Cancelar ejecución').click();
  await expect(ejecuciones().first()).toContainText('Ejecución: Cancelada');
  await expect.poll(() => readdirSync(perfiles)).toEqual([]);
});

test('fallar cerrado: si el proxy se cae, la ejecución se aborta', async () => {
  await lanzarHastaPaginaLenta();
  const [pid] = await pidsDe('qatlas-proxy');
  expect(pid).toBeDefined();
  // Solo este PID: lo lanzó esta app, dentro de este test.
  process.kill(pid as number);
  await expect(ejecuciones().first()).toContainText('Ejecución: Fallida', { timeout: 15_000 });
  await expect(ejecuciones().first()).toContainText('El proxy de salida se cayó');
  await expect.poll(() => pidsDe('qatlas-runner')).toEqual([]);
  await expect.poll(() => readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);
});

test('sin el navegador instalado, la ejecución falla y no se descarga nada', async () => {
  // Otra instancia, con un lugar vacío para los navegadores: el código es el mismo de siempre.
  const otra = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-sin-navegador-'));
  const vacia = path.join(otra, 'sin-navegadores');
  mkdirSync(vacia);
  await app.close();
  const sinNavegador = await lanzarApp(electron, carpeta, { PLAYWRIGHT_BROWSERS_PATH: vacia });
  ({ app, page } = sinNavegador);
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await boton('Desbloquear').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await page.getByRole('button', { name: /Sandbox/ }).click();
  await lanzarEjecucion();
  await expect(ejecuciones().first()).toContainText('Ejecución: Fallida', { timeout: 30_000 });
  await expect(ejecuciones().first()).toContainText('El navegador de pruebas no está disponible');
  expect(readdirSync(vacia)).toEqual([]);
  // La causa llega al log, y la interfaz no la muestra.
  await expect
    .poll(() => sinNavegador.diagnostico.join('\n'))
    .toContain('navegador no disponible: ruta');
  await expect(page.locator('body')).not.toContainText('[ejecucion]');

  await app.close();
  rmSync(otra, { recursive: true, force: true });
  ({ app, page } = await lanzarApp(electron, carpeta));
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await boton('Desbloquear').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test('bloquear la bóveda cancela la ejecución y limpia todo', async () => {
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await page.getByRole('button', { name: /Sandbox/ }).click();
  await lanzarHastaPaginaLenta();
  expect(await pidsDe('qatlas-runner')).toHaveLength(1);
  await page.evaluate(async () => {
    const { qatlas } = window as unknown as { qatlas: QatlasApi };
    await qatlas.vault.lock();
  });
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  await expect.poll(() => pidsDe('qatlas-runner')).toEqual([]);
  await expect.poll(() => pidsDe('qatlas-proxy')).toEqual([]);
  await expect.poll(() => readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);

  await entrada('Contraseña maestra').fill(CONTRASENA);
  await boton('Desbloquear').click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await page.getByRole('navigation', { name: 'Principal' }).getByText('Proyectos').click();
  await page.getByRole('button', { name: /Sandbox/ }).click();
  await expect(ejecuciones().first()).toContainText('Ejecución: Cancelada');
  await expect(ejecuciones().first()).toContainText('la bóveda se bloqueó');
});

test('si puede durar más que el tiempo de bloqueo, lo avisa antes de lanzar', async () => {
  await boton('Editar proyecto').click();
  await entrada('Máximo de páginas').fill('10000');
  await entrada('Solicitudes por segundo').fill('1');
  await boton('Guardar cambios').click();
  await expect(page.getByText('Bloquear cancela la ejecución')).toBeVisible();
  await boton('Editar proyecto').click();
  await entrada('Máximo de páginas').fill('200');
  await entrada('Solicitudes por segundo').fill('50');
  await boton('Guardar cambios').click();
  await expect(page.getByText('Bloquear cancela la ejecución')).toBeHidden();
});

test('agregar un puerto invalida la autorización, y sin ella no se puede lanzar', async () => {
  await boton('Editar proyecto').click();
  await entrada('Puertos locales adicionales').fill(`${sitio.puertoApi}, ${sitio.puertoTrampa}`);
  await expect(page.getByText('la autorización deja de valer')).toBeVisible();
  await boton('Guardar cambios').click();
  await expect(page.getByText('Cambió el alcance')).toBeVisible();
  await expect(boton('Lanzar ejecución')).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Acepto esta declaración' }).check();
  await boton('Aceptar autorización').click();
  await expect(page.getByText('Autorización vigente')).toBeVisible();
});

test.describe('Probar login', () => {
  const CANARIO_USUARIO = CREDENCIALES_DE_PRUEBA.usuario;

  async function agregarCredencial(nombre: string, secreto: string, indicador?: string) {
    await boton('Agregar credencial').click();
    await entrada('Nombre de la credencial').fill(nombre);
    await entrada('Rol').fill(nombre);
    await entrada('Usuario').fill(CANARIO_USUARIO);
    await entrada('Secreto').fill(secreto);
    await entrada('URL de login').fill(`${sitio.url}/login`);
    if (indicador) {
      await entrada('Tipo de indicador').selectOption('aparece');
      await entrada('Valor del indicador').fill(indicador);
    }
    await boton('Guardar credencial').click();
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  }

  const fila = (nombre: string) =>
    page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: nombre }) });

  test('sin indicador de éxito, el botón no está disponible y dice por qué', async () => {
    await agregarCredencial('Sin indicador', 'clave-cualquiera');
    const credencial = fila('Sin indicador');
    await expect(credencial.getByRole('button', { name: 'Probar login' })).toBeDisabled();
    await expect(credencial).toContainText('Configurá un indicador de éxito');
  });

  test('con la contraseña correcta, funcionó', async () => {
    await agregarCredencial('Buena', CREDENCIALES_DE_PRUEBA.clave, 'a[href="/cerrar-sesion"]');
    const credencial = fila('Buena');
    await credencial.getByRole('button', { name: 'Probar login' }).click();
    await expect(credencial.getByRole('status')).toHaveText('El login funcionó.', {
      timeout: 60_000,
    });
  });

  test('con una contraseña mala nunca da verde, y el mensaje no trae nada de la página', async () => {
    await agregarCredencial('Mala', 'contrasena-equivocada-1234', 'a[href="/cerrar-sesion"]');
    const credencial = fila('Mala');
    await credencial.getByRole('button', { name: 'Probar login' }).click();
    await expect(
      credencial.getByRole('alert').or(credencial.getByText(/El login falló/)),
    ).toContainText('El login falló: no se cumplió el indicador de éxito.', { timeout: 60_000 });
    await expect(credencial.getByRole('status')).toHaveCount(0);
    await expect(credencial).not.toContainText('Iniciar sesión');
  });

  test('el aviso se ve antes de probar: un intento fallido puede bloquear la cuenta', async () => {
    const credencial = fila('Mala');
    await expect(credencial).toContainText('puede bloquear la cuenta en el sistema probado');
    await expect(credencial).toContainText('Máximo 3 intentos cada 15 minutos');
  });

  test('el cuarto intento no llega al sistema probado, y lo dice', async () => {
    test.setTimeout(90_000);
    const credencial = fila('Mala');
    const boton = credencial.getByRole('button', { name: 'Probar login' });
    const antes = sitio.registro.intentosLogin.length;
    for (let i = 0; i < 2; i++) {
      await boton.click();
      // Mientras prueba, el botón se llama «Probando…»: este localizador lo encuentra de nuevo al terminar.
      await expect.poll(() => sitio.registro.intentosLogin.length).toBe(antes + i + 1);
      await expect(boton).toBeEnabled({ timeout: 30_000 });
      await expect(credencial).toContainText('El login falló');
    }
    expect(sitio.registro.intentosLogin.length).toBe(antes + 2);
    await boton.click();
    await expect(credencial).toContainText('No se hizo ningún intento', { timeout: 30_000 });
    await expect(credencial).toContainText(/Podés volver a probar en \d+ min/);
    expect(sitio.registro.intentosLogin.length).toBe(antes + 2);
    // Otra credencial del mismo proyecto no se ve afectada.
    await expect(fila('Buena').getByRole('button', { name: 'Probar login' })).toBeEnabled();
  });

  test('el secreto no queda en ningún archivo, ni en el perfil ni en los datos', async () => {
    await expect.poll(() => readdirSync(path.join(carpeta, 'QAtlas', 'perfiles'))).toEqual([]);
    expect(archivosCon(carpeta, CREDENCIALES_DE_PRUEBA.clave)).toEqual([]);
    expect(archivosCon(carpeta, 'contrasena-equivocada-1234')).toEqual([]);
  });

  test('una prueba de login queda en las ejecuciones, con su monitor', async () => {
    // Con el rol de la credencial que se probó.
    await expect(ejecuciones().first()).toContainText(/Prueba de login con el rol .+: Finalizada/);
  });
});

test('eliminar el proyecto purga sus ejecuciones y sus conexiones', async () => {
  await entrada('Para confirmar, escribí «Sandbox»').fill('Sandbox');
  await boton('Eliminar definitivamente').click();
  await expect(titulo('Proyectos')).toBeVisible();
  await boton('Privacidad y conexiones').click();
  await boton('Actualizar').click();
  await expect(page.getByText('fuera-de-dominios')).toHaveCount(0);
});
