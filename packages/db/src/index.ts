export { abrirBaseCifrada, verificarArchivoCifrado, type BaseCifrada } from './conexion';
export { ErrorBoveda, type CodigoErrorBoveda } from './errores';
export * as esquema from './esquema';
export { MIGRACIONES, migrar, VERSION_ESQUEMA, type Migracion } from './migraciones';
export {
  analizarSellada,
  escribirAtomico,
  leerSellada,
  serializarSellada,
  type OperacionesArchivo,
} from './sellada';
export {
  estadoArchivos,
  instalarPar,
  recuperarInstalacion,
  rutasBoveda,
  type EstadoArchivos,
  type RutasBoveda,
} from './almacen';
export { crearCopia, leerCopia, TAMANO_MAXIMO_COPIA, type ContenidoCopia } from './copia';
export {
  borrarFilasConLapida,
  completarBorradosPendientes,
  CONFIGURACION_POR_DEFECTO,
  guardarConfiguracion,
  inicializarDatos,
  leerConfiguracion,
  leerLapidas,
  purgarConLapida,
  registrarLapidas,
  TABLAS_DE_PROYECTO,
  verificarIntegridad,
  type Configuracion,
  type Lapida,
  type Tema,
} from './repositorio';
export type { DetalleAuditoria } from './esquema';
export {
  agregarAutorizacion,
  agregarCredencial,
  borrarCredencial,
  insertarProyecto,
  invalidarAutorizacion,
  leerAuditoria,
  leerCredencial,
  leerCredenciales,
  leerProyecto,
  leerProyectos,
  nombreEnUso,
  registrarAuditoria,
  reemplazarSecretoCredencial,
  actualizarCredencial,
  actualizarProyecto,
  ultimaAutorizacion,
  type AccionAuditoria,
  type FilaAutorizacion,
  type FilaAuditoria,
  type FilaCredencial,
  type FilaProyecto,
  type NuevoProyecto,
} from './proyectos';
