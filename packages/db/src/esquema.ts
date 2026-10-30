import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
  soloLectura: integer('solo_lectura', { mode: 'boolean' }).notNull(),
  exclusiones: text('exclusiones', { mode: 'json' }).$type<string[]>().notNull(),
  modoDatosSensibles: integer('modo_datos_sensibles', { mode: 'boolean' }).notNull(),
  selectoresSensibles: text('selectores_sensibles', { mode: 'json' }).$type<string[]>().notNull(),
  sistemaInterno: integer('sistema_interno', { mode: 'boolean' }).notNull(),
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
  // Cifrado además a nivel de campo con la clave del proyecto (ADR 013).
  secreto: blob('secreto', { mode: 'buffer' }).notNull(),
  secretoActualizadoEn: text('secreto_actualizado_en').notNull(),
  urlLogin: text('url_login').notNull(),
  pasosLogin: text('pasos_login', { mode: 'json' }).$type<unknown[]>().notNull(),
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
