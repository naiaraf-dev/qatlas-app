import { z } from 'zod';
import { LIMITES_PROYECTO } from './proyectos.js';

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

const IdEntidad = z.uuid();

export const MotivoValidacion = z.enum([
  'vacio',
  'invalido',
  'esquema-no-permitido',
  'credenciales-en-url',
  'comodin-invalido',
  'comodin-amplio',
  'sufijo-publico',
  'ip-no-canonica',
  'ip-no-permitida',
  'localhost-no-exacto',
  'requiere-sistema-interno',
  'sin-dominios',
  'url-fuera-de-dominios',
  'nombre-repetido',
  'login-fuera-de-dominios',
  'login-sin-cifrar',
  'declaracion-distinta',
]);
export type MotivoValidacion = z.infer<typeof MotivoValidacion>;

export const ErrorValidacion = z
  .object({
    campo: z.enum(['nombre', 'urlBase', 'dominios', 'urlLogin', 'declaracion']),
    motivo: MotivoValidacion,
  })
  .strict();
export type ErrorValidacion = z.infer<typeof ErrorValidacion>;

const entero = ({ min, max }: { min: number; max: number }) => z.number().int().min(min).max(max);

export const ProyectoEntrada = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    descripcion: z.string().max(2000),
    urlBase: z.string().max(2048),
    dominios: z.array(z.string().max(300)).max(50),
    maxRps: entero(LIMITES_PROYECTO.maxRps),
    maxPaginas: entero(LIMITES_PROYECTO.maxPaginas),
    maxProfundidad: entero(LIMITES_PROYECTO.maxProfundidad),
    timeoutPaginaSegundos: entero(LIMITES_PROYECTO.timeoutPaginaSegundos),
    soloLectura: z.boolean(),
    exclusiones: z.array(z.string().trim().min(1).max(200)).max(200),
    modoDatosSensibles: z.boolean(),
    selectoresSensibles: z.array(z.string().trim().min(1).max(500)).max(200),
    sistemaInterno: z.boolean(),
    permitirLoginHttp: z.boolean(),
  })
  .strict();
export type ProyectoEntrada = z.infer<typeof ProyectoEntrada>;

/** Prueba de qué texto se aceptó: el proceso principal lo compara con el que le corresponde. */
const AceptacionDeclaracion = z
  .object({
    aceptada: z.literal(true),
    version: z.number().int().positive(),
    texto: z.string().max(10000),
  })
  .strict();

export const Declaracion = z
  .object({ version: z.number().int().positive(), texto: z.string() })
  .strict();

export const EstadoAutorizacion = z.discriminatedUnion('vigente', [
  z.object({ vigente: z.literal(true) }).strict(),
  z
    .object({
      vigente: z.literal(false),
      motivo: z.enum(['sin-aceptar', 'version-anterior', 'alcance-cambiado']),
    })
    .strict(),
]);

export type EstadoAutorizacion = z.infer<typeof EstadoAutorizacion>;

export const ProyectoResumen = z
  .object({
    id: IdEntidad,
    nombre: z.string(),
    urlBase: z.string(),
    autorizacion: EstadoAutorizacion,
    credenciales: z.number().int().nonnegative(),
  })
  .strict();
export type ProyectoResumen = z.infer<typeof ProyectoResumen>;

// Acciones tipadas: no hay un campo de texto libre donde pueda quedar una contraseña escrita a mano.
const Selector = z.string().trim().min(1).max(500);
export const PasoLogin = z.discriminatedUnion('accion', [
  z
    .object({
      accion: z.literal('rellenar'),
      selector: Selector,
      origen: z.enum(['usuario', 'secreto']),
    })
    .strict(),
  z.object({ accion: z.literal('click'), selector: Selector }).strict(),
  z.object({ accion: z.literal('esperar'), selector: Selector }).strict(),
]);
export type PasoLogin = z.infer<typeof PasoLogin>;

const DatosCredencial = {
  proyectoId: IdEntidad,
  nombre: z.string().trim().min(1).max(120),
  usuario: z.string().min(1).max(320),
  urlLogin: z.string().max(2048),
  pasosLogin: z.array(PasoLogin).max(30),
};
// El secreto solo viaja de la interfaz al proceso principal. Ningún esquema de salida lo incluye.
const Secreto = z.string().min(1).max(4096);

export const CredencialResumen = z
  .object({
    id: IdEntidad,
    nombre: z.string(),
    usuario: z.string(),
    urlLogin: z.string(),
    pasosLogin: z.array(PasoLogin),
    // RN-PRY-04: sin indicios (ADR 013). Solo "configurado" y cuándo se reemplazó.
    secretoConfigurado: z.literal(true),
    secretoActualizadoEn: z.string(),
    // La URL de login quedó fuera de los dominios o en http sin la opción: no se puede usar.
    requiereRevision: z.boolean(),
  })
  .strict();
export type CredencialResumen = z.infer<typeof CredencialResumen>;

export const ProyectoDetalle = ProyectoEntrada.extend({
  id: IdEntidad,
  autorizacion: EstadoAutorizacion,
  aceptadaEn: z.string().nullable(),
  // Lo que hay que aceptar para el alcance actual.
  declaracion: Declaracion,
  credenciales: z.array(CredencialResumen),
}).strict();
export type ProyectoDetalle = z.infer<typeof ProyectoDetalle>;

const respuestaConErrores = <T extends z.ZodObject>(exito: T) =>
  z.union([
    exito,
    z
      .object({ resultado: z.literal('rechazado'), errores: z.array(ErrorValidacion).min(1) })
      .strict(),
  ]);

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
  'proyectos:listar': { request: Empty, response: z.array(ProyectoResumen) },
  'proyectos:obtener': {
    request: z.object({ id: IdEntidad }).strict(),
    response: ProyectoDetalle.nullable(),
  },
  // Para que el asistente muestre los errores antes del último paso. No guarda nada.
  'proyectos:validar': {
    request: z.object({ proyecto: ProyectoEntrada, id: IdEntidad.optional() }).strict(),
    response: z
      .object({
        errores: z.array(ErrorValidacion),
        dominioPropuesto: z.string().nullable(),
        declaracion: Declaracion.nullable(),
      })
      .strict(),
  },
  // CU-01: el proyecto, su clave y la aceptación se crean juntos. Sin aceptación no se crea.
  'proyectos:crear': {
    request: z.object({ proyecto: ProyectoEntrada, aceptacion: AceptacionDeclaracion }).strict(),
    response: respuestaConErrores(
      z.object({ resultado: z.literal('creado'), id: IdEntidad }).strict(),
    ),
  },
  'proyectos:actualizar': {
    request: z.object({ id: IdEntidad, proyecto: ProyectoEntrada }).strict(),
    response: respuestaConErrores(
      z.object({ resultado: z.literal('actualizado'), autorizacion: EstadoAutorizacion }).strict(),
    ),
  },
  'proyectos:eliminar': {
    request: z.object({ id: IdEntidad, nombreConfirmacion: z.string().max(120) }).strict(),
    response: z.object({ resultado: z.enum(['eliminado', 'nombre-no-coincide']) }).strict(),
  },
  'proyectos:aceptarAutorizacion': {
    request: z.object({ id: IdEntidad, aceptacion: AceptacionDeclaracion }).strict(),
    response: z.object({ resultado: z.enum(['aceptada', 'declaracion-distinta']) }).strict(),
  },
  // Crear lleva secreto; editar, nunca: se reemplaza solo por `credenciales:reemplazarSecreto`.
  'credenciales:guardar': {
    request: z.union([
      z.object({ ...DatosCredencial, secreto: Secreto }).strict(),
      z.object({ ...DatosCredencial, credencialId: IdEntidad }).strict(),
    ]),
    response: respuestaConErrores(
      z.object({ resultado: z.literal('guardada'), credencialId: IdEntidad }).strict(),
    ),
  },
  'credenciales:reemplazarSecreto': {
    request: z
      .object({ proyectoId: IdEntidad, credencialId: IdEntidad, secreto: Secreto })
      .strict(),
    response: z.object({ resultado: z.literal('reemplazado') }).strict(),
  },
  'credenciales:eliminar': {
    request: z.object({ proyectoId: IdEntidad, credencialId: IdEntidad }).strict(),
    response: z.object({ resultado: z.literal('eliminada') }).strict(),
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
