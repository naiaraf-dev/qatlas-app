import { useId, type ReactNode } from 'react';
import {
  EXCLUSIONES_POR_DEFECTO,
  LIMITES_PROYECTO,
  PROYECTO_POR_DEFECTO,
  type ErrorValidacion,
  type EstadoAutorizacion,
  type MotivoValidacion,
  type ProyectoEntrada,
} from '@qatlas/shared';
import { Icon } from '../../ui/Icon';

export const CLASE_ENTRADA =
  'min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-text';

export const MENSAJES: Record<MotivoValidacion, string> = {
  vacio: 'Completá este campo.',
  invalido: 'No tiene un formato válido.',
  'esquema-no-permitido': 'Solo se admiten direcciones http y https.',
  'credenciales-en-url': 'No puede incluir usuario ni contraseña.',
  'comodin-invalido': 'Un comodín solo puede ir al principio, como *.lexora.test.',
  'comodin-amplio': 'Ese comodín es demasiado amplio. Usá un dominio concreto, como *.lexora.test.',
  'sufijo-publico': 'Es un sufijo público, no un dominio concreto.',
  'ip-no-canonica': 'Escribí la IP en forma decimal con puntos, como 192.168.1.20.',
  'ip-no-permitida': 'Esa IP no se admite: solo 127.0.0.1 y, en un sistema interno, IPs privadas.',
  'localhost-no-exacto': 'Se admite solo localhost, sin subdominios.',
  'requiere-sistema-interno': 'Para IPs privadas o nombres sin punto, activá «Sistema interno».',
  'sin-dominios': 'Agregá al menos un dominio.',
  'url-fuera-de-dominios': 'La URL base tiene que pertenecer a un dominio permitido.',
  'nombre-repetido': 'Ya hay un proyecto con ese nombre.',
  'login-fuera-de-dominios': 'La URL de login tiene que estar dentro de los dominios permitidos.',
  'login-sin-cifrar':
    'En http el secreto viajaría sin cifrar. Usá https o activá «Permitir login sin cifrar».',
  'declaracion-distinta': 'La declaración cambió. Revisala y aceptala de nuevo.',
};

export function proyectoNuevo(): ProyectoEntrada {
  return {
    ...PROYECTO_POR_DEFECTO,
    nombre: '',
    descripcion: '',
    urlBase: '',
    dominios: [],
    exclusiones: [...EXCLUSIONES_POR_DEFECTO],
    selectoresSensibles: [],
  };
}

/** Una entrada por línea. */
export const aLineas = (lista: readonly string[]): string => lista.join('\n');
export const deLineas = (texto: string): string[] =>
  texto
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean);

export function erroresDe(errores: readonly ErrorValidacion[], campo: ErrorValidacion['campo']) {
  // Un motivo se repite si falla más de un dominio de la lista.
  return [...new Set(errores.filter((e) => e.campo === campo).map((e) => MENSAJES[e.motivo]))];
}

export function Campo({
  etiqueta,
  ayuda,
  errores = [],
  children,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  errores?: readonly string[];
  children: (props: {
    id: string;
    'aria-describedby': string;
    'aria-invalid': boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {etiqueta}
      </label>
      {children({ id, 'aria-describedby': idAyuda, 'aria-invalid': errores.length > 0 })}
      <div id={idAyuda} className="flex flex-col gap-1">
        {ayuda && <p className="text-[13px] text-muted">{ayuda}</p>}
        {errores.map((error) => (
          <p key={error} role="alert" className="text-[13px] font-medium text-crit-text">
            {error}
          </p>
        ))}
      </div>
    </div>
  );
}

export function Casilla({
  etiqueta,
  ayuda,
  marcada,
  onChange,
}: {
  etiqueta: string;
  ayuda?: ReactNode;
  marcada: boolean;
  onChange: (marcada: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className="mt-1 size-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{etiqueta}</span>
        {ayuda && <span className="text-[13px] text-muted">{ayuda}</span>}
      </span>
    </label>
  );
}

export function Aviso({
  tipo = 'alerta',
  children,
}: {
  tipo?: 'alerta' | 'peligro';
  children: ReactNode;
}) {
  const clases = tipo === 'peligro' ? 'bg-crit-bg text-crit-text' : 'bg-med-bg text-med-text';
  return (
    <div className={`flex items-start gap-2.5 rounded-lg p-3 text-[13.5px] ${clases}`}>
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

const SIN_AUTORIZACION: Record<Extract<EstadoAutorizacion, { vigente: false }>['motivo'], string> =
  {
    'sin-aceptar': 'Sin aceptar',
    'version-anterior': 'Declaración nueva sin aceptar',
    'alcance-cambiado': 'Cambió el alcance: hay que aceptarla de nuevo',
  };

/** Siempre con texto: el color nunca comunica solo. */
export function InsigniaAutorizacion({ estado }: { estado: EstadoAutorizacion }) {
  return estado.vigente ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-bg px-2.5 py-0.5 text-xs font-semibold text-ok-text">
      <Icon name="check" size={12} />
      Autorización vigente
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-high-bg px-2.5 py-0.5 text-xs font-semibold text-high-text">
      <Icon name="alert" size={12} />
      {SIN_AUTORIZACION[estado.motivo]}
    </span>
  );
}

const CAMPOS_NUMERICOS = [
  { campo: 'maxRps', etiqueta: 'Solicitudes por segundo' },
  { campo: 'maxPaginas', etiqueta: 'Máximo de páginas' },
  { campo: 'maxProfundidad', etiqueta: 'Profundidad' },
  { campo: 'timeoutPaginaSegundos', etiqueta: 'Timeout por página (segundos)' },
] as const;

/** Lo que el asistente y la edición comparten: el alcance. */
export function CamposAlcance({
  valor,
  onChange,
  errores,
  dominiosTexto,
  onDominiosTexto,
  ayudaDominios,
}: {
  valor: ProyectoEntrada;
  onChange: (cambios: Partial<ProyectoEntrada>) => void;
  errores: readonly ErrorValidacion[];
  dominiosTexto: string;
  onDominiosTexto: (texto: string) => void;
  ayudaDominios?: ReactNode;
}) {
  return (
    <>
      <Campo
        etiqueta="URL base"
        ayuda="La dirección donde empiezan las pruebas."
        errores={erroresDe(errores, 'urlBase')}
      >
        {(props) => (
          <input
            {...props}
            className={CLASE_ENTRADA}
            value={valor.urlBase}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              onChange({ urlBase: event.target.value });
            }}
          />
        )}
      </Campo>
      <Campo
        etiqueta="Dominios permitidos"
        ayuda={
          ayudaDominios ?? 'Uno por línea. Toda conexión a otro dominio se bloquea y se registra.'
        }
        errores={erroresDe(errores, 'dominios')}
      >
        {(props) => (
          <textarea
            {...props}
            className={`${CLASE_ENTRADA} py-2`}
            rows={3}
            value={dominiosTexto}
            spellCheck={false}
            onChange={(event) => {
              onDominiosTexto(event.target.value);
              onChange({ dominios: deLineas(event.target.value) });
            }}
          />
        )}
      </Campo>
      <Casilla
        etiqueta="Sistema interno"
        ayuda="Habilita IPs privadas (10/8, 172.16/12, 192.168/16) y nombres sin punto, siempre como host exacto. Queda en la auditoría; si cambia, hay que aceptar la autorización de nuevo."
        marcada={valor.sistemaInterno}
        onChange={(sistemaInterno) => {
          onChange({ sistemaInterno });
        }}
      />
    </>
  );
}

/** Límites y controles del escaneo. */
export function CamposControles({
  valor,
  onChange,
}: {
  valor: ProyectoEntrada;
  onChange: (cambios: Partial<ProyectoEntrada>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        {CAMPOS_NUMERICOS.map(({ campo, etiqueta }) => (
          <Campo key={campo} etiqueta={etiqueta}>
            {(props) => (
              <input
                {...props}
                type="number"
                className={CLASE_ENTRADA}
                min={LIMITES_PROYECTO[campo].min}
                max={LIMITES_PROYECTO[campo].max}
                value={valor[campo]}
                onChange={(event) => {
                  onChange({ [campo]: Number(event.target.value) });
                }}
              />
            )}
          </Campo>
        ))}
      </div>
      <Casilla
        etiqueta="Modo solo lectura"
        ayuda="Bloquea POST, PUT, PATCH y DELETE durante los escaneos, salvo el login configurado."
        marcada={valor.soloLectura}
        onChange={(soloLectura) => {
          onChange({ soloLectura });
        }}
      />
      {!valor.soloLectura && (
        <Aviso>Sin solo lectura, un escaneo puede cambiar datos del sistema probado.</Aviso>
      )}
      <Campo
        etiqueta="Exclusiones"
        ayuda="Una por línea. El escaneo nunca visita ni clickea lo que coincida."
      >
        {(props) => (
          <textarea
            {...props}
            className={`${CLASE_ENTRADA} py-2`}
            rows={5}
            value={aLineas(valor.exclusiones)}
            spellCheck={false}
            onChange={(event) => {
              onChange({ exclusiones: event.target.value.split('\n') });
            }}
            onBlur={(event) => {
              onChange({ exclusiones: deLineas(event.target.value) });
            }}
          />
        )}
      </Campo>
      <Casilla
        etiqueta="Modo datos sensibles"
        ayuda="Para sistemas con datos reales: refuerza el enmascarado de las evidencias."
        marcada={valor.modoDatosSensibles}
        onChange={(modoDatosSensibles) => {
          onChange({ modoDatosSensibles });
        }}
      />
      <Campo
        etiqueta="Selectores sensibles"
        ayuda="Uno por línea. Lo que coincida se enmascara en las evidencias."
      >
        {(props) => (
          <textarea
            {...props}
            className={`${CLASE_ENTRADA} py-2`}
            rows={2}
            value={aLineas(valor.selectoresSensibles)}
            spellCheck={false}
            onChange={(event) => {
              onChange({ selectoresSensibles: event.target.value.split('\n') });
            }}
            onBlur={(event) => {
              onChange({ selectoresSensibles: deLineas(event.target.value) });
            }}
          />
        )}
      </Campo>
    </>
  );
}

/** Para mandar: las líneas vacías que quedan mientras se escribe no son datos. */
export function limpiar(valor: ProyectoEntrada): ProyectoEntrada {
  return {
    ...valor,
    exclusiones: valor.exclusiones.map((e) => e.trim()).filter(Boolean),
    selectoresSensibles: valor.selectoresSensibles.map((s) => s.trim()).filter(Boolean),
  };
}

/** Evita mandar por IPC algo que el esquema va a rechazar sin decir por qué. */
export function numerosValidos(valor: ProyectoEntrada): boolean {
  return CAMPOS_NUMERICOS.every(({ campo }) => {
    const { min, max } = LIMITES_PROYECTO[campo];
    const numero = valor[campo];
    return Number.isInteger(numero) && numero >= min && numero <= max;
  });
}

export function Declaracion({ texto }: { texto: string }) {
  return (
    <div
      tabIndex={0}
      aria-label="Texto de la declaración"
      className="rounded-lg border border-border bg-surface-2 p-4 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap"
    >
      {texto}
    </div>
  );
}
