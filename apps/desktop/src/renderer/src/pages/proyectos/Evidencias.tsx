import { useEffect, useRef, useState } from 'react';
import type { EvidenciaVista, IpcResponse, VistaEvidencia } from '@qatlas/shared';
import { Button } from '../../ui/components';
import { Aviso } from './comunes';

/**
 * El visor de las evidencias (3.7, ADR 036). El sitio probado nunca se renderiza acá: las capturas y
 * los fotogramas llegan en bytes ya validados por el proceso principal y se dibujan en un canvas con
 * `createImageBitmap` (la CSP no admite `data:` ni `blob:`); la traza, el HAR y el snapshot del DOM se
 * muestran como texto, que React escapa.
 */

type Pagina = NonNullable<IpcResponse<'ejecuciones:detalle'>>['paginas'][number];
type Texto = Extract<VistaEvidencia, { tipo: 'texto' }>;
type Video = Extract<VistaEvidencia, { tipo: 'video' }>;

const LIMITE_DEL_ENMASCARADO =
  'El enmascarado tapa los campos de contraseña y los selectores sensibles del proyecto (con el modo datos sensibles, todos los campos de formulario). No tapa texto suelto: un dato escrito en un párrafo queda visible en la captura.';
const PUEDE_TENER_DATOS =
  'Puede contener datos sensibles: un video o un snapshot no se pueden redactar del todo. No se incluye por defecto al exportar.';
const MAX_LINEAS = 2000;

function segundos(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

/** Dibuja una imagen ya validada. Sin URL: el canvas no depende de la CSP. */
function Lienzo({
  datos,
  formato,
  etiqueta,
}: {
  datos: Uint8Array;
  formato: 'image/png' | 'image/jpeg';
  etiqueta: string;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  // La imagen que no se pudo dibujar: el error es de esos bytes, no de los siguientes.
  const [fallida, setFallida] = useState<Uint8Array | null>(null);
  useEffect(() => {
    let vigente = true;
    void createImageBitmap(new Blob([new Uint8Array(datos)], { type: formato })).then(
      (imagen) => {
        const destino = lienzo.current;
        if (!vigente || !destino) {
          imagen.close();
          return;
        }
        destino.width = imagen.width;
        destino.height = imagen.height;
        destino.getContext('2d')?.drawImage(imagen, 0, 0);
        imagen.close();
      },
      () => {
        if (vigente) setFallida(datos);
      },
    );
    return () => {
      vigente = false;
    };
  }, [datos, formato]);
  if (fallida === datos) return <p className="text-muted">No se pudo mostrar la imagen.</p>;
  return (
    <canvas
      ref={lienzo}
      role="img"
      aria-label={etiqueta}
      className="h-auto max-w-full rounded-lg border border-border"
    />
  );
}

function Captura({ evidencia }: { evidencia: EvidenciaVista }) {
  const [vista, setVista] = useState<Extract<VistaEvidencia, { tipo: 'imagen' }> | null>(null);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    void window.qatlas.evidencias.obtenerVista({ evidenciaId: evidencia.id }).then((res) => {
      if (res.ok && res.data?.tipo === 'imagen') setVista(res.data);
      else setFallo(true);
    });
  }, [evidencia.id]);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-[13.5px] text-muted">
        Captura
        {evidencia.enmascarados !== null && ` · ${evidencia.enmascarados} elementos tapados`}
        {evidencia.modoSensible && ' · modo datos sensibles'}
      </figcaption>
      {fallo && <p className="text-muted">No se pudo abrir la captura.</p>}
      {vista && (
        <Lienzo
          datos={vista.datos}
          formato={vista.formato}
          etiqueta="Captura de la página, con los campos sensibles tapados"
        />
      )}
      <p className="text-[13px] text-muted">{LIMITE_DEL_ENMASCARADO}</p>
    </figure>
  );
}

/** Los fotogramas perdidos entre el anterior y este: un hueco, no un salto real (f5). */
function huecoAntes(video: Video, indice: number): number {
  const desde = indice === 0 ? -1 : (video.tiempos[indice - 1] ?? -1);
  const hasta = video.tiempos[indice] ?? 0;
  return video.huecos
    .filter((h) => h.t > desde && h.t <= hasta)
    .reduce((total, h) => total + h.cantidad, 0);
}

function Reproductor({ evidencia }: { evidencia: EvidenciaVista }) {
  const [video, setVideo] = useState<Video | null>(null);
  const [fallo, setFallo] = useState(false);
  const [indice, setIndice] = useState(0);
  const [fotograma, setFotograma] = useState<Uint8Array | null>(null);
  const [reproduciendo, setReproduciendo] = useState(false);

  useEffect(() => {
    void window.qatlas.evidencias.obtenerVista({ evidenciaId: evidencia.id }).then((res) => {
      if (res.ok && res.data?.tipo === 'video') setVideo(res.data);
      else setFallo(true);
    });
  }, [evidencia.id]);

  useEffect(() => {
    if (!video) return;
    let vigente = true;
    void window.qatlas.evidencias
      .obtenerFotograma({ evidenciaId: evidencia.id, indice })
      .then((res) => {
        if (vigente && res.ok && res.data) setFotograma(res.data.datos);
      });
    return () => {
      vigente = false;
    };
  }, [video, indice, evidencia.id]);

  useEffect(() => {
    if (!reproduciendo || !video) return;
    const actual = video.tiempos[indice] ?? 0;
    const siguiente = video.tiempos[indice + 1];
    const espera = setTimeout(
      () => {
        if (siguiente === undefined) setReproduciendo(false);
        else setIndice((i) => i + 1);
      },
      siguiente === undefined ? 0 : Math.min(1000, Math.max(40, siguiente - actual)),
    );
    return () => {
      clearTimeout(espera);
    };
  }, [reproduciendo, indice, video]);

  const total = video?.tiempos.length ?? 0;
  const hueco = video ? huecoAntes(video, indice) : 0;
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-[13.5px] text-muted">
        Video del tramo
        {evidencia.duracionMs !== null && ` · ${segundos(evidencia.duracionMs)}`}
      </figcaption>
      <Aviso>{PUEDE_TENER_DATOS}</Aviso>
      {fallo && <p className="text-muted">No se pudo abrir el video.</p>}
      {video && video.fotogramasPerdidos > 0 && (
        <Aviso>
          Se perdieron {video.fotogramasPerdidos} fotogramas en este video: el proceso principal se
          atrasó al guardarlos. Un salto en esos momentos no es un salto real de la página.
        </Aviso>
      )}
      {fotograma && (
        <Lienzo
          datos={fotograma}
          formato="image/jpeg"
          etiqueta={`Fotograma ${indice + 1} de ${total}`}
        />
      )}
      {video && total > 0 && (
        <div className="flex flex-col gap-2">
          {hueco > 0 && (
            <p role="status" className="text-[13.5px] text-med-text">
              Antes de este fotograma se perdieron {hueco} fotogramas: hay un hueco.
            </p>
          )}
          <label className="flex flex-col gap-1 text-[13.5px]">
            <span>
              Fotograma {indice + 1} de {total} · {segundos(video.tiempos[indice] ?? 0)}
            </span>
            <input
              type="range"
              min={0}
              max={total - 1}
              value={indice}
              onChange={(event) => {
                setReproduciendo(false);
                setIndice(Number(event.target.value));
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setReproduciendo(false);
                setIndice((i) => Math.max(0, i - 1));
              }}
            >
              Anterior
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (indice >= total - 1) setIndice(0);
                setReproduciendo((r) => !r);
              }}
            >
              {reproduciendo ? 'Pausar' : 'Reproducir'}
            </Button>
            <Button
              onClick={() => {
                setReproduciendo(false);
                setIndice((i) => Math.min(total - 1, i + 1));
              }}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </figure>
  );
}

/** Una línea de la traza, en pocas palabras. Todo es texto ya redactado. */
function resumirEvento(evento: Record<string, unknown>): string {
  const texto = (clave: string) => (typeof evento[clave] === 'string' ? evento[clave] : '');
  switch (evento.clase) {
    case 'navegacion':
      return `Navegación a ${texto('url')}`;
    case 'accion':
      return `Clic en «${texto('objetivo')}»`;
    case 'red':
      return `${texto('metodo')} ${texto('url')} → ${typeof evento.estado === 'number' ? evento.estado : texto('error') || 'sin respuesta'}`;
    case 'consola':
      return `Consola (${texto('nivel')}): ${texto('texto')}`;
    case 'excepcion':
      return `Excepción: ${texto('texto')}`;
    case 'snapshot':
      return 'Snapshot del DOM (evidencia aparte)';
    default:
      return 'Evento';
  }
}

function Traza({ vista }: { vista: Texto }) {
  const lineas = vista.texto
    .split('\n')
    .filter(Boolean)
    .slice(1, MAX_LINEAS + 1);
  const eventos = lineas.flatMap((linea) => {
    try {
      return [JSON.parse(linea) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
  return (
    <ol className="flex max-h-96 flex-col gap-1 overflow-auto font-mono text-[12px]">
      {eventos.map((evento, i) => (
        <li key={i} className="break-all">
          {typeof evento.t === 'number' ? segundos(evento.t) : ''} · {resumirEvento(evento)}
        </li>
      ))}
    </ol>
  );
}

function Har({ vista }: { vista: Texto }) {
  let entradas: { request?: { method?: string; url?: string }; response?: { status?: number } }[] =
    [];
  try {
    entradas = (JSON.parse(vista.texto) as { log: { entries: typeof entradas } }).log.entries;
  } catch {
    return <p className="text-muted">No se pudo leer el HAR.</p>;
  }
  return (
    <ol className="flex max-h-96 flex-col gap-1 overflow-auto font-mono text-[12px]">
      {entradas.slice(0, MAX_LINEAS).map((entrada, i) => (
        <li key={i} className="break-all">
          {entrada.request?.method} {entrada.request?.url} → {entrada.response?.status ?? '—'}
        </li>
      ))}
    </ol>
  );
}

function EnTexto({ evidencia, titulo }: { evidencia: EvidenciaVista; titulo: string }) {
  const [vista, setVista] = useState<Texto | null>(null);
  const [abierta, setAbierta] = useState(false);
  const [fallo, setFallo] = useState(false);
  useEffect(() => {
    if (!abierta || vista) return;
    void window.qatlas.evidencias.obtenerVista({ evidenciaId: evidencia.id }).then((res) => {
      if (res.ok && res.data?.tipo === 'texto') setVista(res.data);
      else setFallo(true);
    });
  }, [abierta, vista, evidencia.id]);
  return (
    <details
      className="text-[13.5px]"
      onToggle={(event) => {
        setAbierta(event.currentTarget.open);
      }}
    >
      <summary className="cursor-pointer">
        {titulo}
        {evidencia.entradas !== null && ` (${evidencia.entradas})`}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {evidencia.secretosRedactados > 0 && (
          <Aviso>
            Se redactaron {evidencia.secretosRedactados} secretos: lo que se ve dice qué tipo era,
            nunca el valor.
          </Aviso>
        )}
        {evidencia.puedeTenerDatosSensibles && <Aviso>{PUEDE_TENER_DATOS}</Aviso>}
        {fallo && <p className="text-muted">No se pudo abrir.</p>}
        {vista?.formato === 'traza' && <Traza vista={vista} />}
        {vista?.formato === 'har' && <Har vista={vista} />}
        {vista?.formato === 'html-texto' && (
          <>
            <p className="text-[13px] text-muted">
              Se muestra como texto: QAtlas nunca abre el sitio probado en su ventana.
            </p>
            <pre className="max-h-96 overflow-auto font-mono text-[12px] break-all whitespace-pre-wrap">
              {vista.texto}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}

function rutaDe(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function EvidenciasDeEjecucion({
  ejecucionId,
  paginas,
}: {
  ejecucionId: string;
  paginas: readonly Pagina[];
}) {
  const [evidencias, setEvidencias] = useState<EvidenciaVista[] | null>(null);
  useEffect(() => {
    void window.qatlas.evidencias.listar({ ejecucionId }).then((res) => {
      setEvidencias(res.ok ? res.data : []);
    });
  }, [ejecucionId]);
  if (!evidencias) return null;
  if (evidencias.length === 0)
    return <p className="text-muted">Esta ejecución no tiene evidencias.</p>;

  const deEjecucion = evidencias.filter((e) => e.tipo === 'traza' || e.tipo === 'har');
  const porPagina = paginas
    .map((pagina) => ({
      pagina,
      propias: evidencias.filter(
        (e) => e.paginaId === pagina.id && e.tipo !== 'traza' && e.tipo !== 'har',
      ),
    }))
    .filter(({ propias }) => propias.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {deEjecucion.map((evidencia) => (
        <EnTexto
          key={evidencia.id}
          evidencia={evidencia}
          titulo={
            evidencia.tipo === 'traza'
              ? 'Traza de la ejecución (para desarrollo)'
              : 'HAR de la ejecución, sin cuerpos de respuesta (para desarrollo)'
          }
        />
      ))}
      {porPagina.map(({ pagina, propias }) => (
        <section
          key={pagina.id}
          aria-label={`Evidencias de ${rutaDe(pagina.url)}`}
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
        >
          <h4 className="font-mono text-[12.5px] break-all">{rutaDe(pagina.url)}</h4>
          {propias.map((evidencia) => {
            if (evidencia.tipo === 'captura') {
              return <Captura key={evidencia.id} evidencia={evidencia} />;
            }
            if (evidencia.tipo === 'video') {
              return <Reproductor key={evidencia.id} evidencia={evidencia} />;
            }
            return (
              <EnTexto
                key={evidencia.id}
                evidencia={evidencia}
                titulo="Snapshot del DOM, como texto"
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
