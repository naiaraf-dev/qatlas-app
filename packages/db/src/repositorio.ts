import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { BaseCifrada } from './conexion';
import { ErrorBoveda } from './errores';
import { bovedaMeta, configuracion, proyectoLapida } from './esquema';
import { VERSION_ESQUEMA } from './migraciones';

export type Tema = 'system' | 'light' | 'dark';

export interface Configuracion {
  bloqueoMinutos: number;
  actualizacionesActivas: boolean;
  retencionDias: number;
  idioma: string;
  tema: Tema;
}

export const CONFIGURACION_POR_DEFECTO: Readonly<Configuracion> = {
  bloqueoMinutos: 15,
  actualizacionesActivas: false,
  retencionDias: 90,
  idioma: 'es',
  tema: 'system',
};

/**
 * Tablas con datos de un proyecto, en orden de borrado. Se completa al crear cada tabla. Solo admite
 * nombres fijos del código, nunca datos. La fila de `proyecto`, con la clave, se borra al final.
 */
export const TABLAS_DE_PROYECTO: readonly string[] = ['credencial', 'autorizacion'];

const orm = (base: BaseCifrada) => drizzle(base);

export function inicializarDatos(base: BaseCifrada, actualizacionesActivas: boolean): void {
  const ahora = new Date().toISOString();
  const comunes = { createdAt: ahora, updatedAt: ahora };
  orm(base)
    .insert(bovedaMeta)
    .values({
      id: randomUUID(),
      ...comunes,
      versionEsquema: VERSION_ESQUEMA,
      recordarEnEquipo: false,
    })
    .run();
  orm(base)
    .insert(configuracion)
    .values({
      id: randomUUID(),
      ...comunes,
      ...CONFIGURACION_POR_DEFECTO,
      actualizacionesActivas,
    })
    .run();
}

export function leerConfiguracion(base: BaseCifrada): Configuracion {
  const fila = orm(base).select().from(configuracion).get();
  if (!fila) throw new ErrorBoveda('BASE_INVALIDA');
  const { bloqueoMinutos, actualizacionesActivas, retencionDias, idioma, tema } = fila;
  return { bloqueoMinutos, actualizacionesActivas, retencionDias, idioma, tema };
}

export function guardarConfiguracion(base: BaseCifrada, cambios: Partial<Configuracion>): void {
  const fila = orm(base).select({ id: configuracion.id }).from(configuracion).get();
  if (!fila) throw new ErrorBoveda('BASE_INVALIDA');
  orm(base)
    .update(configuracion)
    .set({ ...cambios, updatedAt: new Date().toISOString() })
    .where(eq(configuracion.id, fila.id))
    .run();
}

export interface Lapida {
  proyectoId: string;
  eliminadoEn: string;
}

export function leerLapidas(base: BaseCifrada): Lapida[] {
  return orm(base).select().from(proyectoLapida).all();
}

/** Si la lápida ya existe, conserva la fecha original. */
export function registrarLapidas(base: BaseCifrada, lapidas: readonly Lapida[]): void {
  if (lapidas.length === 0) return;
  orm(base)
    .insert(proyectoLapida)
    .values([...lapidas])
    .onConflictDoNothing()
    .run();
}

/**
 * Borra los datos de todos los proyectos con lápida. Secure_delete pisa el contenido y VACUUM
 * descarta las páginas libres; sin claves de proyecto, sus evidencias quedan ilegibles.
 */
export function purgarConLapida(
  base: BaseCifrada,
  tablas: readonly string[] = TABLAS_DE_PROYECTO,
): void {
  if (leerLapidas(base).length === 0) return;
  borrarFilasConLapida(base, tablas);
  base.exec('VACUUM');
}

/** Sin VACUUM, que no puede correr dentro de una transacción. */
export function borrarFilasConLapida(
  base: BaseCifrada,
  tablas: readonly string[] = TABLAS_DE_PROYECTO,
): void {
  const ids = leerLapidas(base).map((l) => l.proyectoId);
  const purgar = base.transaction(() => {
    for (const tabla of tablas) {
      const borrar = base.prepare(`DELETE FROM "${tabla}" WHERE proyecto_id = ?`);
      for (const id of ids) borrar.run(id);
    }
    const borrarProyecto = base.prepare('DELETE FROM proyecto WHERE id = ?');
    for (const id of ids) borrarProyecto.run(id);
  });
  purgar();
}

/**
 * Termina un borrado que se cortó: filas con lápida o páginas libres sin compactar (ADR 009). Se
 * ejecuta al abrir la base.
 */
export function completarBorradosPendientes(base: BaseCifrada): void {
  borrarFilasConLapida(base);
  if ((base.pragma('freelist_count', { simple: true }) as number) > 0) base.exec('VACUUM');
}

export function verificarIntegridad(base: BaseCifrada): void {
  let resultado: unknown;
  try {
    resultado = base.pragma('integrity_check', { simple: true });
  } catch {
    throw new ErrorBoveda('BASE_INVALIDA');
  }
  if (resultado !== 'ok') throw new ErrorBoveda('BASE_INVALIDA');
}
