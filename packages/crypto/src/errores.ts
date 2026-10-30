/**
 * Errores del paquete. Los mensajes son fijos y nunca incluyen datos, claves ni
 * el error original de la primitiva: una contraseña incorrecta y un dato alterado
 * son indistinguibles (ambos son AUTENTICACION).
 */
export type CodigoErrorCripto = 'AUTENTICACION' | 'FORMATO' | 'VERSION' | 'PARAMETROS';

const MENSAJES: Readonly<Record<CodigoErrorCripto, string>> = {
  AUTENTICACION: 'No se pudieron autenticar los datos.',
  FORMATO: 'El formato de los datos no es válido.',
  VERSION: 'La versión de los datos no está soportada.',
  PARAMETROS: 'Los parámetros criptográficos no son válidos.',
};

export class ErrorCripto extends Error {
  readonly codigo: CodigoErrorCripto;

  constructor(codigo: CodigoErrorCripto) {
    super(MENSAJES[codigo]);
    this.name = 'ErrorCripto';
    this.codigo = codigo;
  }
}
