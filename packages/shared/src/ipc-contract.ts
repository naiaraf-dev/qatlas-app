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
} as const;

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
  'ERROR_INTERNO',
]);
export type IpcErrorCode = z.infer<typeof IpcErrorCode>;
