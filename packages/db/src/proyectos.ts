import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, getTableColumns, gte, inArray, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseCifrada } from './conexion';
import {
  auditoria,
  autorizacion,
  conexion,
  credencial,
  ejecucion,
  hallazgo,
  hallazgoOcurrencia,
  intentoLogin,
  paginaVisitada,
  proyecto,
  type DetalleAuditoria,
} from './esquema';

export type FilaProyecto = typeof proyecto.$inferSelect;
export type FilaAutorizacion = typeof autorizacion.$inferSelect;
export type FilaCredencial = typeof credencial.$inferSelect;
export type FilaAuditoria = typeof auditoria.$inferSelect;
export type FilaEjecucion = typeof ejecucion.$inferSelect;
export type FilaConexion = typeof conexion.$inferSelect;
export type FilaPaginaVisitada = typeof paginaVisitada.$inferSelect;
export type FilaHallazgo = typeof hallazgo.$inferSelect;
export type FilaOcurrencia = typeof hallazgoOcurrencia.$inferSelect;

type Comunes = 'createdAt' | 'updatedAt';
export type NuevoProyecto = Omit<FilaProyecto, Comunes>;
type DatosProyecto = Omit<FilaProyecto, Comunes | 'id' | 'claveProyectoCifrada'>;
type NuevaAutorizacion = Omit<
  FilaAutorizacion,
  Comunes | 'id' | 'fecha' | 'verificacionDominio' | 'invalidadaEn'
>;
type NuevaCredencial = Omit<FilaCredencial, Comunes | 'secretoActualizadoEn'>;
type DatosCredencial = Pick<
  FilaCredencial,
  'nombre' | 'usuario' | 'urlLogin' | 'pasosLogin' | 'indicadorExito' | 'estrategia' | 'rol'
>;

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

/** `urlLogin` cambia junto con el secreto en el token en la URL: sale del enlace nuevo. */
export function reemplazarSecretoCredencial(
  base: BaseCifrada,
  id: string,
  secreto: Buffer,
  urlLogin?: string,
): void {
  const ahora = new Date().toISOString();
  orm(base)
    .update(credencial)
    .set({
      secreto,
      secretoActualizadoEn: ahora,
      updatedAt: ahora,
      ...(urlLogin === undefined ? {} : { urlLogin }),
    })
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

export function insertarEjecucion(
  base: BaseCifrada,
  fila: Omit<FilaEjecucion, Comunes | 'inicio' | 'fin' | 'programacionId'>,
): void {
  orm(base)
    .insert(ejecucion)
    .values({ ...fila, ...marcas(new Date().toISOString()) })
    .run();
}

export function leerEjecucion(base: BaseCifrada, id: string): FilaEjecucion | undefined {
  return orm(base).select().from(ejecucion).where(eq(ejecucion.id, id)).get();
}

export function leerEjecuciones(base: BaseCifrada, proyectoId: string): FilaEjecucion[] {
  return orm(base)
    .select()
    .from(ejecucion)
    .where(eq(ejecucion.proyectoId, proyectoId))
    .orderBy(desc(ejecucion.createdAt), desc(sql`rowid`))
    .limit(50)
    .all();
}

/** Las que no terminaron, en orden de llegada. */
export function leerEjecucionesActivas(base: BaseCifrada): FilaEjecucion[] {
  return (
    orm(base)
      .select()
      .from(ejecucion)
      // Pausada cuenta como activa: retiene la cola (RN-EJE-01).
      .where(inArray(ejecucion.estado, ['encolada', 'en-curso', 'pausada']))
      .orderBy(asc(ejecucion.createdAt), asc(sql`rowid`))
      .all()
  );
}

export function actualizarEjecucion(
  base: BaseCifrada,
  id: string,
  cambios: Partial<Pick<FilaEjecucion, 'estado' | 'inicio' | 'fin' | 'resumen'>>,
): void {
  orm(base)
    .update(ejecucion)
    .set({ ...cambios, updatedAt: new Date().toISOString() })
    .where(eq(ejecucion.id, id))
    .run();
}

export function agregarConexiones(
  base: BaseCifrada,
  filas: readonly Omit<FilaConexion, Comunes | 'id'>[],
): void {
  if (filas.length === 0) return;
  const ahora = new Date().toISOString();
  orm(base)
    .insert(conexion)
    .values(filas.map((fila) => ({ ...fila, id: randomUUID(), ...marcas(ahora) })))
    .run();
}

export function leerConexionesDeEjecucion(base: BaseCifrada, ejecucionId: string): FilaConexion[] {
  return orm(base)
    .select()
    .from(conexion)
    .where(eq(conexion.ejecucionId, ejecucionId))
    .orderBy(asc(conexion.fecha), asc(sql`rowid`))
    .limit(500)
    .all();
}

export function leerUltimasConexiones(base: BaseCifrada, limite: number): FilaConexion[] {
  return orm(base)
    .select()
    .from(conexion)
    .orderBy(desc(sql`rowid`))
    .limit(limite)
    .all();
}

export function agregarPaginaVisitada(
  base: BaseCifrada,
  fila: Omit<FilaPaginaVisitada, Comunes | 'id'>,
): void {
  orm(base)
    .insert(paginaVisitada)
    .values({ ...fila, id: randomUUID(), ...marcas(new Date().toISOString()) })
    .run();
}

export function leerPaginasVisitadas(base: BaseCifrada, ejecucionId: string): FilaPaginaVisitada[] {
  return orm(base)
    .select()
    .from(paginaVisitada)
    .where(eq(paginaVisitada.ejecucionId, ejecucionId))
    .orderBy(asc(sql`rowid`))
    .limit(500)
    .all();
}

/** El hallazgo y su aparición, juntos. */
export function agregarHallazgo(
  base: BaseCifrada,
  fila: Pick<
    FilaHallazgo,
    'proyectoId' | 'ejecucionId' | 'tipo' | 'severidad' | 'titulo' | 'descripcion' | 'url' | 'clave'
  >,
  ocurrencia: Pick<FilaOcurrencia, 'urlOrigen' | 'detalleCifrado'> & { id: string },
): void {
  const ahora = new Date().toISOString();
  const hallazgoId = randomUUID();
  base.transaction(() => {
    orm(base)
      .insert(hallazgo)
      .values({
        ...fila,
        id: hallazgoId,
        huella: null,
        estado: 'nuevo',
        primeraVezEn: ahora,
        ultimaVezEn: ahora,
        casoId: null,
        pasoIndice: null,
        ...marcas(ahora),
      })
      .run();
    orm(base)
      .insert(hallazgoOcurrencia)
      .values({
        id: ocurrencia.id,
        proyectoId: fila.proyectoId,
        hallazgoId,
        ejecucionId: fila.ejecucionId,
        url: fila.url,
        urlOrigen: ocurrencia.urlOrigen,
        detalleCifrado: ocurrencia.detalleCifrado,
        ...marcas(ahora),
      })
      .run();
  })();
}

export function leerHallazgosDeEjecucion(
  base: BaseCifrada,
  ejecucionId: string,
): (FilaHallazgo & {
  ocurrenciaId: string;
  urlOrigen: string | null;
  detalleCifrado: Buffer | null;
})[] {
  return orm(base)
    .select({
      ...getTableColumns(hallazgo),
      ocurrenciaId: hallazgoOcurrencia.id,
      urlOrigen: hallazgoOcurrencia.urlOrigen,
      detalleCifrado: hallazgoOcurrencia.detalleCifrado,
    })
    .from(hallazgo)
    .innerJoin(hallazgoOcurrencia, eq(hallazgoOcurrencia.hallazgoId, hallazgo.id))
    .where(eq(hallazgo.ejecucionId, ejecucionId))
    .orderBy(asc(sql`hallazgo.rowid`))
    .limit(1000)
    .all();
}

export function registrarIntentoLogin(
  base: BaseCifrada,
  fila: { proyectoId: string; credencialId: string; fecha: string },
): void {
  orm(base)
    .insert(intentoLogin)
    .values({ ...fila, id: randomUUID(), ...marcas(fila.fecha) })
    .run();
}

/** Las fechas de los intentos desde `desde`, de la más vieja a la más nueva. */
export function leerIntentosLogin(
  base: BaseCifrada,
  credencialId: string,
  desde: string,
): string[] {
  return orm(base)
    .select({ fecha: intentoLogin.fecha })
    .from(intentoLogin)
    .where(and(eq(intentoLogin.credencialId, credencialId), gte(intentoLogin.fecha, desde)))
    .orderBy(asc(intentoLogin.fecha))
    .all()
    .map(({ fecha }) => fecha);
}

export function leerAuditoria(base: BaseCifrada): FilaAuditoria[] {
  return orm(base).select().from(auditoria).orderBy(asc(auditoria.createdAt)).all();
}
