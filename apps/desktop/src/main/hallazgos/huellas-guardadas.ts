/**
 * La huella de lo guardado antes de la semana 8 (ADR 047). Hasta entonces cada aparición era un hallazgo, sin
 * huella. Al abrir la base (desbloquear o restaurar una copia), después de la redacción de lo guardado
 * (ADR 033), proyecto por proyecto y cada uno en una transacción:
 *
 * - Se recalcula la clave de cada mensaje con la normalización v2, descifrando el detalle de su primera
 *   aparición (ya redactado), y se calcula la huella.
 * - Los hallazgos con la misma huella se fusionan en el más antiguo: las ocurrencias pasan a él, con su
 *   historial. Si tenían estados distintos, gana la última decisión de una persona (`estadoAlFusionar`).
 * - La fusión queda en la auditoría: solo IDs y cantidades.
 *
 * Idempotente: `proyecto.huellas_version` dice hasta dónde se llegó. Si algo se corta, ese proyecto queda
 * como estaba y se rehace en el próximo desbloqueo. Sin `electron`, para probarlo con Vitest.
 */
import { abrirClaveProyecto, borrar, descifrarCampo } from '@qatlas/crypto';
import {
  fusionarEnHuella,
  hallazgosParaHuella,
  leerProyecto,
  limpiarHuellasDelProyecto,
  marcarHuellasDelProyecto,
  proyectosSinHuellas,
  registrarAuditoria,
  type BaseCifrada,
  type FilaProyecto,
  type HallazgoParaHuella,
} from '@qatlas/db';
import type { TipoHallazgo } from '@qatlas/shared';
import {
  claveDeMensaje,
  REDACTOR,
  subclaveDeHallazgos,
  subclaveDeHuellas,
  TIPOS_DE_MENSAJE,
} from '../ejecuciones/redaccion';
import { contextoDetalle } from '../ejecuciones/servicio';
import { registrar } from '../registro';
import { estadoAlFusionar } from './estados';
import { alcanceDe, huellaDe, VERSION_NORMALIZACION } from './huella';

/** Sube si cambia cómo se calcula la huella o la clave: lo guardado se recalcula al desbloquear. */
export const VERSION_HUELLAS = 1;

export interface OpcionesHuellasGuardadas {
  /** Solo para tests: se llama antes de cada proyecto, para simular un corte. */
  antesDeCadaProyecto?: (proyectoId: string) => void;
}

export function fusionarLoGuardado(
  base: BaseCifrada,
  maestra: Buffer,
  opciones: OpcionesHuellasGuardadas = {},
): { proyectos: number; fallidos: number } {
  let proyectos = 0;
  let fallidos = 0;
  for (const { id } of proyectosSinHuellas(base, VERSION_HUELLAS)) {
    const proyecto = leerProyecto(base, id);
    if (!proyecto) continue;
    try {
      base.transaction(() => {
        opciones.antesDeCadaProyecto?.(id);
        const { hallazgos, fusionados } = fusionarProyecto(base, maestra, proyecto);
        marcarHuellasDelProyecto(base, id, VERSION_HUELLAS);
        registrar('huellas.proyecto-fusionado', { proyecto: id, hallazgos, fusionados });
      })();
      proyectos++;
    } catch {
      // Queda como estaba (la transacción se revierte) y se rehace en el próximo desbloqueo.
      fallidos++;
      registrar('huellas.proyecto-fallido', { proyecto: id });
    }
  }
  return { proyectos, fallidos };
}

function fusionarProyecto(
  base: BaseCifrada,
  maestra: Buffer,
  proyecto: FilaProyecto,
): { hallazgos: number; fusionados: number } {
  const subclaveMensajes = subclaveDeHallazgos(maestra, proyecto);
  const subclaveHuellas = subclaveDeHuellas(maestra, proyecto);
  const clave = abrirClaveProyecto(maestra, proyecto.id, proyecto.claveProyectoCifrada);
  try {
    limpiarHuellasDelProyecto(base, proyecto.id);
    const grupos = new Map<
      string,
      { fila: HallazgoParaHuella; clave: string; alcance: string }[]
    >();
    for (const fila of hallazgosParaHuella(base, proyecto.id)) {
      const tipo = fila.tipo as TipoHallazgo;
      let claveNueva: string = fila.clave;
      if (TIPOS_DE_MENSAJE.has(fila.tipo) && fila.detalleCifrado && fila.ocurrenciaId) {
        const bytes = descifrarCampo(
          clave,
          contextoDetalle(proyecto.id, fila.ocurrenciaId),
          fila.detalleCifrado,
        );
        try {
          // Ya está redactado (ADR 033); pasa por la redacción de nuevo para tener el tipo.
          claveNueva = claveDeMensaje(
            subclaveMensajes,
            REDACTOR.texto(bytes.toString('utf8')).texto,
          );
        } finally {
          borrar(bytes);
        }
      }
      const huella = huellaDe(subclaveHuellas, { tipo, url: fila.url, clave: claveNueva });
      const grupo = grupos.get(huella) ?? [];
      grupo.push({ fila, clave: claveNueva, alcance: alcanceDe(tipo, fila.url) });
      grupos.set(huella, grupo);
    }

    let fusionados = 0;
    for (const [huella, grupo] of grupos) {
      const [primero, ...resto] = grupo;
      if (!primero) continue;
      const estado = estadoAlFusionar(grupo.map((g) => g.fila));
      fusionarEnHuella(
        base,
        primero.fila.id,
        resto.map((g) => g.fila.id),
        {
          huella,
          alcance: REDACTOR.texto(primero.alcance).texto,
          clave: REDACTOR.texto(primero.clave).texto,
          versionNormalizacion: VERSION_NORMALIZACION,
          estado: estado.estado,
          estadoPrevio: estado.estadoPrevio,
          decisionEn: estado.decisionEn,
          primeraVezEn:
            grupo.map((g) => g.fila.primeraVezEn).sort()[0] ?? primero.fila.primeraVezEn,
          ultimaVezEn:
            grupo
              .map((g) => g.fila.ultimaVezEn)
              .sort()
              .at(-1) ?? primero.fila.ultimaVezEn,
        },
      );
      if (resto.length > 0) {
        fusionados += resto.length;
        registrarAuditoria(base, {
          accion: 'hallazgo.fusionar',
          entidad: 'hallazgo',
          entidadId: primero.fila.id,
          detalle: { proyectoId: proyecto.id, cantidad: grupo.length },
        });
      }
    }
    return { hallazgos: grupos.size, fusionados };
  } finally {
    borrar(subclaveMensajes, subclaveHuellas, clave);
  }
}
