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
