/**
 * TS-08 — IPC (especificación 3.6 y 3.15).
 *
 * Mensajes malformados, con campos de más o desde orígenes no esperados se
 * rechazan, y un handler nunca puede devolver datos no declarados.
 */
import { describe, expect, it } from 'vitest';
import { ipcContract, type IpcChannel } from '@qatlas/shared';
import { createIpcHandler, makeSenderCheck } from '../apps/desktop/src/main/ipc/create-handler';

const APP = 'app://qatlas';
const isAllowedSender = makeSenderCheck([APP]);
const fromApp = { senderFrame: { url: `${APP}/index.html` } };

const sampleConnections = [
  {
    id: 1,
    timestamp: '2026-10-28T12:00:00.000Z',
    origin: 'interfaz' as const,
    destination: 'https://example.com/',
    allowed: false,
    rule: 'denegar-por-defecto',
  },
];

describe('TS-08 · Origen del mensaje', () => {
  const handler = createIpcHandler('privacy:listConnections', () => sampleConnections, {
    isAllowedSender,
  });

  it('acepta mensajes de la interfaz de QAtlas', async () => {
    const res = await handler(fromApp, { limit: 10 });
    expect(res).toEqual({ ok: true, data: sampleConnections });
  });

  it.each([
    ['sin frame', {}],
    ['frame nulo', { senderFrame: null }],
    ['file://', { senderFrame: { url: 'file:///C:/app/index.html' } }],
    ['sitio externo', { senderFrame: { url: 'https://evil.example/' } }],
    ['host parecido', { senderFrame: { url: 'app://qatlas.evil/index.html' } }],
    ['otro host del esquema', { senderFrame: { url: 'app://otro/index.html' } }],
    ['localhost en producción', { senderFrame: { url: 'http://localhost:5173/' } }],
  ])('rechaza: %s', async (_label, event) => {
    const res = await handler(event, { limit: 10 });
    expect(res).toEqual({ ok: false, error: 'ORIGEN_NO_PERMITIDO' });
  });

  it('en desarrollo acepta solo el origen exacto del servidor de Vite', () => {
    const devCheck = makeSenderCheck([APP, 'http://localhost:5173']);
    expect(devCheck('http://localhost:5173/')).toBe(true);
    expect(devCheck('http://localhost:51730/')).toBe(false);
    expect(devCheck('http://127.0.0.1:5173/')).toBe(false);
    expect(devCheck('https://localhost:5173/')).toBe(false);
  });
});

describe('TS-08 · Validación de la entrada', () => {
  const handler = createIpcHandler('privacy:listConnections', () => [], { isAllowedSender });

  it.each([
    ['sin datos', undefined],
    ['tipo incorrecto', { limit: 'diez' }],
    ['fuera de rango', { limit: 100000 }],
    ['negativo', { limit: -1 }],
    ['campo extra', { limit: 10, path: 'C:\\Windows\\System32' }],
    ['prototipo contaminado', JSON.parse('{"limit":10,"__proto__":{"admin":true}}') as unknown],
  ])('rechaza: %s', async (_label, payload) => {
    const res = await handler(fromApp, payload);
    expect(res).toEqual({ ok: false, error: 'ENTRADA_INVALIDA' });
  });

  it('un canal sin parámetros rechaza datos inesperados', async () => {
    const info = createIpcHandler(
      'app:getInfo',
      () => ({
        name: 'QAtlas',
        version: '0.1.0',
        platform: 'win32' as const,
        electron: '45',
        chrome: '140',
        isPackaged: false,
      }),
      { isAllowedSender },
    );
    expect(await info(fromApp, { extra: true })).toEqual({ ok: false, error: 'ENTRADA_INVALIDA' });
  });
});

describe('TS-08 · Validación de la salida', () => {
  it('si un handler devuelve un campo no declarado (por ejemplo, un secreto), se bloquea', async () => {
    const leaky = createIpcHandler(
      'privacy:listConnections',
      // Simula un error de programación: el handler devuelve un campo extra.
      () =>
        [
          { ...sampleConnections[0], secret: 'CANARIO-no-debe-salir' },
        ] as unknown as typeof sampleConnections,
      { isAllowedSender },
    );
    const res = await leaky(fromApp, { limit: 10 });
    expect(res).toEqual({ ok: false, error: 'ERROR_INTERNO' });
    expect(JSON.stringify(res)).not.toContain('CANARIO');
  });

  it('los errores internos no envían detalles a la interfaz', async () => {
    const failing = createIpcHandler(
      'privacy:listConnections',
      () => {
        throw new Error(
          'fallo en C:\\Users\\ana\\AppData\\Local\\QAtlas\\boveda.db con clave abc123',
        );
      },
      { isAllowedSender },
    );
    const res = await failing(fromApp, { limit: 10 });
    expect(res).toEqual({ ok: false, error: 'ERROR_INTERNO' });
    expect(JSON.stringify(res)).not.toMatch(/Users|abc123/);
  });

  it('informa cada rechazo con canal y motivo, sin el contenido del mensaje', async () => {
    const rejections: string[] = [];
    const handler = createIpcHandler('privacy:listConnections', () => [], {
      isAllowedSender,
      onRejected: (channel, code) => rejections.push(`${channel}:${code}`),
    });
    await handler(fromApp, { limit: 10, token: 'secreto' });
    expect(rejections).toEqual(['privacy:listConnections:ENTRADA_INVALIDA']);
  });
});

describe('TS-08 · Canales de la bóveda', () => {
  const entrada = (canal: IpcChannel) => ipcContract[canal].request;
  const salida = (canal: IpcChannel) => ipcContract[canal].response;
  const CREAR = { contrasena: 'x'.repeat(16), confirmacion: 'x'.repeat(16) };

  it.each<[string, IpcChannel, unknown]>([
    ['crear sin confirmar que no hay recuperación', 'vault:create', CREAR],
    [
      'crear con la confirmación en false',
      'vault:create',
      { ...CREAR, entiendeSinRecuperacion: false },
    ],
    [
      'crear con un campo extra',
      'vault:create',
      { ...CREAR, entiendeSinRecuperacion: true, ruta: 'C:\\Windows' },
    ],
    ['desbloquear sin contraseña', 'vault:unlock', {}],
    ['desbloquear con contraseña vacía', 'vault:unlock', { contrasena: '' }],
    ['desbloquear con contraseña enorme', 'vault:unlock', { contrasena: 'x'.repeat(1025) }],
    ['desbloquear con otro tipo', 'vault:unlock', { contrasena: 123 }],
    ['desbloquear con un campo extra', 'vault:unlock', { contrasena: 'x', clave: 'y' }],
    ['bloquear con datos', 'vault:lock', { motivo: 'x' }],
    ['configurar 0 minutos', 'vault:setSettings', { bloqueoMinutos: 0 }],
    ['configurar demasiados minutos', 'vault:setSettings', { bloqueoMinutos: 241 }],
    ['configurar minutos no enteros', 'vault:setSettings', { bloqueoMinutos: 1.5 }],
    ['configurar un campo extra', 'vault:setSettings', { bloqueoMinutos: 5, tema: 'dark' }],
    ['copia con una ruta desde la interfaz', 'vault:createBackup', { ruta: 'C:\\copia.qatlas' }],
    [
      'restaurar con una ruta desde la interfaz',
      'vault:restoreBackup',
      { contrasena: 'x', ruta: 'C:\\copia.qatlas' },
    ],
  ])('rechaza: %s', (_nombre, canal, datos) => {
    expect(entrada(canal).safeParse(datos).success).toBe(false);
  });

  it.each<[string, IpcChannel, unknown]>([
    ['crear', 'vault:create', { ...CREAR, entiendeSinRecuperacion: true }],
    ['desbloquear', 'vault:unlock', { contrasena: 'x' }],
    ['bloquear', 'vault:lock', undefined],
    ['configurar', 'vault:setSettings', { bloqueoMinutos: 15 }],
    ['copia', 'vault:createBackup', undefined],
    ['restaurar', 'vault:restoreBackup', { contrasena: 'x' }],
  ])('acepta: %s', (_nombre, canal, datos) => {
    expect(entrada(canal).safeParse(datos).success).toBe(true);
  });

  it.each<[string, IpcChannel, unknown]>([
    [
      'estado con una clave',
      'vault:getStatus',
      { estado: 'bloqueada', esperaSegundos: 0, clave: 'x' },
    ],
    ['estado desconocido', 'vault:getStatus', { estado: 'otro', esperaSegundos: 0 }],
    ['desbloqueo con la maestra', 'vault:unlock', { resultado: 'desbloqueada', maestra: 'x' }],
    [
      'rechazo con un detalle interno',
      'vault:unlock',
      { resultado: 'rechazada', esperaSegundos: 0, error: 'x' },
    ],
    ['creación con la contraseña', 'vault:create', { resultado: 'creada', contrasena: 'x' }],
    ['copia con la ruta', 'vault:createBackup', { resultado: 'creada', ruta: 'C:\\x' }],
    ['restauración con la ruta', 'vault:restoreBackup', { resultado: 'restaurada', ruta: 'C:\\x' }],
  ])('la salida no deja pasar: %s', (_nombre, canal, datos) => {
    expect(salida(canal).safeParse(datos).success).toBe(false);
  });

  it('un handler que filtra la contraseña se bloquea', async () => {
    const handler = createIpcHandler(
      'vault:unlock',
      () => ({ resultado: 'desbloqueada', contrasena: 'CANARIO' }) as never,
      { isAllowedSender },
    );
    const res = await handler(fromApp, { contrasena: 'x' });
    expect(res).toEqual({ ok: false, error: 'ERROR_INTERNO' });
    expect(JSON.stringify(res)).not.toContain('CANARIO');
  });

  it('un mensaje de otro origen no llega al handler de desbloqueo', async () => {
    let ejecutado = false;
    const handler = createIpcHandler(
      'vault:unlock',
      () => {
        ejecutado = true;
        return { resultado: 'desbloqueada' };
      },
      { isAllowedSender },
    );
    const res = await handler(
      { senderFrame: { url: 'https://evil.example/' } },
      { contrasena: 'x' },
    );
    expect(res).toEqual({ ok: false, error: 'ORIGEN_NO_PERMITIDO' });
    expect(ejecutado).toBe(false);
  });

  it('informa el rechazo sin el contenido: nunca la contraseña', async () => {
    const rechazos: string[] = [];
    const handler = createIpcHandler('vault:unlock', () => ({ resultado: 'desbloqueada' }), {
      isAllowedSender,
      onRejected: (canal, codigo) => rechazos.push(`${canal}:${codigo}`),
    });
    await handler(fromApp, { contrasena: 'CANARIO', extra: true });
    expect(rechazos).toEqual(['vault:unlock:ENTRADA_INVALIDA']);
  });

  it('el tema se rechaza con la bóveda bloqueada, porque se guarda cifrado', async () => {
    const handler = createIpcHandler(
      'appearance:setTheme',
      ({ preference }) => ({ preference, effective: 'dark' as const }),
      { isAllowedSender, isVaultLocked: () => true },
    );
    expect(await handler(fromApp, { preference: 'dark' })).toEqual({
      ok: false,
      error: 'BOVEDA_BLOQUEADA',
    });
  });
});

describe('TS-08 · Canal de apariencia', () => {
  const handler = createIpcHandler(
    'appearance:setTheme',
    ({ preference }) => ({ preference, effective: 'dark' as const }),
    { isAllowedSender },
  );

  it.each(['system', 'light', 'dark'])('acepta el tema "%s"', async (preference) => {
    const res = await handler(fromApp, { preference });
    expect(res.ok).toBe(true);
  });

  it.each([
    ['valor fuera de la lista', { preference: 'rosa' }],
    ['inyección de CSS', { preference: 'dark; background:url(https://evil.example)' }],
    ['campo extra', { preference: 'dark', css: 'body{}' }],
    ['tipo incorrecto', { preference: 1 }],
  ])('rechaza: %s', async (_label, payload) => {
    expect(await handler(fromApp, payload)).toEqual({ ok: false, error: 'ENTRADA_INVALIDA' });
  });
});
