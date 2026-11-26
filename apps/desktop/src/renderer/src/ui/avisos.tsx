/**
 * Avisos pasajeros (toasts), hechos a mano: la versión 1.22 de react-aria-components los tiene como
 * `UNSTABLE_` (ADR 042), y el patrón es simple.
 *
 * - Una sola región `role="status"` (`aria-live="polite"`), siempre en el DOM: el lector de pantalla
 *   anuncia cada aviso al aparecer, sin robar el foco.
 * - Cada aviso se cierra solo a los 6 segundos, salvo mientras el mouse o el foco están encima, y tiene
 *   un botón «Cerrar aviso». Para errores que hay que leer con calma, no se usa un aviso: va en línea
 *   con `role="alert"`.
 * - Nunca llevan secretos ni datos del sitio: solo textos fijos de la interfaz.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

const DURACION_MS = 6000;

interface Aviso {
  id: number;
  texto: string;
}

const Contexto = createContext<((texto: string) => void) | null>(null);

/** Muestra un aviso pasajero. */
export function useAvisos(): (texto: string) => void {
  const mostrar = useContext(Contexto);
  if (!mostrar) throw new Error('useAvisos fuera de ProveedorDeAvisos');
  return mostrar;
}

export function ProveedorDeAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const siguiente = useRef(0);
  const mostrar = useCallback((texto: string) => {
    siguiente.current += 1;
    const id = siguiente.current;
    setAvisos((actuales) => [...actuales.slice(-2), { id, texto }]);
  }, []);
  const cerrar = useCallback((id: number) => {
    setAvisos((actuales) => actuales.filter((a) => a.id !== id));
  }, []);

  return (
    <Contexto.Provider value={mostrar}>
      {children}
      <section
        role="status"
        aria-live="polite"
        aria-label="Avisos"
        className="pointer-events-none fixed right-5 bottom-5 z-50 flex w-80 flex-col gap-2"
      >
        {avisos.map((aviso) => (
          <TarjetaDeAviso key={aviso.id} aviso={aviso} alCerrar={cerrar} />
        ))}
      </section>
    </Contexto.Provider>
  );
}

function TarjetaDeAviso({ aviso, alCerrar }: { aviso: Aviso; alCerrar: (id: number) => void }) {
  const [pausado, setPausado] = useState(false);
  useEffect(() => {
    if (pausado) return undefined;
    const temporizador = setTimeout(() => {
      alCerrar(aviso.id);
    }, DURACION_MS);
    return () => {
      clearTimeout(temporizador);
    };
  }, [pausado, aviso.id, alCerrar]);

  return (
    <div
      className="pointer-events-auto flex animate-entrar items-start gap-3 rounded-[var(--radius-control)] border border-ok-border bg-ok-bg px-3.5 py-3 text-ok-text shadow-card"
      onMouseEnter={() => {
        setPausado(true);
      }}
      onMouseLeave={() => {
        setPausado(false);
      }}
      onFocus={() => {
        setPausado(true);
      }}
      onBlur={() => {
        setPausado(false);
      }}
    >
      <Icon name="check" size={16} className="mt-0.5 shrink-0" />
      <p className="flex-1 text-[13.5px] font-medium">{aviso.texto}</p>
      <button
        type="button"
        aria-label="Cerrar aviso"
        className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-surface"
        onClick={() => {
          alCerrar(aviso.id);
        }}
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
