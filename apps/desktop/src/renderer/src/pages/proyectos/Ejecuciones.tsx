import { useCallback, useEffect, useState } from 'react';
import {
  credencialUsable,
  minutosMinimosDeEjecucion,
  type EjecucionResumen,
  type HallazgoVista,
  type ProgresoEjecucion,
  type SeveridadHallazgo,
  type IpcResponse,
  type MotivoFinEjecucion,
  type ProyectoDetalle,
} from '@qatlas/shared';
import { Button, Card, SeverityBadge } from '../../ui/components';
import { Aviso } from './comunes';

const INTERVALO_MS = 1000;

const ESTADOS: Record<EjecucionResumen['estado'], string> = {
  encolada: 'En cola',
  'en-curso': 'En curso',
  finalizada: 'Finalizada',
  fallida: 'Fallida',
  cancelada: 'Cancelada',
  pausada: 'Pausada',
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
  'login-fallido': 'No se pudo entrar con la credencial: no se cumplió el indicador de éxito.',
  'limite-logins':
    'Se detuvo para no bloquear la cuenta: llegó al máximo de logins (3 por sesión vencida en una ejecución, o 3 cada 15 minutos por credencial).',
  'ventana-cerrada': 'La ventana del login asistido se cerró antes de entrar.',
  'tiempo-agotado': 'Pasaron 5 minutos en la ventana del login asistido sin entrar.',
  'pausa-vencida': 'Estuvo pausada 15 minutos sin que nadie la reanudara.',
  'credencial-no-disponible': 'La credencial ya no existe o no se puede usar.',
};

const activa = ({ estado }: EjecucionResumen) =>
  estado === 'encolada' || estado === 'en-curso' || estado === 'pausada';

const ESPERAS: Record<NonNullable<ProgresoEjecucion['espera']>, string> = {
  'login-asistido':
    'Entrá en la ventana del navegador de pruebas que se abrió. Tenés 5 minutos. Lo que hagas ahí no cuenta como actividad en QAtlas: si la bóveda se bloquea, la ejecución se cancela.',
  'sesion-vencida':
    'Pausada: la sesión venció. Reanudá para abrir la ventana y volver a entrar. Lo recorrido no se pierde; a los 15 minutos sin reanudar, se cancela.',
  'enlace-vencido':
    'Pausada: el enlace de entrada ya no sirve. Reemplazá el enlace en la credencial y reanudá. A los 15 minutos sin reanudar, se cancela.',
};

type Detalle = NonNullable<IpcResponse<'ejecuciones:detalle'>>;

const ORDEN_SEVERIDAD: readonly SeveridadHallazgo[] = [
  'critica',
  'alta',
  'media',
  'baja',
  'informativa',
];
const NOMBRE_SEVERIDAD: Record<SeveridadHallazgo, string> = {
  critica: 'Crítica',
  alta: 'Alta',
  media: 'Media',
  baja: 'Baja',
  informativa: 'Informativa',
};

/** Lo que el escaneo no cubrió: un reporte tiene que decirlo. */
function Cobertura({ resumen }: { resumen: EjecucionResumen['resumen'] }) {
  const lineas = [
    resumen.detenido === 'max-paginas' &&
      'Se detuvo al llegar al máximo de páginas: quedaron páginas sin recorrer.',
    resumen.detenido === 'max-tiempo' &&
      'Se detuvo al llegar al tiempo máximo: quedaron páginas sin recorrer.',
    resumen.noRecorridosSoloLectura > 0 &&
      `Cobertura no alcanzada: ${resumen.noRecorridosSoloLectura} botones sin tocar por el modo solo lectura.`,
    resumen.noRecorridosExclusiones > 0 &&
      `Cobertura no alcanzada: ${resumen.noRecorridosExclusiones} links o botones excluidos.`,
    resumen.urlsDescartadas > 0 &&
      `${resumen.urlsDescartadas} URLs descartadas por parecer infinitas, como un calendario.`,
    resumen.websocketDescartados > 0 &&
      `${resumen.websocketDescartados} mensajes de WebSocket descartados por el modo solo lectura. No es un error del sitio.`,
    resumen.detenido === 'sesion' &&
      'Se detuvo porque no se pudo volver a entrar: quedaron páginas sin recorrer.',
    resumen.logins > 0 &&
      `Logins: ${resumen.logins} (${resumen.loginsInesperados} por sesión vencida, ${resumen.renovaciones} renovaciones planificadas).`,
  ].filter((linea): linea is string => typeof linea === 'string');
  if (lineas.length === 0) return null;
  return (
    <ul aria-label="Lo que no se cubrió" className="flex flex-col gap-1 text-[13.5px] text-muted">
      {lineas.map((linea) => (
        <li key={linea}>{linea}</li>
      ))}
    </ul>
  );
}

function Hallazgo({ hallazgo }: { hallazgo: HallazgoVista }) {
  const ruta = new URL(hallazgo.url).pathname;
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border p-3">
      <p className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={hallazgo.severidad} />
        <span className="font-medium">{hallazgo.titulo}</span>
      </p>
      <p className="font-mono text-[12.5px] break-all text-text-2">
        {ruta}
        {hallazgo.urlOrigen && ` · link en ${new URL(hallazgo.urlOrigen).pathname}`}
      </p>
      {hallazgo.tipo === 'rendimiento' && (
        <p className="text-[13px] text-muted">Medición orientativa, tomada en este equipo.</p>
      )}
      {hallazgo.detalle && (
        <details className="text-[13px]">
          <summary className="cursor-pointer text-muted">Detalle</summary>
          <pre className="mt-1 font-mono text-[12px] break-all whitespace-pre-wrap">
            {hallazgo.detalle}
          </pre>
        </details>
      )}
    </li>
  );
}

function Hallazgos({ hallazgos }: { hallazgos: readonly HallazgoVista[] }) {
  if (hallazgos.length === 0) return <p className="text-muted">No se encontraron problemas.</p>;
  return (
    <>
      {ORDEN_SEVERIDAD.map((severidad) => {
        const grupo = hallazgos.filter((h) => h.severidad === severidad);
        if (grupo.length === 0) return null;
        return (
          <section
            key={severidad}
            aria-label={`Hallazgos de severidad ${NOMBRE_SEVERIDAD[severidad]}`}
          >
            <h4 className="mb-2 font-semibold">
              {NOMBRE_SEVERIDAD[severidad]} ({grupo.length})
            </h4>
            <ul className="flex flex-col gap-2">
              {grupo.map((h) => (
                <Hallazgo key={h.id} hallazgo={h} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function Ejecuciones({ proyecto }: { proyecto: ProyectoDetalle }) {
  const [lista, setLista] = useState<EjecucionResumen[]>([]);
  const [bloqueoMinutos, setBloqueoMinutos] = useState<number | null>(null);
  const [rechazo, setRechazo] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [progreso, setProgreso] = useState<ProgresoEjecucion | null>(null);
  const usables = proyecto.credenciales.filter(credencialUsable);
  // Vacío: sin credencial, un escaneo anónimo.
  const [credencialId, setCredencialId] = useState('');
  const elegida = usables.find((c) => c.id === credencialId) ?? null;

  // En vivo, desde el proceso principal: página actual, hallazgos y conexiones bloqueadas.
  useEffect(() => window.qatlas.ejecuciones.alProgreso(setProgreso), []);

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
    const res = await window.qatlas.ejecuciones.lanzarEscaneo({
      proyectoId: proyecto.id,
      credencialId: elegida?.id ?? null,
    });
    if (!res.ok) setRechazo('No se pudo lanzar la ejecución.');
    else if (res.data.resultado === 'rechazada') {
      setRechazo(
        {
          'ya-en-curso': 'Ya hay una ejecución en curso en este proyecto.',
          'sin-autorizacion': 'Sin autorización vigente no se puede ejecutar nada.',
          'credencial-no-usable':
            'Esa credencial no se puede usar: revisá su indicador de éxito y su secreto.',
        }[res.data.motivo],
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
          Recorre el sitio en un navegador aislado, dentro de los dominios del proyecto, y busca
          errores, problemas de accesibilidad, de rendimiento y de seguridad. Todo el tráfico pasa
          por el proxy de salida. Con una credencial, entra con su rol y nunca visita el login ni
          los links de cerrar sesión.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className="font-medium">Iniciar sesión con</span>
          <select
            className="min-h-11 w-auto rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-text"
            value={credencialId}
            onChange={(event) => {
              setCredencialId(event.target.value);
            }}
          >
            <option value="">Sin credencial: escaneo anónimo</option>
            {proyecto.credenciales.map((c) => (
              <option key={c.id} value={c.id} disabled={!credencialUsable(c)}>
                {c.rol} · {c.nombre}
                {credencialUsable(c) ? '' : ' (falta el indicador de éxito)'}
              </option>
            ))}
          </select>
          <span className="text-[13px] text-muted">
            Comparar lo que ve cada rol llega en la fase 4.
          </span>
        </label>
        {elegida?.estrategia === 'asistido' && (
          <Aviso>
            Se va a abrir una ventana del navegador de pruebas para que entres. Lo que hagas ahí no
            cuenta como actividad en QAtlas: si la bóveda se bloquea, la ejecución se cancela.
          </Aviso>
        )}
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
                  {ejecucion.tipo === 'escaneo' ? 'Ejecución' : 'Prueba de login'}
                  {ejecucion.rol ? ` con el rol ${ejecucion.rol}` : ''}: {ESTADOS[ejecucion.estado]}
                </p>
                {activa(ejecucion) &&
                  (progreso?.ejecucionId === ejecucion.id && progreso.espera ? (
                    <Aviso>{ESPERAS[progreso.espera]}</Aviso>
                  ) : (
                    ejecucion.estado === 'pausada' && <Aviso>{ESPERAS['sesion-vencida']}</Aviso>
                  ))}
                {ejecucion.resumen.motivo && (
                  <p className="text-[13.5px] text-muted">{MOTIVOS[ejecucion.resumen.motivo]}</p>
                )}
                {activa(ejecucion) && progreso?.ejecucionId === ejecucion.id && (
                  <p className="text-[13.5px] break-all text-muted" aria-live="polite">
                    Página actual: {progreso.paginaActual ?? '—'} · Páginas:{' '}
                    {progreso.paginasVisitadas} · Hallazgos: {progreso.hallazgos} · Conexiones
                    bloqueadas: {progreso.conexionesBloqueadas}
                  </p>
                )}
                {!activa(ejecucion) && (
                  <>
                    <p className="text-[13.5px] text-muted">
                      Páginas: {ejecucion.resumen.paginasVisitadas} · Links excluidos:{' '}
                      {ejecucion.resumen.linksExcluidos} · Conexiones permitidas:{' '}
                      {ejecucion.resumen.conexionesPermitidas} · Bloqueadas:{' '}
                      {ejecucion.resumen.conexionesBloqueadas} · Hallazgos:{' '}
                      {ejecucion.resumen.hallazgos}
                    </p>
                    <Cobertura resumen={ejecucion.resumen} />
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {ejecucion.estado === 'pausada' && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        void window.qatlas.ejecuciones
                          .reanudar({ ejecucionId: ejecucion.id })
                          .then(cargar);
                      }}
                    >
                      Reanudar
                    </Button>
                  )}
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
                      Ver resultado
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {detalle && (
          <section aria-label="Hallazgos de la ejecución" className="flex flex-col gap-3">
            <h3 className="font-semibold">Hallazgos</h3>
            <Hallazgos hallazgos={detalle.hallazgos} />
          </section>
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
