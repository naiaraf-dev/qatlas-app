/**
 * Reportes de bug y exportaciones (semana 9a, ADR 048). La base no descifra nada: el contenido del reporte y
 * el detalle de cada ocurrencia llegan y salen cifrados con la clave del proyecto.
 */
import type { TextoRedactado } from '@qatlas/redaction';
import type { BaseCifrada } from './conexion';

export interface NuevoReporte {
  id: string;
  proyectoId: string;
  severidad: string;
  contenidoCifrado: Buffer;
  alertasDetector: number;
  hallazgoIds: readonly string[];
}

export function insertarReporte(base: BaseCifrada, datos: NuevoReporte): void {
  const ahora = new Date().toISOString();
  base.transaction(() => {
    base
      .prepare(
        `INSERT INTO reporte_bug (id, created_at, updated_at, proyecto_id, severidad, estado, contenido_cifrado,
           alertas_detector) VALUES (?, ?, ?, ?, ?, 'borrador', ?, ?)`,
      )
      .run(
        datos.id,
        ahora,
        ahora,
        datos.proyectoId,
        datos.severidad,
        datos.contenidoCifrado,
        datos.alertasDetector,
      );
    const vinculo = base.prepare(
      `INSERT INTO reporte_hallazgo (id, created_at, updated_at, proyecto_id, reporte_id, hallazgo_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const hallazgoId of new Set(datos.hallazgoIds)) {
      vinculo.run(crypto.randomUUID(), ahora, ahora, datos.proyectoId, datos.id, hallazgoId);
    }
  })();
}

export interface FilaReporte {
  id: string;
  proyectoId: string;
  severidad: string;
  estado: 'borrador' | 'exportado';
  contenidoCifrado: Buffer;
  alertasDetector: number;
  creadoEn: string;
  actualizadoEn: string;
  hallazgoIds: string[];
}

export function leerReporte(base: BaseCifrada, id: string): FilaReporte | null {
  const fila = base
    .prepare(
      `SELECT id, proyecto_id AS proyectoId, severidad, estado, contenido_cifrado AS contenidoCifrado,
         alertas_detector AS alertasDetector, created_at AS creadoEn, updated_at AS actualizadoEn
       FROM reporte_bug WHERE id = ?`,
    )
    .get(id) as Omit<FilaReporte, 'hallazgoIds'> | undefined;
  if (!fila) return null;
  const hallazgoIds = (
    base
      .prepare('SELECT hallazgo_id AS id FROM reporte_hallazgo WHERE reporte_id = ? ORDER BY rowid')
      .all(id) as { id: string }[]
  ).map((f) => f.id);
  return { ...fila, hallazgoIds };
}

export interface FilaListaReportes {
  id: string;
  proyectoId: string;
  proyectoNombre: string;
  severidad: string;
  estado: 'borrador' | 'exportado';
  creadoEn: string;
  actualizadoEn: string;
  hallazgos: number;
  exportaciones: number;
  contenidoCifrado: Buffer;
}

export function listarReportes(
  base: BaseCifrada,
  proyectoId: string | null,
  limite = 500,
): FilaListaReportes[] {
  return base
    .prepare(
      `SELECT r.id, r.proyecto_id AS proyectoId, p.nombre AS proyectoNombre, r.severidad, r.estado,
         r.created_at AS creadoEn, r.updated_at AS actualizadoEn, r.contenido_cifrado AS contenidoCifrado,
         (SELECT COUNT(*) FROM reporte_hallazgo rh WHERE rh.reporte_id = r.id) AS hallazgos,
         (SELECT COUNT(*) FROM exportacion e WHERE e.reporte_id = r.id) AS exportaciones
       FROM reporte_bug r JOIN proyecto p ON p.id = r.proyecto_id
       WHERE (? IS NULL OR r.proyecto_id = ?)
       ORDER BY r.updated_at DESC, r.rowid DESC LIMIT ?`,
    )
    .all(proyectoId, proyectoId, limite) as FilaListaReportes[];
}

export function actualizarReporte(
  base: BaseCifrada,
  id: string,
  datos: { severidad: string; contenidoCifrado: Buffer; alertasDetector: number },
): void {
  base
    .prepare(
      'UPDATE reporte_bug SET severidad = ?, contenido_cifrado = ?, alertas_detector = ?, updated_at = ? WHERE id = ?',
    )
    .run(
      datos.severidad,
      datos.contenidoCifrado,
      datos.alertasDetector,
      new Date().toISOString(),
      id,
    );
}

export interface NuevaExportacion {
  id: string;
  proyectoId: string;
  reporteId: string;
  formato: string;
  nivel: string;
  evidenciasIncluidas: readonly string[];
  destinoSincronizado: boolean;
  alertasConfirmadas: boolean;
}

/** Registra la exportación y deja el reporte como exportado. */
export function registrarExportacion(base: BaseCifrada, datos: NuevaExportacion): void {
  const ahora = new Date().toISOString();
  base.transaction(() => {
    base
      .prepare(
        `INSERT INTO exportacion (id, created_at, updated_at, proyecto_id, reporte_id, formato, nivel,
           evidencias_incluidas, destino_sincronizado, alertas_confirmadas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        datos.id,
        ahora,
        ahora,
        datos.proyectoId,
        datos.reporteId,
        datos.formato,
        datos.nivel,
        JSON.stringify(datos.evidenciasIncluidas),
        datos.destinoSincronizado ? 1 : 0,
        datos.alertasConfirmadas ? 1 : 0,
      );
    base
      .prepare(`UPDATE reporte_bug SET estado = 'exportado', updated_at = ? WHERE id = ?`)
      .run(ahora, datos.reporteId);
  })();
}

export interface OcurrenciaParaReporte {
  id: string;
  hallazgoId: string;
  ejecucionId: string;
  url: TextoRedactado;
  urlOrigen: TextoRedactado | null;
  detalleCifrado: Buffer | null;
  secretosRedactados: number;
  revisionPendiente: number;
  paginaVisitadaId: string | null;
  fecha: string;
}

/** Las ocurrencias de estos hallazgos, de la más nueva a la más vieja, con tope por hallazgo. */
export function ocurrenciasParaReporte(
  base: BaseCifrada,
  hallazgoIds: readonly string[],
  porHallazgo = 5,
): OcurrenciaParaReporte[] {
  const consulta = base.prepare(
    `SELECT id, hallazgo_id AS hallazgoId, ejecucion_id AS ejecucionId, url, url_origen AS urlOrigen,
       detalle_cifrado AS detalleCifrado, secretos_redactados AS secretosRedactados,
       revision_pendiente AS revisionPendiente, pagina_visitada_id AS paginaVisitadaId, created_at AS fecha
     FROM hallazgo_ocurrencia WHERE hallazgo_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
  );
  return hallazgoIds.flatMap((id) => consulta.all(id, porHallazgo) as OcurrenciaParaReporte[]);
}

export interface EvidenciaParaReporte {
  id: string;
  tipo: string;
  ejecucionId: string;
  paginaVisitadaId: string | null;
  tamano: number;
  secretosRedactados: number;
  revisionPendiente: number;
  puedeTenerDatosSensibles: number;
  fecha: string;
}

/**
 * Las evidencias de las páginas donde aparecieron estas ocurrencias, y las de su ejecución que no son de una
 * página (traza, HAR).
 */
export function evidenciasParaReporte(
  base: BaseCifrada,
  ocurrencias: readonly Pick<OcurrenciaParaReporte, 'ejecucionId' | 'paginaVisitadaId'>[],
): EvidenciaParaReporte[] {
  const paginas = [
    ...new Set(ocurrencias.map((o) => o.paginaVisitadaId).filter((p): p is string => !!p)),
  ];
  const ejecuciones = [...new Set(ocurrencias.map((o) => o.ejecucionId))];
  if (paginas.length === 0 && ejecuciones.length === 0) return [];
  const marcas = (n: number) => Array.from({ length: n }, () => '?').join(', ') || "''";
  return base
    .prepare(
      `SELECT id, tipo, ejecucion_id AS ejecucionId, pagina_visitada_id AS paginaVisitadaId, tamano,
         secretos_redactados AS secretosRedactados, revision_pendiente AS revisionPendiente,
         puede_tener_datos_sensibles AS puedeTenerDatosSensibles, created_at AS fecha
       FROM evidencia
       WHERE pagina_visitada_id IN (${marcas(paginas.length)})
          OR (pagina_visitada_id IS NULL AND ejecucion_id IN (${marcas(ejecuciones.length)}))
       ORDER BY created_at, rowid`,
    )
    .all(...paginas, ...ejecuciones) as EvidenciaParaReporte[];
}

/**
 * EVI-06: las evidencias de hallazgos incluidos en reportes no se borran por antigüedad. Las de sus páginas,
 * y las de sus ejecuciones que no son de una página.
 */
export function idsDeEvidenciasEnReportes(base: BaseCifrada): Set<string> {
  const filas = base
    .prepare(
      `SELECT e.id FROM evidencia e
       WHERE e.pagina_visitada_id IN (
           SELECT o.pagina_visitada_id FROM hallazgo_ocurrencia o
           JOIN reporte_hallazgo rh ON rh.hallazgo_id = o.hallazgo_id WHERE o.pagina_visitada_id IS NOT NULL)
          OR (e.pagina_visitada_id IS NULL AND e.ejecucion_id IN (
           SELECT o.ejecucion_id FROM hallazgo_ocurrencia o JOIN reporte_hallazgo rh ON rh.hallazgo_id = o.hallazgo_id))`,
    )
    .all() as { id: string }[];
  return new Set(filas.map((f) => f.id));
}
