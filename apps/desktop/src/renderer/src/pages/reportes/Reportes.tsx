import { useEffect, useId, useState } from 'react';
import type {
  ContenidoReporte,
  FormatoExportacion,
  IpcResponse,
  ProyectoResumen,
  ReporteVista,
  SeveridadHallazgo,
} from '@qatlas/shared';
import { Button, Card, PageHeader, SeverityBadge } from '../../ui/components';
import { Casilla, Selector } from '../../ui/controles';
import { aLineas, Aviso, Campo, CLASE_ENTRADA, deLineas } from '../proyectos/comunes';
import {
  fecha,
  NOMBRE_ESTADO,
  NOMBRE_SEVERIDAD,
  NOMBRE_TIPO,
  ORDEN_SEVERIDAD,
} from '../hallazgos/textos';
import { Anotador } from './Anotador';

/**
 * Reportes de bug y exportación guiada (3.9, 6.5, CU-05, ADR 048). La interfaz nunca ve ni elige una ruta:
 * el destino lo pide el proceso principal. Todo lo que se guarda vuelve redactado, para que la persona vea
 * qué se tapó.
 */

type Fila = IpcResponse<'reportes:listar'>[number];
type Evidencia = ReporteVista['evidencias'][number];
type Vista = Extract<IpcResponse<'reportes:vistaPrevia'>, { resultado: 'lista' }>;

const FORMATOS: readonly { valor: FormatoExportacion; texto: string }[] = [
  { valor: 'pdf', texto: 'PDF' },
  { valor: 'markdown', texto: 'Markdown (solo texto)' },
  { valor: 'zip', texto: 'ZIP sin cifrar (Markdown con las capturas)' },
];

const RECHAZOS: Record<string, string> = {
  'no-existe': 'El reporte ya no existe.',
  'sin-evidencia':
    'Elegí al menos una evidencia: una captura o el detalle de una aparición (RN-REP-01).',
  'evidencia-ajena': 'Una evidencia elegida no es de este reporte.',
  'requiere-confirmacion': 'Hay alertas sin revisar: confirmá que las revisaste.',
  'no-se-pudo-generar':
    'No se pudo generar el archivo de forma segura, así que no se exportó nada.',
};

const NOMBRE_ESTADO_REPORTE = { borrador: 'Borrador', exportado: 'Exportado' } as const;

function nombreEvidencia(e: Evidencia, hallazgos: ReporteVista['hallazgos']): string {
  const corto = e.id.slice(0, 8);
  if (e.clase === 'detalle') {
    const titulo = hallazgos.find((h) => h.id === e.hallazgoId)?.titulo ?? 'un hallazgo';
    return `Detalle de la aparición de «${titulo}» (${corto})`;
  }
  const nombres: Record<Evidencia['clase'], string> = {
    captura: 'Captura',
    detalle: 'Detalle',
    video: 'Video',
    traza: 'Traza',
    har: 'HAR',
    'snapshot-dom': 'Snapshot del DOM',
  };
  return `${nombres[e.clase]} (${corto})`;
}

export function Reportes({ inicial }: { inicial: string | null }) {
  const [abierto, setAbierto] = useState<string | null>(inicial);
  if (abierto) {
    return (
      <Editor
        reporteId={abierto}
        alVolver={() => {
          setAbierto(null);
        }}
      />
    );
  }
  return <Lista alAbrir={setAbierto} />;
}

function Lista({ alAbrir }: { alAbrir: (id: string) => void }) {
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [proyectoId, setProyectoId] = useState<string | null>(null);
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void window.qatlas.proyectos.listar().then((res) => {
      if (res.ok) setProyectos(res.data);
    });
  }, []);

  useEffect(() => {
    void window.qatlas.reportes.listar({ proyectoId }).then((res) => {
      if (res.ok) {
        setFilas(res.data);
        setError(false);
      } else {
        setError(true);
      }
    });
  }, [proyectoId]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reportes"
        description="Reportes de bug armados desde los hallazgos. Se guardan cifrados; al exportarlos, revisás exactamente qué sale antes de elegir dónde."
      />
      <Card title="Reporte de ejecución">
        <div className="flex flex-col gap-2">
          <p className="text-[13.5px] text-text-2">
            El resumen de una ejecución, con sus gráficos, en PDF o HTML.
          </p>
          <div>
            <Button disabled>Crear un reporte de ejecución</Button>
          </div>
          <p className="text-[13px] text-muted">Llega en: semana 9b.</p>
        </div>
      </Card>
      <Card title="Reportes de bug">
        <div className="flex flex-col gap-4">
          <p className="text-[13.5px] text-text-2">
            Se crean desde la página Hallazgos, con uno o varios hallazgos del mismo proyecto.
          </p>
          <div className="max-w-sm">
            <Selector
              etiqueta="Proyecto"
              valor={proyectoId ?? 'todos'}
              opciones={[
                { valor: 'todos', texto: 'Todos los proyectos' },
                ...proyectos.map((p) => ({ valor: p.id, texto: p.nombre })),
              ]}
              alCambiar={(valor) => {
                setProyectoId(valor === 'todos' ? null : valor);
              }}
            />
          </div>
          {error && <Aviso tipo="peligro">No se pudieron leer los reportes.</Aviso>}
          {filas !== null && filas.length === 0 && (
            <p className="text-muted">Todavía no hay reportes.</p>
          )}
          <ul aria-label="Reportes de bug" className="flex flex-col gap-3">
            {(filas ?? []).map((f) => (
              <li
                key={f.id}
                className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-semibold">{f.titulo}</span>
                    <SeverityBadge severity={f.severidad} />
                    <span className="text-[13px] font-semibold text-text-2">
                      {NOMBRE_ESTADO_REPORTE[f.estado]}
                    </span>
                  </div>
                  <p className="text-[13.5px] text-muted">
                    {f.proyectoNombre} ·{' '}
                    {f.hallazgos === 1 ? '1 hallazgo' : `${String(f.hallazgos)} hallazgos`} ·{' '}
                    {f.exportaciones === 1
                      ? 'exportado 1 vez'
                      : `exportado ${String(f.exportaciones)} veces`}{' '}
                    · Actualizado: {fecha(f.actualizadoEn)}
                  </p>
                </div>
                <Button
                  aria-label={`Abrir «${f.titulo}»`}
                  onClick={() => {
                    alAbrir(f.id);
                  }}
                >
                  Abrir
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function Editor({ reporteId, alVolver }: { reporteId: string; alVolver: () => void }) {
  const [reporte, setReporte] = useState<ReporteVista | null>(null);
  const [fallo, setFallo] = useState(false);
  const [contenido, setContenido] = useState<ContenidoReporte | null>(null);
  const [severidad, setSeveridad] = useState<SeveridadHallazgo>('media');
  const [sucio, setSucio] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [alertasGuardadas, setAlertasGuardadas] = useState(0);
  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    void window.qatlas.reportes.obtener({ reporteId }).then((res) => {
      if (res.ok && res.data) {
        setReporte(res.data);
        setContenido(res.data.contenido);
        setSeveridad(res.data.severidad);
        setAlertasGuardadas(res.data.alertasDetector);
        setSucio(false);
      } else {
        setFallo(true);
      }
    });
  }, [reporteId, recarga]);

  const cambiar = (cambio: (c: ContenidoReporte) => ContenidoReporte) => {
    setContenido((c) => (c ? cambio(c) : c));
    setSucio(true);
  };

  const guardar = async () => {
    if (!contenido) return;
    const res = await window.qatlas.reportes.guardar({ reporteId, severidad, contenido });
    if (res.ok && res.data) {
      setContenido(res.data.contenido);
      setAlertasGuardadas(res.data.alertasDetector);
      setSucio(false);
      setMensaje(
        res.data.alertasDetector > 0
          ? `Se guardó. El detector tapó ${String(res.data.alertasDetector)} posibles secretos: revisá el texto.`
          : 'Se guardó.',
      );
    } else {
      setMensaje('No se pudo guardar el reporte.');
    }
  };

  if (fallo) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso tipo="peligro">No se pudo abrir el reporte.</Aviso>
        <div>
          <Button onClick={alVolver}>Volver a los reportes</Button>
        </div>
      </div>
    );
  }
  if (!reporte || !contenido) return <p className="text-muted">Cargando…</p>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reporte de bug"
        description="Editá el borrador. Al guardar, el texto pasa por la redacción: un secreto que escribas o pegues se tapa."
      />
      <div>
        <Button onClick={alVolver}>Volver a los reportes</Button>
      </div>
      <p role="status" className="sr-only">
        {mensaje}
      </p>
      {mensaje && <p className="text-[13.5px] text-text-2">{mensaje}</p>}
      {alertasGuardadas > 0 && (
        <Aviso>
          El detector encontró {alertasGuardadas} posibles secretos en el texto y los tapó. Antes de
          exportar, revisá que el reporte siga siendo claro.
        </Aviso>
      )}

      <Card title="Contenido">
        <div className="flex flex-col gap-4">
          <Campo etiqueta="Título">
            {(props) => (
              <input
                {...props}
                className={CLASE_ENTRADA}
                maxLength={300}
                value={contenido.titulo}
                onChange={(e) => {
                  const titulo = e.target.value;
                  cambiar((c) => ({ ...c, titulo }));
                }}
              />
            )}
          </Campo>
          <div className="max-w-xs">
            <Selector<SeveridadHallazgo>
              etiqueta="Severidad"
              valor={severidad}
              opciones={ORDEN_SEVERIDAD.map((s) => ({ valor: s, texto: NOMBRE_SEVERIDAD[s] }))}
              alCambiar={(s) => {
                setSeveridad(s);
                setSucio(true);
              }}
            />
          </div>
          <Campo etiqueta="Pasos para reproducir" ayuda="Un paso por línea.">
            {(props) => (
              <textarea
                {...props}
                className={CLASE_ENTRADA}
                rows={5}
                value={aLineas(contenido.pasos)}
                onChange={(e) => {
                  const pasos = deLineas(e.target.value).slice(0, 50);
                  cambiar((c) => ({ ...c, pasos }));
                }}
              />
            )}
          </Campo>
          <Campo etiqueta="Resultado esperado">
            {(props) => (
              <textarea
                {...props}
                className={CLASE_ENTRADA}
                rows={3}
                maxLength={10_000}
                value={contenido.esperado}
                onChange={(e) => {
                  const esperado = e.target.value;
                  cambiar((c) => ({ ...c, esperado }));
                }}
              />
            )}
          </Campo>
          <Campo etiqueta="Resultado obtenido">
            {(props) => (
              <textarea
                {...props}
                className={CLASE_ENTRADA}
                rows={4}
                maxLength={10_000}
                value={contenido.obtenido}
                onChange={(e) => {
                  const obtenido = e.target.value;
                  cambiar((c) => ({ ...c, obtenido }));
                }}
              />
            )}
          </Campo>
          <dl className="grid gap-x-4 gap-y-1 text-[13.5px] sm:grid-cols-[max-content_1fr]">
            <dt className="font-medium">Entorno</dt>
            <dd className="text-text-2">{contenido.entorno.url}</dd>
            <dt className="font-medium">Navegador</dt>
            <dd className="text-text-2">{contenido.entorno.navegador}</dd>
            <dt className="font-medium">Ventana</dt>
            <dd className="text-text-2">{contenido.entorno.viewport}</dd>
            <dt className="font-medium">Fecha</dt>
            <dd className="text-text-2">{contenido.entorno.fecha}</dd>
            <dt className="font-medium">Ejecución</dt>
            <dd className="text-text-2">{contenido.entorno.ejecucionId}</dd>
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" disabled={!sucio} onClick={() => void guardar()}>
              Guardar
            </Button>
            {sucio && <p className="text-[13px] text-muted">Hay cambios sin guardar.</p>}
          </div>
        </div>
      </Card>

      <Card title="Hallazgos del reporte">
        <ul aria-label="Hallazgos del reporte" className="flex flex-col gap-2 text-[13.5px]">
          {reporte.hallazgos.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-2.5">
              <span className="font-medium">{h.titulo}</span>
              <SeverityBadge severity={h.severidad} />
              <span className="text-text-2">
                {NOMBRE_TIPO[h.tipo]} · Estado: {NOMBRE_ESTADO[h.estado]}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Exportacion
        reporte={reporte}
        sucio={sucio}
        alExportar={() => {
          setRecarga((n) => n + 1);
        }}
      />
    </div>
  );
}

function Exportacion({
  reporte,
  sucio,
  alExportar,
}: {
  reporte: ReporteVista;
  sucio: boolean;
  alExportar: () => void;
}) {
  const exportables = reporte.evidencias.filter((e) => e.exportable);
  const [formato, setFormato] = useState<FormatoExportacion>('pdf');
  // Por defecto, todo lo que se puede exportar (captura y detalle). Video, traza, HAR y snapshot nunca.
  const [elegidas, setElegidas] = useState<ReadonlySet<string>>(
    () => new Set(exportables.map((e) => e.id)),
  );
  const [vista, setVista] = useState<Vista | null>(null);
  const [revisadas, setRevisadas] = useState(false);
  const [resultado, setResultado] = useState('');
  const [anotando, setAnotando] = useState<string | null>(null);
  const idVista = useId();

  const invalidar = () => {
    setVista(null);
    setRevisadas(false);
  };

  const pedirVista = async () => {
    const res = await window.qatlas.reportes.vistaPrevia({
      reporteId: reporte.id,
      formato,
      evidenciaIds: [...elegidas],
    });
    if (res.ok && res.data.resultado === 'lista') {
      setVista(res.data);
      setResultado('');
    } else {
      setVista(null);
      setResultado(
        res.ok && res.data.resultado === 'rechazada'
          ? (RECHAZOS[res.data.motivo] ?? '')
          : 'No se pudo armar la vista previa.',
      );
    }
  };

  const exportar = async () => {
    const res = await window.qatlas.reportes.exportar({
      reporteId: reporte.id,
      formato,
      evidenciaIds: [...elegidas],
      confirmaAlertas: revisadas,
    });
    if (!res.ok) {
      setResultado('No se pudo exportar.');
    } else if (res.data.resultado === 'exportado') {
      setResultado('Se exportó el reporte. Quedó registrado en la auditoría.');
      alExportar();
    } else if (res.data.resultado === 'cancelado') {
      setResultado('Se canceló: no se guardó ningún archivo.');
    } else {
      setResultado(RECHAZOS[res.data.motivo] ?? 'No se pudo exportar.');
    }
  };

  const copiar = async () => {
    if (!vista) return;
    const res = await window.qatlas.portapapeles.copiar({ texto: vista.texto, sensible: false });
    setResultado(
      !res.ok
        ? 'No se pudo copiar.'
        : res.data.limpiaEnMs !== null
          ? 'Se copió el texto. Como tenía posibles secretos, se borra del portapapeles en 30 segundos.'
          : 'Se copió el texto.',
    );
  };

  const capturaAnotada = reporte.evidencias.find((e) => e.id === anotando);

  return (
    <Card title="Exportar">
      <div className="flex flex-col gap-5">
        {sucio && <Aviso>Guardá los cambios antes de exportar: se exporta lo guardado.</Aviso>}

        <div className="flex flex-col gap-3">
          <div className="max-w-md">
            <Selector<FormatoExportacion>
              etiqueta="Formato"
              valor={formato}
              opciones={FORMATOS}
              alCambiar={(f) => {
                setFormato(f);
                invalidar();
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <div>
              <Button disabled>Paquete cifrado (.qatlas-paquete)</Button>
            </div>
            <p className="text-[13px] text-muted">
              Con contraseña y toda la evidencia, incluidos video y traza. Llega en: semana 9b.
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-2.5">
          <legend className="mb-1 font-medium">Evidencias que salen</legend>
          {reporte.evidencias.length === 0 && (
            <p className="text-[13.5px] text-muted">Este reporte no tiene evidencias.</p>
          )}
          {!reporte.evidencias.some((e) => e.clase === 'captura') && (
            <p className="text-[13.5px] text-muted">
              Sin capturas: la evidencia es el detalle de cada aparición, y el reporte lo dice.
            </p>
          )}
          {reporte.evidencias.map((e) => (
            <div key={e.id} className="flex flex-col gap-1">
              <Casilla
                etiqueta={nombreEvidencia(e, reporte.hallazgos)}
                deshabilitada={!e.exportable || sucio}
                marcada={e.exportable && elegidas.has(e.id)}
                ayuda={[
                  !e.exportable && 'Solo en el paquete cifrado. Llega en: semana 9b.',
                  e.secretosRedactados > 0 &&
                    `Se redactaron ${String(e.secretosRedactados)} secretos.`,
                  e.revisionPendiente && 'Revisión pendiente.',
                  e.puedeTenerDatosSensibles && 'Puede contener datos sensibles.',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onChange={(marcada) => {
                  setElegidas((previas) => {
                    const nuevas = new Set(previas);
                    if (marcada) nuevas.add(e.id);
                    else nuevas.delete(e.id);
                    return nuevas;
                  });
                  invalidar();
                }}
              />
              {e.clase === 'captura' && (
                <div className="pl-8">
                  <Button
                    disabled={sucio}
                    onClick={() => {
                      setAnotando(anotando === e.id ? null : e.id);
                    }}
                  >
                    {anotando === e.id ? 'Cerrar el anotador' : 'Anotar y exportar esta captura…'}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </fieldset>

        {capturaAnotada && (
          <Anotador
            reporteId={reporte.id}
            evidenciaId={capturaAnotada.id}
            alTerminar={(texto) => {
              setResultado(texto);
              alExportar();
            }}
          />
        )}

        <div>
          <Button disabled={sucio} onClick={() => void pedirVista()}>
            Ver exactamente qué sale
          </Button>
        </div>

        {vista && (
          <section aria-label="Vista previa" className="flex flex-col gap-3">
            <Aviso tipo={formato === 'zip' ? 'peligro' : 'alerta'}>
              <p className="font-semibold">Este archivo no está cifrado.</p>
              <p>
                Cualquiera que lo tenga lo puede leer.
                {formato === 'zip' &&
                  ' Para compartir la evidencia cifrada, usá el paquete cifrado (.qatlas-paquete). Llega en: semana 9b.'}
              </p>
            </Aviso>
            <p className="text-[13.5px] text-text-2">
              Archivos: {vista.archivos.join(', ')} · Capturas: {vista.capturas}
            </p>
            <label htmlFor={idVista} className="font-medium">
              Texto del reporte, tal como sale
            </label>
            <textarea
              id={idVista}
              readOnly
              className={`${CLASE_ENTRADA} font-mono text-[13px]`}
              rows={14}
              value={vista.texto}
            />
            {vista.alertasSinRevisar > 0 && (
              <div className="flex flex-col gap-2">
                <Aviso>
                  Hay {vista.alertasSinRevisar} alertas sin revisar: secretos redactados o
                  evidencias con revisión pendiente. Lo redactado sale tapado, pero revisalo antes
                  de compartir.
                </Aviso>
                <Casilla
                  etiqueta="Revisé las redacciones y las alertas, y quiero exportar igual"
                  marcada={revisadas}
                  onChange={setRevisadas}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                disabled={vista.alertasSinRevisar > 0 && !revisadas}
                onClick={() => void exportar()}
              >
                Exportar…
              </Button>
              <Button onClick={() => void copiar()}>Copiar el texto</Button>
            </div>
            <p className="text-[13px] text-muted">
              Al exportar, elegís dónde guardarlo. Si la carpeta parece sincronizada con la nube,
              QAtlas te avisa antes.
            </p>
          </section>
        )}

        <p role="status" className="text-[13.5px] text-text-2">
          {resultado}
        </p>
      </div>
    </Card>
  );
}
