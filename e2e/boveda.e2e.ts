/**
 * E2E de la bóveda (CU-00, TS-02 y TS-09 en la app real): primer inicio, desbloqueo, freno,
 * bloqueo, copia, restauración y tema persistido, en los dos modos.
 *
 * Cada corrida usa una carpeta temporal como carpeta de datos y contraseñas inventadas: nunca la
 * bóveda real del equipo. Requiere `npm run build` antes.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { lanzarApp } from './lanzar';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const OTRA = 'cometa-verde-sobre-el-rio-58';

let carpeta: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-e2e-boveda-'));
  ({ app, page } = await lanzarApp(electron, carpeta));
});

test.afterAll(async () => {
  await app.close();
  rmSync(carpeta, { recursive: true, force: true });
});

const titulo = (nombre: string) => page.getByRole('heading', { name: nombre, level: 1 });
const entrada = (etiqueta: string) => page.getByLabel(etiqueta, { exact: true });

/** Escrita pero sin enviar: ningún atributo la refleja, aunque el campo la tenga. */
async function verificarSinReflejo(
  etiqueta: string,
  valor: string,
  autocompletar: 'current-password' | 'new-password',
): Promise<void> {
  await expect(entrada(etiqueta)).toHaveValue(valor);
  await expect(entrada(etiqueta)).not.toHaveAttribute('value');
  await expect(entrada(etiqueta)).toHaveAttribute('autocomplete', autocompletar);
  await expect(entrada(etiqueta)).toHaveAttribute('spellcheck', 'false');
  expect(await page.content()).not.toContain(valor);
}

async function desbloquear(contrasena = CONTRASENA): Promise<void> {
  await entrada('Contraseña maestra').fill(contrasena);
  await page.getByRole('button', { name: 'Desbloquear' }).click();
}

/** Lo que el diálogo nativo devolvería: solo el proceso principal conoce la ruta. */
async function simularDialogos(ruta: string): Promise<void> {
  await app.evaluate(({ dialog }, destino) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: destino });
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [destino] });
    dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
  }, ruta);
}

test('primer inicio: pide una contraseña fuerte y avisa que no hay recuperación', async () => {
  await expect(titulo('Creá tu bóveda')).toBeVisible();
  await expect(page.getByText('No hay forma de recuperarla')).toBeVisible();
  const crear = page.getByRole('button', { name: 'Crear bóveda' });
  await expect(crear).toBeDisabled();

  await entrada('Contraseña maestra').fill('corta');
  await expect(page.getByText('al menos 12 caracteres')).toBeVisible();
  await entrada('Contraseña maestra').fill('aaaaaaaaaaaaaaaa');
  await expect(page.getByText(/Fortaleza: (Muy débil|Débil)/)).toBeVisible();

  await entrada('Contraseña maestra').fill(CONTRASENA);
  await expect(page.getByText(/Fortaleza: (Fuerte|Muy fuerte)/)).toBeVisible();
  await verificarSinReflejo('Contraseña maestra', CONTRASENA, 'new-password');
  await entrada('Repetí la contraseña').fill(OTRA);
  await expect(page.getByText('no coinciden')).toBeVisible();
  await entrada('Repetí la contraseña').fill(CONTRASENA);
  await verificarSinReflejo('Repetí la contraseña', CONTRASENA, 'new-password');
  await expect(crear).toBeDisabled();

  await page.getByRole('checkbox', { name: /no hay recuperación/ }).check();
  await expect(crear).toBeEnabled();
});

test('las actualizaciones aparecen deshabilitadas, con cuándo llegan', async () => {
  await expect(page.getByRole('checkbox', { name: /Buscar actualizaciones/ })).toBeDisabled();
  await expect(page.getByText('Llega en: semana 10')).toBeVisible();
});

test('primer inicio: crea la bóveda y entra a la app', async () => {
  await page.getByRole('button', { name: 'Crear bóveda' }).click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  expect(existsSync(path.join(carpeta, 'QAtlas', 'boveda.db'))).toBe(true);
  expect(existsSync(path.join(carpeta, 'QAtlas', 'boveda.sellada'))).toBe(true);
});

test('TS-02 en la app real: ningún archivo de la carpeta tiene la base en texto plano', () => {
  const datos = path.join(carpeta, 'QAtlas');
  const base = readFileSync(path.join(datos, 'boveda.db'));
  expect(base.includes(Buffer.from('SQLite format 3'))).toBe(false);
  expect(base.includes(Buffer.from('CREATE TABLE'))).toBe(false);
  const sellada = readFileSync(path.join(datos, 'boveda.sellada'), 'utf8');
  expect(sellada).not.toContain(CONTRASENA);
  expect(readdirSync(datos).some((n) => n.includes('.tmp-'))).toBe(false);
});

test('la API expuesta a la interfaz incluye solo funciones de la bóveda, sin claves', async () => {
  const claves = await page.evaluate(() => {
    const scope = globalThis as unknown as { qatlas: Record<string, object> };
    return Object.keys(scope.qatlas.vault ?? {}).sort();
  });
  expect(claves).toEqual([
    'create',
    'createBackup',
    'getSettings',
    'getStatus',
    'lock',
    'restoreBackup',
    'setSettings',
    'unlock',
  ]);
});

test('el tema elegido se guarda en la configuración cifrada', async () => {
  const fondo = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.getByRole('radio', { name: 'Oscuro' }).click();
  await expect.poll(fondo).toBe('rgb(11, 13, 18)');

  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  await desbloquear();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(fondo).toBe('rgb(11, 13, 18)');
});

test('la pantalla bloqueada se ve bien en los dos modos', async () => {
  await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  for (const [modo, fondo] of [
    ['dark', 'rgb(11, 13, 18)'],
    ['light', 'rgb(246, 247, 249)'],
  ] as const) {
    // Bloqueada no se conoce la preferencia guardada: la pantalla sigue al sistema.
    await page.emulateMedia({ colorScheme: modo });
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .toBe(fondo);
    await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeVisible();
  }
  await desbloquear();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test('TS-09: al bloquear no queda ningún dato en la interfaz y los canales se rechazan', async () => {
  await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
  await expect(titulo('Bóveda')).toBeVisible();
  await page.keyboard.press('Control+Shift+L');
  await expect(titulo('Bóveda bloqueada')).toBeVisible();

  const visible = await page.evaluate(() => document.body.innerText);
  expect(visible).not.toContain('Privacidad y conexiones');
  expect(visible).not.toContain('Copia de seguridad');

  const respuestas = await page.evaluate(async () => {
    const { qatlas } = globalThis as unknown as {
      qatlas: {
        vault: { getSettings(): Promise<unknown>; setSettings(r: unknown): Promise<unknown> };
        privacy: { listConnections(r: unknown): Promise<unknown> };
        appearance: { setTheme(r: unknown): Promise<unknown> };
      };
    };
    return Promise.all([
      qatlas.vault.getSettings(),
      qatlas.vault.setSettings({ bloqueoMinutos: 5 }),
      qatlas.privacy.listConnections({ limit: 10 }),
      qatlas.appearance.setTheme({ preference: 'dark' }),
    ]);
  });
  for (const respuesta of respuestas) {
    expect(respuesta).toEqual({ ok: false, error: 'BOVEDA_BLOQUEADA' });
  }
});

test('TS-09: las claves no están en ningún objeto global de la interfaz', async () => {
  const nombres = await page.evaluate(() => {
    const scope = globalThis as unknown as { qatlas: object; localStorage: Storage };
    return {
      globales: Object.keys(globalThis).filter((k) =>
        /clave|maestra|contrase|secret|^key$/i.test(k),
      ),
      almacen: scope.localStorage.length,
    };
  });
  expect(nombres).toEqual({ globales: [], almacen: 0 });
});

test('desbloqueo: una contraseña incorrecta da un error sin detalles internos', async () => {
  await desbloquear(OTRA);
  await expect(page.getByText('La contraseña no es correcta.')).toBeVisible();
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  await expect(entrada('Contraseña maestra')).toHaveValue('');
});

test('bloqueo al bloquear el sistema operativo y al suspender', async () => {
  await desbloquear();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('lock-screen');
  });
  await expect(titulo('Bóveda bloqueada')).toBeVisible();

  await desbloquear();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('suspend');
  });
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  await desbloquear();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
});

test('la copia de seguridad se crea con la ruta del proceso principal y sale cifrada', async () => {
  const destino = path.join(carpeta, 'copia.qatlas');
  await simularDialogos(destino);
  await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
  await page.getByRole('button', { name: 'Crear copia de seguridad' }).click();
  await expect(page.getByText('Copia creada.')).toBeVisible();
  // La bóveda sigue abierta: VACUUM INTO no la bloquea.
  await expect(titulo('Bóveda')).toBeVisible();

  const bytes = readFileSync(destino);
  expect(bytes.subarray(0, 4).toString()).toBe('QATB');
  expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
  expect(bytes.includes(Buffer.from('CREATE TABLE'))).toBe(false);
  expect(bytes.includes(Buffer.from(CONTRASENA))).toBe(false);
});

test('una carpeta sincronizada se advierte, y al cancelar no se escribe nada', async () => {
  const destino = path.join(carpeta, 'OneDrive', 'copia.qatlas');
  await simularDialogos(destino);
  const mensajes = await app.evaluate(({ dialog }) => {
    const vistos: string[] = [];
    dialog.showMessageBox = (...args: unknown[]) => {
      vistos.push((args.at(-1) as { message: string }).message);
      (globalThis as unknown as { vistos: string[] }).vistos = vistos;
      return Promise.resolve({ response: 0, checkboxChecked: false });
    };
    return vistos.length;
  });
  expect(mensajes).toBe(0);

  await page.getByRole('button', { name: 'Crear copia de seguridad' }).click();
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { vistos?: string[] }).vistos))
    .toEqual(['Esta carpeta parece estar sincronizada con la nube']);
  expect(existsSync(destino)).toBe(false);
  await simularDialogos(path.join(carpeta, 'copia.qatlas'));
});

test('los minutos de bloqueo se configuran, y una restauración vuelve a los de la copia', async () => {
  const minutos = page.getByLabel('Minutos sin actividad');
  await expect(minutos).toHaveValue('15');
  await minutos.fill('30');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();

  await page.getByLabel('Contraseña de la copia').fill(OTRA);
  await verificarSinReflejo('Contraseña de la copia', OTRA, 'current-password');
  await page.getByRole('button', { name: 'Elegir copia y restaurar' }).click();
  await expect(page.getByText('no corresponde a la copia')).toBeVisible();
  await expect(page.getByLabel('Contraseña de la copia')).toHaveValue('');
  expect(await page.content()).not.toContain(OTRA);
  await expect(minutos).toHaveValue('30');

  await page.getByLabel('Contraseña de la copia').fill(CONTRASENA);
  await page.getByRole('button', { name: 'Elegir copia y restaurar' }).click();
  await expect(titulo('Te damos la bienvenida a QAtlas')).toBeVisible();
  await page.getByRole('button', { name: 'Bóveda', exact: true }).click();
  await expect(page.getByLabel('Minutos sin actividad')).toHaveValue('15');
});

test('TS-09: bloqueo automático por inactividad con el mínimo de 1 minuto', async () => {
  test.setTimeout(120_000);
  const minutos = page.getByLabel('Minutos sin actividad');
  await minutos.fill('1');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Guardado.')).toBeVisible();
  // La ventana está visible en el equipo: un movimiento del mouse encima o una tecla real
  // reiniciarían el contador. setFocusable solo existe en Windows y macOS; en Linux el CI corre bajo
  // xvfb, sin teclado real.
  const enfocada = await app.evaluate(({ BrowserWindow }) => {
    const ventana = BrowserWindow.getAllWindows()[0];
    ventana?.setIgnoreMouseEvents(true);
    if (process.platform !== 'linux') ventana?.setFocusable(false);
    ventana?.blur();
    return ventana?.isFocused();
  });
  if (process.platform === 'win32') expect(enfocada).toBe(false);
  try {
    await expect(titulo('Bóveda bloqueada')).toBeVisible({ timeout: 90_000 });
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      const ventana = BrowserWindow.getAllWindows()[0];
      ventana?.setIgnoreMouseEvents(false);
      if (process.platform !== 'linux') ventana?.setFocusable(true);
    });
  }
});

test('la bóveda sigue bloqueada al reiniciar, y al cerrar no quedan archivos sueltos', async () => {
  await app.close();
  ({ app, page } = await lanzarApp(electron, carpeta));
  await expect(titulo('Bóveda bloqueada')).toBeVisible();
  const datos = path.join(carpeta, 'QAtlas');
  expect(readdirSync(datos).some((n) => n.includes('.nueva') || n.includes('.tmp-'))).toBe(false);
});

test('desbloqueo: la contraseña escrita no se refleja, y se vacía aunque falle', async () => {
  await entrada('Contraseña maestra').fill(OTRA);
  await verificarSinReflejo('Contraseña maestra', OTRA, 'current-password');
  await page.getByRole('button', { name: 'Desbloquear' }).click();
  await expect(page.getByText('La contraseña no es correcta.')).toBeVisible();
  await expect(entrada('Contraseña maestra')).toHaveValue('');
  expect(await page.content()).not.toContain(OTRA);
});

test('freno ante intentos repetidos: a los 5 fallos hay que esperar', async () => {
  // Un intento ya se hizo en el test anterior.
  for (let i = 0; i < 4; i++) {
    await desbloquear(OTRA);
    await expect(page.getByText('La contraseña no es correcta.')).toBeVisible();
    await expect(entrada('Contraseña maestra')).toHaveValue('');
  }
  await expect(
    page.getByText(/Demasiados intentos\. Podés volver a probar en \d+ s\./),
  ).toBeVisible();
  await entrada('Contraseña maestra').fill(CONTRASENA);
  await expect(page.getByRole('button', { name: 'Desbloquear' })).toBeDisabled();
});
