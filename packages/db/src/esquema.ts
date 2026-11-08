import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { TextoRedactado } from '@qatlas/redaction';

// Los campos comunes de la sección 5 de la especificación.
const comunes = {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
};

/**
 * Lo que se conoce recién con la base abierta. El salt, los parámetros de la KDF y la clave
 * maestra envuelta hacen falta para abrirla, así que viven en `boveda.sellada` (ADR 010).
 */
export const bovedaMeta = sqliteTable('boveda_meta', {
  ...comunes,
  versionEsquema: integer('version_esquema').notNull(),
  recordarEnEquipo: integer('recordar_en_equipo', { mode: 'boolean' }).notNull(),
});

export const configuracion = sqliteTable('configuracion', {
  ...comunes,
  bloqueoMinutos: integer('bloqueo_minutos').notNull(),
  actualizacionesActivas: integer('actualizaciones_activas', { mode: 'boolean' }).notNull(),
  retencionDias: integer('retencion_dias').notNull(),
  idioma: text('idioma').notNull(),
  tema: text('tema', { enum: ['system', 'light', 'dark'] }).notNull(),
});

/** Proyectos eliminados: una restauración no debe devolverlos (ADR 009). */
export const proyectoLapida = sqliteTable('proyecto_lapida', {
  proyectoId: text('proyecto_id').primaryKey(),
  eliminadoEn: text('eliminado_en').notNull(),
});

export const proyecto = sqliteTable('proyecto', {
  ...comunes,
  nombre: text('nombre').notNull(),
  // Sin distinguir mayúsculas: confirmar un borrado escribiendo el nombre no puede ser ambiguo.
  nombreNormalizado: text('nombre_normalizado').notNull().unique(),
  descripcion: text('descripcion').notNull(),
  urlBase: text('url_base').notNull(),
  dominiosPermitidos: text('dominios_permitidos', { mode: 'json' }).$type<string[]>().notNull(),
  maxRps: integer('max_rps').notNull(),
  maxPaginas: integer('max_paginas').notNull(),
  maxProfundidad: integer('max_profundidad').notNull(),
  timeoutPaginaSegundos: integer('timeout_pagina_segundos').notNull(),
  maxMinutos: integer('max_minutos').notNull(),
  soloLectura: integer('solo_lectura', { mode: 'boolean' }).notNull(),
  exclusiones: text('exclusiones', { mode: 'json' }).$type<string[]>().notNull(),
  modoDatosSensibles: integer('modo_datos_sensibles', { mode: 'boolean' }).notNull(),
  selectoresSensibles: text('selectores_sensibles', { mode: 'json' }).$type<string[]>().notNull(),
  sistemaInterno: integer('sistema_interno', { mode: 'boolean' }).notNull(),
  puertosLocales: text('puertos_locales', { mode: 'json' }).$type<number[]>().notNull(),
  dominiosAutenticacion: text('dominios_autenticacion', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  sesionMaxMinutos: integer('sesion_max_minutos'),
  /** Hasta qué versión de la redacción se pasó lo guardado de este proyecto (ADR 033). */
  redaccionVersion: integer('redaccion_version').notNull().default(0),
  permitirLoginHttp: integer('permitir_login_http', { mode: 'boolean' }).notNull(),
  claveProyectoCifrada: blob('clave_proyecto_cifrada', { mode: 'buffer' }).notNull(),
});

/** Una fila por aceptación: solo se le agrega `invalidada_en` si después cambia el alcance. */
export const autorizacion = sqliteTable('autorizacion', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  textoAceptado: text('texto_aceptado').notNull(),
  versionTexto: integer('version_texto').notNull(),
  fecha: text('fecha').notNull(),
  urlBaseAceptada: text('url_base_aceptada').notNull(),
  dominiosAceptados: text('dominios_aceptados', { mode: 'json' }).$type<string[]>().notNull(),
  sistemaInternoAceptado: integer('sistema_interno_aceptado', { mode: 'boolean' }).notNull(),
  puertosAceptados: text('puertos_aceptados', { mode: 'json' }).$type<number[]>().notNull(),
  dominiosAutenticacionAceptados: text('dominios_autenticacion_aceptados', { mode: 'json' })
    .$type<string[]>()
    .notNull(),
  invalidadaEn: text('invalidada_en'),
  // SEG-06, fase 4.
  verificacionDominio: text('verificacion_dominio'),
});

export const credencial = sqliteTable('credencial', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  nombre: text('nombre').notNull(),
  usuario: text('usuario').notNull(),
  // Cifrado además a nivel de campo con la clave del proyecto (ADR 013). Vacío en el login asistido.
  secreto: blob('secreto', { mode: 'buffer' }),
  estrategia: text('estrategia', {
    enum: ['formulario', 'sso', 'token-url', 'asistido', 'basica'],
  }).notNull(),
  rol: text('rol').notNull(),
  secretoActualizadoEn: text('secreto_actualizado_en').notNull(),
  urlLogin: text('url_login').notNull(),
  pasosLogin: text('pasos_login', { mode: 'json' }).$type<unknown[]>().notNull(),
  indicadorExito: text('indicador_exito', { mode: 'json' }).$type<unknown>(),
});

/** Una por página analizada. La URL va sin query en claro; la completa, cifrada con la clave del proyecto. */
export const paginaVisitada = sqliteTable('pagina_visitada', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  ejecucionId: text('ejecucion_id')
    .notNull()
    .references(() => ejecucion.id),
  // Texto del sitio: solo texto redactado (ADR 032).
  url: text('url').$type<TextoRedactado>().notNull(),
  urlCompletaCifrada: blob('url_completa_cifrada', { mode: 'buffer' }),
  statusHttp: integer('status_http'),
  tiempoCargaMs: integer('tiempo_carga_ms'),
  profundidad: integer('profundidad').notNull(),
});

/**
 * La identidad de un problema, por proyecto (sección 5). Esta semana, una por aparición: la huella, la
 * fusión y los estados llegan en la semana 8, con `clave` ya guardada para no volver a escanear.
 */
export const hallazgo = sqliteTable('hallazgo', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  ejecucionId: text('ejecucion_id')
    .notNull()
    .references(() => ejecucion.id),
  tipo: text('tipo').notNull(),
  severidad: text('severidad').notNull(),
  // Texto del sitio: solo texto redactado. La clave de un mensaje es un HMAC (ADR 032).
  titulo: text('titulo').$type<TextoRedactado>().notNull(),
  descripcion: text('descripcion').$type<TextoRedactado>().notNull(),
  url: text('url').$type<TextoRedactado>().notNull(),
  clave: text('clave').$type<TextoRedactado>().notNull(),
  huella: text('huella'),
  estado: text('estado').notNull(),
  primeraVezEn: text('primera_vez_en').notNull(),
  ultimaVezEn: text('ultima_vez_en').notNull(),
  casoId: text('caso_id'),
  pasoIndice: integer('paso_indice'),
});

/** Cada aparición de un hallazgo en una ejecución. Lo que puede traer contenido de la página, cifrado. */
export const hallazgoOcurrencia = sqliteTable('hallazgo_ocurrencia', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  hallazgoId: text('hallazgo_id')
    .notNull()
    .references(() => hallazgo.id),
  ejecucionId: text('ejecucion_id')
    .notNull()
    .references(() => ejecucion.id),
  url: text('url').$type<TextoRedactado>().notNull(),
  urlOrigen: text('url_origen').$type<TextoRedactado>(),
  /** Redactado y después cifrado con la clave del proyecto (ADR 021 y 032). */
  detalleCifrado: blob('detalle_cifrado', { mode: 'buffer' }),
  /** Cuántos secretos se redactaron en esta aparición: la interfaz lo avisa (EVI-04). */
  secretosRedactados: integer('secretos_redactados').notNull().default(0),
  /** Con secretos redactados: la exportación (semana 9) pide revisarla (RN-REP-03). */
  revisionPendiente: integer('revision_pendiente', { mode: 'boolean' }).notNull().default(false),
});

/**
 * El registro de redacciones: qué se redactó, dónde y por qué regla, nunca el valor (EVI-03 y EVI-04).
 * `ejecucionId` es null para lo que se redactó al migrar datos guardados antes (ADR 033).
 */
export const redaccion = sqliteTable('redaccion', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  ejecucionId: text('ejecucion_id').references(() => ejecucion.id),
  origen: text('origen').notNull(),
  regla: text('regla').notNull(),
  tipo: text('tipo').notNull(),
  cantidad: integer('cantidad').notNull(),
});

/** Sin referencia a la credencial: eliminarla no borra el rastro de los intentos ya hechos. */
export const intentoLogin = sqliteTable('intento_login', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  credencialId: text('credencial_id').notNull(),
  fecha: text('fecha').notNull(),
});

/** La cola local: lo que no terminó al cerrar la app se marca fallido al desbloquear. */
export const ejecucion = sqliteTable('ejecucion', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  tipo: text('tipo', { enum: ['escaneo', 'prueba-login'] }).notNull(),
  // RN-EJE-01: en la fase 1, el objetivo de una ejecución es su proyecto.
  objetivoId: text('objetivo_id').notNull(),
  navegador: text('navegador').notNull(),
  estado: text('estado', {
    enum: ['encolada', 'en-curso', 'pausada', 'finalizada', 'fallida', 'cancelada'],
  }).notNull(),
  inicio: text('inicio'),
  fin: text('fin'),
  resumen: text('resumen', { mode: 'json' }).$type<unknown>().notNull(),
  programacionId: text('programacion_id'),
  // Con qué credencial y rol corrió: para comparar roles en la fase 4.
  credencialId: text('credencial_id'),
  rol: text('rol'),
});

/** Solo host y puerto: una ruta o una query pueden tener tokens. Se purga con su proyecto. */
export const conexion = sqliteTable('conexion', {
  ...comunes,
  proyectoId: text('proyecto_id')
    .notNull()
    .references(() => proyecto.id),
  ejecucionId: text('ejecucion_id')
    .notNull()
    .references(() => ejecucion.id),
  fecha: text('fecha').notNull(),
  proceso: text('proceso', { enum: ['proxy', 'navegador', 'runner'] }).notNull(),
  destino: text('destino').$type<TextoRedactado>().notNull(),
  permitida: integer('permitida', { mode: 'boolean' }).notNull(),
  regla: text('regla').notNull(),
});

/**
 * SEG-07. Solo IDs y nombres de campos: nunca secretos, valores, nombres ni URLs. Por eso no se purga
 * al eliminar un proyecto: sin su clave, queda solo el rastro con el UUID (ADR 015).
 */
export const auditoria = sqliteTable('auditoria', {
  ...comunes,
  accion: text('accion').notNull(),
  entidad: text('entidad').notNull(),
  entidadId: text('entidad_id').notNull(),
  detalle: text('detalle', { mode: 'json' }).$type<DetalleAuditoria>().notNull(),
});

export interface DetalleAuditoria {
  proyectoId?: string;
  campos?: string[];
}
