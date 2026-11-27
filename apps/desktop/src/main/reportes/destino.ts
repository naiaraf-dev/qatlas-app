import { writeFile } from 'node:fs/promises';
import { dialog, type BrowserWindow } from 'electron';
import { isLikelySyncedPath } from '../security/data-dir';

/**
 * El destino de una exportación (3.9, paso 5; ADR 048). La ruta nace y queda en el proceso principal: la
 * interfaz nunca la envía ni la recibe. Si la carpeta parece sincronizada con la nube, se avisa antes de
 * guardar, y la decisión queda registrada (sin la ruta).
 */
export interface DestinoElegido {
  ruta: string;
  sincronizado: boolean;
}

export interface Destinos {
  elegir(
    nombreSugerido: string,
    extension: string,
    descripcion: string,
  ): Promise<DestinoElegido | null>;
  escribir(ruta: string, datos: Uint8Array): Promise<void>;
}

export function destinosNativos(ventana: () => BrowserWindow | null): Destinos {
  return {
    async elegir(nombreSugerido, extension, descripcion) {
      const actual = ventana();
      const opciones = {
        defaultPath: nombreSugerido,
        filters: [{ name: descripcion, extensions: [extension] }],
      };
      const { canceled, filePath } = actual
        ? await dialog.showSaveDialog(actual, opciones)
        : await dialog.showSaveDialog(opciones);
      if (canceled || !filePath) return null;
      const sincronizado = isLikelySyncedPath(filePath);
      if (sincronizado) {
        const aviso = {
          type: 'warning' as const,
          message: 'Esta carpeta parece estar sincronizada con la nube',
          detail:
            'El archivo exportado no está cifrado: se subiría a un servicio externo, y sus versiones pueden quedar en el historial de ese servicio.',
          buttons: ['Cancelar', 'Guardar igual'],
          defaultId: 0,
          cancelId: 0,
        };
        const { response } = actual
          ? await dialog.showMessageBox(actual, aviso)
          : await dialog.showMessageBox(aviso);
        if (response !== 1) return null;
      }
      return { ruta: filePath, sincronizado };
    },
    async escribir(ruta, datos) {
      // Lo elegido por la persona: es la exportación, en claro por decisión suya (3.9).
      await writeFile(ruta, datos, { mode: 0o600 });
    },
  };
}
