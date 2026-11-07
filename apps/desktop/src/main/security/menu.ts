/**
 * El menú de la aplicación (especificación 3.6: herramientas de desarrollo deshabilitadas en producción).
 * Sin importar `electron`, para probarlo con Vitest: devuelve la plantilla, o null para no tener menú.
 *
 * - Desarrollo (`electron-vite dev`): el menú por defecto de Electron (null acá = no se toca).
 * - Producción en Windows y Linux: sin menú. Copiar, pegar y deshacer funcionan igual en los campos, y
 *   los atajos de QAtlas (Ctrl+Mayús+L) los maneja la interfaz.
 * - Producción en macOS: un menú mínimo, porque ahí los atajos de edición dependen del menú. Sin
 *   recargar ni herramientas de desarrollo.
 */

/** Los roles que usa el menú de producción: ninguno recarga ni abre herramientas de desarrollo. */
type Rol =
  | 'hide'
  | 'hideOthers'
  | 'quit'
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'minimize'
  | 'close';

export interface ItemDeMenu {
  label?: string;
  role?: Rol;
  type?: 'separator';
  submenu?: ItemDeMenu[];
}

export type DecisionDeMenu =
  { tipo: 'por-defecto' } | { tipo: 'ninguno' } | { tipo: 'plantilla'; plantilla: ItemDeMenu[] };

/** Roles que nunca van en producción: recargan la interfaz o abren las herramientas de desarrollo. */
export const ROLES_PROHIBIDOS: ReadonlySet<string> = new Set([
  'reload',
  'forceReload',
  'toggleDevTools',
  'viewMenu',
  'toggleTabBar',
]);

export function menuDeLaAplicacion(opciones: {
  desarrollo: boolean;
  plataforma: NodeJS.Platform;
}): DecisionDeMenu {
  if (opciones.desarrollo) return { tipo: 'por-defecto' };
  if (opciones.plataforma !== 'darwin') return { tipo: 'ninguno' };
  return {
    tipo: 'plantilla',
    plantilla: [
      {
        label: 'QAtlas',
        submenu: [
          { label: 'Ocultar QAtlas', role: 'hide' },
          { label: 'Ocultar las demás', role: 'hideOthers' },
          { type: 'separator' },
          { label: 'Salir de QAtlas', role: 'quit' },
        ],
      },
      {
        label: 'Edición',
        submenu: [
          { label: 'Deshacer', role: 'undo' },
          { label: 'Rehacer', role: 'redo' },
          { type: 'separator' },
          { label: 'Cortar', role: 'cut' },
          { label: 'Copiar', role: 'copy' },
          { label: 'Pegar', role: 'paste' },
          { label: 'Seleccionar todo', role: 'selectAll' },
        ],
      },
      {
        label: 'Ventana',
        submenu: [
          { label: 'Minimizar', role: 'minimize' },
          { label: 'Cerrar', role: 'close' },
        ],
      },
    ],
  };
}

/** Todos los roles de una plantilla, también los de los submenús. */
export function rolesDe(plantilla: readonly ItemDeMenu[]): string[] {
  return plantilla.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(item.submenu ? rolesDe(item.submenu) : []),
  ]);
}
