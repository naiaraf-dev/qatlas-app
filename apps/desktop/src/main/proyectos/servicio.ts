import { randomUUID } from 'node:crypto';
import {
  abrirClaveProyecto,
  borrar,
  cifrarCampo,
  crearClaveProyecto,
  descifrarCampo,
} from '@qatlas/crypto';
import {
  actualizarCredencial,
  actualizarProyecto,
  agregarAutorizacion,
  agregarCredencial,
  borrarCredencial,
  borrarFilasConLapida,
  completarBorradosPendientes,
  insertarProyecto,
  invalidarAutorizacion,
  leerCredencial,
  leerCredenciales,
  leerProyecto,
  leerProyectos,
  nombreEnUso,
  reemplazarSecretoCredencial,
  registrarAuditoria,
  registrarLapidas,
  ultimaAutorizacion,
  type BaseCifrada,
  type FilaCredencial,
  type FilaProyecto,
} from '@qatlas/db';
import {
  normalizarNombreProyecto,
  renderizarDeclaracion,
  verificarAutorizacion,
  VERSION_DECLARACION,
  type CredencialResumen,
  type ErrorValidacion,
  type EstadoAutorizacion as EstadoAutorizacionContrato,
  type IpcRequest,
  type IpcResponse,
  type PasoLogin,
  type ProyectoDetalle,
  type ProyectoEntrada,
  type ProyectoResumen,
} from '@qatlas/shared';
import { proponerDominio, validarAlcance, validarUrlLogin } from '@qatlas/shared/dominios';
import type { ServicioBoveda } from '../boveda/servicio';

export interface Aceptacion {
  aceptada: true;
  version: number;
  texto: string;
}

export class EntidadNoEncontrada extends Error {
  constructor() {
    super('No existe.');
    this.name = 'EntidadNoEncontrada';
  }
}

/** RN-PRY-01: el runner lo recibe en lugar de ejecutar. */
export class AutorizacionNoVigente extends Error {
  constructor(readonly motivo: string) {
    super('El proyecto no tiene una autorización vigente.');
    this.name = 'AutorizacionNoVigente';
  }
}

export class CredencialARevisar extends Error {
  constructor() {
    super('La URL de login de la credencial ya no se puede usar.');
    this.name = 'CredencialARevisar';
  }
}

// Se comparan para saber qué cambió. Solo los nombres llegan a la auditoría.
const CAMPOS_EDITABLES = [
  'nombre',
  'descripcion',
  'urlBase',
  'dominios',
  'maxRps',
  'maxPaginas',
  'maxProfundidad',
  'timeoutPaginaSegundos',
  'exclusiones',
  'selectoresSensibles',
] as const;

// Relajar un control se registra aparte, con su sentido (principio 3.3).
const OPCIONES = [
  'soloLectura',
  'modoDatosSensibles',
  'sistemaInterno',
  'permitirLoginHttp',
] as const;

/** Lo que ata el secreto a su proyecto y a su credencial (ADR 013). */
export function contextoSecreto(proyectoId: string, credencialId: string): string {
  return `credencial/${proyectoId}/${credencialId}/secreto`;
}

function aEntrada(fila: FilaProyecto): ProyectoEntrada {
  return {
    nombre: fila.nombre,
    descripcion: fila.descripcion,
    urlBase: fila.urlBase,
    dominios: fila.dominiosPermitidos,
    maxRps: fila.maxRps,
    maxPaginas: fila.maxPaginas,
    maxProfundidad: fila.maxProfundidad,
    timeoutPaginaSegundos: fila.timeoutPaginaSegundos,
    soloLectura: fila.soloLectura,
    exclusiones: fila.exclusiones,
    modoDatosSensibles: fila.modoDatosSensibles,
    selectoresSensibles: fila.selectoresSensibles,
    sistemaInterno: fila.sistemaInterno,
    permitirLoginHttp: fila.permitirLoginHttp,
  };
}

function aColumnas(entrada: ProyectoEntrada, urlBase: string, dominios: string[]) {
  return {
    nombre: entrada.nombre,
    nombreNormalizado: normalizarNombreProyecto(entrada.nombre),
    descripcion: entrada.descripcion,
    urlBase,
    dominiosPermitidos: dominios,
    maxRps: entrada.maxRps,
    maxPaginas: entrada.maxPaginas,
    maxProfundidad: entrada.maxProfundidad,
    timeoutPaginaSegundos: entrada.timeoutPaginaSegundos,
    soloLectura: entrada.soloLectura,
    exclusiones: entrada.exclusiones,
    modoDatosSensibles: entrada.modoDatosSensibles,
    selectoresSensibles: entrada.selectoresSensibles,
    sistemaInterno: entrada.sistemaInterno,
    permitirLoginHttp: entrada.permitirLoginHttp,
  };
}

const iguales = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function estadoDe(base: BaseCifrada, fila: FilaProyecto) {
  const aceptada = ultimaAutorizacion(base, fila.id);
  return verificarAutorizacion(
    {
      urlBase: fila.urlBase,
      dominios: fila.dominiosPermitidos,
      sistemaInterno: fila.sistemaInterno,
    },
    aceptada && {
      urlBase: aceptada.urlBaseAceptada,
      dominios: aceptada.dominiosAceptados,
      sistemaInterno: aceptada.sistemaInternoAceptado,
      version: aceptada.versionTexto,
      invalidada: aceptada.invalidadaEn !== null,
    },
  );
}

function loginValido(fila: FilaProyecto, urlLogin: string): boolean {
  return validarUrlLogin(urlLogin, {
    dominios: fila.dominiosPermitidos,
    permitirLoginHttp: fila.permitirLoginHttp,
  }).ok;
}

function aResumenCredencial(proyecto: FilaProyecto, fila: FilaCredencial): CredencialResumen {
  // Lista explícita de campos: la fila tiene el secreto cifrado y acá nunca se copia.
  return {
    id: fila.id,
    nombre: fila.nombre,
    usuario: fila.usuario,
    urlLogin: fila.urlLogin,
    pasosLogin: fila.pasosLogin as PasoLogin[],
    secretoConfigurado: true,
    secretoActualizadoEn: fila.secretoActualizadoEn,
    requiereRevision: !loginValido(proyecto, fila.urlLogin),
  };
}

/**
 * Proyectos, autorización y credenciales (sección 6.2). Sin Electron: se prueba con Vitest.
 *
 * - La clave de un proyecto se abre solo para una operación y se borra enseguida.
 * - Cada acción y su auditoría van en la misma transacción.
 */
export class ServicioProyectos {
  constructor(private readonly boveda: ServicioBoveda) {}

  listar(): ProyectoResumen[] {
    return this.boveda.conAcceso((base) =>
      leerProyectos(base).map((fila) => ({
        id: fila.id,
        nombre: fila.nombre,
        urlBase: fila.urlBase,
        autorizacion: estadoDe(base, fila),
        credenciales: leerCredenciales(base, fila.id).length,
      })),
    );
  }

  obtener(id: string): ProyectoDetalle | null {
    return this.boveda.conAcceso((base) => {
      const fila = leerProyecto(base, id);
      if (!fila) return null;
      const aceptada = ultimaAutorizacion(base, id);
      return {
        ...aEntrada(fila),
        id: fila.id,
        autorizacion: estadoDe(base, fila),
        aceptadaEn: aceptada?.fecha ?? null,
        declaracion: {
          version: VERSION_DECLARACION,
          texto: renderizarDeclaracion({
            urlBase: fila.urlBase,
            dominios: fila.dominiosPermitidos,
          }),
        },
        credenciales: leerCredenciales(base, id).map((c) => aResumenCredencial(fila, c)),
      };
    });
  }

  private evaluar(base: BaseCifrada, entrada: ProyectoEntrada, excepto?: string) {
    const alcance = validarAlcance(entrada);
    const errores: ErrorValidacion[] = alcance.ok ? [] : [...alcance.errores];
    if (nombreEnUso(base, normalizarNombreProyecto(entrada.nombre), excepto)) {
      errores.unshift({ campo: 'nombre', motivo: 'nombre-repetido' });
    }
    return { errores, alcance };
  }

  validar(entrada: ProyectoEntrada, id?: string): IpcResponse<'proyectos:validar'> {
    return this.boveda.conAcceso((base) => {
      const { errores, alcance } = this.evaluar(base, entrada, id);
      return {
        errores,
        dominioPropuesto: proponerDominio(entrada.urlBase, entrada),
        declaracion: alcance.ok
          ? { version: VERSION_DECLARACION, texto: renderizarDeclaracion(alcance) }
          : null,
      };
    });
  }

  crear(entrada: ProyectoEntrada, aceptacion: Aceptacion): IpcResponse<'proyectos:crear'> {
    return this.boveda.conAcceso((base, maestra) => {
      const { errores, alcance } = this.evaluar(base, entrada);
      if (errores.length > 0 || !alcance.ok) return { resultado: 'rechazado', errores };

      const texto = renderizarDeclaracion(alcance);
      if (!this.aceptacionValida(aceptacion, texto)) {
        return {
          resultado: 'rechazado',
          errores: [{ campo: 'declaracion', motivo: 'declaracion-distinta' }],
        };
      }

      const id = randomUUID();
      const { clave, envuelta } = crearClaveProyecto(maestra, id);
      borrar(clave);
      base.transaction(() => {
        insertarProyecto(base, {
          id,
          ...aColumnas(entrada, alcance.urlBase, alcance.dominios),
          claveProyectoCifrada: envuelta,
        });
        this.registrarAceptacion(base, id, texto, {
          urlBase: alcance.urlBase,
          dominios: alcance.dominios,
          sistemaInterno: entrada.sistemaInterno,
        });
        registrarAuditoria(base, { accion: 'proyecto.crear', entidad: 'proyecto', entidadId: id });
      })();
      return { resultado: 'creado', id };
    });
  }

  actualizar(id: string, entrada: ProyectoEntrada): IpcResponse<'proyectos:actualizar'> {
    return this.boveda.conAcceso((base) => {
      const fila = this.proyectoExistente(base, id);
      const { errores, alcance } = this.evaluar(base, entrada, id);
      if (errores.length > 0 || !alcance.ok) return { resultado: 'rechazado', errores };

      const anterior = aEntrada(fila);
      const nueva: ProyectoEntrada = {
        ...entrada,
        urlBase: alcance.urlBase,
        dominios: alcance.dominios,
      };
      const cambio = (campo: keyof ProyectoEntrada) => !iguales(anterior[campo], nueva[campo]);
      const campos = CAMPOS_EDITABLES.filter(cambio);
      const opciones = OPCIONES.filter(cambio);
      // RN-PRY-03. "Sistema interno" cambia a qué se puede llegar; el login en http, no.
      const camposDeAlcance = (['urlBase', 'dominios', 'sistemaInterno'] as const).filter(cambio);

      base.transaction(() => {
        actualizarProyecto(base, id, aColumnas(entrada, alcance.urlBase, alcance.dominios));
        if (campos.length > 0) {
          registrarAuditoria(base, {
            accion: 'proyecto.editar',
            entidad: 'proyecto',
            entidadId: id,
            detalle: { campos },
          });
        }
        for (const opcion of opciones) {
          registrarAuditoria(base, {
            accion: nueva[opcion] ? 'opcion.activar' : 'opcion.desactivar',
            entidad: 'proyecto',
            entidadId: id,
            detalle: { campos: [opcion] },
          });
        }
        const aceptada = ultimaAutorizacion(base, id);
        if (camposDeAlcance.length > 0 && aceptada && aceptada.invalidadaEn === null) {
          invalidarAutorizacion(base, aceptada.id);
          registrarAuditoria(base, {
            accion: 'autorizacion.invalidar',
            entidad: 'autorizacion',
            entidadId: aceptada.id,
            detalle: { proyectoId: id, campos: camposDeAlcance },
          });
        }
      })();
      return {
        resultado: 'actualizado',
        autorizacion: estadoDe(base, this.proyectoExistente(base, id)),
      };
    });
  }

  /**
   * Borrado criptográfico (ADR 009): la clave envuelta se borra con `secure_delete`, y las páginas
   * libres se descartan con VACUUM. Si VACUUM falla, las filas ya no están y se reintenta al abrir.
   */
  eliminar(id: string, nombreConfirmacion: string): IpcResponse<'proyectos:eliminar'> {
    return this.boveda.conAcceso((base) => {
      const fila = this.proyectoExistente(base, id);
      if (nombreConfirmacion !== fila.nombre) return { resultado: 'nombre-no-coincide' };
      base.transaction(() => {
        registrarLapidas(base, [{ proyectoId: id, eliminadoEn: new Date().toISOString() }]);
        borrarFilasConLapida(base);
        registrarAuditoria(base, {
          accion: 'proyecto.eliminar',
          entidad: 'proyecto',
          entidadId: id,
        });
      })();
      try {
        completarBorradosPendientes(base);
      } catch {
        // Se completa al abrir la base.
      }
      return { resultado: 'eliminado' };
    });
  }

  aceptarAutorizacion(
    id: string,
    aceptacion: Aceptacion,
  ): IpcResponse<'proyectos:aceptarAutorizacion'> {
    return this.boveda.conAcceso((base) => {
      const fila = this.proyectoExistente(base, id);
      const texto = renderizarDeclaracion({
        urlBase: fila.urlBase,
        dominios: fila.dominiosPermitidos,
      });
      if (!this.aceptacionValida(aceptacion, texto)) return { resultado: 'declaracion-distinta' };
      base.transaction(() => {
        this.registrarAceptacion(base, id, texto, {
          urlBase: fila.urlBase,
          dominios: fila.dominiosPermitidos,
          sistemaInterno: fila.sistemaInterno,
        });
      })();
      return { resultado: 'aceptada' };
    });
  }

  /** El texto aceptado es el que corresponde al alcance que se guarda, no otro. */
  private aceptacionValida(aceptacion: Aceptacion, texto: string): boolean {
    return aceptacion.version === VERSION_DECLARACION && aceptacion.texto === texto;
  }

  private registrarAceptacion(
    base: BaseCifrada,
    proyectoId: string,
    texto: string,
    alcance: { urlBase: string; dominios: string[]; sistemaInterno: boolean },
  ): void {
    agregarAutorizacion(base, {
      proyectoId,
      textoAceptado: texto,
      versionTexto: VERSION_DECLARACION,
      urlBaseAceptada: alcance.urlBase,
      dominiosAceptados: alcance.dominios,
      sistemaInternoAceptado: alcance.sistemaInterno,
    });
    registrarAuditoria(base, {
      accion: 'autorizacion.aceptar',
      entidad: 'proyecto',
      entidadId: proyectoId,
    });
  }

  /** RN-PRY-01, para el runner de la semana 5. Un proyecto inexistente tampoco está autorizado. */
  estadoAutorizacion(id: string): EstadoAutorizacionContrato {
    return this.boveda.conAcceso((base) => {
      const fila = leerProyecto(base, id);
      return fila ? estadoDe(base, fila) : { vigente: false, motivo: 'sin-aceptar' };
    });
  }

  exigirAutorizacion(id: string): void {
    const estado = this.estadoAutorizacion(id);
    if (!estado.vigente) throw new AutorizacionNoVigente(estado.motivo);
  }

  guardarCredencial(
    solicitud: IpcRequest<'credenciales:guardar'>,
  ): IpcResponse<'credenciales:guardar'> {
    return this.boveda.conAcceso((base, maestra) => {
      const { proyectoId, nombre, usuario, urlLogin, pasosLogin } = solicitud;
      const proyecto = this.proyectoExistente(base, proyectoId);
      const login = validarUrlLogin(urlLogin, {
        dominios: proyecto.dominiosPermitidos,
        permitirLoginHttp: proyecto.permitirLoginHttp,
      });
      if (!login.ok) {
        return { resultado: 'rechazado', errores: [{ campo: 'urlLogin', motivo: login.motivo }] };
      }
      const datos = { nombre: nombre.trim(), usuario, urlLogin: login.url, pasosLogin };

      if ('secreto' in solicitud) {
        const id = randomUUID();
        const secreto = this.cifrarSecreto(maestra, proyecto, id, solicitud.secreto);
        base.transaction(() => {
          agregarCredencial(base, { id, proyectoId, ...datos, secreto });
          this.auditarCredencial(base, 'credencial.guardar', id, proyectoId);
        })();
        return { resultado: 'guardada', credencialId: id };
      }

      const id = solicitud.credencialId;
      this.credencialExistente(base, proyectoId, id);
      base.transaction(() => {
        actualizarCredencial(base, id, datos);
        this.auditarCredencial(base, 'credencial.guardar', id, proyectoId);
      })();
      return { resultado: 'guardada', credencialId: id };
    });
  }

  reemplazarSecreto(
    proyectoId: string,
    credencialId: string,
    secreto: string,
  ): IpcResponse<'credenciales:reemplazarSecreto'> {
    return this.boveda.conAcceso((base, maestra) => {
      const proyecto = this.proyectoExistente(base, proyectoId);
      this.credencialExistente(base, proyectoId, credencialId);
      const cifrado = this.cifrarSecreto(maestra, proyecto, credencialId, secreto);
      base.transaction(() => {
        reemplazarSecretoCredencial(base, credencialId, cifrado);
        this.auditarCredencial(base, 'credencial.reemplazar_secreto', credencialId, proyectoId);
      })();
      return { resultado: 'reemplazado' };
    });
  }

  eliminarCredencial(
    proyectoId: string,
    credencialId: string,
  ): IpcResponse<'credenciales:eliminar'> {
    return this.boveda.conAcceso((base) => {
      this.credencialExistente(base, proyectoId, credencialId);
      base.transaction(() => {
        borrarCredencial(base, credencialId);
        this.auditarCredencial(base, 'credencial.eliminar', credencialId, proyectoId);
      })();
      return { resultado: 'eliminada' };
    });
  }

  /**
   * El único lugar donde se descifra un secreto, y ningún canal IPC llega acá. Lo usa el runner en
   * el momento del login (semana 6). Exige autorización vigente y una URL de login admitida.
   */
  async usarSecreto<T>(
    proyectoId: string,
    credencialId: string,
    uso: (secreto: Buffer) => T | Promise<T>,
  ): Promise<T> {
    const secreto = this.boveda.conAcceso((base, maestra) => {
      const proyecto = this.proyectoExistente(base, proyectoId);
      const estado = estadoDe(base, proyecto);
      if (!estado.vigente) throw new AutorizacionNoVigente(estado.motivo);
      const credencial = this.credencialExistente(base, proyectoId, credencialId);
      if (!loginValido(proyecto, credencial.urlLogin)) throw new CredencialARevisar();

      const clave = abrirClaveProyecto(maestra, proyectoId, proyecto.claveProyectoCifrada);
      try {
        return descifrarCampo(clave, contextoSecreto(proyectoId, credencialId), credencial.secreto);
      } finally {
        borrar(clave);
      }
    });
    try {
      return await uso(secreto);
    } finally {
      borrar(secreto);
    }
  }

  private cifrarSecreto(
    maestra: Buffer,
    proyecto: FilaProyecto,
    credencialId: string,
    secreto: string,
  ): Buffer {
    const clave = abrirClaveProyecto(maestra, proyecto.id, proyecto.claveProyectoCifrada);
    // Buffer.alloc: Buffer.from(string) puede usar el pool compartido, que no se puede borrar.
    const bytes = Buffer.alloc(Buffer.byteLength(secreto, 'utf8'));
    bytes.write(secreto, 'utf8');
    try {
      return cifrarCampo(clave, contextoSecreto(proyecto.id, credencialId), bytes);
    } finally {
      borrar(clave, bytes);
    }
  }

  private auditarCredencial(
    base: BaseCifrada,
    accion: 'credencial.guardar' | 'credencial.reemplazar_secreto' | 'credencial.eliminar',
    credencialId: string,
    proyectoId: string,
  ): void {
    registrarAuditoria(base, {
      accion,
      entidad: 'credencial',
      entidadId: credencialId,
      detalle: { proyectoId },
    });
  }

  private proyectoExistente(base: BaseCifrada, id: string): FilaProyecto {
    const fila = leerProyecto(base, id);
    if (!fila) throw new EntidadNoEncontrada();
    return fila;
  }

  private credencialExistente(base: BaseCifrada, proyectoId: string, id: string): FilaCredencial {
    const fila = leerCredencial(base, proyectoId, id);
    if (!fila) throw new EntidadNoEncontrada();
    return fila;
  }
}
