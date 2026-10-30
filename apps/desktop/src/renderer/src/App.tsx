import { useCallback, useEffect, useState } from 'react';
import type { ConnectionEntry, SecurityStatus, ThemePreference, VaultStatus } from '@qatlas/shared';
import { Shell, type PageId } from './layout/Shell';
import { BovedaDanada, Desbloqueo, PrimerInicio, RestaurarEnPrimerInicio } from './pages/Acceso';
import { Boveda } from './pages/Boveda';
import { Inicio } from './pages/Inicio';
import { Privacidad } from './pages/Privacidad';
import { Proximamente } from './pages/Proximamente';
import { applyTheme } from './theme';

/**
 * Decide qué se muestra según el estado de la bóveda. Al bloquear, el proceso principal recarga la
 * ventana: todo el estado de la interfaz se descarta y se vuelve a pasar por acá.
 */
export function App() {
  const [boveda, setBoveda] = useState<VaultStatus | null>(null);
  const [theme, setTheme] = useState<ThemePreference>('system');

  const [refrescos, setRefrescos] = useState(0);

  useEffect(() => {
    void (async () => {
      const [estado, apariencia] = await Promise.all([
        window.qatlas.vault.getStatus(),
        window.qatlas.appearance.get(),
      ]);
      if (estado.ok) setBoveda(estado.data);
      if (apariencia.ok) setTheme(apariencia.data.preference);
    })();
  }, [refrescos]);

  // El tema efectivo se aplica en la interfaz; en "Sistema" sigue al sistema operativo.
  useEffect(() => applyTheme(theme), [theme]);

  if (boveda === null) return null;
  const listo = () => {
    setRefrescos((n) => n + 1);
  };

  switch (boveda.estado) {
    case 'sin-boveda':
      return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto bg-bg pb-6">
          <PrimerInicio onListo={listo} />
          <RestaurarEnPrimerInicio onListo={listo} />
        </div>
      );
    case 'danada':
      return <BovedaDanada onListo={listo} />;
    case 'bloqueada':
      return <Desbloqueo estado={boveda} onListo={listo} />;
    case 'desbloqueada':
      return <Principal theme={theme} onThemeChange={setTheme} />;
  }
}

function Principal({
  theme,
  onThemeChange,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
}) {
  const [page, setPage] = useState<PageId>('inicio');
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);

  const refreshConnections = useCallback(async () => {
    const res = await window.qatlas.privacy.listConnections({ limit: 50 });
    if (res.ok) setConnections(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      const statusRes = await window.qatlas.security.getStatus();
      if (statusRes.ok) setStatus(statusRes.data);
      await refreshConnections();
    })();
  }, [refreshConnections]);

  useEffect(() => {
    const atajo = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        void window.qatlas.vault.lock();
      }
    };
    window.addEventListener('keydown', atajo);
    return () => {
      window.removeEventListener('keydown', atajo);
    };
  }, []);

  const changeTheme = async (preference: ThemePreference) => {
    onThemeChange(preference);
    const res = await window.qatlas.appearance.setTheme({ preference });
    if (res.ok) onThemeChange(res.data.preference);
  };

  const protectionsOk =
    status === null
      ? null
      : status.contextIsolation && status.sandbox && !status.nodeIntegration && status.cspActive;

  return (
    <Shell
      page={page}
      onNavigate={setPage}
      theme={theme}
      onThemeChange={(t) => void changeTheme(t)}
      onLock={() => void window.qatlas.vault.lock()}
      protectionsOk={protectionsOk}
    >
      {page === 'inicio' && <Inicio onNavigate={setPage} />}
      {page === 'privacidad' && (
        <Privacidad status={status} connections={connections} onRefresh={refreshConnections} />
      )}
      {page === 'boveda' && <Boveda />}
      {page !== 'inicio' && page !== 'privacidad' && page !== 'boveda' && (
        <Proximamente page={page} />
      )}
    </Shell>
  );
}
