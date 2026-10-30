import { abrir, PROPOSITO, sellar } from './aead';
import { derivarSubclaveCampos } from './claves';
import { borrar } from './memoria';

/**
 * Cifrado de campo para secretos (credenciales). `contexto` identifica el campo, por
 * ejemplo `credencial:<id>:secreto`: un valor copiado a otro campo no se autentica.
 */
export function cifrarCampo(claveProyecto: Buffer, contexto: string, texto: Buffer): Buffer {
  const subclave = derivarSubclaveCampos(claveProyecto);
  try {
    return sellar(subclave, PROPOSITO.CAMPO, contexto, texto);
  } finally {
    borrar(subclave);
  }
}

/** Devuelve el secreto en claro: quien lo recibe debe borrarlo apenas lo use. */
export function descifrarCampo(claveProyecto: Buffer, contexto: string, sellado: Buffer): Buffer {
  const subclave = derivarSubclaveCampos(claveProyecto);
  try {
    return abrir(subclave, PROPOSITO.CAMPO, contexto, sellado);
  } finally {
    borrar(subclave);
  }
}
