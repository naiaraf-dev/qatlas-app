import type { ReactNode } from 'react';
import type { ThemePreference } from '@qatlas/shared';
import { Icon, Logo, type IconName } from '../ui/Icon';
import { Button, SegmentedControl, StatusPill, cx } from '../ui/components';

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

export function Shell({
  page,
  onNavigate,
  theme,
  onThemeChange,
  onLock,
  protectionsOk,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onLock: () => void;
  protectionsOk: boolean | null;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full bg-bg">
      <aside className="flex h-full w-64 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-sidebar px-3.5 py-5">
        <div className="flex items-center gap-2.5 px-2">
          <Logo />
          <span className="text-[17px] font-bold tracking-tight">QAtlas</span>
        </div>

        <nav aria-label="Principal" className="flex flex-col gap-0.5">
          {MAIN_NAV.map((id) => (
            <NavItem key={id} id={id} current={page === id} onNavigate={onNavigate} />
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-border pt-4">
          <NavItem id="privacidad" current={page === 'privacidad'} onNavigate={onNavigate} />
          <NavItem id="boveda" current={page === 'boveda'} onNavigate={onNavigate} />
          <Button icon="lock" onClick={onLock}>
            Bloquear
          </Button>
          <SegmentedControl
            label="Tema de la interfaz"
            value={theme}
            options={THEME_OPTIONS}
            onChange={onThemeChange}
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

function NavItem({
  id,
  current,
  onNavigate,
}: {
  id: PageId;
  current: boolean;
  onNavigate: (page: PageId) => void;
}) {
  const { label, icon } = PAGES[id];
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={() => {
        onNavigate(id);
      }}
      className={cx(
        'flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-left transition-colors',
        current
          ? 'bg-accent-soft font-semibold text-accent-soft-text'
          : 'text-text-2 hover:bg-surface-2 hover:text-text',
      )}
    >
      <Icon name={icon} />
      {label}
    </button>
  );
}
