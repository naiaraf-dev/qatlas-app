import { dialog, type BrowserWindow } from 'electron';
import { isLikelySyncedPath } from '../security/data-dir';

/**
 * Diálogos nativos de la copia de seguridad. Las rutas nacen y quedan acá, en el proceso principal:
 * la interfaz nunca las envía ni las recibe.
 */
const FILTROS = [{ name: 'Copia de QAtlas', extensions: ['qatlas'] }];
const NOMBRE_SUGERIDO = 'copia-de-qatlas.qatlas';

async function confirmar(
  ventana: BrowserWindow | null,
  mensaje: string,
  detalle: string,
  aceptar: string,
): Promise<boolean> {
  const opciones = {
    type: 'warning' as const,
    message: mensaje,
    detail: detalle,
    buttons: ['Cancelar', aceptar],
    defaultId: 0,
    cancelId: 0,
  };
  const { response } = ventana
    ? await dialog.showMessageBox(ventana, opciones)
    : await dialog.showMessageBox(opciones);
  return response === 1;
}

/** Si la ruta parece sincronizada con la nube, avisa antes de seguir. La decisión es del usuario. */
async function aceptaCarpetaSincronizada(
  ventana: BrowserWindow | null,
  ruta: string,
): Promise<boolean> {
  if (!isLikelySyncedPath(ruta)) return true;
  return confirmar(
    ventana,
    'Esta carpeta parece estar sincronizada con la nube',
    'La copia está cifrada, pero se subiría a un servicio externo y las copias viejas pueden quedar en su historial. Solo la protege tu contraseña.',
    'Guardar igual',
  );
}

export async function elegirDestinoDeCopia(ventana: BrowserWindow | null): Promise<string | null> {
  const opciones = { defaultPath: NOMBRE_SUGERIDO, filters: FILTROS };
  const { canceled, filePath } = ventana
    ? await dialog.showSaveDialog(ventana, opciones)
    : await dialog.showSaveDialog(opciones);
  if (canceled || !filePath) return null;
  return (await aceptaCarpetaSincronizada(ventana, filePath)) ? filePath : null;
}

export async function elegirCopiaARestaurar(
  ventana: BrowserWindow | null,
  hayBovedaDanada: boolean,
): Promise<string | null> {
  const opciones = { properties: ['openFile' as const], filters: FILTROS };
  const { canceled, filePaths } = ventana
    ? await dialog.showOpenDialog(ventana, opciones)
    : await dialog.showOpenDialog(opciones);
  const ruta = filePaths[0];
  if (canceled || !ruta) return null;
  const detalle = hayBovedaDanada
    ? 'No se puede leer la bóveda actual, así que tampoco la lista de proyectos eliminados: un proyecto eliminado después de hacer la copia volvería a aparecer.'
    : 'Los datos actuales se reemplazan por los de la copia. Los proyectos eliminados no vuelven. Después se desbloquea con la contraseña de la copia.';
  return (await confirmar(ventana, '¿Restaurar esta copia de seguridad?', detalle, 'Restaurar'))
    ? ruta
    : null;
}
