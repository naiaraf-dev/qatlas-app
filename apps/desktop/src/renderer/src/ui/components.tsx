import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** Une clases ignorando valores vacíos. */
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

// --- Botón ---------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-2',
  ghost: 'text-text-2 hover:bg-surface-2',
};

export function Button({
  variant = 'secondary',
  icon,
  className,
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; icon?: IconName }) {
  return (
    <button
      type={type}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

// --- Tarjeta con título --------------------------------------------------------

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={cx(
        'rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card',
        className,
      )}
    >
      {title && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={headingId} className="text-base font-semibold">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// --- Insignias de severidad y estado -------------------------------------------

export type Severity = 'critica' | 'alta' | 'media' | 'baja';

const SEVERITY: Record<Severity, { label: string; className: string }> = {
  critica: { label: 'Crítica', className: 'bg-crit-bg text-crit-text' },
  alta: { label: 'Alta', className: 'bg-high-bg text-high-text' },
  media: { label: 'Media', className: 'bg-med-bg text-med-text' },
  baja: { label: 'Baja', className: 'bg-low-bg text-low-text' },
};

/** La severidad siempre lleva su nombre escrito: nunca se comunica solo con color. */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const { label, className } = SEVERITY[severity];
  return (
    <span
      className={cx('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}
    >
      {label}
    </span>
  );
}

export function StatusPill({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-ok-border bg-ok-bg px-3 py-1.5 text-[13px] font-medium text-ok-text">
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}

// --- Encabezado de página ------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5">{actions}</div>}
    </div>
  );
}

// --- Selector segmentado -------------------------------------------------------

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; icon: IconName }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex rounded-[var(--radius-control)] border border-border bg-surface-2 p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.label}
            onClick={() => {
              onChange(option.value);
            }}
            className={cx(
              'flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors',
              selected ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text',
            )}
          >
            <Icon name={option.icon} size={15} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Indicador de verificación --------------------------------------------------

export function CheckItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <span
        className={cx(
          'grid size-6 shrink-0 place-items-center rounded-full',
          ok ? 'bg-ok-bg text-ok-text' : 'bg-crit-bg text-crit-text',
        )}
      >
        <Icon name={ok ? 'check' : 'x'} size={14} />
      </span>
      <span className="text-text">{children}</span>
      <span className="sr-only">{ok ? 'correcto' : 'con problemas'}</span>
    </li>
  );
}
