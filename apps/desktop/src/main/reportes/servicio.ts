/**
 * Reportes de bug y exportación guiada (3.9, 6.5, CU-05, ADR 048). Sin `electron`: el PDF, el destino y el
 * portapapeles se inyectan, para probarlo con Vitest.
 *
 * - **Crear** desde uno o varios hallazgos del mismo proyecto: borrador precargado y los hallazgos pasan a
 *   «reportado». No desde un descartado ni un resuelto.
 * - **Guardar:** todo texto pasa por la redacción y el detector, con los secretos de las credenciales del
 *   proyecto (EVI-04). Se guarda cifrado con la clave del proyecto.
 * - **Evidencia (RN-REP-01):** una captura o el detalle redactado de una aparición. Sin captura, el reporte
 *   lo dice. Video, traza, HAR y snapshot llegan con el paquete cifrado (semana 9b).
 * - **Exportar:** con alertas sin revisar, pide confirmación explícita (RN-REP-03). El destino lo elige el
 *   proceso principal, con aviso si está sincronizado. Queda en `exportacion` y en la auditoría.
 * - **Captura anotada:** la imagen que arma la interfaz se decodifica, se vuelven a tapar los recuadros en el
 *   proceso principal (tapar destruye, aunque la interfaz fallara) y se codifica sin metadatos.
 */
import { randomUUID } from 'node:crypto';
import {
  actualizarReporte,
  evidenciasParaReporte,
  guardarDecision,
  hallazgoParaDecidir,
  insertarReporte,
  leerProyecto,
  leerReporte,
  listarReportes,
  ocurrenciasParaReporte,
  registrarAuditoria,
  registrarExportacion,
  type BaseCifrada,
  type EvidenciaParaReporte,
  type OcurrenciaParaReporte,
} from '@qatlas/db';
import { contarRedacciones } from '@qatlas/redaction';
import type { EstadoHallazgo, SeveridadHallazgo, TipoHallazgo } from '@qatlas/shared';
import type { ServicioBoveda } from '../boveda/servicio';
import { comparadorDelProyecto, REDACTOR, type Redactor } from '../ejecuciones/redaccion';
import { contextoDetalle } from '../ejecuciones/servicio';
import type { ServicioEvidencias } from '../evidencias/servicio';
import { decidir } from '../hallazgos/estados';
import type { ServicioProyectos } from '../proyectos/servicio';
import type { Destinos } from './destino';
import {
  aHtml,
  aMarkdown,
  prellenar,
  severidadMayor,
  type ContenidoReporte,
  type EvidenciaEnReporte,
  type FuentesEmbebidas,
} from './plantillas';
import { codificarPng, decodificarPng, tapar, type Recuadro } from './png';
import { escribirZip } from './zip';

export type FormatoExportacion = 'pdf' | 'markdown' | 'zip';

export const contextoReporte = (proyectoId: string, reporteId: string): string =>
  `reporte:${proyectoId}:${reporteId}`;

export interface DependenciasReportes {
  boveda: ServicioBoveda;
  proyectos: ServicioProyectos;
  evidencias: Pick<ServicioEvidencias, 'capturaPng'>;
  destinos: Destinos;
  renderizarPdf: (html: string) => Promise<Buffer>;
  fuentes: () => FuentesEmbebidas;
  redactor?: Redactor;
}

export interface EvidenciaDisponible {
  id: string;
  clase: 'captura' | 'detalle' | 'video' | 'traza' | 'har' | 'snapshot-dom';
  /** Solo captura y detalle se exportan en la 9a. El resto, con el paquete cifrado (9b). */
  exportable: boolean;
  hallazgoId: string | null;
  secretosRedactados: number;
  revisionPendiente: boolean;
  puedeTenerDatosSensibles: boolean;
}

const EXTENSION: Record<FormatoExportacion, string> = { pdf: 'pdf', markdown: 'md', zip: 'zip' };
const DESCRIPCION: Record<FormatoExportacion, string> = {
  pdf: 'PDF',
  markdown: 'Markdown',
  zip: 'ZIP sin cifrar',
};

/** Lo que cambia la persona. Todo texto, redactado antes de guardarlo. */
export interface CambiosReporte {
  severidad: SeveridadHallazgo;
  contenido: ContenidoReporte;
}

export class ServicioReportes {
  private readonly redactor: Redactor;

  constructor(private readonly d: DependenciasReportes) {
    this.redactor = d.redactor ?? REDACTOR;
  }

  crear(
    hallazgoIds: readonly string[],
  ):
    | { resultado: 'creado'; reporteId: string }
    | { resultado: 'rechazada'; motivo: 'no-existe' | 'otro-proyecto' | 'no-corresponde' } {
    return this.d.boveda.conAcceso((base, maestra) => {
      const hallazgos = hallazgoIds.map((id) => hallazgoParaDecidir(base, id));
      if (hallazgos.some((h) => h === null))
        return { resultado: 'rechazada', motivo: 'no-existe' } as const;
      const filas = hallazgos.filter((h) => h !== null);
      const proyectoId = filas[0]?.proyectoId ?? '';
      if (filas.some((h) => h.proyectoId !== proyectoId)) {
        return { resultado: 'rechazada', motivo: 'otro-proyecto' } as const;
      }
      if (filas.some((h) => !decidir(h, { accion: 'reportar' }))) {
        return { resultado: 'rechazada', motivo: 'no-corresponde' } as const;
      }
      const proyecto = leerProyecto(base, proyectoId);
      if (!proyecto) return { resultado: 'rechazada', motivo: 'no-existe' } as const;
      const detalles = this.hallazgosConDatos(
        base,
        filas.map((h) => h.id),
      );
      const ocurrencias = ocurrenciasParaReporte(
        base,
        filas.map((h) => h.id),
      );
      const textos = this.descifrarDetalles(proyectoId, ocurrencias);
      const borrador = prellenar(
        detalles,
        ocurrencias.map((o) => ({
          hallazgoId: o.hallazgoId,
          ejecucionId: o.ejecucionId,
          url: o.url,
          urlOrigen: o.urlOrigen,
          fecha: o.fecha,
          detalle: textos.get(o.id) ?? null,
        })),
      );
      const comparador = comparadorDelProyecto(base, maestra, proyecto);
      try {
        const { contenido, alertas } = this.redactarContenido(borrador, comparador);
        const reporteId = randomUUID();
        const severidad = severidadMayor(detalles.map((h) => h.severidad));
        base.transaction(() => {
          insertarReporte(base, {
            id: reporteId,
            proyectoId,
            severidad,
            contenidoCifrado: this.cifrar(proyectoId, reporteId, contenido),
            alertasDetector: alertas,
            hallazgoIds: filas.map((h) => h.id),
          });
          for (const h of filas) {
            const siguiente = decidir(h, { accion: 'reportar' });
            if (siguiente && h.estado !== 'reportado') {
              guardarDecision(base, h.id, { ...siguiente, motivoDescarteCifrado: null });
              registrarAuditoria(base, {
                accion: 'hallazgo.reportar',
                entidad: 'hallazgo',
                entidadId: h.id,
                detalle: { proyectoId, campos: ['estado'] },
              });
            }
          }
          registrarAuditoria(base, {
            accion: 'reporte.crear',
            entidad: 'reporte',
            entidadId: reporteId,
            detalle: { proyectoId, cantidad: filas.length },
          });
        })();
        return { resultado: 'creado', reporteId } as const;
      } finally {
        comparador.descartar();
      }
    });
  }

  obtener(reporteId: string) {
    return this.d.boveda.conAcceso((base) => {
      const fila = leerReporte(base, reporteId);
      if (!fila) return null;
      const contenido = this.descifrar(fila.proyectoId, reporteId, fila.contenidoCifrado);
      return {
        id: fila.id,
        proyectoId: fila.proyectoId,
        severidad: fila.severidad as SeveridadHallazgo,
        estado: fila.estado,
        contenido,
        alertasDetector: fila.alertasDetector,
        hallazgos: this.hallazgosConDatos(base, fila.hallazgoIds),
        evidencias: this.evidenciasDisponibles(base, fila.hallazgoIds),
      };
    });
  }

  listar(proyectoId: string | null) {
    return this.d.boveda.conAcceso((base) =>
      listarReportes(base, proyectoId).map((f) => ({
        id: f.id,
        proyectoId: f.proyectoId,
        proyectoNombre: f.proyectoNombre,
        titulo: this.descifrar(f.proyectoId, f.id, f.contenidoCifrado).titulo,
        severidad: f.severidad as SeveridadHallazgo,
        estado: f.estado,
        hallazgos: f.hallazgos,
        exportaciones: f.exportaciones,
        actualizadoEn: f.actualizadoEn,
      })),
    );
  }

  /** Guarda lo editado: redactado y con el detector. Devuelve lo que quedó, para que la persona lo vea. */
  guardar(reporteId: string, cambios: CambiosReporte) {
    return this.d.boveda.conAcceso((base, maestra) => {
      const fila = leerReporte(base, reporteId);
      if (!fila) return null;
      const proyecto = leerProyecto(base, fila.proyectoId);
      if (!proyecto) return null;
      const comparador = comparadorDelProyecto(base, maestra, proyecto);
      try {
        const { contenido, alertas } = this.redactarContenido(cambios.contenido, comparador);
        base.transaction(() => {
          actualizarReporte(base, reporteId, {
            severidad: cambios.severidad,
            contenidoCifrado: this.cifrar(fila.proyectoId, reporteId, contenido),
            alertasDetector: alertas,
          });
          registrarAuditoria(base, {
            accion: 'reporte.editar',
            entidad: 'reporte',
            entidadId: reporteId,
            detalle: { proyectoId: fila.proyectoId, campos: ['contenido', 'severidad'] },
          });
        })();
        return { contenido, alertasDetector: alertas };
      } finally {
        comparador.descartar();
      }
    });
  }

  /**
   * Exactamente lo que sale: el texto, los archivos (con sus nombres por ID), si está cifrado, y las alertas
   * sin revisar. El PDF lleva lo mismo que el Markdown, maquetado.
   */
  vistaPrevia(reporteId: string, formato: FormatoExportacion, evidenciaIds: readonly string[]) {
    return this.d.boveda.conAcceso((base) => {
      const preparado = this.preparar(base, reporteId, evidenciaIds);
      if (preparado.rechazo) return preparado.rechazo;
      const { fila, contenido, incluidas } = preparado;
      return {
        resultado: 'lista' as const,
        texto: aMarkdown(
          contenido,
          fila.severidad as SeveridadHallazgo,
          incluidas,
          formato === 'zip',
        ),
        archivos:
          formato === 'zip'
            ? ['reporte.md', ...incluidas.filter((e) => e.archivo).map((e) => e.archivo ?? '')]
            : [`reporte.${EXTENSION[formato]}`],
        cifrado: false as const,
        capturas: incluidas.filter((e) => e.clase === 'captura').length,
        alertasSinRevisar: this.alertasSinRevisar(base, fila, incluidas),
      };
    });
  }

  async exportar(
    reporteId: string,
    formato: FormatoExportacion,
    evidenciaIds: readonly string[],
    confirmaAlertas: boolean,
  ): Promise<
    | { resultado: 'exportado' }
    | { resultado: 'cancelado' }
    | {
        resultado: 'rechazada';
        motivo:
          | 'no-existe'
          | 'sin-evidencia'
          | 'evidencia-ajena'
          | 'requiere-confirmacion'
          | 'no-se-pudo-generar';
      }
  > {
    const preparado = this.d.boveda.conAcceso((base) => {
      const p = this.preparar(base, reporteId, evidenciaIds);
      if (p.rechazo) return p;
      return { ...p, alertas: this.alertasSinRevisar(base, p.fila, p.incluidas) };
    });
    if (preparado.rechazo) return preparado.rechazo;
    const { fila, contenido, incluidas, alertas } = preparado;
    if (alertas > 0 && !confirmaAlertas)
      return { resultado: 'rechazada', motivo: 'requiere-confirmacion' };

    let datos: Buffer;
    try {
      datos = await this.generar(
        formato,
        fila.severidad as SeveridadHallazgo,
        contenido,
        incluidas,
      );
    } catch {
      // Un PDF que no se pudo limpiar, una captura ilegible: no sale nada (fallar cerrado).
      return { resultado: 'rechazada', motivo: 'no-se-pudo-generar' };
    }
    const destino = await this.d.destinos.elegir(
      `reporte-${reporteId.slice(0, 8)}.${EXTENSION[formato]}`,
      EXTENSION[formato],
      DESCRIPCION[formato],
    );
    if (!destino) return { resultado: 'cancelado' };
    await this.d.destinos.escribir(destino.ruta, datos);
    datos.fill(0);
    this.registrar(
      fila.proyectoId,
      reporteId,
      formato,
      incluidas.map((e) => e.id),
      destino.sincronizado,
      alertas > 0,
    );
    return { resultado: 'exportado' };
  }

  /**
   * La captura anotada: la interfaz manda su imagen y los recuadros a tapar. Se verifica que la captura sea
   * del reporte y que la imagen tenga su tamaño; se vuelve a tapar acá y se codifica sin metadatos.
   */
  async exportarCaptura(
    reporteId: string,
    evidenciaId: string,
    imagen: Uint8Array,
    tapados: readonly Recuadro[],
  ): Promise<
    | { resultado: 'exportado' }
    | { resultado: 'cancelado' }
    | { resultado: 'rechazada'; motivo: 'no-existe' | 'evidencia-ajena' | 'imagen-invalida' }
  > {
    const fila = this.d.boveda.conAcceso((base) => leerReporte(base, reporteId));
    if (!fila) return { resultado: 'rechazada', motivo: 'no-existe' };
    const disponibles = this.d.boveda.conAcceso((base) =>
      this.evidenciasDisponibles(base, fila.hallazgoIds),
    );
    if (!disponibles.some((e) => e.id === evidenciaId && e.clase === 'captura')) {
      return { resultado: 'rechazada', motivo: 'evidencia-ajena' };
    }
    const original = await this.d.evidencias.capturaPng(evidenciaId);
    if (!original) return { resultado: 'rechazada', motivo: 'no-existe' };
    let salida: Buffer;
    try {
      const base = decodificarPng(original);
      const anotada = decodificarPng(imagen);
      if (anotada.ancho !== base.ancho || anotada.alto !== base.alto) {
        return { resultado: 'rechazada', motivo: 'imagen-invalida' };
      }
      salida = codificarPng(tapar(anotada, tapados));
    } catch {
      return { resultado: 'rechazada', motivo: 'imagen-invalida' };
    } finally {
      original.fill(0);
    }
    const destino = await this.d.destinos.elegir(
      `captura-${evidenciaId.slice(0, 8)}.png`,
      'png',
      'Imagen PNG',
    );
    if (!destino) return { resultado: 'cancelado' };
    await this.d.destinos.escribir(destino.ruta, salida);
    this.registrar(
      fila.proyectoId,
      reporteId,
      'captura-anotada',
      [evidenciaId],
      destino.sincronizado,
      false,
    );
    return { resultado: 'exportado' };
  }

  // --- Lo de adentro --------------------------------------------------------------------------------

  private registrar(
    proyectoId: string,
    reporteId: string,
    formato: string,
    evidencias: readonly string[],
    sincronizado: boolean,
    alertasConfirmadas: boolean,
  ): void {
    this.d.boveda.conAcceso((base) => {
      base.transaction(() => {
        registrarExportacion(base, {
          id: randomUUID(),
          proyectoId,
          reporteId,
          formato,
          nivel: 'texto-y-capturas',
          evidenciasIncluidas: evidencias,
          destinoSincronizado: sincronizado,
          alertasConfirmadas,
        });
        registrarAuditoria(base, {
          accion: 'reporte.exportar',
          entidad: 'reporte',
          entidadId: reporteId,
          detalle: { proyectoId, campos: [formato], cantidad: evidencias.length },
        });
      })();
    });
  }

  private preparar(base: BaseCifrada, reporteId: string, evidenciaIds: readonly string[]) {
    const fila = leerReporte(base, reporteId);
    if (!fila)
      return { rechazo: { resultado: 'rechazada' as const, motivo: 'no-existe' as const } };
    const disponibles = this.evidenciasDisponibles(base, fila.hallazgoIds);
    const pedidas = new Set(evidenciaIds);
    // Solo lo del reporte, y solo lo que se exporta en la 9a.
    if ([...pedidas].some((id) => !disponibles.some((e) => e.id === id && e.exportable))) {
      return { rechazo: { resultado: 'rechazada' as const, motivo: 'evidencia-ajena' as const } };
    }
    if (pedidas.size === 0)
      return { rechazo: { resultado: 'rechazada' as const, motivo: 'sin-evidencia' as const } };
    const contenido = this.descifrar(fila.proyectoId, reporteId, fila.contenidoCifrado);
    const ocurrencias = ocurrenciasParaReporte(base, fila.hallazgoIds);
    const textos = this.descifrarDetalles(
      fila.proyectoId,
      ocurrencias.filter((o) => pedidas.has(o.id)),
    );
    const incluidas: EvidenciaEnReporte[] = disponibles
      .filter((e) => pedidas.has(e.id))
      .map((e) =>
        e.clase === 'detalle'
          ? { id: e.id, clase: 'detalle', texto: textos.get(e.id) ?? '' }
          : { id: e.id, clase: 'captura', archivo: `evidencias/${e.id}.png` },
      );
    return { rechazo: null, fila, contenido, incluidas };
  }

  private async generar(
    formato: FormatoExportacion,
    severidad: SeveridadHallazgo,
    contenido: ContenidoReporte,
    incluidas: readonly EvidenciaEnReporte[],
  ): Promise<Buffer> {
    if (formato === 'markdown')
      return Buffer.from(aMarkdown(contenido, severidad, incluidas, false), 'utf8');
    const capturas = new Map<string, Buffer>();
    for (const e of incluidas) {
      if (e.clase !== 'captura') continue;
      const png = await this.d.evidencias.capturaPng(e.id);
      if (!png) throw new Error('captura ilegible');
      // Se vuelve a codificar: sin metadatos aunque el original los tuviera.
      capturas.set(e.id, codificarPng(decodificarPng(png)));
      png.fill(0);
    }
    if (formato === 'zip') {
      return escribirZip([
        {
          nombre: 'reporte.md',
          datos: Buffer.from(aMarkdown(contenido, severidad, incluidas, true), 'utf8'),
        },
        {
          nombre: 'leeme.txt',
          datos: Buffer.from(
            'Este archivo no está cifrado. Para compartir la evidencia completa y cifrada, QAtlas ofrece el paquete .qatlas-paquete.\n',
            'utf8',
          ),
        },
        ...[...capturas].map(([id, datos]) => ({ nombre: `evidencias/${id}.png`, datos })),
      ]);
    }
    const html = aHtml(
      contenido,
      severidad,
      incluidas.map((e) => {
        const png = capturas.get(e.id);
        return png ? { ...e, png } : e;
      }),
      this.d.fuentes(),
    );
    return this.d.renderizarPdf(html);
  }

  private alertasSinRevisar(
    base: BaseCifrada,
    fila: { alertasDetector: number; hallazgoIds: string[] },
    incluidas: readonly EvidenciaEnReporte[],
  ): number {
    const ids = new Set(incluidas.map((e) => e.id));
    const deEvidencias = this.evidenciasDisponibles(base, fila.hallazgoIds).filter(
      (e) => ids.has(e.id) && (e.revisionPendiente || e.secretosRedactados > 0),
    ).length;
    return fila.alertasDetector + deEvidencias;
  }

  private hallazgosConDatos(base: BaseCifrada, ids: readonly string[]) {
    const consulta = base.prepare(
      'SELECT id, tipo, severidad, titulo, url, estado FROM hallazgo WHERE id = ?',
    );
    return ids
      .map(
        (id) =>
          consulta.get(id) as
            | {
                id: string;
                tipo: TipoHallazgo;
                severidad: SeveridadHallazgo;
                titulo: string;
                url: string;
                estado: EstadoHallazgo;
              }
            | undefined,
      )
      .filter((h) => h !== undefined);
  }

  /** Captura o detalle de cada aparición (exportables); video, traza, HAR y snapshot, para la 9b. */
  private evidenciasDisponibles(
    base: BaseCifrada,
    hallazgoIds: readonly string[],
  ): EvidenciaDisponible[] {
    const ocurrencias = ocurrenciasParaReporte(base, hallazgoIds);
    const detalles: EvidenciaDisponible[] = ocurrencias
      .filter((o) => o.detalleCifrado)
      .map((o) => ({
        id: o.id,
        clase: 'detalle',
        exportable: true,
        hallazgoId: o.hallazgoId,
        secretosRedactados: o.secretosRedactados,
        revisionPendiente: o.revisionPendiente === 1,
        puedeTenerDatosSensibles: false,
      }));
    const evidencias = evidenciasParaReporte(base, ocurrencias).map(
      (e: EvidenciaParaReporte): EvidenciaDisponible => ({
        id: e.id,
        clase: e.tipo as EvidenciaDisponible['clase'],
        exportable: e.tipo === 'captura',
        hallazgoId: null,
        secretosRedactados: e.secretosRedactados,
        revisionPendiente: e.revisionPendiente === 1,
        puedeTenerDatosSensibles: e.puedeTenerDatosSensibles === 1,
      }),
    );
    return [...evidencias, ...detalles];
  }

  private redactarContenido(
    contenido: ContenidoReporte,
    comparador: ReturnType<typeof comparadorDelProyecto>,
  ): { contenido: ContenidoReporte; alertas: number } {
    let alertas = 0;
    const r = (texto: string) => {
      const resultado = this.redactor.texto(texto, { comparador });
      alertas += contarRedacciones(resultado.registros);
      return resultado.texto as string;
    };
    return {
      contenido: {
        titulo: r(contenido.titulo),
        pasos: contenido.pasos.map(r),
        esperado: r(contenido.esperado),
        obtenido: r(contenido.obtenido),
        entorno: {
          url: r(contenido.entorno.url),
          navegador: r(contenido.entorno.navegador),
          viewport: r(contenido.entorno.viewport),
          fecha: r(contenido.entorno.fecha),
          ejecucionId: r(contenido.entorno.ejecucionId),
        },
      },
      alertas,
    };
  }

  private descifrarDetalles(
    proyectoId: string,
    ocurrencias: readonly OcurrenciaParaReporte[],
  ): Map<string, string> {
    const conDetalle = ocurrencias.filter((o) => o.detalleCifrado);
    const textos = this.d.proyectos.descifrarDatos(
      proyectoId,
      conDetalle.map((o) => ({
        contexto: contextoDetalle(proyectoId, o.id),
        sellado: o.detalleCifrado as Buffer,
      })),
    );
    return new Map(conDetalle.map((o, i) => [o.id, textos[i] ?? '']));
  }

  private cifrar(proyectoId: string, reporteId: string, contenido: ContenidoReporte): Buffer {
    return this.d.proyectos.cifrarDato(
      proyectoId,
      contextoReporte(proyectoId, reporteId),
      JSON.stringify(contenido),
    );
  }

  private descifrar(proyectoId: string, reporteId: string, sellado: Buffer): ContenidoReporte {
    const [texto] = this.d.proyectos.descifrarDatos(proyectoId, [
      { contexto: contextoReporte(proyectoId, reporteId), sellado },
    ]);
    return JSON.parse(texto ?? '{}') as ContenidoReporte;
  }
}
