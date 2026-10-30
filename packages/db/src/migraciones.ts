import type { BaseCifrada } from './conexion';
import { ErrorBoveda } from './errores';

export interface Migracion {
  version: number;
  sql: string;
}

/** Solo se agregan al final: una migración publicada no se modifica. La versión es user_version. */
export const MIGRACIONES: readonly Migracion[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE boveda_meta (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        version_esquema INTEGER NOT NULL,
        recordar_en_equipo INTEGER NOT NULL
      );
      CREATE TABLE configuracion (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        bloqueo_minutos INTEGER NOT NULL,
        actualizaciones_activas INTEGER NOT NULL,
        retencion_dias INTEGER NOT NULL,
        idioma TEXT NOT NULL,
        tema TEXT NOT NULL
      );
      CREATE TABLE proyecto_lapida (
        proyecto_id TEXT PRIMARY KEY,
        eliminado_en TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE proyecto (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        nombre TEXT NOT NULL,
        nombre_normalizado TEXT NOT NULL UNIQUE,
        descripcion TEXT NOT NULL,
        url_base TEXT NOT NULL,
        dominios_permitidos TEXT NOT NULL,
        max_rps INTEGER NOT NULL,
        max_paginas INTEGER NOT NULL,
        max_profundidad INTEGER NOT NULL,
        timeout_pagina_segundos INTEGER NOT NULL,
        solo_lectura INTEGER NOT NULL,
        exclusiones TEXT NOT NULL,
        modo_datos_sensibles INTEGER NOT NULL,
        selectores_sensibles TEXT NOT NULL,
        sistema_interno INTEGER NOT NULL,
        permitir_login_http INTEGER NOT NULL,
        clave_proyecto_cifrada BLOB NOT NULL
      );
      CREATE TABLE autorizacion (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        proyecto_id TEXT NOT NULL REFERENCES proyecto(id),
        texto_aceptado TEXT NOT NULL,
        version_texto INTEGER NOT NULL,
        fecha TEXT NOT NULL,
        url_base_aceptada TEXT NOT NULL,
        dominios_aceptados TEXT NOT NULL,
        sistema_interno_aceptado INTEGER NOT NULL,
        invalidada_en TEXT,
        verificacion_dominio TEXT
      );
      CREATE TABLE credencial (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        proyecto_id TEXT NOT NULL REFERENCES proyecto(id),
        nombre TEXT NOT NULL,
        usuario TEXT NOT NULL,
        secreto BLOB NOT NULL,
        secreto_actualizado_en TEXT NOT NULL,
        url_login TEXT NOT NULL,
        pasos_login TEXT NOT NULL
      );
      CREATE TABLE auditoria (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        accion TEXT NOT NULL,
        entidad TEXT NOT NULL,
        entidad_id TEXT NOT NULL,
        detalle TEXT NOT NULL
      );
      CREATE INDEX autorizacion_proyecto ON autorizacion(proyecto_id);
      CREATE INDEX credencial_proyecto ON credencial(proyecto_id);
    `,
  },
];

export const VERSION_ESQUEMA = MIGRACIONES.at(-1)?.version ?? 0;

/**
 * Aplica en una transacción las migraciones pendientes. Si la base es de una versión más nueva
 * de QAtlas, falla cerrado en lugar de tocarla.
 */
export function migrar(base: BaseCifrada, migraciones: readonly Migracion[] = MIGRACIONES): void {
  const actual = base.pragma('user_version', { simple: true }) as number;
  const ultima = migraciones.at(-1)?.version ?? 0;
  if (actual > ultima) throw new ErrorBoveda('ESQUEMA_MAS_NUEVO');

  const aplicar = base.transaction(() => {
    for (const { version, sql } of migraciones) {
      if (version <= actual) continue;
      base.exec(sql);
      base.pragma(`user_version = ${version}`);
    }
  });
  aplicar();
}
