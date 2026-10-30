import { z } from 'zod';

/**
 * Contrato IPC de QAtlas (especificación, sección 9).
 *
 * Es la ÚNICA forma en que la interfaz se comunica con el proceso principal.
 * Cada canal declara el esquema de su entrada y de su salida:
 * - el proceso principal valida la entrada antes de ejecutar nada;
 * - el proceso principal valida su propia salida antes de devolverla, para que
 *   nunca se filtre un campo que no esté declarado (por ejemplo, un secreto);
 * - el preload solo expone los canales listados acá.
 *
 * Reglas al agregar un canal:
 * - nunca aceptar rutas de archivo arbitrarias desde la interfaz;
 * - nunca devolver claves, secretos ni contenido sin redactar;
 * - usar `.strict()` en los objetos para rechazar campos desconocidos.
 */

const Empty = z.undefined();

export const SecurityStatus = z
  .object({
    contextIsolation: z.boolean(),
    sandbox: z.boolean(),
    nodeIntegration: z.boolean(),
    webSecurity: z.boolean(),
    cspActive: z.boolean(),
    networkPolicy: z.literal('deny-by-default'),
    telemetry: z.literal('none'),
    dataDirectorySynced: z.boolean(),
  })
  .strict();
export type SecurityStatus = z.infer<typeof SecurityStatus>;

export const AppInfo = z
  .object({
    name: z.string(),
    version: z.string(),
    platform: z.enum(['win32', 'darwin', 'linux']),
    electron: z.string(),
    chrome: z.string(),
    isPackaged: z.boolean(),
  })
  .strict();
export type AppInfo = z.infer<typeof AppInfo>;

export const ConnectionEntry = z
  .object({
    id: z.number().int().nonnegative(),
    timestamp: z.string(),
    origin: z.enum(['interfaz', 'runner', 'integracion', 'actualizaciones']),
    destination: z.string().max(2048),
    allowed: z.boolean(),
    rule: z.string(),
  })
  .strict();
export type ConnectionEntry = z.infer<typeof ConnectionEntry>;

export const ThemePreference = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof ThemePreference>;

export const AppearanceState = z
  .object({
    preference: ThemePreference,
    effective: z.enum(['light', 'dark']),
  })
  .strict();
export type AppearanceState = z.infer<typeof AppearanceState>;

// La contraseña solo viaja de la interfaz al proceso principal. Ningún esquema de salida la incluye.
const Contrasena = z.string().min(1).max(1024);
const MotivoRechazoContrasena = z.enum(['corta', 'comun', 'debil', 'ya-existe', 'no-coincide']);

export const VaultStatus = z
  .object({
    estado: z.enum(['sin-boveda', 'bloqueada', 'desbloqueada', 'danada']),
    esperaSegundos: z.number().int().nonnegative(),
  })
  .strict();
export type VaultStatus = z.infer<typeof VaultStatus>;

export const BLOQUEO_MINUTOS_MIN = 1;
export const BLOQUEO_MINUTOS_MAX = 240;

export const VaultSettings = z
  .object({
    bloqueoMinutos: z.number().int().min(BLOQUEO_MINUTOS_MIN).max(BLOQUEO_MINUTOS_MAX),
  })
  .strict();
export type VaultSettings = z.infer<typeof VaultSettings>;

export const ipcContract = {
  'app:getInfo': { request: Empty, response: AppInfo },
  'security:getStatus': { request: Empty, response: SecurityStatus },
  'privacy:listConnections': {
    request: z.object({ limit: z.number().int().min(1).max(500) }).strict(),
    response: z.array(ConnectionEntry),
  },
  'appearance:get': { request: Empty, response: AppearanceState },
  'appearance:setTheme': {
    request: z.object({ preference: ThemePreference }).strict(),
    response: AppearanceState,
  },
  'vault:getStatus': { request: Empty, response: VaultStatus },
  'vault:create': {
    request: z
      .object({
        contrasena: Contrasena,
        confirmacion: Contrasena,
        // CU-00: sin esta confirmación no se crea nada.
        entiendeSinRecuperacion: z.literal(true),
      })
      .strict(),
    response: z.discriminatedUnion('resultado', [
      z.object({ resultado: z.literal('creada') }).strict(),
      z.object({ resultado: z.literal('rechazada'), motivo: MotivoRechazoContrasena }).strict(),
    ]),
  },
  'vault:unlock': {
    request: z.object({ contrasena: Contrasena }).strict(),
    response: z.discriminatedUnion('resultado', [
      z.object({ resultado: z.literal('desbloqueada') }).strict(),
      z
        .object({
          resultado: z.literal('rechazada'),
          esperaSegundos: z.number().int().nonnegative(),
        })
        .strict(),
    ]),
  },
  'vault:lock': {
    request: Empty,
    response: z.object({ estado: z.literal('bloqueada') }).strict(),
  },
  'vault:getSettings': { request: Empty, response: VaultSettings },
  'vault:setSettings': { request: VaultSettings, response: VaultSettings },
  // Las rutas las elige el proceso principal con un diálogo nativo: nunca viajan por IPC.
  'vault:createBackup': {
    request: Empty,
    response: z.object({ resultado: z.enum(['creada', 'cancelada']) }).strict(),
  },
  'vault:restoreBackup': {
    request: z.object({ contrasena: Contrasena }).strict(),
    response: z.object({ resultado: z.enum(['restaurada', 'cancelada', 'rechazada']) }).strict(),
  },
} as const;

/**
 * Canales que exponen o modifican datos: con la bóveda bloqueada se rechazan todos (RN-BOV-03). Una
 * lista de permitidos: un canal nuevo queda bloqueado salvo que se agregue acá de forma explícita.
 */
export const CANALES_SIN_BOVEDA: ReadonlySet<string> = new Set([
  'app:getInfo',
  'security:getStatus',
  'appearance:get',
  'vault:getStatus',
  'vault:create',
  'vault:unlock',
  'vault:lock',
  'vault:restoreBackup',
]);

export type IpcContract = typeof ipcContract;
export type IpcChannel = keyof IpcContract;
export type IpcRequest<C extends IpcChannel> = z.input<IpcContract[C]['request']>;
export type IpcResponse<C extends IpcChannel> = z.output<IpcContract[C]['response']>;

export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[];

/** Respuesta envuelta: los errores llegan a la interfaz sin detalles internos. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcErrorCode };

export const IpcErrorCode = z.enum([
  'ORIGEN_NO_PERMITIDO',
  'ENTRADA_INVALIDA',
  'CANAL_DESCONOCIDO',
  'BOVEDA_BLOQUEADA',
  'ERROR_INTERNO',
]);
export type IpcErrorCode = z.infer<typeof IpcErrorCode>;
