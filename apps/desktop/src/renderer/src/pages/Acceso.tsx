import { useEffect, useId, useMemo, useState, type ReactNode, type SyntheticEvent } from 'react';
import type { VaultStatus } from '@qatlas/shared';
import { Icon, Logo } from '../ui/Icon';
import { Button, Card, cx } from '../ui/components';

/** Pantallas previas al desbloqueo. No muestran ningún dato de la bóveda (RN-BOV-03). */

type Evaluador = typeof import('@qatlas/shared/contrasena').evaluarContrasena;
type Evaluacion = ReturnType<Evaluador>;
type Motivo = 'corta' | 'comun' | 'debil' | 'ya-existe' | 'no-coincide';

const MOTIVOS: Record<Motivo, string> = {
  corta: 'La contraseña debe tener al menos 12 caracteres.',
  comun: 'Es una contraseña muy común. Elegí otra.',
  debil: 'Es demasiado fácil de adivinar. Probá con una frase larga y poco previsible.',
  'ya-existe': 'Ya hay una bóveda en este equipo.',
  'no-coincide': 'Las dos contraseñas no coinciden.',
};

const NIVELES = ['Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'] as const;

function PantallaAcceso({
  titulo,
  descripcion,
  children,
}: {
  titulo: string;
  descripcion: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="grid h-full place-items-center overflow-y-auto bg-bg p-6">
      <div className="flex w-full max-w-lg flex-col gap-5">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[17px] font-bold tracking-tight">QAtlas</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] leading-tight font-bold tracking-tight">{titulo}</h1>
          <p className="text-[15px] text-muted">{descripcion}</p>
        </div>
        <Card>{children}</Card>
      </div>
    </main>
  );
}

function CampoContrasena({
  etiqueta,
  valor,
  onChange,
  autoFocus,
  autoComplete,
}: {
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
  autoFocus?: boolean;
  autoComplete: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {etiqueta}
      </label>
      <input
        id={id}
        type="password"
        value={valor}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-text"
      />
    </div>
  );
}

function Aviso({ tono, children }: { tono: 'error' | 'advertencia'; children: ReactNode }) {
  return (
    <p
      role="alert"
      className={cx(
        'flex items-start gap-2 rounded-lg px-3 py-2.5',
        tono === 'error' ? 'bg-crit-bg text-crit-text' : 'bg-med-bg text-med-text',
      )}
    >
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** El color acompaña: el nivel siempre está escrito. */
function Medidor({ evaluacion }: { evaluacion: Evaluacion | null }) {
  const puntaje = evaluacion?.puntaje ?? 0;
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cx(
              'h-1.5 flex-1 rounded-full',
              evaluacion && i < Math.max(puntaje, 1)
                ? puntaje >= 3
                  ? 'bg-ok-text'
                  : 'bg-crit-text'
                : 'bg-border',
            )}
          />
        ))}
      </div>
      <p className="text-[13px] text-muted">
        Fortaleza: {evaluacion ? NIVELES[puntaje] : 'sin evaluar'}
      </p>
    </div>
  );
}

export function PrimerInicio({ onListo }: { onListo: () => void }) {
  const [contrasena, setContrasena] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [entiende, setEntiende] = useState(false);
  const [evaluador, setEvaluador] = useState<Evaluador | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [carpetaSincronizada, setCarpetaSincronizada] = useState(false);

  // Los diccionarios se cargan recién acá: el resto de la app no los necesita.
  useEffect(() => {
    void import('@qatlas/shared/contrasena').then(({ evaluarContrasena }) => {
      setEvaluador(() => evaluarContrasena);
    });
  }, []);
  const evaluacion = useMemo(
    () => (contrasena && evaluador ? evaluador(contrasena) : null),
    [contrasena, evaluador],
  );

  // CU-00, 5a: el aviso es parte de crear la bóveda, no algo para descubrir después.
  useEffect(() => {
    void window.qatlas.security.getStatus().then((res) => {
      if (res.ok) setCarpetaSincronizada(res.data.dataDirectorySynced);
    });
  }, []);

  const coinciden = contrasena === confirmacion;
  const puedeCrear =
    evaluacion?.aceptable === true && confirmacion.length > 0 && coinciden && entiende && !ocupado;

  const crear = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!puedeCrear) return;
    setOcupado(true);
    setError(null);
    const res = await window.qatlas.vault.create({
      contrasena,
      confirmacion,
      entiendeSinRecuperacion: true,
    });
    setOcupado(false);
    if (res.ok && res.data.resultado === 'creada') {
      setContrasena('');
      setConfirmacion('');
      onListo();
    } else if (res.ok && res.data.resultado === 'rechazada') {
      setError(MOTIVOS[res.data.motivo]);
    } else {
      setError('No se pudo crear la bóveda. No se guardó nada.');
    }
  };

  return (
    <PantallaAcceso
      titulo="Creá tu bóveda"
      descripcion="Todo lo que guardes en QAtlas queda cifrado en este equipo con una contraseña maestra."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void crear(event);
        }}
      >
        {carpetaSincronizada && (
          <Aviso tono="advertencia">
            La carpeta de datos parece estar sincronizada con la nube. La bóveda está cifrada, pero
            se subiría a un servicio externo. Elegir otra ubicación llega en la semana 10.
          </Aviso>
        )}
        <CampoContrasena
          etiqueta="Contraseña maestra"
          valor={contrasena}
          onChange={setContrasena}
          autoFocus
          autoComplete="new-password"
        />
        <Medidor evaluacion={evaluacion} />
        {evaluacion?.motivo && <Aviso tono="advertencia">{MOTIVOS[evaluacion.motivo]}</Aviso>}
        <CampoContrasena
          etiqueta="Repetí la contraseña"
          valor={confirmacion}
          onChange={setConfirmacion}
          autoComplete="new-password"
        />
        {confirmacion.length > 0 && !coinciden && (
          <Aviso tono="advertencia">{MOTIVOS['no-coincide']}</Aviso>
        )}

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="font-semibold">No hay forma de recuperarla</p>
          <p className="mt-1 text-[13.5px] text-muted">
            Si perdés la contraseña, tus datos son irrecuperables: nadie, tampoco QAtlas, puede
            abrirlos. Después de crear la bóveda, hacé una copia de seguridad.
          </p>
          <label className="mt-3 flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={entiende}
              onChange={(event) => {
                setEntiende(event.target.checked);
              }}
              className="mt-1 size-4 accent-[var(--qa-accent)]"
            />
            <span>Entiendo que, si la pierdo, no hay recuperación.</span>
          </label>
        </div>

        <label className="flex items-start gap-2.5 text-muted">
          <input type="checkbox" disabled className="mt-1 size-4" />
          <span>
            Buscar actualizaciones.{' '}
            <span className="text-[13px]">Llega en: semana 10. Hasta entonces, desactivado.</span>
          </span>
        </label>

        {error && <Aviso tono="error">{error}</Aviso>}
        <Button type="submit" variant="primary" icon="lock" disabled={!puedeCrear}>
          {ocupado ? 'Creando…' : 'Crear bóveda'}
        </Button>
      </form>
    </PantallaAcceso>
  );
}

function RestaurarCopia({ onListo }: { onListo: () => void }) {
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const restaurar = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!contrasena || ocupado) return;
    setOcupado(true);
    setError(null);
    const res = await window.qatlas.vault.restoreBackup({ contrasena });
    setOcupado(false);
    if (res.ok && res.data.resultado === 'restaurada') {
      setContrasena('');
      onListo();
    } else if (!res.ok || res.data.resultado === 'rechazada') {
      setError('La contraseña no corresponde a la copia, o la copia no es válida.');
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        void restaurar(event);
      }}
    >
      <CampoContrasena
        etiqueta="Contraseña de la copia"
        valor={contrasena}
        onChange={setContrasena}
        autoComplete="current-password"
      />
      {error && <Aviso tono="error">{error}</Aviso>}
      <Button type="submit" disabled={!contrasena || ocupado}>
        {ocupado ? 'Restaurando…' : 'Elegir copia y restaurar'}
      </Button>
    </form>
  );
}

export function RestaurarEnPrimerInicio({ onListo }: { onListo: () => void }) {
  return (
    <details className="w-full max-w-lg self-center rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <summary className="cursor-pointer font-medium">Ya tengo una copia de seguridad</summary>
      <div className="mt-4">
        <RestaurarCopia onListo={onListo} />
      </div>
    </details>
  );
}

export function BovedaDanada({ onListo }: { onListo: () => void }) {
  return (
    <PantallaAcceso
      titulo="No se puede abrir la bóveda"
      descripcion="Faltan archivos de la bóveda o están dañados. No se modificó nada. Podés restaurar una copia de seguridad."
    >
      <RestaurarCopia onListo={onListo} />
    </PantallaAcceso>
  );
}

export function Desbloqueo({ estado, onListo }: { estado: VaultStatus; onListo: () => void }) {
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [espera, setEspera] = useState(estado.esperaSegundos);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (espera <= 0) return;
    const temporizador = setTimeout(() => {
      setEspera(espera - 1);
    }, 1000);
    return () => {
      clearTimeout(temporizador);
    };
  }, [espera]);

  const desbloquear = async (event: SyntheticEvent) => {
    event.preventDefault();
    if (!contrasena || ocupado || espera > 0) return;
    setOcupado(true);
    setError(null);
    const res = await window.qatlas.vault.unlock({ contrasena });
    setOcupado(false);
    setContrasena('');
    if (res.ok && res.data.resultado === 'desbloqueada') {
      onListo();
    } else if (res.ok && res.data.resultado === 'rechazada') {
      setError('La contraseña no es correcta.');
      setEspera(res.data.esperaSegundos);
    } else {
      setError('No se pudo desbloquear la bóveda.');
    }
  };

  return (
    <PantallaAcceso
      titulo="Bóveda bloqueada"
      descripcion="Ingresá tu contraseña maestra para ver tus datos."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          void desbloquear(event);
        }}
      >
        <CampoContrasena
          etiqueta="Contraseña maestra"
          valor={contrasena}
          onChange={setContrasena}
          autoFocus
          autoComplete="current-password"
        />
        {error && <Aviso tono="error">{error}</Aviso>}
        {espera > 0 && (
          <Aviso tono="advertencia">
            Demasiados intentos. Podés volver a probar en {espera} s.
          </Aviso>
        )}
        <Button
          type="submit"
          variant="primary"
          icon="lock"
          disabled={!contrasena || ocupado || espera > 0}
        >
          {ocupado ? 'Desbloqueando…' : 'Desbloquear'}
        </Button>
      </form>
    </PantallaAcceso>
  );
}
