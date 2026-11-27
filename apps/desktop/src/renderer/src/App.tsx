import { useCallback, useEffect, useState } from 'react';
import type {
  BarraLateral,
  ConnectionEntry,
  SecurityStatus,
  ThemePreference,
  VaultStatus,
} from '@qatlas/shared';
import { Shell, type PageId } from './layout/Shell';
import { BovedaDanada, Desbloqueo, PrimerInicio, RestaurarEnPrimerInicio } from './pages/Acceso';
import { Boveda } from './pages/Boveda';
import { Inicio } from './pages/Inicio';
import { Privacidad } from './pages/Privacidad';
import { Proximamente } from './pages/Proximamente';
import { Bandeja } from './pages/hallazgos/Bandeja';
import { EjecucionesTodas } from './pages/hallazgos/EjecucionesTodas';
import { Escaneos } from './pages/hallazgos/Escaneos';
import { Proyectos, type VistaProyectos } from './pages/proyectos/Proyectos';
import { Reportes } from './pages/reportes/Reportes';
import { applyTheme } from './theme';

/**
 * Decide qué se muestra según el estado de la bóveda. Al bloquear, el proceso principal recarga la
 * ventana: todo el estado de la interfaz se descarta y se vuelve a pasar por acá.
 */
export function App() {
  const [boveda, setBoveda] = useState<VaultStatus | null>(null);
  const [theme, setTheme] = useState<ThemePreference>('system');
  // Con la bóveda bloqueada, el principal responde «expandida»: la preferencia está cifrada.
  const [barra, setBarra] = useState<BarraLateral>('expandida');

  const [refrescos, setRefrescos] = useState(0);

  useEffect(() => {
    void (async () => {
      const [estado, apariencia] = await Promise.all([
        window.qatlas.vault.getStatus(),
        window.qatlas.appearance.get(),
      ]);
      if (estado.ok) setBoveda(estado.data);
      if (apariencia.ok) {
        setTheme(apariencia.data.preference);
        setBarra(apariencia.data.barraLateral);
      }
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
      return (
        <Principal theme={theme} onThemeChange={setTheme} barra={barra} onBarraChange={setBarra} />
      );
  }
}

/**
 * Un campo donde se escribe: ahí Ctrl+B no colapsa la barra (sería sorprendente mientras se tipea).
 */
function esEditable(elemento: Element | null): boolean {
  if (!(elemento instanceof HTMLElement)) return false;
  if (elemento.isContentEditable || elemento instanceof HTMLTextAreaElement) return true;
  if (!(elemento instanceof HTMLInputElement)) return false;
  const noEscritura = ['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'];
  return !noEscritura.includes(elemento.type) && !elemento.readOnly && !elemento.disabled;
}

function Principal({
  theme,
  onThemeChange,
  barra,
  onBarraChange,
}: {
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  barra: BarraLateral;
  onBarraChange: (barra: BarraLateral) => void;
}) {
  const [page, setPage] = useState<PageId>('inicio');
  const [vistaInicial, setVistaInicial] = useState<VistaProyectos>({ tipo: 'lista' });
  // El reporte recién creado desde Hallazgos se abre directo.
  const [reporteInicial, setReporteInicial] = useState<string | null>(null);
  // Volver a tocar el menú abre la lista, aunque ya se esté en la página.
  const [visita, setVisita] = useState(0);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);

  const refreshConnections = useCallback(async () => {
    const res = await window.qatlas.privacy.listConnections({ limit: 200 });
    if (res.ok) setConnections(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      const statusRes = await window.qatlas.security.getStatus();
      if (statusRes.ok) setStatus(statusRes.data);
      await refreshConnections();
    })();
  }, [refreshConnections]);

  const alternarBarra = useCallback(() => {
    const nueva: BarraLateral = barra === 'expandida' ? 'colapsada' : 'expandida';
    onBarraChange(nueva);
    // Se guarda cifrada, como el tema. Si falla, la interfaz queda como la dejó la persona.
    void window.qatlas.appearance.setBarraLateral({ estado: nueva });
  }, [barra, onBarraChange]);

  useEffect(() => {
    const atajo = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        void window.qatlas.vault.lock();
        return;
      }
      // Ctrl+B: colapsar o expandir la barra lateral, salvo escribiendo en un campo.
      if (
        event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !event.metaKey &&
        event.key.toLowerCase() === 'b' &&
        !esEditable(document.activeElement)
      ) {
        event.preventDefault();
        alternarBarra();
      }
    };
    window.addEventListener('keydown', atajo);
    return () => {
      window.removeEventListener('keydown', atajo);
    };
  }, [alternarBarra]);

  const changeTheme = async (preference: ThemePreference) => {
    onThemeChange(preference);
    const res = await window.qatlas.appearance.setTheme({ preference });
    if (res.ok) onThemeChange(res.data.preference);
  };

  const navegar = (destino: PageId) => {
    setVistaInicial({ tipo: 'lista' });
    setReporteInicial(null);
    setVisita((n) => n + 1);
    setPage(destino);
  };

  const abrirProyecto = (id: string) => {
    setVistaInicial({ tipo: 'detalle', id });
    setVisita((n) => n + 1);
    setPage('proyectos');
  };

  const protectionsOk =
    status === null
      ? null
      : status.contextIsolation && status.sandbox && !status.nodeIntegration && status.cspActive;

  return (
    <Shell
      page={page}
      onNavigate={navegar}
      theme={theme}
      onThemeChange={(t) => void changeTheme(t)}
      onLock={() => void window.qatlas.vault.lock()}
      protectionsOk={protectionsOk}
      colapsada={barra === 'colapsada'}
      onToggleBarra={alternarBarra}
    >
      {page === 'inicio' && (
        <Inicio
          onNavigate={navegar}
          onCrearProyecto={() => {
            setVistaInicial({ tipo: 'nuevo' });
            setVisita((n) => n + 1);
            setPage('proyectos');
          }}
        />
      )}
      {page === 'proyectos' && <Proyectos key={visita} inicial={vistaInicial} />}
      {page === 'privacidad' && (
        <Privacidad status={status} connections={connections} onRefresh={refreshConnections} />
      )}
      {page === 'boveda' && <Boveda />}
      {page === 'hallazgos' && (
        <Bandeja
          key={visita}
          onAbrirReporte={(id) => {
            setReporteInicial(id);
            setVisita((n) => n + 1);
            setPage('reportes');
          }}
        />
      )}
      {page === 'reportes' && <Reportes key={visita} inicial={reporteInicial} />}
      {page === 'ejecuciones' && <EjecucionesTodas key={visita} onAbrirProyecto={abrirProyecto} />}
      {page === 'escaneos' && <Escaneos key={visita} onAbrirProyecto={abrirProyecto} />}
      {(page === 'casos' || page === 'uat') && (
        <Proximamente
          page={page}
          onIrAProyectos={() => {
            navegar('proyectos');
          }}
        />
      )}
    </Shell>
  );
}
