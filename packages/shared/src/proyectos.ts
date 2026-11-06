/** Valores por defecto y límites de un proyecto (sección 6.2). Seguro por defecto (3.3). */
export const LIMITES_PROYECTO = {
  maxRps: { min: 1, max: 50 },
  maxPaginas: { min: 1, max: 10000 },
  maxProfundidad: { min: 1, max: 50 },
  timeoutPaginaSegundos: { min: 1, max: 300 },
  maxMinutos: { min: 1, max: 240 },
} as const;

/** SEG-05: el crawler nunca visita ni clickea lo que coincida. */
export const EXCLUSIONES_POR_DEFECTO: readonly string[] = [
  'logout',
  'log out',
  'signout',
  'sign out',
  'cerrar sesión',
  'cerrar sesion',
  'salir',
  'eliminar',
  'borrar',
  'delete',
  'remove',
  'pagar',
  'comprar',
  'checkout',
  'enviar',
];

export const PROYECTO_POR_DEFECTO = {
  maxRps: 2,
  maxPaginas: 200,
  maxProfundidad: 5,
  timeoutPaginaSegundos: 30,
  maxMinutos: 30,
  soloLectura: true,
  modoDatosSensibles: false,
  sistemaInterno: false,
  permitirLoginHttp: false,
} as const;

/** Una prueba de login es un intento real: los fallidos pueden bloquear la cuenta en el sistema probado. */
export const LIMITE_PRUEBAS_LOGIN = { intentos: 3, ventanaMinutos: 15 } as const;

/** Lo mínimo que tarda un escaneo si usa todas sus páginas. Sirve para avisar antes de lanzarlo. */
export function minutosMinimosDeEjecucion(limites: {
  maxPaginas: number;
  maxRps: number;
  maxMinutos: number;
}): number {
  // RN-ESC-05: el tiempo máximo corta antes, si llega primero.
  return Math.min(limites.maxPaginas / limites.maxRps / 60, limites.maxMinutos);
}

/** Clave de unicidad del nombre: sin distinguir mayúsculas, también con acentos y eñes. */
export function normalizarNombreProyecto(nombre: string): string {
  return nombre.trim().normalize('NFC').toLocaleLowerCase('es');
}
