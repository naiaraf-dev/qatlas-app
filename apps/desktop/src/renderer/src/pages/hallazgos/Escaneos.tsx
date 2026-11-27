import { useEffect, useState } from 'react';
import type { IpcResponse, ProyectoResumen } from '@qatlas/shared';
import { Button, Card, PageHeader } from '../../ui/components';
import { Selector } from '../../ui/controles';
import { Aviso } from '../proyectos/comunes';
import { fecha, NOMBRE_ESTADO_EJECUCION } from './textos';

type Ejecucion = IpcResponse<'ejecuciones:listarTodas'>[number];

const RECHAZOS: Record<
  Extract<IpcResponse<'ejecuciones:lanzarEscaneo'>, { resultado: 'rechazada' }>['motivo'],
  string
> = {
  'ya-en-curso': 'Ese proyecto ya tiene una ejecución en curso.',
  'sin-autorizacion': 'El proyecto no tiene la autorización vigente: aceptala desde el proyecto.',
  'credencial-no-usable': 'La credencial no se puede usar.',
  'estrategia-no-disponible': 'Esa estrategia de login todavía no está disponible.',
};

/** Lanzar un escaneo sin entrar al proyecto, y ver los últimos de todos. El detalle, en el proyecto. */
export function Escaneos({ onAbrirProyecto }: { onAbrirProyecto: (id: string) => void }) {
  const [proyectos, setProyectos] = useState<ProyectoResumen[]>([]);
  const [proyectoId, setProyectoId] = useState('ninguno');
  const [ultimos, setUltimos] = useState<Ejecucion[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [recarga, setRecarga] = useState(0);

  useEffect(() => {
    void window.qatlas.ejecuciones.listarTodas({ proyectoId: null }).then((res) => {
      if (res.ok) setUltimos(res.data.filter((e) => e.tipo === 'escaneo').slice(0, 20));
    });
  }, [recarga]);

  useEffect(() => {
    void window.qatlas.proyectos.listar().then((res) => {
      if (res.ok) setProyectos(res.data);
    });
  }, []);

  const lanzar = async () => {
    const res = await window.qatlas.ejecuciones.lanzarEscaneo({ proyectoId, credencialId: null });
    if (!res.ok) setMensaje('No se pudo lanzar el escaneo.');
    else if (res.data.resultado === 'rechazada') setMensaje(RECHAZOS[res.data.motivo]);
    else setMensaje('Escaneo encolado. Su progreso se ve en el proyecto.');
    setRecarga((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Escaneos"
        description="Recorrer una aplicación autorizada y detectar problemas automáticamente. Sin login desde acá; con un rol, desde las credenciales del proyecto."
      />
      <Card title="Lanzar un escaneo">
        <div className="flex flex-col gap-4">
          <Selector
            etiqueta="Proyecto"
            valor={proyectoId}
            opciones={[
              { valor: 'ninguno', texto: 'Elegí un proyecto' },
              ...proyectos.map((p) => ({ valor: p.id, texto: p.nombre })),
            ]}
            alCambiar={setProyectoId}
          />
          <div>
            <Button
              variant="primary"
              disabled={proyectoId === 'ninguno'}
              onClick={() => void lanzar()}
            >
              Lanzar escaneo
            </Button>
          </div>
          {mensaje && (
            <p role="status" className="text-[13.5px]">
              {mensaje}
            </p>
          )}
          {proyectos.length === 0 && (
            <Aviso>Todavía no hay proyectos: creá uno para escanear.</Aviso>
          )}
        </div>
      </Card>
      <Card title="Últimos escaneos">
        <ul aria-label="Últimos escaneos" className="flex flex-col gap-2">
          {ultimos.map((e) => (
            <li
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span>
                <span className="font-semibold">{e.proyectoNombre}</span> ·{' '}
                {NOMBRE_ESTADO_EJECUCION[e.estado]} · {fecha(e.inicio)} · Hallazgos:{' '}
                {e.resumen.hallazgos}
                {e.resumen.regresiones > 0 && (
                  <span className="font-semibold text-crit-text">
                    {' '}
                    ·{' '}
                    {e.resumen.regresiones === 1
                      ? '1 regresión'
                      : `${String(e.resumen.regresiones)} regresiones`}
                  </span>
                )}
              </span>
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
        {ultimos.length === 0 && <p className="text-muted">Todavía no hay escaneos.</p>}
      </Card>
    </div>
  );
}
