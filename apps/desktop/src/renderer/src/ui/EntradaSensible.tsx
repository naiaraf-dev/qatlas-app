import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { cx } from './components';

export interface CampoSensible {
  ref: RefObject<HTMLInputElement | null>;
  /** Solo si hay algo escrito: el valor nunca entra al estado de React. */
  tieneTexto: boolean;
  /** Se llama solo al enviar: devuelve el valor y deja el campo vacío, falle o no el envío. */
  tomar: () => string;
  vaciar: () => void;
  actualizar: () => void;
}

export function useCampoSensible(): CampoSensible {
  const ref = useRef<HTMLInputElement>(null);
  const [tieneTexto, setTieneTexto] = useState(false);

  const actualizar = useCallback(() => {
    setTieneTexto(Boolean(ref.current?.value));
  }, []);
  const vaciar = useCallback(() => {
    if (ref.current) ref.current.value = '';
    setTieneTexto(false);
  }, []);
  const tomar = useCallback(() => {
    const valor = ref.current?.value ?? '';
    vaciar();
    return valor;
  }, [vaciar]);

  return { ref, tieneTexto, tomar, vaciar, actualizar };
}

/**
 * El único campo para contraseñas y secretos. No es controlado a propósito: React copia el valor de
 * un campo controlado al atributo `value`, y de ahí es legible en el HTML. Sin `value`, el texto
 * vive solo en el elemento. Se vacía al enviar, al desmontar y al salir de la página, que es lo que
 * pasa al bloquear la bóveda.
 */
export function EntradaSensible({
  campo,
  alCambiar,
  id,
  autocompletar,
  className,
  autoFocus,
  ...aria
}: {
  campo: CampoSensible;
  alCambiar?: () => void;
  id: string;
  /** `current-password` si la contraseña ya existe; `new-password` si se está definiendo. */
  autocompletar: 'current-password' | 'new-password';
  className?: string;
  autoFocus?: boolean;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}) {
  const { ref } = campo;

  useEffect(() => {
    const elemento = ref.current;
    const limpiar = () => {
      if (elemento) elemento.value = '';
    };
    window.addEventListener('pagehide', limpiar);
    return () => {
      window.removeEventListener('pagehide', limpiar);
      limpiar();
    };
  }, [ref]);

  return (
    <input
      {...aria}
      ref={ref}
      id={id}
      type="password"
      autoComplete={autocompletar}
      spellCheck={false}
      autoFocus={autoFocus}
      onInput={() => {
        campo.actualizar();
        alCambiar?.();
      }}
      className={cx(
        'min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-text',
        className,
      )}
    />
  );
}
