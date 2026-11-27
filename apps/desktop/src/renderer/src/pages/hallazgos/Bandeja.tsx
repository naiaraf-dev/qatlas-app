import { useEffect, useId, useMemo, useState } from 'react';
import type {
  EstadoHallazgo,
  FiltrosBandeja,
  HallazgoBandeja,
  IpcResponse,
  ProyectoResumen,
  SeveridadHallazgo,
  TipoHallazgo,
} from '@qatlas/shared';
import { Button, Card, PageHeader, SeverityBadge } from '../../ui/components';
import { Casilla, DialogoConfirmacion, Selector } from '../../ui/controles';
import { Aviso, CLASE_ENTRADA } from '../proyectos/comunes';
import {
  fecha,
  NOMBRE_APARICION,
  NOMBRE_ESTADO,
  NOMBRE_SEVERIDAD,
  NOMBRE_TIPO,
  ORDEN_ESTADOS,
  ORDEN_SEVERIDAD,
  rutaDe,
} from './textos';

type Detalle = NonNullable<IpcResponse<'hallazgos:detalle'>>;
type Agrupacion = 'ninguna' | 'problema' | 'tipo' | 'pagina' | 'estado';

const FILTROS_INICIALES: FiltrosBandeja = {
  proyectoId: null,
  estados: [],
  severidades: [],
  tipos: [],
  soloRegresiones: false,
  incluirDescartados: false,
  soloSinCobertura: false,
};

const AGRUPACIONES: readonly { valor: Agrupacion; texto: string }[] = [
  { valor: 'ninguna', texto: 'Sin agrupar' },
  { valor: 'problema', texto: 'Mismo problema en varias páginas' },
  { valor: 'tipo', texto: 'Por tipo' },
  { valor: 'pagina', texto: 'Por página' },
  { valor: 'estado', texto: 'Por estado' },
];

interface Grupo {
  clave: string;
  titulo: string;
  filas: HallazgoBandeja[];
}

/** Las filas agrupadas. «Mismo problema en varias páginas»: igual tipo y clave, en cualquier página. */
export function agrupar(filas: readonly HallazgoBandeja[], modo: Agrupacion): Grupo[] {
  if (modo === 'ninguna') return [{ clave: 'todos', titulo: '', filas: [...filas] }];
  const grupos = new Map<string, Grupo>();
  for (const fila of filas) {
    const clave =
      modo === 'problema'
        ? fila.grupo
        : modo === 'tipo'
          ? fila.tipo
          : modo === 'pagina'
            ? fila.alcance
            : fila.estado;
    const grupo = grupos.get(clave) ?? { clave, titulo: '', filas: [] };
    grupo.filas.push(fila);
    grupos.set(clave, grupo);
  }
  for (const grupo of grupos.values()) {
    const [primera] = grupo.filas;
    if (!primera) continue;
    const paginas = new Set(grupo.filas.map((f) => f.alcance)).size;
    grupo.titulo =
      modo === 'problema'
        ? `${NOMBRE_TIPO[primera.tipo]}: ${primera.titulo} — en ${String(paginas)} ${paginas === 1 ? 'página' : 'páginas'}`
        : modo === 'tipo'
          ? NOMBRE_TIPO[primera.tipo]
          : modo === 'pagina'
            ? rutaDe(primera.alcance)
            : NOMBRE_ESTADO[primera.estado];
  }
  // El mismo problema en más páginas, primero.
  return [...grupos.values()].sort((a, b) => b.filas.length - a.filas.length);
}

/** Se puede incluir en un reporte: abierto, ni descartado ni resuelto. */
const REPORTABLE = new Set<EstadoHallazgo>([
  'nuevo',
  'confirmado',
  'regresion',
  'posiblemente_resuelto',
  'reportado',
]);

const NO_SE_PUDO_REPORTAR: Record<'no-existe' | 'otro-proyecto' | 'no-corresponde', string> = {
  'no-existe': 'No se pudo crear el reporte: un hallazgo ya no existe.',
  'otro-proyecto':
    'Un reporte junta hallazgos de un solo proyecto. Elegí hallazgos del mismo proyecto.',
  'no-corresponde': 'Un hallazgo descartado o resuelto no se reporta.',
};

export function Bandeja({ onAbrirReporte }: { onAbrirReporte: (reporteId: string) => void }) {
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [filtros, setFiltros] = useState<FiltrosBandeja>(FILTROS_INICIALES);
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('ninguna');
  const [filas, setFilas] = useState<HallazgoBandeja[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState('');
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [abiertos, setAbiertos] = useState<Record<string, Detalle | 'cargando'>>({});
  const [descartando, setDescartando] = useState<HallazgoBandeja | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmandoLote, setConfirmandoLote] = useState(false);
  const idMotivo = useId();

  const [recarga, setRecarga] = useState(0);
  const cargar = () => {
    setRecarga((n) => n + 1);
  };

  useEffect(() => {
    void window.qatlas.hallazgos.listar(filtros).then((res) => {
      if (res.ok) {
        setFilas(res.data);
        setError(null);
      } else {
        setError('No se pudieron leer los hallazgos.');
      }
    });
  }, [filtros, recarga]);

  /** Cambiar un filtro vacía la selección del lote: lo seleccionado podría no estar en la lista nueva. */
  const cambiarFiltros = (cambio: (f: FiltrosBandeja) => FiltrosBandeja) => {
    setFiltros(cambio);
    setSeleccion(new Set());
  };

  useEffect(() => {
    void window.qatlas.proyectos.listar().then((res) => {
      if (res.ok) setProyectos(res.data);
    });
  }, []);

  const loteActivo = filtros.estados.length === 1 && filtros.estados[0] === 'posiblemente_resuelto';

  const regresiones = (filas ?? []).filter((f) => f.estado === 'regresion');
  const grupos = useMemo(() => agrupar(filas ?? [], agrupacion), [filas, agrupacion]);

  const decidir = async (
    fila: HallazgoBandeja,
    accion: 'confirmar' | 'resolver' | 'reabrir' | 'descartar',
    textoMotivo?: string,
  ) => {
    const res = await window.qatlas.hallazgos.decidir(
      accion === 'descartar'
        ? { accion, hallazgoId: fila.id, motivo: textoMotivo ?? '' }
        : { accion, hallazgoId: fila.id },
    );
    if (res.ok && res.data.resultado === 'hecho') {
      setMensaje(`«${fila.titulo}»: ${NOMBRE_ESTADO[res.data.estado]}.`);
    } else {
      setMensaje(`No se pudo cambiar «${fila.titulo}»: ya no corresponde a su estado.`);
    }
    cargar();
  };

  const cambiarSeveridad = async (fila: HallazgoBandeja, severidad: SeveridadHallazgo) => {
    const res = await window.qatlas.hallazgos.cambiarSeveridad({ hallazgoId: fila.id, severidad });
    setMensaje(
      res.ok && res.data.resultado === 'hecho'
        ? `«${fila.titulo}»: severidad ${NOMBRE_SEVERIDAD[severidad]}.`
        : `No se pudo cambiar la severidad de «${fila.titulo}».`,
    );
    cargar();
  };

  const resolverLote = async () => {
    setConfirmandoLote(false);
    const res = await window.qatlas.hallazgos.resolverEnLote({ hallazgoIds: [...seleccion] });
    setMensaje(
      res.ok
        ? `Se confirmaron como resueltos ${String(res.data.resueltos)} hallazgos.${res.data.rechazados > 0 ? ` ${String(res.data.rechazados)} ya no estaban en «Posiblemente resuelto».` : ''}`
        : 'No se pudieron confirmar como resueltos.',
    );
    cargar();
  };

  const crearReporte = async (hallazgoIds: string[]) => {
    const res = await window.qatlas.reportes.crear({ hallazgoIds });
    if (res.ok && res.data.resultado === 'creado') {
      onAbrirReporte(res.data.reporteId);
      return;
    }
    setMensaje(
      res.ok && res.data.resultado === 'rechazada'
        ? NO_SE_PUDO_REPORTAR[res.data.motivo]
        : 'No se pudo crear el reporte.',
    );
    cargar();
  };

  const seleccionadas = (filas ?? []).filter((f) => seleccion.has(f.id));
  const proyectosSeleccionados = new Set(seleccionadas.map((f) => f.proyectoId)).size;

  const alternarDetalle = async (fila: HallazgoBandeja) => {
    if (abiertos[fila.id]) {
      setAbiertos(Object.fromEntries(Object.entries(abiertos).filter(([id]) => id !== fila.id)));
      return;
    }
    setAbiertos((previos) => ({ ...previos, [fila.id]: 'cargando' }));
    const res = await window.qatlas.hallazgos.detalle({ hallazgoId: fila.id });
    if (res.ok && res.data) {
      const detalle = res.data;
      setAbiertos((previos) => ({ ...previos, [fila.id]: detalle }));
    }
  };

  const opcionesProyecto = [
    { valor: 'todos', texto: 'Todos los proyectos' },
    ...proyectos.map((p) => ({ valor: p.id, texto: p.nombre })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hallazgos"
        description="Los problemas que encontraron los escaneos, de un proyecto o de todos. El mismo problema en distintas ejecuciones es un solo hallazgo: se reconoce por su huella, sin guardar texto de la página."
      />

      {/* Lo que pasa al decidir, para el lector de pantalla. */}
      <p role="status" className="sr-only">
        {mensaje}
      </p>

      {regresiones.length > 0 && (
        <section
          aria-label="Regresiones"
          className="flex flex-col gap-1 rounded-[var(--radius-card)] border-2 border-crit-text bg-crit-bg p-4 text-crit-text"
        >
          <p className="font-bold">
            {regresiones.length === 1
              ? '1 regresión: un hallazgo resuelto volvió a aparecer.'
              : `${String(regresiones.length)} regresiones: hallazgos resueltos volvieron a aparecer.`}
          </p>
          <p className="text-[13.5px]">Están primeros en la lista y marcados como «Regresión».</p>
        </section>
      )}

      <Card title="Filtros">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Selector
            etiqueta="Proyecto"
            valor={filtros.proyectoId ?? 'todos'}
            opciones={opcionesProyecto}
            alCambiar={(valor) => {
              cambiarFiltros((f) => ({ ...f, proyectoId: valor === 'todos' ? null : valor }));
            }}
          />
          <Selector<EstadoHallazgo | 'cualquiera'>
            etiqueta="Estado"
            valor={filtros.estados[0] ?? 'cualquiera'}
            opciones={[
              { valor: 'cualquiera', texto: 'Cualquiera' },
              ...ORDEN_ESTADOS.map((e) => ({ valor: e, texto: NOMBRE_ESTADO[e] })),
            ]}
            alCambiar={(valor) => {
              cambiarFiltros((f) => ({ ...f, estados: valor === 'cualquiera' ? [] : [valor] }));
            }}
          />
          <Selector<SeveridadHallazgo | 'cualquiera'>
            etiqueta="Severidad"
            valor={filtros.severidades[0] ?? 'cualquiera'}
            opciones={[
              { valor: 'cualquiera', texto: 'Cualquiera' },
              ...ORDEN_SEVERIDAD.map((s) => ({ valor: s, texto: NOMBRE_SEVERIDAD[s] })),
            ]}
            alCambiar={(valor) => {
              cambiarFiltros((f) => ({ ...f, severidades: valor === 'cualquiera' ? [] : [valor] }));
            }}
          />
          <Selector<TipoHallazgo | 'cualquiera'>
            etiqueta="Tipo"
            valor={filtros.tipos[0] ?? 'cualquiera'}
            opciones={[
              { valor: 'cualquiera', texto: 'Cualquiera' },
              ...(Object.keys(NOMBRE_TIPO) as TipoHallazgo[]).map((t) => ({
                valor: t,
                texto: NOMBRE_TIPO[t],
              })),
            ]}
            alCambiar={(valor) => {
              cambiarFiltros((f) => ({ ...f, tipos: valor === 'cualquiera' ? [] : [valor] }));
            }}
          />
          <Selector<Agrupacion>
            etiqueta="Agrupar"
            valor={agrupacion}
            opciones={AGRUPACIONES}
            alCambiar={setAgrupacion}
          />
          <div className="flex flex-col gap-2.5">
            <Casilla
              etiqueta="Solo regresiones"
              marcada={filtros.soloRegresiones}
              onChange={(marcada) => {
                cambiarFiltros((f) => ({ ...f, soloRegresiones: marcada }));
              }}
            />
            <Casilla
              etiqueta="Solo sin cobertura"
              ayuda="Abiertos que la última ejecución del proyecto no recorrió."
              marcada={filtros.soloSinCobertura}
              onChange={(marcada) => {
                cambiarFiltros((f) => ({ ...f, soloSinCobertura: marcada }));
              }}
            />
            <Casilla
              etiqueta="Incluir descartados"
              marcada={filtros.incluirDescartados}
              onChange={(marcada) => {
                cambiarFiltros((f) => ({ ...f, incluirDescartados: marcada }));
              }}
            />
          </div>
        </div>
      </Card>

      {loteActivo && (filas?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13.5px] text-muted">
            No aparecieron en una ejecución que recorrió su página. Confirmá los que de verdad están
            corregidos.
          </p>
          <Button
            variant="primary"
            disabled={seleccion.size === 0}
            onClick={() => {
              setConfirmandoLote(true);
            }}
          >
            Confirmar como resueltos ({seleccion.size})
          </Button>
        </div>
      )}

      {seleccion.size > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            disabled={
              proyectosSeleccionados !== 1 || seleccionadas.some((f) => !REPORTABLE.has(f.estado))
            }
            onClick={() => void crearReporte(seleccionadas.map((f) => f.id))}
          >
            Crear un reporte con los seleccionados ({seleccion.size})
          </Button>
          {proyectosSeleccionados > 1 && (
            <p className="text-[13.5px] text-muted">
              Un reporte junta hallazgos de un solo proyecto.
            </p>
          )}
        </div>
      )}

      {mensaje && <p className="text-[13.5px] text-text-2">{mensaje}</p>}
      {error && <Aviso tipo="peligro">{error}</Aviso>}
      {filas !== null && filas.length === 0 && (
        <p className="text-muted">No hay hallazgos con estos filtros.</p>
      )}

      {grupos.map((grupo) => (
        <section
          key={grupo.clave}
          aria-label={grupo.titulo ? `Grupo: ${grupo.titulo}` : 'Hallazgos'}
          className="flex flex-col gap-3"
        >
          {grupo.titulo && <h2 className="text-lg font-semibold">{grupo.titulo}</h2>}
          <ul aria-label={grupo.titulo || 'Hallazgos'} className="flex flex-col gap-3">
            {grupo.filas.map((fila) => (
              <FilaHallazgo
                key={fila.id}
                fila={fila}
                detalle={abiertos[fila.id]}
                lote={loteActivo}
                alReportar={() => void crearReporte([fila.id])}
                seleccionada={seleccion.has(fila.id)}
                alSeleccionar={(marcada) => {
                  setSeleccion((previa) => {
                    const nueva = new Set(previa);
                    if (marcada) nueva.add(fila.id);
                    else nueva.delete(fila.id);
                    return nueva;
                  });
                }}
                alDecidir={(accion) => {
                  if (accion === 'descartar') {
                    setMotivo('');
                    setDescartando(fila);
                  } else {
                    void decidir(fila, accion);
                  }
                }}
                alCambiarSeveridad={(severidad) => void cambiarSeveridad(fila, severidad)}
                alVerDetalle={() => void alternarDetalle(fila)}
              />
            ))}
          </ul>
        </section>
      ))}

      <DialogoConfirmacion
        abierto={descartando !== null}
        titulo="Descartar el hallazgo"
        textoConfirmar="Descartar"
        alCancelar={() => {
          setDescartando(null);
        }}
        alConfirmar={() => {
          const fila = descartando;
          const texto = motivo.trim();
          if (!fila || texto.length === 0) return;
          setDescartando(null);
          void decidir(fila, 'descartar', texto);
        }}
      >
        <p>
          «{descartando?.titulo}» deja de alertar: si vuelve a aparecer, queda registrado sin aviso.
          Se puede reabrir.
        </p>
        <label htmlFor={idMotivo} className="font-medium">
          Motivo (obligatorio)
        </label>
        <textarea
          id={idMotivo}
          className={CLASE_ENTRADA}
          rows={3}
          maxLength={500}
          value={motivo}
          onChange={(evento) => {
            setMotivo(evento.target.value);
          }}
        />
        <p className="text-[13px] text-muted">Se guarda cifrado. No pegues datos de la página.</p>
      </DialogoConfirmacion>

      <DialogoConfirmacion
        abierto={confirmandoLote}
        titulo="Confirmar como resueltos"
        textoConfirmar="Confirmar"
        alCancelar={() => {
          setConfirmandoLote(false);
        }}
        alConfirmar={() => void resolverLote()}
      >
        <p>
          {seleccion.size === 1
            ? 'El hallazgo seleccionado pasa a «Resuelto».'
            : `Los ${String(seleccion.size)} hallazgos seleccionados pasan a «Resuelto».`}{' '}
          Si alguno vuelve a aparecer, es una regresión.
        </p>
      </DialogoConfirmacion>
    </div>
  );
}

function FilaHallazgo({
  fila,
  detalle,
  lote,
  seleccionada,
  alSeleccionar,
  alDecidir,
  alCambiarSeveridad,
  alVerDetalle,
  alReportar,
}: {
  fila: HallazgoBandeja;
  detalle: Detalle | 'cargando' | undefined;
  lote: boolean;
  seleccionada: boolean;
  alSeleccionar: (marcada: boolean) => void;
  alDecidir: (accion: 'confirmar' | 'resolver' | 'reabrir' | 'descartar') => void;
  alCambiarSeveridad: (severidad: SeveridadHallazgo) => void;
  alVerDetalle: () => void;
  alReportar: () => void;
}) {
  const idTitulo = useId();
  const idDetalle = useId();
  const regresion = fila.estado === 'regresion';
  return (
    <li>
      <article
        aria-labelledby={idTitulo}
        className={`flex flex-col gap-2 rounded-[var(--radius-card)] border bg-surface p-4 ${regresion ? 'border-2 border-crit-text' : 'border-border'}`}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          {(lote || REPORTABLE.has(fila.estado)) && (
            <Casilla
              etiqueta={<span className="sr-only">Seleccionar «{fila.titulo}»</span>}
              marcada={seleccionada}
              onChange={alSeleccionar}
            />
          )}
          <h3 id={idTitulo} className="font-semibold">
            {fila.titulo}
          </h3>
          <SeverityBadge severity={fila.severidad} />
          <span
            className={`text-[13px] font-semibold ${regresion ? 'text-crit-text' : 'text-text-2'}`}
          >
            Estado: {NOMBRE_ESTADO[fila.estado]}
          </span>
        </div>
        {regresion && (
          <p className="font-semibold text-crit-text">
            Regresión: estaba resuelto y volvió a aparecer.
          </p>
        )}
        <p className="text-[13.5px] text-text-2">
          {NOMBRE_TIPO[fila.tipo]} · {fila.proyectoNombre} · {rutaDe(fila.alcance)}
        </p>
        <p className="text-[13.5px] text-muted">
          {fila.ocurrencias === 1 ? 'Apareció 1 vez' : `Apareció ${String(fila.ocurrencias)} veces`}{' '}
          en {fila.paginas === 1 ? '1 página' : `${String(fila.paginas)} páginas`} · Primera vez:{' '}
          {fecha(fila.primeraVezEn)} · Última vez: {fecha(fila.ultimaVezEn)}
          {fila.ultimaAparicion && ` · ${NOMBRE_APARICION[fila.ultimaAparicion]}`}
          {fila.severidadManual && ' · Severidad cambiada a mano'}
        </p>
        {fila.sinCobertura && (
          <p className="text-[13.5px] text-muted">
            Sin cobertura: la última ejecución del proyecto no recorrió su página
            {fila.cubiertoEn ? ` (cubierta por última vez el ${fecha(fila.cubiertoEn)})` : ''}. No
            se da por arreglado.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2.5">
          {['nuevo', 'regresion', 'posiblemente_resuelto'].includes(fila.estado) && (
            <Button
              onClick={() => {
                alDecidir('confirmar');
              }}
            >
              Confirmar
            </Button>
          )}
          {fila.estado !== 'resuelto' && fila.estado !== 'descartado' && (
            <Button
              onClick={() => {
                alDecidir('resolver');
              }}
            >
              Marcar como resuelto
            </Button>
          )}
          {fila.estado !== 'descartado' ? (
            <Button
              onClick={() => {
                alDecidir('descartar');
              }}
            >
              Descartar…
            </Button>
          ) : (
            <Button
              onClick={() => {
                alDecidir('reabrir');
              }}
            >
              Reabrir
            </Button>
          )}
          {REPORTABLE.has(fila.estado) && (
            <Button aria-label={`Crear un reporte con «${fila.titulo}»`} onClick={alReportar}>
              Crear reporte
            </Button>
          )}
          <Selector<SeveridadHallazgo>
            etiqueta={`Severidad de «${fila.titulo}»`}
            etiquetaOculta
            valor={fila.severidad}
            opciones={ORDEN_SEVERIDAD.map((s) => ({ valor: s, texto: NOMBRE_SEVERIDAD[s] }))}
            alCambiar={alCambiarSeveridad}
          />
          <Button
            aria-expanded={detalle !== undefined}
            aria-controls={idDetalle}
            onClick={alVerDetalle}
          >
            {detalle ? 'Ocultar historial' : 'Ver historial'}
          </Button>
        </div>
        <div id={idDetalle}>
          {detalle === 'cargando' && <p className="text-muted">Cargando…</p>}
          {detalle && detalle !== 'cargando' && (
            <div className="flex flex-col gap-2">
              {detalle.motivoDescarte && (
                <p className="text-[13.5px]">Motivo del descarte: {detalle.motivoDescarte}</p>
              )}
              <ol
                aria-label={`Historial de «${fila.titulo}»`}
                className="flex flex-col gap-1 text-[13.5px]"
              >
                {detalle.historial.map((o) => (
                  <li key={`${o.ejecucionId}-${o.fecha}-${o.url}`}>
                    {fecha(o.fecha)} · {NOMBRE_APARICION[o.aparicion]} · {rutaDe(o.url)}
                    {o.secretosRedactados > 0 &&
                      ` · Se redactaron ${String(o.secretosRedactados)} secretos`}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </article>
    </li>
  );
}
