import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
