/**
 * La redacción en el proceso principal (ADR 032): el único punto por el que pasa todo texto que llega
 * del runner o del proxy antes de guardarse, mostrarse o registrarse. El runner redacta antes como
 * primera capa; la garantía es esta, que además es la única que conoce los secretos de las credenciales
 * (por su HMAC, ADR 031).
 *
 * Sin `electron`, para probarlo con Vitest.
 */
import { createHmac } from 'node:crypto';
import {
  abrirClaveProyecto,
  borrar,
  derivarSubclaveHallazgos,
  descifrarCampo,
} from '@qatlas/crypto';
import { leerCredenciales, type BaseCifrada, type NuevaRedaccion } from '@qatlas/db';
import {
  ComparadorDeSecretos,
  normalizarMensaje,
  redactarSecuencia,
  redactarTexto,
  redactarUrl,
  type OpcionesRedaccion,
  type RegistroRedaccion,
  type Resultado,
  type TextoRedactado,
} from '@qatlas/redaction';
import { contextoSecreto } from '../proyectos/servicio';

/** Sube cuando cambia lo que se redacta: lo guardado se vuelve a pasar al desbloquear (ADR 033). */
export const VERSION_REDACCION = 1;

/** Los hallazgos cuya clave sale del texto de la página: su clave es un HMAC (ADR 032). */
export const TIPOS_DE_MENSAJE: ReadonlySet<string> = new Set(['console-error', 'error-javascript']);

export interface Redactor {
  texto: (texto: string, opciones?: OpcionesRedaccion) => Resultado;
  url: (url: string, opciones?: OpcionesRedaccion) => Resultado;
  secuencia: (textos: readonly string[], opciones?: OpcionesRedaccion) => Resultado[];
}

/** El de siempre. Solo el control positivo de TS-01 inyecta otro. */
export const REDACTOR: Redactor = {
  texto: redactarTexto,
  url: redactarUrl,
  secuencia: redactarSecuencia,
};

interface ProyectoConClave {
  id: string;
  claveProyectoCifrada: Buffer;
}

/**
 * El comparador con los secretos de las credenciales del proyecto. Se descifran, se calcula su HMAC y se
 * borran enseguida: desde ahí, solo queda el comparador.
 */
export function comparadorDelProyecto(
  base: BaseCifrada,
  maestra: Buffer,
  proyecto: ProyectoConClave,
): ComparadorDeSecretos {
  const clave = abrirClaveProyecto(maestra, proyecto.id, proyecto.claveProyectoCifrada);
  const secretos: Buffer[] = [];
  try {
    for (const credencial of leerCredenciales(base, proyecto.id)) {
      if (credencial.secreto === null) continue;
      secretos.push(
        descifrarCampo(clave, contextoSecreto(proyecto.id, credencial.id), credencial.secreto),
      );
    }
    return ComparadorDeSecretos.crear(secretos);
  } finally {
    borrar(clave, ...secretos);
  }
}

/** La subclave del proyecto para las claves de los hallazgos. Quien la recibe la borra. */
export function subclaveDeHallazgos(maestra: Buffer, proyecto: ProyectoConClave): Buffer {
  const clave = abrirClaveProyecto(maestra, proyecto.id, proyecto.claveProyectoCifrada);
  try {
    return derivarSubclaveHallazgos(clave);
  } finally {
    borrar(clave);
  }
}

/**
 * La clave de un mensaje (ADR 032): HMAC-SHA-256 con la subclave del proyecto, sobre el mensaje ya
 * redactado y normalizado. El mismo problema da la misma clave dentro del proyecto; sin la clave del
 * proyecto no se puede probar candidatos.
 */
export function claveDeMensaje(
  subclave: Buffer,
  detalleRedactado: TextoRedactado,
  normalizar = true,
): TextoRedactado {
  const hmac = createHmac('sha256', subclave)
    .update(normalizar ? normalizarMensaje(detalleRedactado) : detalleRedactado)
    .digest('hex')
    .slice(0, 32);
  // Un HMAC no tiene nada que redactar: pasa por la redacción para tener el tipo.
  return redactarTexto(`msj:${hmac}`).texto;
}

/** Las filas del registro de redacciones de un campo: regla, tipo y cantidad, nunca el valor. */
export function filasDeRegistro(
  proyectoId: string,
  ejecucionId: string | null,
  origen: string,
  registros: readonly RegistroRedaccion[],
): NuevaRedaccion[] {
  return registros.map((r) => ({
    proyectoId,
    ejecucionId,
    origen,
    regla: r.regla,
    tipo: r.tipo,
    cantidad: r.cantidad,
  }));
}
