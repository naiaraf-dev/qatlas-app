/**
 * La bandeja de hallazgos, las decisiones de la persona y la comparación de ejecuciones (especificación 6.4 y
 * 6.5, CU-04 y CU-09, ADR 047). Sin `electron`: se prueba con Vitest.
 *
 * - **Decisiones:** confirmar, descartar (con motivo), resolver, reabrir un descartado y cambiar la
 *   severidad. El motivo es texto de la persona: se guarda cifrado con la clave del proyecto. Cada decisión
 *   queda en la auditoría, solo con IDs y nombres de campos (ADR 015).
 * - **Resolver en lote:** solo los que están en «posiblemente resuelto».
 * - **Comparar:** dos ejecuciones terminadas del mismo proyecto, en orden. Lo que dejó de aparecer es
 *   «resuelto» solo si la posterior lo cubrió; si no, «no cubierto».
 */
import { createHash } from 'node:crypto';
import {
  aparicionesDeEjecucion,
  contextoDeEjecucion,
  guardarDecision,
  guardarSeveridad,
  hallazgoParaDecidir,
  historialDeHallazgo,
  leerEjecucion,
  listarBandeja,
  listarEjecucionesDeTodos,
  motivoDescarteCifrado,
  paginasAnalizadas,
  registrarAuditoria,
  type AparicionEnEjecucion,
  type BaseCifrada,
} from '@qatlas/db';
import type {
  IpcRequest,
  IpcResponse,
  ResumenEjecucion,
  SeveridadHallazgo,
  TipoHallazgo,
} from '@qatlas/shared';
import type { ServicioBoveda } from '../boveda/servicio';
import { RESUMEN_VACIO } from '../ejecuciones/servicio';
import type { ServicioProyectos } from '../proyectos/servicio';
import { cubre } from './cobertura';
import { decidir, type AccionDePersona } from './estados';

const LIMITE_BANDEJA = 1000;
const LIMITE_EJECUCIONES = 500;

/** El contexto del cifrado del motivo de un descarte: atado al proyecto y al hallazgo. */
export const contextoMotivo = (proyectoId: string, hallazgoId: string): string =>
  `hallazgo-motivo:${proyectoId}:${hallazgoId}`;

/** Agrupa «el mismo problema en varias páginas»: el mismo tipo y la misma clave, en cualquier forma. */
const grupoDe = (tipo: string, clave: string): string =>
  createHash('sha256').update(`${tipo}\0${clave}`).digest('hex').slice(0, 16);

const AUDITORIA: Record<
  AccionDePersona['accion'],
  'hallazgo.confirmar' | 'hallazgo.descartar' | 'hallazgo.resolver' | 'hallazgo.reabrir'
> = {
  confirmar: 'hallazgo.confirmar',
  descartar: 'hallazgo.descartar',
  resolver: 'hallazgo.resolver',
  reabrir: 'hallazgo.reabrir',
};

export class ServicioHallazgos {
  constructor(
    private readonly boveda: ServicioBoveda,
    private readonly proyectos: ServicioProyectos,
  ) {}

  listar(filtros: IpcRequest<'hallazgos:listar'>): IpcResponse<'hallazgos:listar'> {
    return this.boveda.conAcceso((base) =>
      listarBandeja(base, { ...filtros, limite: LIMITE_BANDEJA }).map((f) => ({
        id: f.id,
        proyectoId: f.proyectoId,
        proyectoNombre: f.proyectoNombre,
        tipo: f.tipo as TipoHallazgo,
        severidad: f.severidad as SeveridadHallazgo,
        severidadManual: f.severidadManual === 1,
        titulo: f.titulo,
        url: f.url,
        alcance: f.alcance ?? f.url,
        grupo: grupoDe(f.tipo, f.clave),
        estado: f.estado,
        primeraVezEn: f.primeraVezEn,
        ultimaVezEn: f.ultimaVezEn,
        cubiertoEn: f.cubiertoEn,
        ocurrencias: f.ocurrencias,
        paginas: f.paginas,
        ultimaAparicion: f.ultimaAparicion,
        sinCobertura: f.sinCobertura === 1,
      })),
    );
  }

  /** El historial y, si está descartado, el motivo, descifrado solo para mostrarlo. */
  detalle(hallazgoId: string): IpcResponse<'hallazgos:detalle'> {
    return this.boveda.conAcceso((base) => {
      const hallazgo = hallazgoParaDecidir(base, hallazgoId);
      if (!hallazgo) return null;
      const cifrado =
        hallazgo.estado === 'descartado' ? motivoDescarteCifrado(base, hallazgoId) : null;
      return {
        historial: historialDeHallazgo(base, hallazgoId).map((o) => ({
          ejecucionId: o.ejecucionId,
          fecha: o.fecha,
          url: o.url,
          aparicion: o.aparicion,
          secretosRedactados: o.secretosRedactados,
        })),
        motivoDescarte: cifrado
          ? (this.proyectos.descifrarDatos(hallazgo.proyectoId, [
              { contexto: contextoMotivo(hallazgo.proyectoId, hallazgoId), sellado: cifrado },
            ])[0] ?? null)
          : null,
      };
    });
  }

  decidir(solicitud: IpcRequest<'hallazgos:decidir'>): IpcResponse<'hallazgos:decidir'> {
    return this.boveda.conAcceso((base) => {
      const hallazgo = hallazgoParaDecidir(base, solicitud.hallazgoId);
      if (!hallazgo) return { resultado: 'rechazada', motivo: 'no-existe' } as const;
      const siguiente = decidir(hallazgo, { accion: solicitud.accion });
      if (!siguiente) return { resultado: 'rechazada', motivo: 'no-corresponde' } as const;
      const motivo =
        solicitud.accion === 'descartar'
          ? this.proyectos.cifrarDato(
              hallazgo.proyectoId,
              contextoMotivo(hallazgo.proyectoId, hallazgo.id),
              solicitud.motivo,
            )
          : null;
      base.transaction(() => {
        guardarDecision(base, hallazgo.id, { ...siguiente, motivoDescarteCifrado: motivo });
        registrarAuditoria(base, {
          accion: AUDITORIA[solicitud.accion],
          entidad: 'hallazgo',
          entidadId: hallazgo.id,
          detalle: {
            proyectoId: hallazgo.proyectoId,
            campos: solicitud.accion === 'descartar' ? ['estado', 'motivo'] : ['estado'],
          },
        });
      })();
      return { resultado: 'hecho', estado: siguiente.estado } as const;
    });
  }

  cambiarSeveridad(
    solicitud: IpcRequest<'hallazgos:cambiarSeveridad'>,
  ): IpcResponse<'hallazgos:cambiarSeveridad'> {
    return this.boveda.conAcceso((base) => {
      const hallazgo = hallazgoParaDecidir(base, solicitud.hallazgoId);
      if (!hallazgo) return { resultado: 'no-existe' } as const;
      base.transaction(() => {
        guardarSeveridad(base, hallazgo.id, solicitud.severidad);
        registrarAuditoria(base, {
          accion: 'hallazgo.severidad',
          entidad: 'hallazgo',
          entidadId: hallazgo.id,
          detalle: { proyectoId: hallazgo.proyectoId, campos: ['severidad'] },
        });
      })();
      return { resultado: 'hecho' } as const;
    });
  }

  /** Confirma como resueltos los que están en «posiblemente resuelto». Los demás se rechazan. */
  resolverEnLote(hallazgoIds: readonly string[]): IpcResponse<'hallazgos:resolverEnLote'> {
    return this.boveda.conAcceso((base) => {
      let resueltos = 0;
      let rechazados = 0;
      base.transaction(() => {
        for (const id of new Set(hallazgoIds)) {
          const hallazgo = hallazgoParaDecidir(base, id);
          if (!hallazgo || hallazgo.estado !== 'posiblemente_resuelto') {
            rechazados++;
            continue;
          }
          guardarDecision(base, id, {
            estado: 'resuelto',
            estadoPrevio: null,
            motivoDescarteCifrado: null,
          });
          registrarAuditoria(base, {
            accion: 'hallazgo.resolver-lote',
            entidad: 'hallazgo',
            entidadId: id,
            detalle: { proyectoId: hallazgo.proyectoId, campos: ['estado'] },
          });
          resueltos++;
        }
      })();
      return { resueltos, rechazados };
    });
  }

  listarEjecuciones(proyectoId: string | null): IpcResponse<'ejecuciones:listarTodas'> {
    return this.boveda.conAcceso((base) =>
      listarEjecucionesDeTodos(base, proyectoId, LIMITE_EJECUCIONES).map((f) => ({
        id: f.id,
        proyectoId: f.proyectoId,
        proyectoNombre: f.proyectoNombre,
        tipo: f.tipo as 'escaneo' | 'prueba-login',
        estado: f.estado as IpcResponse<'ejecuciones:listarTodas'>[number]['estado'],
        inicio: f.inicio,
        fin: f.fin,
        resumen: { ...RESUMEN_VACIO, ...(JSON.parse(f.resumen) as Partial<ResumenEjecucion>) },
        rol: f.rol,
      })),
    );
  }

  comparar(anteriorId: string, posteriorId: string): IpcResponse<'ejecuciones:comparar'> {
    if (anteriorId === posteriorId) return { resultado: 'rechazada', motivo: 'misma' };
    return this.boveda.conAcceso((base) => {
      const a = leerEjecucion(base, anteriorId);
      const b = leerEjecucion(base, posteriorId);
      if (!a || !b) return { resultado: 'rechazada', motivo: 'no-existe' } as const;
      if (a.proyectoId !== b.proyectoId)
        return { resultado: 'rechazada', motivo: 'otro-proyecto' } as const;
      if (a.estado !== 'finalizada' || b.estado !== 'finalizada') {
        return { resultado: 'rechazada', motivo: 'no-terminada' } as const;
      }
      // En orden: la anterior es la que empezó antes, la pidan como la pidan.
      const [antes, despues] = (a.inicio ?? '') <= (b.inicio ?? '') ? [a, b] : [b, a];
      return {
        resultado: 'comparada',
        anteriorId: antes.id,
        posteriorId: despues.id,
        ...this.diferencias(base, antes.id, despues.id),
      } as const;
    });
  }

  private diferencias(base: BaseCifrada, anteriorId: string, posteriorId: string) {
    const enAntes = aparicionesDeEjecucion(base, anteriorId);
    const enDespues = aparicionesDeEjecucion(base, posteriorId);
    const idsAntes = new Set(enAntes.map((h) => h.hallazgoId));
    const idsDespues = new Set(enDespues.map((h) => h.hallazgoId));
    const contextoAntes = contextoDeEjecucion(base, anteriorId);
    const contextoDespues = contextoDeEjecucion(base, posteriorId);
    const paginas = paginasAnalizadas(base, posteriorId);
    const vista = (h: AparicionEnEjecucion) => ({
      hallazgoId: h.hallazgoId,
      tipo: h.tipo as TipoHallazgo,
      severidad: h.severidad as SeveridadHallazgo,
      titulo: h.titulo,
      alcance: h.alcance ?? h.url,
      estado: h.estado,
    });
    const regresiones = enDespues.filter((h) => h.aparicion === 'regresion');
    const sinRegresion = enDespues.filter((h) => h.aparicion !== 'regresion');
    const dejaron = enAntes.filter((h) => !idsDespues.has(h.hallazgoId));
    const cubierto = (h: AparicionEnEjecucion) =>
      contextoAntes !== null &&
      contextoDespues !== null &&
      cubre(
        contextoDespues,
        paginas,
        h.lugares.map((url) => ({
          url,
          credencialId: contextoAntes.credencialId,
          rol: contextoAntes.rol,
        })),
      );
    return {
      nuevos: sinRegresion.filter((h) => !idsAntes.has(h.hallazgoId)).map(vista),
      recurrentes: sinRegresion.filter((h) => idsAntes.has(h.hallazgoId)).map(vista),
      regresiones: regresiones.map(vista),
      resueltos: dejaron.filter(cubierto).map(vista),
      noCubiertos: dejaron.filter((h) => !cubierto(h)).map(vista),
    };
  }
}
