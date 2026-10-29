import { useCallback, useEffect, useState } from 'react';
import type { ConnectionEntry, SecurityStatus, ThemePreference } from '@qatlas/shared';
import { Shell, type PageId } from './layout/Shell';
import { Inicio } from './pages/Inicio';
import { Privacidad } from './pages/Privacidad';
import { Proximamente } from './pages/Proximamente';
import { applyTheme } from './theme';

export function App() {
  const [page, setPage] = useState<PageId>('inicio');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);

  const refreshConnections = useCallback(async () => {
    const res = await window.qatlas.privacy.listConnections({ limit: 50 });
    if (res.ok) setConnections(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      const [statusRes, appearanceRes] = await Promise.all([
        window.qatlas.security.getStatus(),
        window.qatlas.appearance.get(),
      ]);
      if (statusRes.ok) setStatus(statusRes.data);
      if (appearanceRes.ok) setTheme(appearanceRes.data.preference);
      await refreshConnections();
    })();
  }, [refreshConnections]);

  // El tema efectivo se aplica en la interfaz; en "Sistema" sigue al sistema operativo.
  useEffect(() => applyTheme(theme), [theme]);

  const changeTheme = async (preference: ThemePreference) => {
    setTheme(preference);
    const res = await window.qatlas.appearance.setTheme({ preference });
    if (res.ok) setTheme(res.data.preference);
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
      protectionsOk={protectionsOk}
    >
      {page === 'inicio' && <Inicio onNavigate={setPage} />}
      {page === 'privacidad' && (
        <Privacidad status={status} connections={connections} onRefresh={refreshConnections} />
      )}
      {page !== 'inicio' && page !== 'privacidad' && <Proximamente page={page} />}
    </Shell>
  );
}
