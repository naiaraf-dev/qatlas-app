import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { AppInfo, ConnectionEntry, SecurityStatus } from '@qatlas/shared';

/**
 * Pantalla inicial de la estructura base: muestra el estado REAL de los
 * controles de seguridad y permite comprobar que la interfaz no puede salir a
 * internet. Se reemplaza por el asistente de primer inicio en la semana 3.
 */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [connections, setConnections] = useState<ConnectionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshConnections = useCallback(async () => {
    const res = await window.qatlas.privacy.listConnections({ limit: 20 });
    if (res.ok) setConnections(res.data);
  }, []);

  useEffect(() => {
    void (async () => {
      const [infoRes, statusRes] = await Promise.all([
        window.qatlas.app.getInfo(),
        window.qatlas.security.getStatus(),
      ]);
      if (infoRes.ok) setInfo(infoRes.data);
      if (statusRes.ok) setStatus(statusRes.data);
      if (!infoRes.ok || !statusRes.ok) setError('No se pudo leer el estado de la aplicación.');
      await refreshConnections();
    })();
  }, [refreshConnections]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header>
        <h1 className="text-3xl font-bold text-sky-400">QAtlas</h1>
        <p className="text-slate-400">
          Testing de aplicaciones web · local-first · cifrado · sin telemetría
        </p>
        {info && (
          <p className="mt-1 text-xs text-slate-500">
            v{info.version} · Electron {info.electron} · {info.platform}
            {info.isPackaged ? '' : ' · modo desarrollo'}
          </p>
        )}
      </header>

      {error && (
        <p role="alert" className="rounded border border-red-500 bg-red-950 p-3 text-red-200">
          {error}
        </p>
      )}

      <SecurityPanel status={status} />
      <NetworkTest onDone={refreshConnections} />
      <ConnectionsPanel connections={connections} onRefresh={refreshConnections} />
    </main>
  );
}

function SecurityPanel({ status }: { status: SecurityStatus | null }) {
  if (!status) return <Card title="Estado de seguridad">Cargando…</Card>;
  const checks: Array<[string, boolean]> = [
    ['Aislamiento de contexto', status.contextIsolation],
    ['Sandbox de la interfaz', status.sandbox],
    ['Interfaz sin acceso a Node.js', !status.nodeIntegration],
    ['Verificado en vivo: sin require ni process', interfaceHasNoNode()],
    ['Política del mismo origen', status.webSecurity],
    ['Content Security Policy activa', status.cspActive],
    // Los esquemas solo admiten estos valores: si el proceso principal
    // reportara otra cosa, la respuesta IPC sería rechazada.
    ['Red: denegar por defecto', true],
    ['Sin telemetría', true],
    ['Datos fuera de carpetas sincronizadas', !status.dataDirectorySynced],
  ];
  return (
    <Card title="Estado de seguridad">
      <ul className="grid gap-2 sm:grid-cols-2">
        {checks.map(([label, ok]) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden="true" className={ok ? 'text-emerald-400' : 'text-red-400'}>
              {ok ? '✔' : '✖'}
            </span>
            <span>{label}</span>
            <span className="sr-only">{ok ? 'correcto' : 'con problemas'}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Comprobación en vivo, desde la propia interfaz, de que Node no está expuesto. */
function interfaceHasNoNode(): boolean {
  const scope = globalThis as Record<string, unknown>;
  return typeof scope.require === 'undefined' && typeof scope.process === 'undefined';
}

type TestResult = { label: string; blocked: boolean };

function NetworkTest({ onDone }: { onDone: () => Promise<void> }) {
  const [results, setResults] = useState<TestResult[] | null>(null);

  const run = async () => {
    const attempts: Array<[string, () => Promise<unknown>]> = [
      ['fetch a https://example.com', () => fetch('https://example.com')],
      ['imagen de un dominio externo', () => loadImage('https://example.com/pixel.png')],
      ['WebSocket externo', () => openSocket('wss://example.com/socket')],
    ];
    const out: TestResult[] = [];
    for (const [label, attempt] of attempts) {
      try {
        await attempt();
        out.push({ label, blocked: false });
      } catch {
        out.push({ label, blocked: true });
      }
    }
    setResults(out);
    await onDone();
  };

  return (
    <Card title="Prueba de contención de red">
      <p className="mb-3 text-sm text-slate-400">
        Intenta conectarse a internet desde la interfaz. Todas las conexiones deben quedar
        bloqueadas: primero por la CSP y, si la pasaran, por el proceso principal.
      </p>
      <button
        type="button"
        onClick={() => void run()}
        className="rounded bg-sky-600 px-4 py-2 font-medium hover:bg-sky-500 focus:outline-2 focus:outline-offset-2 focus:outline-sky-300"
      >
        Probar conexiones salientes
      </button>
      {results && (
        <ul className="mt-3 space-y-1" aria-live="polite">
          {results.map((r) => (
            <li key={r.label} className={r.blocked ? 'text-emerald-300' : 'text-red-300'}>
              {r.blocked ? '✔ Bloqueado' : '✖ NO bloqueado'}: {r.label}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConnectionsPanel({
  connections,
  onRefresh,
}: {
  connections: ConnectionEntry[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <Card title="Conexiones registradas por el proceso principal">
      <button
        type="button"
        onClick={() => void onRefresh()}
        className="mb-3 text-sm text-sky-400 underline hover:text-sky-300"
      >
        Actualizar
      </button>
      {connections.length === 0 ? (
        <p className="text-sm text-slate-400">
          Sin intentos registrados. Las conexiones que bloquea la CSP no llegan a esta capa.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1">Hora</th>
              <th>Destino</th>
              <th>Estado</th>
              <th>Regla</th>
            </tr>
          </thead>
          <tbody>
            {connections.map((c) => (
              <tr key={c.id} className="border-t border-slate-700">
                <td className="py-1">{new Date(c.timestamp).toLocaleTimeString('es-AR')}</td>
                <td className="font-mono break-all">{c.destination}</td>
                <td className={c.allowed ? 'text-amber-300' : 'text-emerald-300'}>
                  {c.allowed ? 'Permitida' : 'Bloqueada'}
                </td>
                <td className="font-mono">{c.rule}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-slate-700 bg-slate-800/60 p-5"
    >
      <h2 id={headingId} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve();
    };
    img.onerror = () => {
      reject(new Error('bloqueada'));
    };
    img.src = src;
  });
}

function openSocket(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const socket = new WebSocket(url);
      socket.onopen = () => {
        socket.close();
        resolve();
      };
      socket.onerror = () => {
        reject(new Error('bloqueado'));
      };
    } catch (e) {
      reject(e instanceof Error ? e : new Error('bloqueado'));
    }
  });
}
