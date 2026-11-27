/**
 * Los nombres que ve la persona: estados, apariciones, tipos y severidades. Siempre con texto: el color
 * nunca comunica solo.
 */
import type {
  AparicionHallazgo,
  EjecucionResumen,
  EstadoHallazgo,
  SeveridadHallazgo,
  TipoHallazgo,
} from '@qatlas/shared';

export const NOMBRE_ESTADO: Record<EstadoHallazgo, string> = {
  nuevo: 'Nuevo',
  confirmado: 'Confirmado',
  descartado: 'Descartado',
  reportado: 'Reportado',
  posiblemente_resuelto: 'Posiblemente resuelto',
  resuelto: 'Resuelto',
  regresion: 'Regresión',
};

export const ORDEN_ESTADOS: readonly EstadoHallazgo[] = [
  'regresion',
  'nuevo',
  'confirmado',
  'reportado',
  'posiblemente_resuelto',
  'resuelto',
  'descartado',
];

export const NOMBRE_APARICION: Record<AparicionHallazgo, string> = {
  nueva: 'Apareció por primera vez',
  recurrente: 'Volvió a aparecer',
  regresion: 'Volvió estando resuelto: regresión',
};

export const NOMBRE_TIPO: Record<TipoHallazgo, string> = {
  'error-http': 'Error HTTP',
  'link-roto': 'Link roto',
  'recurso-con-error': 'Recurso con error',
  'error-javascript': 'Excepción de JavaScript',
  'console-error': 'Error en la consola',
  accesibilidad: 'Accesibilidad',
  rendimiento: 'Rendimiento',
  'cookie-insegura': 'Cookie insegura',
  'contenido-mixto': 'Contenido mixto',
  'login-sin-cifrar': 'Login sin cifrar',
  'recurso-externo-bloqueado': 'Recurso externo bloqueado',
  'parametro-sensible': 'Parámetro sensible en la URL',
  'secreto-en-almacenamiento': 'Secreto guardado en el navegador',
};

export const ORDEN_SEVERIDAD: readonly SeveridadHallazgo[] = [
  'critica',
  'alta',
  'media',
  'baja',
  'informativa',
];

export const NOMBRE_SEVERIDAD: Record<SeveridadHallazgo, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  informativa: 'Informativa',
};

export const NOMBRE_ESTADO_EJECUCION: Record<EjecucionResumen['estado'], string> = {
  encolada: 'En cola',
  'en-curso': 'En curso',
  finalizada: 'Finalizada',
  fallida: 'Fallida',
  cancelada: 'Cancelada',
  pausada: 'Pausada',
};

/** Una fecha para leer. La hora es la del equipo; la fecha guardada, en UTC. */
export function fecha(iso: string | null): string {
  if (!iso) return '—';
  const valor = new Date(iso);
  return Number.isNaN(valor.getTime())
    ? iso
    : valor.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/** La ruta de una URL ya redactada, para mostrar. Si no se puede leer, tal cual. */
export function rutaDe(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}
