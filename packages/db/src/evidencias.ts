import { randomUUID } from 'node:crypto';
import { and, asc, eq, getTableColumns, inArray, lt } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseCifrada } from './conexion';
import { evidencia, type MetadatosEvidencia, type TipoEvidencia } from './esquema';

/**
 * Las filas de las evidencias (semana 7b). La semilla sale de acá solo hacia el proceso principal, para
 * descifrar; nunca hacia la interfaz.
 */

export type FilaEvidencia = typeof evidencia.$inferSelect;
/** Lo que se puede mostrar o listar: todo menos la semilla. */
export type ResumenEvidencia = Omit<FilaEvidencia, 'semilla'>;

export interface NuevaEvidencia {
  id?: string;
  proyectoId: string;
  ejecucionId: string;
  paginaVisitadaId: string | null;
  tipo: TipoEvidencia;
  archivo: string;
  semilla: Buffer;
  tamano: number;
  secretosRedactados?: number;
  puedeTenerDatosSensibles?: boolean;
  metadatos: MetadatosEvidencia;
}

const orm = (base: BaseCifrada) => drizzle(base);
const columnasSinSemilla = Object.fromEntries(
  Object.entries(getTableColumns(evidencia)).filter(([nombre]) => nombre !== 'semilla'),
) as Omit<ReturnType<typeof getTableColumns<typeof evidencia>>, 'semilla'>;

export function agregarEvidencia(base: BaseCifrada, fila: NuevaEvidencia): string {
  const id = fila.id ?? randomUUID();
  const ahora = new Date().toISOString();
  const secretos = fila.secretosRedactados ?? 0;
  orm(base)
    .insert(evidencia)
    .values({
      id,
      createdAt: ahora,
      updatedAt: ahora,
      proyectoId: fila.proyectoId,
      ejecucionId: fila.ejecucionId,
      paginaVisitadaId: fila.paginaVisitadaId,
      tipo: fila.tipo,
      archivo: fila.archivo,
      semilla: fila.semilla,
      tamano: fila.tamano,
      secretosRedactados: secretos,
      // Con secretos redactados, la exportación pide revisarla (RN-REP-03).
      revisionPendiente: secretos > 0,
      puedeTenerDatosSensibles: fila.puedeTenerDatosSensibles ?? false,
      metadatos: fila.metadatos,
    })
    .run();
  return id;
}

/** Con la semilla: solo para descifrar en el proceso principal. */
export function leerEvidenciaParaDescifrar(base: BaseCifrada, id: string): FilaEvidencia | null {
  return orm(base).select().from(evidencia).where(eq(evidencia.id, id)).get() ?? null;
}

export function leerEvidenciasDeEjecucion(
  base: BaseCifrada,
  ejecucionId: string,
): ResumenEvidencia[] {
  return orm(base)
    .select(columnasSinSemilla)
    .from(evidencia)
    .where(eq(evidencia.ejecucionId, ejecucionId))
    .orderBy(asc(evidencia.createdAt))
    .all();
}

/** Las de antes de `antesDe`, salvo las protegidas (las de reportes, semana 9). */
export function evidenciasVencidas(
  base: BaseCifrada,
  antesDe: string,
  protegidas: ReadonlySet<string>,
): Pick<FilaEvidencia, 'id' | 'proyectoId' | 'archivo'>[] {
  return orm(base)
    .select({ id: evidencia.id, proyectoId: evidencia.proyectoId, archivo: evidencia.archivo })
    .from(evidencia)
    .where(lt(evidencia.createdAt, antesDe))
    .all()
    .filter((fila) => !protegidas.has(fila.id));
}

/** Videos y snapshots del DOM de un proyecto: lo que el modo datos sensibles no graba (EVI-05). */
export function evidenciasQueNoCumplenModoSensible(
  base: BaseCifrada,
  proyectoId: string,
): Pick<FilaEvidencia, 'id' | 'tipo' | 'archivo'>[] {
  return orm(base)
    .select({ id: evidencia.id, tipo: evidencia.tipo, archivo: evidencia.archivo })
    .from(evidencia)
    .where(
      and(eq(evidencia.proyectoId, proyectoId), inArray(evidencia.tipo, ['video', 'snapshot-dom'])),
    )
    .all();
}

/**
 * Borrar la fila es el borrado criptográfico: la semilla solo estaba acá, y `secure_delete` pisa su
 * página. El archivo lo borra quien llama, después.
 */
export function borrarEvidencias(base: BaseCifrada, ids: readonly string[]): void {
  if (ids.length === 0) return;
  base.transaction(() => {
    for (let i = 0; i < ids.length; i += 500) {
      orm(base)
        .delete(evidencia)
        .where(inArray(evidencia.id, ids.slice(i, i + 500)))
        .run();
    }
  })();
}

/** Los nombres de archivo que tienen fila: lo demás en la carpeta es un resto ilegible. */
export function archivosDeEvidencias(base: BaseCifrada): Set<string> {
  return new Set(
    orm(base)
      .select({ archivo: evidencia.archivo })
      .from(evidencia)
      .all()
      .map((f) => f.archivo),
  );
}
