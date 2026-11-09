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
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { TextoRedactado } from '@qatlas/redaction';
import {
  HOST_IDP,
  iniciarSandbox,
  JWT_DE_PRUEBA,
  USUARIOS_APP,
  type SandboxActivo,
} from '../apps/sandbox-site/src/servidor.mjs';
import type { Redactor } from '../apps/desktop/src/main/ejecuciones/redaccion';
import {
  archivosCon,
  armar,
  conConsolaCapturada,
  conTemporal,
  CONTRASENA_BOVEDA,
  enTexto as enTextoDe,
  type AppEnProceso,
} from './app-en-proceso';
import { vigilarEntorno } from './entorno';
import { contiene, crearOcr, leerTodas } from './ocr';

/** Único en cada corrida: si aparece, vino de acá. */
const CANARIO = `CANARIO-ts01-${randomUUID().slice(0, 8)}`;
const enTexto = (texto: string, valor = CANARIO) => enTextoDe(texto, valor);
const archivosConCanario = (carpeta: string) => archivosCon(carpeta, CANARIO);

test.describe.configure({ mode: 'serial', timeout: 600_000 });
vigilarEntorno(test);

let sitio: SandboxActivo;

test.beforeAll(async () => {
  sitio = await iniciarSandbox({ puerto: 0, canario: CANARIO });
});

test.afterAll(async () => {
  await sitio.cerrar();
});

/** Las evidencias de varias ejecuciones, como las recibiría la interfaz. */
async function evidenciasDeTodas(app: AppEnProceso, ejecuciones: readonly string[]) {
  const textos: { tipo: string; texto: string }[] = [];
  const capturas: Buffer[] = [];
  for (const id of ejecuciones) {
    const evidencias = await app.evidenciasDe(id);
    textos.push(...evidencias.textos);
    capturas.push(...evidencias.capturas);
  }
  return { textos, capturas };
}

/** Si el canario se ve en alguna captura, leída con OCR (ADR 039). */
async function capturasConCanario(capturas: readonly Buffer[]): Promise<boolean> {
  const ocr = await crearOcr();
  try {
    return (await leerTodas(ocr, capturas)).some((leido) => contiene(leido, CANARIO));
  } finally {
    await ocr.cerrar();
  }
}

/** La base descifrada: cada tabla, y cada campo cifrado con la clave del proyecto, salvo el secreto. */
function baseDescifrada(app: AppEnProceso): string {
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

test('TS-01: el canario no aparece en claro en ningún archivo, ni en la base, ni en la interfaz, ni en los logs', async () => {
  const raiz = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts01-'));
  let abierta: AppEnProceso | undefined;
  try {
    await conConsolaCapturada(async (logs) => {
      await conTemporal(path.join(raiz, 'tmp'), async () => {
        const app = await armar(raiz, sitio);
        abierta = app;
        const { origen, ejecuciones, credencial, crearProyecto, escanear } = app;

        // Las fugas, sin login. El proyecto tiene una credencial con el canario: la redacción lo conoce.
        const fugas = crearProyecto('Fugas', '/fugas', []);
        credencial(fugas, 'admin', 'formulario', `${origen}/app/login`, CANARIO);
        // El canario a la vista en una página con una falla: su captura lo tiene que tapar (EVI-04).
        const visible = crearProyecto('Visible', '/evidencias/visible', [], { maxPaginas: 1 });
        credencial(visible, 'admin', 'formulario', `${origen}/app/login`, CANARIO);
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
        const aLaVista = await escanear(visible, null);
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
        // Las evidencias (semana 7b), descifradas como las recibe la interfaz: HAR, traza y snapshots
        // como texto, y las capturas leídas con OCR.
        const { textos: deEvidencias, capturas } = await evidenciasDeTodas(app, [
          sinLogin,
          aLaVista,
          ...conLogin,
        ]);
        // Se guardaron y se redactaron: el test no pasa porque no hubo evidencias.
        expect(deEvidencias.map((t) => t.tipo)).toEqual(expect.arrayContaining(['traza', 'har']));
        expect(deEvidencias.some((t) => t.texto.includes('[REDACTADO:'))).toBe(true);
        expect(capturas.length).toBeGreaterThan(0);
        lugares['evidencias descifradas'] = enTexto(deEvidencias.map((t) => t.texto).join('\n'));
        lugares['capturas (OCR)'] = (await capturasConCanario(capturas)) ? ['visible'] : [];
        expect(lugares).toEqual({
          archivos: [],
          'base descifrada': [],
          interfaz: [],
          logs: [],
          'evidencias descifradas': [],
          'capturas (OCR)': [],
        });
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
  let abierta: AppEnProceso | undefined;
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
      const app = await armar(raiz, sitio, sinRedactar);
      abierta = app;
      const fugas = app.crearProyecto('Fugas', '/fugas', []);
      app.credencial(fugas, 'admin', 'formulario', `${app.origen}/app/login`, CANARIO);
      const id = await app.escanear(fugas, null);
      expect(enTexto(baseDescifrada(app))).toContain('tal cual');
      const visible = app.crearProyecto('Visible', '/evidencias/visible', [], { maxPaginas: 1 });
      app.credencial(visible, 'admin', 'formulario', `${app.origen}/app/login`, CANARIO);
      const aLaVista = await app.escanear(visible, null);
      // Sin redacción, el canario queda en las evidencias descifradas y a la vista en una captura: el
      // OCR lo lee. Así, en el test principal, no encontrarlo dice algo.
      const { textos, capturas } = await evidenciasDeTodas(app, [id, aLaVista]);
      expect(enTexto(textos.map((t) => t.texto).join('\n'))).toContain('tal cual');
      expect(await capturasConCanario(capturas)).toBe(true);
      app.boveda.bloquear();
    });
  } finally {
    // Si el test falló antes, la base sigue abierta: se cierra para poder borrar la carpeta.
    abierta?.boveda.bloquear();
    rmSync(raiz, { recursive: true, force: true, maxRetries: 3 });
  }
});
