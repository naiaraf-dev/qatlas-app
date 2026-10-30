/**
 * TS-08 — IPC (especificación 3.6 y 3.15).
 *
 * Mensajes malformados, con campos de más o desde orígenes no esperados se
 * rechazan, y un handler nunca puede devolver datos no declarados.
 */
import { describe, expect, it } from 'vitest';
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
