import { useCallback, useEffect, useState } from 'react';
import {
  minutosMinimosDeEjecucion,
  type EjecucionResumen,
  type IpcResponse,
  type MotivoFinEjecucion,
  type ProyectoDetalle,
} from '@qatlas/shared';
import { Button, Card } from '../../ui/components';
import { Aviso } from './comunes';

const INTERVALO_MS = 1000;

const ESTADOS: Record<EjecucionResumen['estado'], string> = {
  encolada: 'En cola',
  'en-curso': 'En curso',
  finalizada: 'Finalizada',
  fallida: 'Fallida',
  cancelada: 'Cancelada',
};

const MOTIVOS: Record<MotivoFinEjecucion, string> = {
  'proxy-no-inicio': 'El proxy de salida no arrancó: no se abrió el navegador.',
  'proxy-caido': 'El proxy de salida se cayó: la ejecución se cortó.',
  'runner-caido': 'El proceso de pruebas terminó de forma inesperada.',
  'navegador-no-disponible': 'El navegador de pruebas no está disponible.',
  'autorizacion-no-vigente': 'El proyecto no tiene una autorización vigente.',
  bloqueo: 'Se canceló porque la bóveda se bloqueó.',
  interrumpida: 'La aplicación se cerró antes de que terminara.',
  usuario: 'La cancelaste.',
};

const activa = ({ estado }: EjecucionResumen) => estado === 'encolada' || estado === 'en-curso';

type Detalle = NonNullable<IpcResponse<'ejecuciones:detalle'>>;

export function Ejecuciones({ proyecto }: { proyecto: ProyectoDetalle }) {
  const [lista, setLista] = useState<EjecucionResumen[]>([]);
  const [bloqueoMinutos, setBloqueoMinutos] = useState<number | null>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);

  const cargar = useCallback(async () => {
    const res = await window.qatlas.ejecuciones.listar({ proyectoId: proyecto.id });
    if (res.ok) setLista(res.data);
  }, [proyecto.id]);

  useEffect(() => {
    void window.qatlas.vault.getSettings().then((res) => {
      if (res.ok) setBloqueoMinutos(res.data.bloqueoMinutos);
    });
  }, []);

  const hayActiva = lista.some(activa);
  // Siempre, no solo con una activa: una prueba de login se lanza desde otra tarjeta.
  useEffect(() => {
    const pedir = () => {
      void window.qatlas.ejecuciones.listar({ proyectoId: proyecto.id }).then((res) => {
        if (res.ok) setLista(res.data);
      });
    };
    pedir();
    const intervalo = setInterval(pedir, INTERVALO_MS);
    return () => {
      clearInterval(intervalo);
    };
  }, [proyecto.id]);

  const lanzar = async () => {
    setRechazo(null);
    const res = await window.qatlas.ejecuciones.lanzarEscaneo({ proyectoId: proyecto.id });
    if (!res.ok) setRechazo('No se pudo lanzar la ejecución.');
    else if (res.data.resultado === 'rechazada') {
      setRechazo(
        res.data.motivo === 'ya-en-curso'
          ? 'Ya hay una ejecución en curso en este proyecto.'
          : 'Sin autorización vigente no se puede ejecutar nada.',
      );
    }
    await cargar();
  };

  const verDetalle = async (ejecucionId: string) => {
    const res = await window.qatlas.ejecuciones.detalle({ ejecucionId });
    if (res.ok) setDetalle(res.data);
  };

  const minutos = minutosMinimosDeEjecucion(proyecto);
  const bloqueadas = detalle?.conexiones.filter((c) => !c.permitida) ?? [];

  return (
    <Card title="Ejecuciones">
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Abre la URL base en un navegador aislado y sigue los links de esa página. Todo el tráfico
          pasa por el proxy de salida. El crawler completo llega en la semana 6.
        </p>
        {bloqueoMinutos !== null && minutos > bloqueoMinutos && (
          <Aviso>
            Con estos límites puede durar más de {Math.ceil(minutos)} minutos, y la bóveda se
            bloquea a los {bloqueoMinutos} minutos sin actividad. Bloquear cancela la ejecución.
            Ajustá el tiempo de bloqueo en Bóveda o bajá el máximo de páginas.
          </Aviso>
        )}
        <div>
          <Button
            variant="primary"
            disabled={!proyecto.autorizacion.vigente || hayActiva}
            onClick={() => void lanzar()}
          >
            Lanzar ejecución
          </Button>
        </div>
        {rechazo && <Aviso tipo="peligro">{rechazo}</Aviso>}
        {lista.length > 0 && (
          <ul className="flex flex-col gap-2" aria-label="Ejecuciones del proyecto">
            {lista.map((ejecucion) => (
              <li
                key={ejecucion.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-3"
              >
                <p className="font-medium">
                  {ejecucion.tipo === 'escaneo' ? 'Ejecución' : 'Prueba de login'}:{' '}
                  {ESTADOS[ejecucion.estado]}
                </p>
                {ejecucion.resumen.motivo && (
                  <p className="text-[13.5px] text-muted">{MOTIVOS[ejecucion.resumen.motivo]}</p>
                )}
                {!activa(ejecucion) && (
                  <p className="text-[13.5px] text-muted">
                    Páginas: {ejecucion.resumen.paginasVisitadas} · Links excluidos:{' '}
                    {ejecucion.resumen.linksExcluidos} · Conexiones permitidas:{' '}
                    {ejecucion.resumen.conexionesPermitidas} · Bloqueadas:{' '}
                    {ejecucion.resumen.conexionesBloqueadas}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  {activa(ejecucion) ? (
                    <Button
                      onClick={() => {
                        void window.qatlas.ejecuciones
                          .cancelar({ ejecucionId: ejecucion.id })
                          .then(cargar);
                      }}
                    >
                      Cancelar ejecución
                    </Button>
                  ) : (
                    <Button variant="ghost" onClick={() => void verDetalle(ejecucion.id)}>
                      Ver conexiones
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {detalle && (
          <section
            aria-label="Conexiones bloqueadas de la ejecución"
            className="flex flex-col gap-2"
          >
            <h3 className="font-semibold">Conexiones bloqueadas</h3>
            {bloqueadas.length === 0 ? (
              <p className="text-muted">Ninguna.</p>
            ) : (
              <ul className="flex flex-col gap-1 font-mono text-[12.5px]">
                {bloqueadas.map((c, i) => (
                  <li key={i} className="break-all">
                    {c.destino} · {c.regla} · {c.proceso}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
