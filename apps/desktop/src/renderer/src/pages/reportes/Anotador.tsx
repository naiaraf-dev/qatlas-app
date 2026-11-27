import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../../ui/components';
import { CampoNumerico, Selector } from '../../ui/controles';
import { Aviso, Campo, CLASE_ENTRADA } from '../proyectos/comunes';

/**
 * Captura anotada (3.9, ADR 048): recuadro, flecha, texto y tapar. La captura llega en bytes validados y se
 * dibuja en un canvas (la CSP no admite `data:` ni `blob:`). Al exportar, la interfaz manda la imagen y los
 * recuadros a tapar: el proceso principal los vuelve a tapar (tapar destruye, no desenfoca) y la codifica sin
 * metadatos, así que la imagen original nunca sale.
 *
 * Con teclado: los campos numéricos agregan la anotación sin arrastrar en el canvas.
 */

type Herramienta = 'tapar' | 'recuadro' | 'flecha' | 'texto';

interface Anotacion {
  herramienta: Herramienta;
  x: number;
  y: number;
  ancho: number;
  alto: number;
  texto?: string;
}

const HERRAMIENTAS: readonly { valor: Herramienta; texto: string }[] = [
  { valor: 'tapar', texto: 'Tapar (destruye lo de abajo)' },
  { valor: 'recuadro', texto: 'Recuadro' },
  { valor: 'flecha', texto: 'Flecha' },
  { valor: 'texto', texto: 'Texto' },
];

const NOMBRE: Record<Herramienta, string> = {
  tapar: 'Tapado',
  recuadro: 'Recuadro',
  flecha: 'Flecha',
  texto: 'Texto',
};

/** El color de las marcas: el token de lo crítico, leído del tema. Tapar es negro opaco, como en el proceso principal. */
function colorDeMarca(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--color-crit-text').trim();
}

/** Un recuadro con ancho y alto positivos, recortado a la imagen. */
function normalizar(a: Anotacion, ancho: number, alto: number): Anotacion {
  if (a.herramienta === 'flecha') {
    return {
      ...a,
      x: Math.round(a.x),
      y: Math.round(a.y),
      ancho: Math.round(a.ancho),
      alto: Math.round(a.alto),
    };
  }
  const x = Math.max(0, Math.min(a.x, a.x + a.ancho));
  const y = Math.max(0, Math.min(a.y, a.y + a.alto));
  return {
    ...a,
    x: Math.round(x),
    y: Math.round(y),
    ancho: Math.round(Math.min(Math.abs(a.ancho), ancho - x)),
    alto: Math.round(Math.min(Math.abs(a.alto), alto - y)),
  };
}

function dibujar(ctx: CanvasRenderingContext2D, imagen: ImageBitmap, anotaciones: Anotacion[]) {
  ctx.drawImage(imagen, 0, 0);
  const marca = colorDeMarca();
  const grosor = Math.max(3, Math.round(imagen.width / 300));
  for (const a of anotaciones) {
    if (a.herramienta === 'tapar') {
      ctx.fillStyle = 'rgb(0 0 0)';
      ctx.fillRect(a.x, a.y, a.ancho, a.alto);
    } else if (a.herramienta === 'recuadro') {
      ctx.strokeStyle = marca;
      ctx.lineWidth = grosor;
      ctx.strokeRect(a.x, a.y, a.ancho, a.alto);
    } else if (a.herramienta === 'flecha') {
      const x2 = a.x + a.ancho;
      const y2 = a.y + a.alto;
      const angulo = Math.atan2(a.alto, a.ancho);
      const punta = grosor * 5;
      ctx.strokeStyle = marca;
      ctx.fillStyle = marca;
      ctx.lineWidth = grosor;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - punta * Math.cos(angulo - 0.4), y2 - punta * Math.sin(angulo - 0.4));
      ctx.lineTo(x2 - punta * Math.cos(angulo + 0.4), y2 - punta * Math.sin(angulo + 0.4));
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = marca;
      ctx.font = `600 ${String(grosor * 6)}px "Inter Variable", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(a.texto ?? '', a.x, a.y);
    }
  }
}

export function Anotador({
  reporteId,
  evidenciaId,
  alTerminar,
}: {
  reporteId: string;
  evidenciaId: string;
  alTerminar: (mensaje: string) => void;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const [imagen, setImagen] = useState<ImageBitmap | null>(null);
  const [fallo, setFallo] = useState(false);
  const [herramienta, setHerramienta] = useState<Herramienta>('tapar');
  const [texto, setTexto] = useState('');
  const [anotaciones, setAnotaciones] = useState<Anotacion[]>([]);
  const [arrastre, setArrastre] = useState<Anotacion | null>(null);
  const [manual, setManual] = useState({ x: 0, y: 0, ancho: 100, alto: 40 });
  const [mensaje, setMensaje] = useState('');

  useEffect(() => {
    let vigente = true;
    let cargada: ImageBitmap | null = null;
    void window.qatlas.evidencias.obtenerVista({ evidenciaId }).then(async (res) => {
      if (!res.ok || res.data?.tipo !== 'imagen') {
        if (vigente) setFallo(true);
        return;
      }
      try {
        cargada = await createImageBitmap(
          new Blob([new Uint8Array(res.data.datos)], { type: res.data.formato }),
        );
        if (vigente) setImagen(cargada);
        else cargada.close();
      } catch {
        if (vigente) setFallo(true);
      }
    });
    return () => {
      vigente = false;
      cargada?.close();
    };
  }, [evidenciaId]);

  useEffect(() => {
    const destino = lienzo.current;
    if (!imagen || !destino) return;
    destino.width = imagen.width;
    destino.height = imagen.height;
    const ctx = destino.getContext('2d');
    if (ctx) dibujar(ctx, imagen, arrastre ? [...anotaciones, arrastre] : anotaciones);
  }, [imagen, anotaciones, arrastre]);

  const aImagen = (evento: PointerEvent<HTMLCanvasElement>) => {
    const destino = evento.currentTarget;
    const caja = destino.getBoundingClientRect();
    return {
      x: ((evento.clientX - caja.left) * destino.width) / caja.width,
      y: ((evento.clientY - caja.top) * destino.height) / caja.height,
    };
  };

  const agregar = (a: Anotacion) => {
    if (!imagen) return;
    const n = normalizar(a, imagen.width, imagen.height);
    if (n.herramienta !== 'texto' && n.herramienta !== 'flecha' && (n.ancho < 1 || n.alto < 1))
      return;
    if (n.herramienta === 'texto' && !n.texto) return;
    setAnotaciones((previas) => [...previas, n]);
    setMensaje(`${NOMBRE[n.herramienta]} agregado.`);
  };

  const exportar = async () => {
    const destino = lienzo.current;
    if (!destino) return;
    const blob = await new Promise<Blob | null>((listo) => {
      destino.toBlob(listo, 'image/png');
    });
    if (!blob) {
      setMensaje('No se pudo armar la imagen.');
      return;
    }
    const tapados = anotaciones
      .filter((a) => a.herramienta === 'tapar')
      .map(({ x, y, ancho, alto }) => ({ x, y, ancho, alto }));
    const res = await window.qatlas.reportes.exportarCaptura({
      reporteId,
      evidenciaId,
      imagen: new Uint8Array(await blob.arrayBuffer()),
      tapados,
    });
    if (!res.ok) setMensaje('No se pudo exportar la captura.');
    else if (res.data.resultado === 'exportado')
      alTerminar('Se exportó la captura anotada. Quedó registrada en la auditoría.');
    else if (res.data.resultado === 'cancelado')
      setMensaje('Se canceló: no se guardó ningún archivo.');
    else setMensaje('No se pudo exportar la captura: la imagen no corresponde a la evidencia.');
  };

  if (fallo) return <Aviso tipo="peligro">No se pudo abrir la captura.</Aviso>;

  return (
    <section
      aria-label="Anotador de la captura"
      className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-border p-4"
    >
      <Aviso>
        Tapar destruye lo de abajo: en el archivo exportado no queda nada recuperable. El archivo no
        está cifrado y no lleva metadatos.
      </Aviso>
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56">
          <Selector<Herramienta>
            etiqueta="Herramienta"
            valor={herramienta}
            opciones={HERRAMIENTAS}
            alCambiar={setHerramienta}
          />
        </div>
        {herramienta === 'texto' && (
          <Campo etiqueta="Texto de la anotación">
            {(props) => (
              <input
                {...props}
                className={CLASE_ENTRADA}
                maxLength={120}
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                }}
              />
            )}
          </Campo>
        )}
      </div>
      {!imagen && <p className="text-muted">Cargando la captura…</p>}
      <canvas
        ref={lienzo}
        role="img"
        aria-label={`Captura con ${String(anotaciones.length)} anotaciones`}
        className="h-auto max-w-full cursor-crosshair touch-none rounded-lg border border-border"
        onPointerDown={(e) => {
          if (!imagen) return;
          const { x, y } = aImagen(e);
          if (herramienta === 'texto') {
            agregar({ herramienta, x, y, ancho: 1, alto: 1, texto: texto.trim() });
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          setArrastre({ herramienta, x, y, ancho: 0, alto: 0 });
        }}
        onPointerMove={(e) => {
          if (!arrastre) return;
          const { x, y } = aImagen(e);
          setArrastre({ ...arrastre, ancho: x - arrastre.x, alto: y - arrastre.y });
        }}
        onPointerUp={() => {
          if (arrastre) agregar(arrastre);
          setArrastre(null);
        }}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-medium">
          Agregar con el teclado (en píxeles de la captura)
        </legend>
        <div className="grid gap-3 sm:grid-cols-4">
          {(['x', 'y', 'ancho', 'alto'] as const).map((campo) => (
            <CampoNumerico
              key={campo}
              etiqueta={
                campo === 'x'
                  ? 'Desde la izquierda'
                  : campo === 'y'
                    ? 'Desde arriba'
                    : campo === 'ancho'
                      ? 'Ancho'
                      : 'Alto'
              }
              valor={manual[campo]}
              alCambiar={(valor) => {
                setManual((m) => ({ ...m, [campo]: Number.isFinite(valor) ? valor : 0 }));
              }}
            />
          ))}
        </div>
        <div>
          <Button
            onClick={() => {
              agregar({ herramienta, ...manual, texto: texto.trim() });
            }}
          >
            Agregar {NOMBRE[herramienta].toLowerCase()}
          </Button>
        </div>
      </fieldset>
      {anotaciones.length > 0 && (
        <ul aria-label="Anotaciones" className="flex flex-col gap-2 text-[13.5px]">
          {anotaciones.map((a, i) => (
            <li key={`${String(i)}-${a.herramienta}`} className="flex flex-wrap items-center gap-3">
              <span>
                {NOMBRE[a.herramienta]}
                {a.texto && a.herramienta === 'texto' ? ` «${a.texto}»` : ''} en {a.x}, {a.y}
                {a.herramienta !== 'texto' ? ` · ${String(a.ancho)} × ${String(a.alto)}` : ''}
              </span>
              <Button
                variant="ghost"
                onClick={() => {
                  setAnotaciones((previas) => previas.filter((_, j) => j !== i));
                  setMensaje(`${NOMBRE[a.herramienta]} quitado.`);
                }}
              >
                Quitar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="primary" disabled={!imagen} onClick={() => void exportar()}>
          Exportar la captura anotada…
        </Button>
      </div>
      <p role="status" className="text-[13.5px] text-text-2">
        {mensaje}
      </p>
    </section>
  );
}
