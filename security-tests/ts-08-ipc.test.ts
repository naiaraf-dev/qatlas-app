/**
 * TS-08 — IPC (especificación 3.6 y 3.15).
 *
 * Mensajes malformados, con campos de más o desde orígenes no esperados se
 * rechazan, y un handler nunca puede devolver datos no declarados.
 */
import { describe, expect, it } from 'vitest';
import { CANALES_SIN_BOVEDA, IPC_CHANNELS, ipcContract, type IpcChannel } from '@qatlas/shared';
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

describe('TS-08 · Canales de proyectos y credenciales', () => {
  const ID = '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
  const OTRO_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const PROYECTO = {
    nombre: 'Lexora',
    descripcion: '',
    urlBase: 'https://app.lexora.test/',
    dominios: ['app.lexora.test'],
    maxRps: 2,
    maxPaginas: 200,
    maxProfundidad: 5,
    timeoutPaginaSegundos: 30,
    soloLectura: true,
    exclusiones: ['logout'],
    modoDatosSensibles: false,
    selectoresSensibles: [],
    sistemaInterno: false,
    permitirLoginHttp: false,
  };
  const ACEPTACION = { aceptada: true, version: 1, texto: 'x' };
  const CREDENCIAL = {
    proyectoId: ID,
    nombre: 'Prueba',
    usuario: 'ana@example.com',
    urlLogin: 'https://app.lexora.test/login',
    pasosLogin: [{ accion: 'click', selector: 'button' }],
  };
  const RESUMEN_CREDENCIAL = {
    id: OTRO_ID,
    nombre: 'Prueba',
    usuario: 'ana@example.com',
    urlLogin: 'https://app.lexora.test/login',
    pasosLogin: [],
    secretoConfigurado: true,
    secretoActualizadoEn: '2026-10-30T12:00:00.000Z',
    requiereRevision: false,
  };
  const DETALLE = {
    ...PROYECTO,
    id: ID,
    autorizacion: { vigente: true },
    aceptadaEn: '2026-10-30T12:00:00.000Z',
    declaracion: { version: 1, texto: 'x' },
    credenciales: [RESUMEN_CREDENCIAL],
  };

  const entrada = (canal: IpcChannel, datos: unknown) =>
    ipcContract[canal].request.safeParse(datos).success;
  const salida = (canal: IpcChannel, datos: unknown) =>
    ipcContract[canal].response.safeParse(datos).success;

  it.each<[string, IpcChannel, unknown]>([
    ['listar', 'proyectos:listar', undefined],
    ['obtener', 'proyectos:obtener', { id: ID }],
    ['validar', 'proyectos:validar', { proyecto: PROYECTO }],
    ['validar una edición', 'proyectos:validar', { proyecto: PROYECTO, id: ID }],
    ['crear', 'proyectos:crear', { proyecto: PROYECTO, aceptacion: ACEPTACION }],
    ['actualizar', 'proyectos:actualizar', { id: ID, proyecto: PROYECTO }],
    ['eliminar', 'proyectos:eliminar', { id: ID, nombreConfirmacion: 'Lexora' }],
    ['aceptar', 'proyectos:aceptarAutorizacion', { id: ID, aceptacion: ACEPTACION }],
    ['credencial nueva', 'credenciales:guardar', { ...CREDENCIAL, secreto: 'x' }],
    ['editar credencial', 'credenciales:guardar', { ...CREDENCIAL, credencialId: OTRO_ID }],
    [
      'reemplazar',
      'credenciales:reemplazarSecreto',
      { proyectoId: ID, credencialId: OTRO_ID, secreto: 'x' },
    ],
    ['eliminar credencial', 'credenciales:eliminar', { proyectoId: ID, credencialId: OTRO_ID }],
  ])('acepta: %s', (_nombre, canal, datos) => {
    expect(entrada(canal, datos)).toBe(true);
  });

  it.each<[string, IpcChannel, unknown]>([
    ['listar con datos', 'proyectos:listar', { filtro: 'x' }],
    ['obtener con un ID que no es UUID', 'proyectos:obtener', { id: "1' OR '1'='1" }],
    ['obtener con una ruta', 'proyectos:obtener', { id: ID, ruta: 'C:\\x' }],
    ['crear sin aceptación', 'proyectos:crear', { proyecto: PROYECTO }],
    [
      'crear con la aceptación en false',
      'proyectos:crear',
      { proyecto: PROYECTO, aceptacion: { ...ACEPTACION, aceptada: false } },
    ],
    [
      'crear con un campo extra',
      'proyectos:crear',
      { proyecto: { ...PROYECTO, ruta: 'C:\\x' }, aceptacion: ACEPTACION },
    ],
    [
      'crear con una clave de proyecto',
      'proyectos:crear',
      { proyecto: { ...PROYECTO, claveProyectoCifrada: 'x' }, aceptacion: ACEPTACION },
    ],
    ['nombre vacío', 'proyectos:validar', { proyecto: { ...PROYECTO, nombre: '   ' } }],
    ['nombre enorme', 'proyectos:validar', { proyecto: { ...PROYECTO, nombre: 'x'.repeat(121) } }],
    ['0 rps', 'proyectos:validar', { proyecto: { ...PROYECTO, maxRps: 0 } }],
    ['demasiados rps', 'proyectos:validar', { proyecto: { ...PROYECTO, maxRps: 51 } }],
    ['páginas no enteras', 'proyectos:validar', { proyecto: { ...PROYECTO, maxPaginas: 1.5 } }],
    ['timeout de 0', 'proyectos:validar', { proyecto: { ...PROYECTO, timeoutPaginaSegundos: 0 } }],
    [
      'solo lectura de otro tipo',
      'proyectos:validar',
      { proyecto: { ...PROYECTO, soloLectura: 1 } },
    ],
    [
      'demasiados dominios',
      'proyectos:validar',
      {
        proyecto: { ...PROYECTO, dominios: Array<string>(51).fill('a.test') },
      },
    ],
    ['eliminar sin confirmación', 'proyectos:eliminar', { id: ID }],
    [
      'aceptar sin versión',
      'proyectos:aceptarAutorizacion',
      {
        id: ID,
        aceptacion: { aceptada: true, texto: 'x' },
      },
    ],
    ['credencial nueva sin secreto', 'credenciales:guardar', CREDENCIAL],
    ['credencial con secreto vacío', 'credenciales:guardar', { ...CREDENCIAL, secreto: '' }],
    [
      'editar y mandar el secreto a la vez',
      'credenciales:guardar',
      { ...CREDENCIAL, credencialId: OTRO_ID, secreto: 'x' },
    ],
    [
      'un paso con un valor escrito a mano',
      'credenciales:guardar',
      {
        ...CREDENCIAL,
        secreto: 'x',
        pasosLogin: [{ accion: 'rellenar', selector: '#c', origen: 'secreto', valor: 'clave' }],
      },
    ],
    [
      'un paso con otra acción',
      'credenciales:guardar',
      { ...CREDENCIAL, secreto: 'x', pasosLogin: [{ accion: 'evaluar', selector: 'x' }] },
    ],
    [
      'un paso con otro origen',
      'credenciales:guardar',
      {
        ...CREDENCIAL,
        secreto: 'x',
        pasosLogin: [{ accion: 'rellenar', selector: '#c', origen: 'clave' }],
      },
    ],
    [
      'reemplazar sin secreto',
      'credenciales:reemplazarSecreto',
      {
        proyectoId: ID,
        credencialId: OTRO_ID,
      },
    ],
    [
      'reemplazar con un secreto enorme',
      'credenciales:reemplazarSecreto',
      { proyectoId: ID, credencialId: OTRO_ID, secreto: 'x'.repeat(4097) },
    ],
    [
      'eliminar con un campo extra',
      'credenciales:eliminar',
      {
        proyectoId: ID,
        credencialId: OTRO_ID,
        forzar: true,
      },
    ],
  ])('rechaza: %s', (_nombre, canal, datos) => {
    expect(entrada(canal, datos)).toBe(false);
  });

  it('el detalle válido pasa', () => {
    expect(salida('proyectos:obtener', DETALLE)).toBe(true);
    expect(salida('proyectos:obtener', null)).toBe(true);
  });

  it.each<[string, IpcChannel, unknown]>([
    [
      'detalle con la clave del proyecto',
      'proyectos:obtener',
      { ...DETALLE, claveProyectoCifrada: 'x' },
    ],
    [
      'credencial con el secreto',
      'proyectos:obtener',
      { ...DETALLE, credenciales: [{ ...RESUMEN_CREDENCIAL, secreto: 'x' }] },
    ],
    [
      'credencial con un indicio',
      'proyectos:obtener',
      { ...DETALLE, credenciales: [{ ...RESUMEN_CREDENCIAL, ultimos4: '1234' }] },
    ],
    [
      'credencial con secreto sin configurar',
      'proyectos:obtener',
      { ...DETALLE, credenciales: [{ ...RESUMEN_CREDENCIAL, secretoConfigurado: false }] },
    ],
    [
      'resumen con un campo extra',
      'proyectos:listar',
      [
        {
          id: ID,
          nombre: 'x',
          urlBase: 'https://x.test/',
          autorizacion: { vigente: true },
          credenciales: 0,
          clave: 'x',
        },
      ],
    ],
    [
      'guardar con el secreto',
      'credenciales:guardar',
      {
        resultado: 'guardada',
        credencialId: ID,
        secreto: 'x',
      },
    ],
    [
      'reemplazar con el secreto',
      'credenciales:reemplazarSecreto',
      {
        resultado: 'reemplazado',
        secreto: 'x',
      },
    ],
    [
      'rechazo con un detalle',
      'proyectos:crear',
      {
        resultado: 'rechazado',
        errores: [{ campo: 'nombre', motivo: 'nombre-repetido', valor: 'x' }],
      },
    ],
  ])('la salida no deja pasar: %s', (_nombre, canal, datos) => {
    expect(salida(canal, datos)).toBe(false);
  });

  it('un handler que filtra el secreto se bloquea', async () => {
    const handler = createIpcHandler(
      'proyectos:obtener',
      () =>
        ({
          ...DETALLE,
          credenciales: [{ ...RESUMEN_CREDENCIAL, secreto: 'CANARIO' }],
        }) as never,
      { isAllowedSender },
    );
    const res = await handler(fromApp, { id: ID });
    expect(res).toEqual({ ok: false, error: 'ERROR_INTERNO' });
    expect(JSON.stringify(res)).not.toContain('CANARIO');
  });

  it('todos los canales nuevos quedan bloqueados con la bóveda bloqueada', () => {
    const nuevos = IPC_CHANNELS.filter(
      (canal) => canal.startsWith('proyectos:') || canal.startsWith('credenciales:'),
    );
    expect(nuevos).toHaveLength(10);
    for (const canal of nuevos) expect(CANALES_SIN_BOVEDA.has(canal)).toBe(false);
  });

  it('con la bóveda bloqueada el handler no se ejecuta', async () => {
    let ejecutado = false;
    const handler = createIpcHandler(
      'credenciales:reemplazarSecreto',
      () => {
        ejecutado = true;
        return { resultado: 'reemplazado' };
      },
      { isAllowedSender, isVaultLocked: () => true },
    );
    const res = await handler(fromApp, { proyectoId: ID, credencialId: OTRO_ID, secreto: 'x' });
    expect(res).toEqual({ ok: false, error: 'BOVEDA_BLOQUEADA' });
    expect(ejecutado).toBe(false);
  });

  it('el rechazo se informa sin el secreto', async () => {
    const rechazos: string[] = [];
    const handler = createIpcHandler(
      'credenciales:reemplazarSecreto',
      () => ({ resultado: 'reemplazado' }),
      { isAllowedSender, onRejected: (canal, codigo) => rechazos.push(`${canal}:${codigo}`) },
    );
    await handler(fromApp, { proyectoId: 'no', credencialId: OTRO_ID, secreto: 'CANARIO' });
    expect(rechazos).toEqual(['credenciales:reemplazarSecreto:ENTRADA_INVALIDA']);
  });

  it('la prueba de login no tiene canal hasta la semana 5', () => {
    expect(IPC_CHANNELS).not.toContain('credenciales:probarLogin');
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
