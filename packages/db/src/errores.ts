export type CodigoErrorBoveda =
  'SELLADA_INVALIDA' | 'BASE_INVALIDA' | 'COPIA_INVALIDA' | 'ESQUEMA_MAS_NUEVO';

const MENSAJES: Record<CodigoErrorBoveda, string> = {
  SELLADA_INVALIDA: 'El archivo sellado de la bóveda no es válido.',
  BASE_INVALIDA: 'La base de la bóveda no se pudo abrir.',
  COPIA_INVALIDA: 'La copia de seguridad no es válida.',
  ESQUEMA_MAS_NUEVO: 'La base fue creada por una versión más nueva de QAtlas.',
};

/** Mensaje fijo: nunca incluye rutas, datos ni el error original. */
export class ErrorBoveda extends Error {
  readonly codigo: CodigoErrorBoveda;

  constructor(codigo: CodigoErrorBoveda) {
    super(MENSAJES[codigo]);
    this.name = 'ErrorBoveda';
    this.codigo = codigo;
  }
}
