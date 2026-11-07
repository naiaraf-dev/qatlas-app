/** Qué se redactó. Va en la marca `[REDACTADO:tipo]` y en el registro. */
export type TipoRedaccion =
  | 'credencial'
  | 'clave-privada'
  | 'jwt'
  | 'clave-api'
  | 'bearer'
  | 'basica'
  | 'url-con-usuario'
  | 'parametro'
  | 'campo'
  | 'encabezado'
  | 'entropia'
  | 'cuerpo';

/** Un registro de redacción: qué regla, de qué tipo y cuántas veces. Nunca el valor. */
export interface RegistroRedaccion {
  regla: string;
  tipo: TipoRedaccion;
  cantidad: number;
}

declare const redactado: unique symbol;

/**
 * Texto que pasó por la redacción. Solo lo producen las funciones de este paquete: las funciones que
 * guardan o muestran texto del sitio lo exigen, y el compilador no deja pasar texto sin redactar.
 */
export type TextoRedactado = string & { readonly [redactado]: true };

export interface Resultado {
  texto: TextoRedactado;
  registros: RegistroRedaccion[];
}

/** La marca que reemplaza lo redactado. No contiene nada del valor. */
export const marca = (tipo: TipoRedaccion): string => `[REDACTADO:${tipo}]`;

/** Solo para este paquete: marcar como redactado lo que ya pasó por la redacción. */
export const comoRedactado = (texto: string): TextoRedactado => texto as TextoRedactado;

/** Cuántos secretos se redactaron en total. */
export const contarRedacciones = (registros: readonly RegistroRedaccion[]): number =>
  registros.reduce((total, r) => total + r.cantidad, 0);
