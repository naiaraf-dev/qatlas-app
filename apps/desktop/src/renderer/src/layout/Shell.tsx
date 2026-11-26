import { useId, type ReactNode } from 'react';
import { Button as BotonAria } from 'react-aria-components';
import type { ThemePreference } from '@qatlas/shared';
import { Icon, Logo, type IconName } from '../ui/Icon';
import { SegmentedControl, StatusPill, cx } from '../ui/components';
import { Ayuda } from '../ui/controles';

export type PageId =
  | 'inicio'
  | 'proyectos'
  | 'escaneos'
  | 'casos'
  | 'ejecuciones'
  | 'hallazgos'
  | 'reportes'
  | 'uat'
  | 'privacidad'
  | 'boveda';

export const PAGES: Record<PageId, { label: string; icon: IconName }> = {
  inicio: { label: 'Inicio', icon: 'home' },
  proyectos: { label: 'Proyectos', icon: 'folderPlus' },
  escaneos: { label: 'Escaneos', icon: 'scan' },
  casos: { label: 'Casos de prueba', icon: 'cases' },
  ejecuciones: { label: 'Ejecuciones', icon: 'play' },
  hallazgos: { label: 'Hallazgos', icon: 'alert' },
  reportes: { label: 'Reportes', icon: 'report' },
  uat: { label: 'UAT', icon: 'uat' },
  privacidad: { label: 'Privacidad y conexiones', icon: 'shield' },
  boveda: { label: 'Bóveda', icon: 'lock' },
};

const MAIN_NAV: PageId[] = [
  'inicio',
  'proyectos',
  'escaneos',
  'casos',
  'ejecuciones',
  'hallazgos',
  'reportes',
  'uat',
];

const THEME_OPTIONS = [
  { value: 'system', label: 'Sistema', icon: 'monitor' },
  { value: 'light', label: 'Claro', icon: 'sun' },
  { value: 'dark', label: 'Oscuro', icon: 'moon' },
] as const;

/** El atajo para colapsar y expandir la barra. Lo muestra la ayuda del botón y lo anuncia aria-keyshortcuts. */
export const ATAJO_BARRA = { teclas: 'Control+B', texto: 'Ctrl + B' } as const;

export function Shell({
  page,
  onNavigate,
  theme,
  onThemeChange,
  onLock,
  protectionsOk,
  colapsada,
  onToggleBarra,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLock: () => void;
  protectionsOk: boolean | null;
  /** La barra lateral muestra solo los íconos (ADR 043). */
  colapsada: boolean;
  onToggleBarra: () => void;
  children: ReactNode;
}) {
  const idBarra = useId();
  const accion = colapsada ? 'Expandir la barra lateral' : 'Contraer la barra lateral';
  return (
    <div className="flex h-full bg-bg">
      <aside
        id={idBarra}
        aria-label="Barra lateral"
        className={cx(
          'flex h-full shrink-0 flex-col gap-5 overflow-x-hidden overflow-y-auto border-r border-border bg-sidebar py-5',
          'transition-[width,padding] duration-200 ease-out',
          colapsada ? 'w-[76px] px-3' : 'w-64 px-3.5',
        )}
      >
        <div className={cx('flex items-center gap-2.5', colapsada ? 'flex-col' : 'px-2')}>
          <Logo />
          {!colapsada && (
            <span className="flex-1 text-[17px] font-bold tracking-tight">QAtlas</span>
          )}
          <Ayuda texto={`${accion} (${ATAJO_BARRA.texto})`}>
            <BotonAria
              aria-label={accion}
              aria-expanded={!colapsada}
              aria-controls={idBarra}
              // El Button de React Aria no pasa aria-keyshortcuts: se pone en el elemento.
              ref={(boton) => boton?.setAttribute('aria-keyshortcuts', ATAJO_BARRA.teclas)}
              onPress={onToggleBarra}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-text-2 hover:bg-surface-2 hover:text-text data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent"
            >
              <Icon name={colapsada ? 'chevronsRight' : 'chevronsLeft'} size={18} />
            </BotonAria>
          </Ayuda>
        </div>

        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          {MAIN_NAV.map((id) => (
            <NavItem
              key={id}
              id={id}
              current={page === id}
              colapsada={colapsada}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
          <NavItem
            id="privacidad"
            current={page === 'privacidad'}
            colapsada={colapsada}
            onNavigate={onNavigate}
          />
          <NavItem
            id="boveda"
            current={page === 'boveda'}
            colapsada={colapsada}
            onNavigate={onNavigate}
          />
          <Ayuda texto="Bloquear" desactivada={!colapsada}>
            <BotonAria
              onPress={onLock}
              {...(colapsada ? { 'aria-label': 'Bloquear' } : {})}
              className={cx(
                'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-surface font-semibold text-text transition-colors hover:bg-surface-2',
                'data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent',
                colapsada ? 'px-0' : 'px-4',
              )}
            >
              <Icon name="lock" size={16} />
              {!colapsada && 'Bloquear'}
            </BotonAria>
          </Ayuda>
          <SegmentedControl
            label="Tema de la interfaz"
            value={theme}
            options={THEME_OPTIONS}
            onChange={onThemeChange}
            compacto={colapsada}
          />
        </div>
      </aside>

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 px-8 pt-6">
          <nav aria-label="Ubicación" className="flex items-center gap-2 text-muted">
            <span>QAtlas</span>
            <span aria-hidden="true">/</span>
            <span className="text-text">{PAGES[page].label}</span>
          </nav>
          {protectionsOk && (
            <StatusPill icon="shieldCheck">
              Protecciones activas · sin conexiones externas
            </StatusPill>
          )}
        </header>
        <main className="flex flex-col gap-6 px-8 pt-6 pb-10">{children}</main>
      </div>
    </div>
  );
}

/**
 * Un ítem del menú. Colapsado, se ve solo el ícono: el nombre sigue en el árbol accesible (texto
 * oculto) y aparece en una ayuda al pasar el mouse o al enfocar. El activo se distingue por el fondo y
 * por una barra a la izquierda (no solo por color), y lleva aria-current.
 */
function NavItem({
  id,
  current,
  colapsada,
  onNavigate,
}: {
  id: PageId;
  current: boolean;
  colapsada: boolean;
  onNavigate: (page: PageId) => void;
}) {
  const { label, icon } = PAGES[id];
  return (
    <Ayuda texto={label} desactivada={!colapsada}>
      <BotonAria
        {...(current ? { 'aria-current': 'page' as const } : {})}
        onPress={() => {
          onNavigate(id);
        }}
        className={cx(
          'relative flex min-h-10 items-center gap-2.5 rounded-lg text-left whitespace-nowrap transition-colors',
          'data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent',
          colapsada ? 'justify-center px-0' : 'px-3',
          current
            ? 'bg-accent-soft font-semibold text-accent-soft-text before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-accent'
            : 'text-text-2 hover:bg-surface-2 hover:text-text',
        )}
      >
        <Icon name={icon} />
        <span className={colapsada ? 'sr-only' : undefined}>{label}</span>
      </BotonAria>
    </Ayuda>
  );
}
