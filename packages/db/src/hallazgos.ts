/**
 * Hallazgos por huella, estados y regresiones (semana 8, ADR 046 y 047). La base solo guarda y consulta: la
 * huella, las transiciones y la cobertura las decide el proceso principal (`main/hallazgos/`), con funciones
 * puras.
 *
 * Nada de acá descifra: el detalle de cada ocurrencia y el motivo de un descarte llegan y salen cifrados.
 */
import { randomUUID } from 'node:crypto';
import type { TextoRedactado } from '@qatlas/redaction';
import type { BaseCifrada } from './conexion';
import type { EstadoHallazgo } from './esquema';

export type Aparicion = 'nueva' | 'recurrente' | 'regresion';

export interface EstadoGuardado {
  id: string;
  estado: EstadoHallazgo;
  estadoPrevio: EstadoHallazgo | null;
}

/** El hallazgo de esta huella en el proyecto, si existe. */
export function buscarPorHuella(
  base: BaseCifrada,
  proyectoId: string,
  huella: string,
): EstadoGuardado | null {
  const fila = base
    .prepare(
      'SELECT id, estado, estado_previo AS estadoPrevio FROM hallazgo WHERE proyecto_id = ? AND huella = ?',
    )
    .get(proyectoId, huella) as EstadoGuardado | undefined;
  return fila ?? null;
}

export interface NuevaAparicion {
  proyectoId: string;
  ejecucionId: string;
  tipo: string;
  severidad: string;
  titulo: TextoRedactado;
  url: TextoRedactado;
  clave: TextoRedactado;
  huella: string;
  alcance: TextoRedactado;
  versionNormalizacion: number;
  /** El estado después de esta aparición (`alAparecer`). */
  estado: EstadoHallazgo;
  estadoPrevio: EstadoHallazgo | null;
  aparicion: Aparicion;
  ocurrencia: {
    id: string;
    urlOrigen: TextoRedactado | null;
    detalleCifrado: Buffer | null;
    secretosRedactados: number;
    paginaVisitadaId: string | null;
  };
}

/**
 * Guarda una aparición: crea el hallazgo o actualiza el de su huella, y agrega la ocurrencia. Una
 * transacción. La severidad cambiada a mano no se pisa. Devuelve el ID del hallazgo.
 */
export function registrarAparicion(
  base: BaseCifrada,
  datos: NuevaAparicion,
  existenteId: string | null,
): string {
  const ahora = new Date().toISOString();
  const hallazgoId = existenteId ?? randomUUID();
  base.transaction(() => {
    if (existenteId) {
      base
        .prepare(
          `UPDATE hallazgo SET estado = ?, estado_previo = ?, ultima_vez_en = ?, cubierto_en = ?,
             severidad = CASE WHEN severidad_manual = 1 THEN severidad ELSE ? END, updated_at = ?
           WHERE id = ?`,
        )
        .run(datos.estado, datos.estadoPrevio, ahora, ahora, datos.severidad, ahora, existenteId);
    } else {
      base
        .prepare(
          `INSERT INTO hallazgo (id, created_at, updated_at, proyecto_id, ejecucion_id, tipo, severidad,
             titulo, descripcion, url, clave, huella, estado, estado_previo, primera_vez_en, ultima_vez_en,
             alcance, version_normalizacion, cubierto_en)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          hallazgoId,
          ahora,
          ahora,
          datos.proyectoId,
          datos.ejecucionId,
          datos.tipo,
          datos.severidad,
          datos.titulo,
          datos.titulo,
          datos.url,
          datos.clave,
          datos.huella,
          datos.estado,
          datos.estadoPrevio,
          ahora,
          ahora,
          datos.alcance,
          datos.versionNormalizacion,
          ahora,
        );
    }
    const o = datos.ocurrencia;
    base
      .prepare(
        `INSERT INTO hallazgo_ocurrencia (id, created_at, updated_at, proyecto_id, hallazgo_id, ejecucion_id,
           url, url_origen, detalle_cifrado, secretos_redactados, revision_pendiente, pagina_visitada_id,
           aparicion)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        o.id,
        ahora,
        ahora,
        datos.proyectoId,
        hallazgoId,
        datos.ejecucionId,
        datos.url,
        o.urlOrigen,
        o.detalleCifrado,
        o.secretosRedactados,
        // Con secretos redactados, la exportación pide revisarla (RN-REP-03).
        o.secretosRedactados > 0 ? 1 : 0,
        o.paginaVisitadaId,
        datos.aparicion,
      );
  })();
  return hallazgoId;
}

// --- Cobertura ---------------------------------------------------------------------------------------

export interface ContextoEjecucion {
  proyectoId: string;
  credencialId: string | null;
  rol: string | null;
  tipo: string;
  estado: string;
}

export function contextoDeEjecucion(
  base: BaseCifrada,
  ejecucionId: string,
): ContextoEjecucion | null {
  const fila = base
    .prepare(
      `SELECT proyecto_id AS proyectoId, credencial_id AS credencialId, rol, tipo, estado
       FROM ejecucion WHERE id = ?`,
    )
    .get(ejecucionId) as ContextoEjecucion | undefined;
  return fila ?? null;
}

/** Las páginas que la ejecución analizó: las que cargaron (con estado HTTP). URL sin query, redactada. */
export function paginasAnalizadas(base: BaseCifrada, ejecucionId: string): string[] {
  return (
    base
      .prepare(
        'SELECT DISTINCT url FROM pagina_visitada WHERE ejecucion_id = ? AND status_http IS NOT NULL',
      )
      .all(ejecucionId) as { url: string }[]
  ).map((f) => f.url);
}

export interface Lugar {
  /** La página donde se analizó (sin query, redactada). */
  url: string;
  credencialId: string | null;
  rol: string | null;
}

export interface CandidatoCobertura extends EstadoGuardado {
  tipo: string;
  /** Las páginas de su última ejecución con apariciones, con el contexto de esa ejecución. */
  lugares: Lugar[];
}

/**
 * Los hallazgos del proyecto en estos estados que NO aparecieron en la ejecución, con dónde aparecieron la
 * última vez. El proceso principal decide cuáles cubrió (`cubre`).
 */
export function candidatosACobertura(
  base: BaseCifrada,
  proyectoId: string,
  ejecucionId: string,
  estados: readonly EstadoHallazgo[],
): CandidatoCobertura[] {
  if (estados.length === 0) return [];
  const marcadores = estados.map(() => '?').join(', ');
  const hallazgos = base
    .prepare(
      `SELECT h.id, h.estado, h.estado_previo AS estadoPrevio, h.tipo,
         (SELECT o.ejecucion_id FROM hallazgo_ocurrencia o WHERE o.hallazgo_id = h.id
          ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1) AS ultimaEjecucion
       FROM hallazgo h
       WHERE h.proyecto_id = ? AND h.estado IN (${marcadores})
         AND NOT EXISTS (SELECT 1 FROM hallazgo_ocurrencia o2 WHERE o2.hallazgo_id = h.id AND o2.ejecucion_id = ?)`,
    )
    .all(proyectoId, ...estados, ejecucionId) as (EstadoGuardado & {
    tipo: string;
    ultimaEjecucion: string | null;
  })[];
  const lugares = base.prepare(
    `SELECT DISTINCT COALESCE(p.url, o.url) AS url, e.credencial_id AS credencialId, e.rol AS rol
     FROM hallazgo_ocurrencia o
     JOIN ejecucion e ON e.id = o.ejecucion_id
     LEFT JOIN pagina_visitada p ON p.id = o.pagina_visitada_id
     WHERE o.hallazgo_id = ? AND o.ejecucion_id = ?`,
  );
  return hallazgos.map(({ ultimaEjecucion, ...h }) => ({
    ...h,
    lugares: ultimaEjecucion ? (lugares.all(h.id, ultimaEjecucion) as Lugar[]) : [],
  }));
}

/** Aplica lo que decidió la cobertura: los que pasan a «posiblemente resuelto» y los que se cubrieron. */
export function aplicarCobertura(
  base: BaseCifrada,
  cambios: readonly EstadoGuardado[],
  cubiertos: readonly string[],
): void {
  const ahora = new Date().toISOString();
  base.transaction(() => {
    const estado = base.prepare(
      'UPDATE hallazgo SET estado = ?, estado_previo = ?, updated_at = ? WHERE id = ?',
    );
    for (const c of cambios) estado.run(c.estado, c.estadoPrevio, ahora, c.id);
    const cubierto = base.prepare('UPDATE hallazgo SET cubierto_en = ? WHERE id = ?');
    for (const id of cubiertos) cubierto.run(ahora, id);
  })();
}

// --- Bandeja ---------------------------------------------------------------------------------------------

export interface FiltrosBandeja {
  proyectoId: string | null;
  estados: readonly string[];
  severidades: readonly string[];
  tipos: readonly string[];
  soloRegresiones: boolean;
  /** Los descartados se ocultan salvo que se pidan (CU-04 3a). */
  incluirDescartados: boolean;
  /** Abiertos que la última ejecución terminada del proyecto no cubrió. */
  soloSinCobertura: boolean;
  limite: number;
}

export interface FilaBandeja {
  id: string;
  proyectoId: string;
  proyectoNombre: string;
  tipo: string;
  severidad: string;
  severidadManual: number;
  titulo: TextoRedactado;
  url: TextoRedactado;
  alcance: TextoRedactado | null;
  clave: TextoRedactado;
  estado: EstadoHallazgo;
  primeraVezEn: string;
  ultimaVezEn: string;
  cubiertoEn: string | null;
  ocurrencias: number;
  paginas: number;
  ultimaAparicion: Aparicion | null;
  sinCobertura: number;
}

const SIN_COBERTURA = `(h.estado IN ('nuevo', 'confirmado', 'reportado', 'regresion') AND
  (h.cubierto_en IS NULL OR h.cubierto_en < (SELECT MAX(e.fin) FROM ejecucion e
     WHERE e.proyecto_id = h.proyecto_id AND e.tipo = 'escaneo' AND e.estado = 'finalizada')))`;

export function listarBandeja(base: BaseCifrada, filtros: FiltrosBandeja): FilaBandeja[] {
  const condiciones: string[] = [];
  const parametros: unknown[] = [];
  const enLista = (columna: string, valores: readonly string[]) => {
    if (valores.length === 0) return;
    condiciones.push(`${columna} IN (${valores.map(() => '?').join(', ')})`);
    parametros.push(...valores);
  };
  if (filtros.proyectoId) {
    condiciones.push('h.proyecto_id = ?');
    parametros.push(filtros.proyectoId);
  }
  enLista('h.estado', filtros.estados);
  enLista('h.severidad', filtros.severidades);
  enLista('h.tipo', filtros.tipos);
  if (filtros.soloRegresiones) condiciones.push(`h.estado = 'regresion'`);
  if (!filtros.incluirDescartados && !filtros.estados.includes('descartado')) {
    condiciones.push(`h.estado <> 'descartado'`);
  }
  if (filtros.soloSinCobertura) condiciones.push(SIN_COBERTURA);
  const donde = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  return base
    .prepare(
      `SELECT h.id, h.proyecto_id AS proyectoId, pr.nombre AS proyectoNombre, h.tipo, h.severidad,
         h.severidad_manual AS severidadManual, h.titulo, h.url, h.alcance, h.clave, h.estado,
         h.primera_vez_en AS primeraVezEn, h.ultima_vez_en AS ultimaVezEn, h.cubierto_en AS cubiertoEn,
         (SELECT COUNT(*) FROM hallazgo_ocurrencia o WHERE o.hallazgo_id = h.id) AS ocurrencias,
         (SELECT COUNT(DISTINCT COALESCE(p.url, o.url)) FROM hallazgo_ocurrencia o
            LEFT JOIN pagina_visitada p ON p.id = o.pagina_visitada_id WHERE o.hallazgo_id = h.id) AS paginas,
         (SELECT o.aparicion FROM hallazgo_ocurrencia o WHERE o.hallazgo_id = h.id
            ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1) AS ultimaAparicion,
         ${SIN_COBERTURA} AS sinCobertura
       FROM hallazgo h JOIN proyecto pr ON pr.id = h.proyecto_id
       ${donde}
       ORDER BY CASE h.estado WHEN 'regresion' THEN 0 ELSE 1 END, h.ultima_vez_en DESC
       LIMIT ?`,
    )
    .all(...parametros, filtros.limite) as FilaBandeja[];
}

export interface OcurrenciaHistorial {
  id: string;
  ejecucionId: string;
  fecha: string;
  url: TextoRedactado;
  aparicion: Aparicion;
  secretosRedactados: number;
}

/** El historial de un hallazgo: sus apariciones, de la más nueva a la más vieja. */
export function historialDeHallazgo(
  base: BaseCifrada,
  hallazgoId: string,
  limite = 200,
): OcurrenciaHistorial[] {
  return base
    .prepare(
      `SELECT id, ejecucion_id AS ejecucionId, created_at AS fecha, url, aparicion,
         secretos_redactados AS secretosRedactados
       FROM hallazgo_ocurrencia WHERE hallazgo_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(hallazgoId, limite) as OcurrenciaHistorial[];
}

export interface HallazgoParaDecidir extends EstadoGuardado {
  proyectoId: string;
  severidad: string;
}

export function hallazgoParaDecidir(base: BaseCifrada, id: string): HallazgoParaDecidir | null {
  const fila = base
    .prepare(
      `SELECT id, proyecto_id AS proyectoId, estado, estado_previo AS estadoPrevio, severidad
       FROM hallazgo WHERE id = ?`,
    )
    .get(id) as HallazgoParaDecidir | undefined;
  return fila ?? null;
}

/** La decisión de una persona. El motivo de un descarte llega cifrado; al reabrir, se borra. */
export function guardarDecision(
  base: BaseCifrada,
  id: string,
  decision: {
    estado: EstadoHallazgo;
    estadoPrevio: EstadoHallazgo | null;
    motivoDescarteCifrado: Buffer | null;
  },
): void {
  const ahora = new Date().toISOString();
  base
    .prepare(
      `UPDATE hallazgo SET estado = ?, estado_previo = ?, motivo_descarte_cifrado = ?, decision_en = ?,
         updated_at = ? WHERE id = ?`,
    )
    .run(decision.estado, decision.estadoPrevio, decision.motivoDescarteCifrado, ahora, ahora, id);
}

export function guardarSeveridad(base: BaseCifrada, id: string, severidad: string): void {
  base
    .prepare(
      'UPDATE hallazgo SET severidad = ?, severidad_manual = 1, decision_en = ?, updated_at = ? WHERE id = ?',
    )
    .run(severidad, new Date().toISOString(), new Date().toISOString(), id);
}

export function motivoDescarteCifrado(base: BaseCifrada, id: string): Buffer | null {
  const fila = base
    .prepare('SELECT motivo_descarte_cifrado AS motivo FROM hallazgo WHERE id = ?')
    .get(id) as { motivo: Buffer | null } | undefined;
  return fila?.motivo ?? null;
}

// --- Ejecuciones y comparación ----------------------------------------------------------------------------

export interface FilaEjecucionDeTodos {
  id: string;
  proyectoId: string;
  proyectoNombre: string;
  tipo: string;
  estado: string;
  inicio: string | null;
  fin: string | null;
  resumen: string;
  rol: string | null;
  credencialId: string | null;
}

/** Las ejecuciones de todos los proyectos (o de uno), de la más nueva a la más vieja. */
export function listarEjecucionesDeTodos(
  base: BaseCifrada,
  proyectoId: string | null,
  limite: number,
): FilaEjecucionDeTodos[] {
  return base
    .prepare(
      `SELECT e.id, e.proyecto_id AS proyectoId, p.nombre AS proyectoNombre, e.tipo, e.estado, e.inicio,
         e.fin, e.resumen, e.rol, e.credencial_id AS credencialId
       FROM ejecucion e JOIN proyecto p ON p.id = e.proyecto_id
       WHERE (? IS NULL OR e.proyecto_id = ?)
       ORDER BY COALESCE(e.inicio, e.created_at) DESC, e.rowid DESC LIMIT ?`,
    )
    .all(proyectoId, proyectoId, limite) as FilaEjecucionDeTodos[];
}

export interface AparicionEnEjecucion {
  hallazgoId: string;
  aparicion: Aparicion;
  tipo: string;
  severidad: string;
  titulo: TextoRedactado;
  alcance: TextoRedactado | null;
  url: TextoRedactado;
  estado: EstadoHallazgo;
  /** Las páginas donde apareció en esa ejecución. */
  lugares: string[];
}

/** Los hallazgos que aparecieron en una ejecución: una fila por hallazgo, con la primera aparición. */
export function aparicionesDeEjecucion(
  base: BaseCifrada,
  ejecucionId: string,
): AparicionEnEjecucion[] {
  const filas = base
    .prepare(
      `SELECT o.hallazgo_id AS hallazgoId, o.aparicion, h.tipo, h.severidad, h.titulo, h.alcance, h.url,
         h.estado, COALESCE(p.url, o.url) AS lugar
       FROM hallazgo_ocurrencia o
       JOIN hallazgo h ON h.id = o.hallazgo_id
       LEFT JOIN pagina_visitada p ON p.id = o.pagina_visitada_id
       WHERE o.ejecucion_id = ?
       ORDER BY o.created_at, o.rowid`,
    )
    .all(ejecucionId) as (Omit<AparicionEnEjecucion, 'lugares'> & { lugar: string })[];
  const porHallazgo = new Map<string, AparicionEnEjecucion>();
  for (const { lugar, ...fila } of filas) {
    const previa = porHallazgo.get(fila.hallazgoId);
    if (previa) {
      if (!previa.lugares.includes(lugar)) previa.lugares.push(lugar);
    } else {
      porHallazgo.set(fila.hallazgoId, { ...fila, lugares: [lugar] });
    }
  }
  return [...porHallazgo.values()];
}

// --- Fusión de lo guardado antes de la semana 8 -----------------------------------------------------------

export function proyectosSinHuellas(base: BaseCifrada, version: number): { id: string }[] {
  return base.prepare('SELECT id FROM proyecto WHERE huellas_version < ?').all(version) as {
    id: string;
  }[];
}

export function marcarHuellasDelProyecto(base: BaseCifrada, id: string, version: number): void {
  base.prepare('UPDATE proyecto SET huellas_version = ? WHERE id = ?').run(version, id);
}

export interface HallazgoParaHuella {
  id: string;
  tipo: string;
  url: TextoRedactado;
  clave: TextoRedactado;
  estado: EstadoHallazgo;
  estadoPrevio: EstadoHallazgo | null;
  decisionEn: string | null;
  primeraVezEn: string;
  ultimaVezEn: string;
  /** El detalle cifrado de su primera ocurrencia: con él se recalcula la clave de un mensaje. */
  ocurrenciaId: string | null;
  detalleCifrado: Buffer | null;
}

export function hallazgosParaHuella(base: BaseCifrada, proyectoId: string): HallazgoParaHuella[] {
  return base
    .prepare(
      `SELECT h.id, h.tipo, h.url, h.clave, h.estado, h.estado_previo AS estadoPrevio,
         h.decision_en AS decisionEn, h.primera_vez_en AS primeraVezEn, h.ultima_vez_en AS ultimaVezEn,
         o.id AS ocurrenciaId, o.detalle_cifrado AS detalleCifrado
       FROM hallazgo h
       LEFT JOIN hallazgo_ocurrencia o ON o.id = (SELECT o2.id FROM hallazgo_ocurrencia o2
         WHERE o2.hallazgo_id = h.id ORDER BY o2.created_at, o2.rowid LIMIT 1)
       WHERE h.proyecto_id = ?
       ORDER BY h.primera_vez_en, h.rowid`,
    )
    .all(proyectoId) as HallazgoParaHuella[];
}

/**
 * Deja un solo hallazgo por huella: las ocurrencias de `otros` pasan a `destino`, `otros` se borran, y
 * `destino` queda con la huella, la clave recalculada, el estado elegido y las fechas de todos. Las huellas
 * de los demás se limpian antes, para no chocar con el índice único.
 */
export function fusionarEnHuella(
  base: BaseCifrada,
  destino: string,
  otros: readonly string[],
  datos: {
    huella: string;
    alcance: TextoRedactado;
    clave: TextoRedactado;
    versionNormalizacion: number;
    estado: EstadoHallazgo;
    estadoPrevio: EstadoHallazgo | null;
    decisionEn: string | null;
    primeraVezEn: string;
    ultimaVezEn: string;
  },
): void {
  const ahora = new Date().toISOString();
  if (otros.length > 0) {
    const marcadores = otros.map(() => '?').join(', ');
    base
      .prepare(
        `UPDATE hallazgo_ocurrencia SET hallazgo_id = ? WHERE hallazgo_id IN (${marcadores})`,
      )
      .run(destino, ...otros);
    base.prepare(`DELETE FROM hallazgo WHERE id IN (${marcadores})`).run(...otros);
  }
  base
    .prepare(
      `UPDATE hallazgo SET huella = ?, alcance = ?, clave = ?, version_normalizacion = ?, estado = ?,
         estado_previo = ?, decision_en = ?, primera_vez_en = ?, ultima_vez_en = ?,
         cubierto_en = COALESCE(cubierto_en, ?), updated_at = ? WHERE id = ?`,
    )
    .run(
      datos.huella,
      datos.alcance,
      datos.clave,
      datos.versionNormalizacion,
      datos.estado,
      datos.estadoPrevio,
      datos.decisionEn,
      datos.primeraVezEn,
      datos.ultimaVezEn,
      datos.ultimaVezEn,
      ahora,
      destino,
    );
}

/** Antes de recalcular un proyecto: sin huellas, para que el índice único no choque a mitad de camino. */
export function limpiarHuellasDelProyecto(base: BaseCifrada, proyectoId: string): void {
  base.prepare('UPDATE hallazgo SET huella = NULL WHERE proyecto_id = ?').run(proyectoId);
}
