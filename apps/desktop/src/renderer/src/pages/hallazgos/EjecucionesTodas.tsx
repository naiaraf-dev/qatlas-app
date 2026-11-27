import { useEffect, useState } from 'react';
import type { HallazgoComparado, IpcResponse, ProyectoResumen } from '@qatlas/shared';
import { Button, Card, PageHeader, SeverityBadge } from '../../ui/components';
import { Selector } from '../../ui/controles';
import { Aviso } from '../proyectos/comunes';
import { fecha, NOMBRE_ESTADO, NOMBRE_ESTADO_EJECUCION, NOMBRE_TIPO, rutaDe } from './textos';

type Ejecucion = IpcResponse<'ejecuciones:listarTodas'>[number];
type Comparacion = Extract<IpcResponse<'ejecuciones:comparar'>, { resultado: 'comparada' }>;

const RECHAZOS: Record<
  Extract<IpcResponse<'ejecuciones:comparar'>, { resultado: 'rechazada' }>['motivo'],
  string
> = {
  misma: 'Elegí dos ejecuciones distintas.',
  'no-existe': 'Una de las ejecuciones ya no existe.',
  'otro-proyecto': 'Las dos ejecuciones tienen que ser del mismo proyecto.',
  'no-terminada': 'Las dos ejecuciones tienen que haber terminado.',
};

const SECCIONES: readonly {
  clave: keyof Omit<Comparacion, 'resultado' | 'anteriorId' | 'posteriorId'>;
  titulo: string;
  ayuda: string;
}[] = [
  {
    clave: 'regresiones',
    titulo: 'Regresiones',
    ayuda: 'Estaban resueltos y volvieron a aparecer.',
  },
  { clave: 'nuevos', titulo: 'Nuevos', ayuda: 'Aparecen en la posterior y no en la anterior.' },
  { clave: 'recurrentes', titulo: 'Recurrentes', ayuda: 'Aparecen en las dos.' },
  {
    clave: 'resueltos',
    titulo: 'Resueltos',
    ayuda: 'Estaban en la anterior, y la posterior recorrió su página sin encontrarlos.',
  },
  {
    clave: 'noCubiertos',
    titulo: 'No cubiertos',
    ayuda:
      'Estaban en la anterior, y la posterior no recorrió su página: no se dan por arreglados.',
  },
];

export function EjecucionesTodas({ onAbrirProyecto }: { onAbrirProyecto: (id: string) => void }) {
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [proyectoId, setProyectoId] = useState<string | null>(null);
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[] | null>(null);
  const [anterior, setAnterior] = useState<string>('ninguna');
  const [posterior, setPosterior] = useState<string>('ninguna');
  const [comparacion, setComparacion] = useState<Comparacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.qatlas.ejecuciones.listarTodas({ proyectoId }).then((res) => {
      if (res.ok) setEjecuciones(res.data);
      else setError('No se pudieron leer las ejecuciones.');
    });
  }, [proyectoId]);

  useEffect(() => {
    void window.qatlas.proyectos.listar().then((res) => {
      if (res.ok) setProyectos(res.data);
    });
  }, []);

  const terminadas = (ejecuciones ?? []).filter(
    (e) => e.tipo === 'escaneo' && e.estado === 'finalizada',
  );
  const opcionesEjecucion = [
    { valor: 'ninguna', texto: 'Elegí una ejecución' },
    ...terminadas.map((e) => ({
      valor: e.id,
      texto: `${e.proyectoNombre} · ${fecha(e.inicio)}${e.rol ? ` · ${e.rol}` : ''}`,
    })),
  ];

  const comparar = async () => {
    setComparacion(null);
    setError(null);
    const res = await window.qatlas.ejecuciones.comparar({
      anteriorId: anterior,
      posteriorId: posterior,
    });
    if (!res.ok) {
      setError('No se pudo comparar.');
    } else if (res.data.resultado === 'rechazada') {
      setError(RECHAZOS[res.data.motivo]);
    } else {
      setComparacion(res.data);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ejecuciones"
        description="Las ejecuciones de todos los proyectos. Compará dos del mismo proyecto para ver qué apareció, qué se resolvió y qué volvió."
      />

      <Card title="Comparar dos ejecuciones">
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Selector
              etiqueta="Anterior"
              valor={anterior}
              opciones={opcionesEjecucion}
              alCambiar={setAnterior}
            />
            <Selector
              etiqueta="Posterior"
              valor={posterior}
              opciones={opcionesEjecucion}
              alCambiar={setPosterior}
            />
          </div>
          <div>
            <Button
              variant="primary"
              disabled={anterior === 'ninguna' || posterior === 'ninguna'}
              onClick={() => void comparar()}
            >
              Comparar
            </Button>
          </div>
          {error && <Aviso>{error}</Aviso>}
          {comparacion && (
            <div
              className="flex flex-col gap-4"
              aria-label="Resultado de la comparación"
              role="region"
            >
              {SECCIONES.map(({ clave, titulo, ayuda }) => (
                <ListaComparada
                  key={clave}
                  titulo={titulo}
                  ayuda={ayuda}
                  filas={comparacion[clave]}
                  destacada={clave === 'regresiones'}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Todas las ejecuciones">
        <div className="flex flex-col gap-4">
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
          {ejecuciones !== null && ejecuciones.length === 0 && (
            <p className="text-muted">Todavía no hay ejecuciones.</p>
          )}
          <ul aria-label="Ejecuciones de todos los proyectos" className="flex flex-col gap-2">
            {(ejecuciones ?? []).map((e) => (
              <li
                key={e.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${e.resumen.regresiones > 0 ? 'border-2 border-crit-text' : 'border-border'}`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold">
                    {e.proyectoNombre} · {e.tipo === 'escaneo' ? 'Escaneo' : 'Prueba de login'}
                    {e.rol ? ` · ${e.rol}` : ' · sin login'}
                  </span>
                  <span className="text-[13.5px] text-muted">
                    {NOMBRE_ESTADO_EJECUCION[e.estado]} · {fecha(e.inicio)} · Hallazgos:{' '}
                    {e.resumen.hallazgos} · Nuevos: {e.resumen.hallazgosNuevos} · Posiblemente
                    resueltos: {e.resumen.posiblementeResueltos}
                  </span>
                  {e.resumen.regresiones > 0 && (
                    <span className="font-semibold text-crit-text">
                      {e.resumen.regresiones === 1
                        ? '1 regresión'
                        : `${String(e.resumen.regresiones)} regresiones`}
                    </span>
                  )}
                </div>
                <Button
                  onClick={() => {
                    onAbrirProyecto(e.proyectoId);
                  }}
                >
                  Ver en el proyecto
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}

function ListaComparada({
  titulo,
  ayuda,
  filas,
  destacada,
}: {
  titulo: string;
  ayuda: string;
  filas: readonly HallazgoComparado[];
  destacada: boolean;
}) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-1.5">
      <h3 className={`font-semibold ${destacada && filas.length > 0 ? 'text-crit-text' : ''}`}>
        {titulo}: {filas.length}
      </h3>
      <p className="text-[13px] text-muted">{ayuda}</p>
      {filas.length > 0 && (
        <ul className="flex flex-col gap-1 text-[13.5px]">
          {filas.map((h) => (
            <li key={h.hallazgoId} className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={h.severidad} />
              <span>
                {h.titulo} · {NOMBRE_TIPO[h.tipo]} · {rutaDe(h.alcance)} · Estado:{' '}
                {NOMBRE_ESTADO[h.estado]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
