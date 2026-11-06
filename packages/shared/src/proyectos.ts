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
  sesionMaxMinutos: null,
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

/**
 * En un escaneo autenticado se vuelve a entrar sola (ADR 027): el tope de logins por sesión vencida en
 * una ejecución, y cuánto espera una ejecución pausada antes de cancelarse.
 */
export const LIMITES_SESION = { loginsInesperados: 3, pausaMinutos: 15 } as const;

/**
 * Formas de login del contrato que todavía no se pueden usar, y cuándo llegan. La básica: Chromium
 * arrastra el encabezado que pone QAtlas a una redirección a otro origen, y la contraseña viajaría ahí
 * (ADR 025). Una credencial de estas, de antes o de una copia, queda pero no se prueba ni se lanza.
 */
export const ESTRATEGIAS_PENDIENTES: Readonly<Record<string, { llega: string; motivo: string }>> = {
  basica: {
    llega: 'fase 2',
    motivo:
      'si el sitio redirige a otro origen, el navegador podría mandarle la contraseña. Se resuelve en la fase 2.',
  },
};

export const estrategiaDisponible = (estrategia: string): boolean =>
  !Object.hasOwn(ESTRATEGIAS_PENDIENTES, estrategia);

/**
 * Si una credencial se puede probar y usar en un escaneo. El indicador confirma el ingreso y, en un
 * escaneo, que la sesión sigue; la básica alcanza con que la URL no responda 401.
 */
export function credencialUsable(credencial: {
  requiereRevision: boolean;
  estrategia: string;
  secretoConfigurado: boolean;
  indicadorExito: unknown;
}): boolean {
  if (credencial.requiereRevision) return false;
  if (!estrategiaDisponible(credencial.estrategia)) return false;
  if (credencial.estrategia !== 'asistido' && !credencial.secretoConfigurado) return false;
  return credencial.estrategia === 'basica' || credencial.indicadorExito !== null;
}
