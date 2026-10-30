import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseCifrada } from './conexion';
import { auditoria, autorizacion, credencial, proyecto, type DetalleAuditoria } from './esquema';

export type FilaProyecto = typeof proyecto.$inferSelect;
export type FilaAutorizacion = typeof autorizacion.$inferSelect;
export type FilaCredencial = typeof credencial.$inferSelect;
export type FilaAuditoria = typeof auditoria.$inferSelect;

type Comunes = 'createdAt' | 'updatedAt';
export type NuevoProyecto = Omit<FilaProyecto, Comunes>;
type DatosProyecto = Omit<FilaProyecto, Comunes | 'id' | 'claveProyectoCifrada'>;
type NuevaAutorizacion = Omit<
  FilaAutorizacion,
  Comunes | 'id' | 'fecha' | 'verificacionDominio' | 'invalidadaEn'
>;
type NuevaCredencial = Omit<FilaCredencial, Comunes | 'secretoActualizadoEn'>;
type DatosCredencial = Pick<FilaCredencial, 'nombre' | 'usuario' | 'urlLogin' | 'pasosLogin'>;

/** Lista cerrada: un valor del usuario no puede terminar acá. */
export type AccionAuditoria =
  | 'proyecto.crear'
  | 'proyecto.editar'
  | 'proyecto.eliminar'
  | 'autorizacion.aceptar'
  | 'autorizacion.invalidar'
  | 'opcion.activar'
  | 'opcion.desactivar'
  | 'credencial.guardar'
  | 'credencial.reemplazar_secreto'
  | 'credencial.eliminar';

const orm = (base: BaseCifrada) => drizzle(base);

function marcas(ahora: string) {
  return { createdAt: ahora, updatedAt: ahora };
}

export function insertarProyecto(base: BaseCifrada, fila: NuevoProyecto): void {
  orm(base)
    .insert(proyecto)
    .values({ ...fila, ...marcas(new Date().toISOString()) })
    .run();
}

export function leerProyectos(base: BaseCifrada): FilaProyecto[] {
  return orm(base).select().from(proyecto).orderBy(asc(proyecto.nombreNormalizado)).all();
}

export function leerProyecto(base: BaseCifrada, id: string): FilaProyecto | undefined {
  return orm(base).select().from(proyecto).where(eq(proyecto.id, id)).get();
}

export function nombreEnUso(base: BaseCifrada, normalizado: string, excepto?: string): boolean {
  const mismoNombre = eq(proyecto.nombreNormalizado, normalizado);
  const fila = orm(base)
    .select({ id: proyecto.id })
    .from(proyecto)
    .where(excepto ? and(mismoNombre, ne(proyecto.id, excepto)) : mismoNombre)
    .get();
  return fila !== undefined;
}

export function actualizarProyecto(base: BaseCifrada, id: string, cambios: DatosProyecto): void {
  orm(base)
    .update(proyecto)
    .set({ ...cambios, updatedAt: new Date().toISOString() })
    .where(eq(proyecto.id, id))
    .run();
}

export function agregarAutorizacion(base: BaseCifrada, fila: NuevaAutorizacion): void {
  const ahora = new Date().toISOString();
  orm(base)
    .insert(autorizacion)
    .values({ ...fila, id: randomUUID(), fecha: ahora, ...marcas(ahora) })
    .run();
}

export function ultimaAutorizacion(
  base: BaseCifrada,
  proyectoId: string,
): FilaAutorizacion | undefined {
  // rowid desempata dos aceptaciones en el mismo milisegundo.
  return orm(base)
    .select()
    .from(autorizacion)
    .where(eq(autorizacion.proyectoId, proyectoId))
    .orderBy(desc(autorizacion.fecha), desc(sql`rowid`))
    .get();
}

/** RN-PRY-03: volver al alcance anterior no la revive; hay que aceptar de nuevo. */
export function invalidarAutorizacion(base: BaseCifrada, id: string): void {
  const ahora = new Date().toISOString();
  orm(base)
    .update(autorizacion)
    .set({ invalidadaEn: ahora, updatedAt: ahora })
    .where(eq(autorizacion.id, id))
    .run();
}

export function agregarCredencial(base: BaseCifrada, fila: NuevaCredencial): void {
  const ahora = new Date().toISOString();
  orm(base)
    .insert(credencial)
    .values({ ...fila, secretoActualizadoEn: ahora, ...marcas(ahora) })
    .run();
}

export function leerCredenciales(base: BaseCifrada, proyectoId: string): FilaCredencial[] {
  return orm(base)
    .select()
    .from(credencial)
    .where(eq(credencial.proyectoId, proyectoId))
    .orderBy(asc(credencial.createdAt))
    .all();
}

/** Atada al proyecto: un ID de credencial de otro proyecto no devuelve nada. */
export function leerCredencial(
  base: BaseCifrada,
  proyectoId: string,
  id: string,
): FilaCredencial | undefined {
  return orm(base)
    .select()
    .from(credencial)
    .where(and(eq(credencial.id, id), eq(credencial.proyectoId, proyectoId)))
    .get();
}

export function actualizarCredencial(
  base: BaseCifrada,
  id: string,
  cambios: DatosCredencial,
): void {
  orm(base)
    .update(credencial)
    .set({ ...cambios, updatedAt: new Date().toISOString() })
    .where(eq(credencial.id, id))
    .run();
}

export function reemplazarSecretoCredencial(base: BaseCifrada, id: string, secreto: Buffer): void {
  const ahora = new Date().toISOString();
  orm(base)
    .update(credencial)
    .set({ secreto, secretoActualizadoEn: ahora, updatedAt: ahora })
    .where(eq(credencial.id, id))
    .run();
}

export function borrarCredencial(base: BaseCifrada, id: string): void {
  orm(base).delete(credencial).where(eq(credencial.id, id)).run();
}

/** Solo IDs y nombres de campos (ADR 015). */
export function registrarAuditoria(
  base: BaseCifrada,
  entrada: {
    accion: AccionAuditoria;
    entidad: 'proyecto' | 'autorizacion' | 'credencial';
    entidadId: string;
    detalle?: DetalleAuditoria;
  },
): void {
  orm(base)
    .insert(auditoria)
    .values({
      id: randomUUID(),
      ...marcas(new Date().toISOString()),
      accion: entrada.accion,
      entidad: entrada.entidad,
      entidadId: entrada.entidadId,
      detalle: entrada.detalle ?? {},
    })
    .run();
}

export function leerAuditoria(base: BaseCifrada): FilaAuditoria[] {
  return orm(base).select().from(auditoria).orderBy(asc(auditoria.createdAt)).all();
}
