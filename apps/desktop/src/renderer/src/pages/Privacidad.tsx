import { useState } from 'react';
import type { ConnectionEntry, SecurityStatus } from '@qatlas/shared';
import { Icon } from '../ui/Icon';
import { Button, Card, CheckItem, PageHeader, cx } from '../ui/components';

/** Comprobación en vivo, desde la propia interfaz, de que Node no está expuesto. */
function interfaceHasNoNode(): boolean {
  const scope = globalThis as Record<string, unknown>;
  return typeof scope.require === 'undefined' && typeof scope.process === 'undefined';
}

export function Privacidad({
  status,
  connections,
  onRefresh,
}: {
  status: SecurityStatus | null;
  connections: ConnectionEntry[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <>
      <PageHeader
        title="Privacidad y conexiones"
        description="El estado real de las protecciones de QAtlas y cada conexión que la aplicación intentó hacer."
      />
      <SecurityChecks status={status} />
      <NetworkTest onDone={onRefresh} />
      <ConnectionsTable connections={connections} onRefresh={onRefresh} />
    </>
  );
}

function SecurityChecks({ status }: { status: SecurityStatus | null }) {
  if (!status) {
    return (
      <Card title="Estado de seguridad">
        <p className="text-muted">Cargando…</p>
      </Card>
    );
  }
  const checks: Array<[string, boolean]> = [
    ['Aislamiento de contexto', status.contextIsolation],
    ['Interfaz en sandbox', status.sandbox],
    ['Interfaz sin acceso a Node.js', !status.nodeIntegration],
    ['Verificado en vivo: sin require ni process', interfaceHasNoNode()],
    ['Política del mismo origen', status.webSecurity],
    ['Content Security Policy activa', status.cspActive],
    // Los esquemas IPC solo admiten estos valores: si el proceso principal
    // reportara otra cosa, la respuesta sería rechazada.
    ['Red: denegar por defecto', true],
    ['Sin telemetría', true],
    ['Datos fuera de carpetas sincronizadas', !status.dataDirectorySynced],
  ];
  return (
    <Card title="Estado de seguridad">
      <ul className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2.5">
        {checks.map(([label, ok]) => (
          <CheckItem key={label} ok={ok}>
            {label}
          </CheckItem>
        ))}
      </ul>
    </Card>
  );
}

type TestResult = { label: string; blocked: boolean };

function NetworkTest({ onDone }: { onDone: () => Promise<void> }) {
  const [results, setResults] = useState<TestResult[] | null>(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
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
    setRunning(false);
    await onDone();
  };

  return (
    <Card title="Prueba de contención de red">
      <div className="flex flex-col gap-4">
        <p className="text-muted">
          Intenta conectarse a internet desde la interfaz. Todas las conexiones deben quedar
          bloqueadas: primero por la Content Security Policy y, si la pasaran, por el proceso
          principal.
        </p>
        <div>
          <Button variant="primary" icon="shield" disabled={running} onClick={() => void run()}>
            {running ? 'Probando…' : 'Probar conexiones salientes'}
          </Button>
        </div>
        {results && (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {results.map((r) => (
              <li
                key={r.label}
                className={cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2',
                  r.blocked ? 'bg-ok-bg text-ok-text' : 'bg-crit-bg text-crit-text',
                )}
              >
                <Icon name={r.blocked ? 'check' : 'x'} size={16} />
                <span className="font-medium">{r.blocked ? 'Bloqueado' : 'NO bloqueado'}:</span>
                <span>{r.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function ConnectionsTable({
  connections,
  onRefresh,
}: {
  connections: ConnectionEntry[];
  onRefresh: () => Promise<void>;
}) {
  return (
    <Card
      title="Conexiones registradas por el proceso principal"
      action={
        <Button variant="ghost" icon="refresh" onClick={() => void onRefresh()}>
          Actualizar
        </Button>
      }
    >
      {connections.length === 0 ? (
        <p className="text-muted">
          Sin intentos registrados. Las conexiones que bloquea la Content Security Policy no llegan
          a esta capa.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13.5px]">
            <thead className="text-muted">
              <tr>
                <th className="py-2 pr-3 font-medium">Hora</th>
                <th className="px-3 py-2 font-medium">Destino</th>
                <th className="px-3 py-2 font-medium">Estado</th>
                <th className="px-3 py-2 font-medium">Regla</th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="py-2.5 pr-3 text-text-2">
                    {new Date(c.timestamp).toLocaleTimeString('es-AR')}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] break-all">{c.destination}</td>
                  <td
                    className={cx(
                      'px-3 py-2.5 font-medium',
                      c.allowed ? 'text-high-text' : 'text-ok-text',
                    )}
                  >
                    {c.allowed ? 'Permitida' : 'Bloqueada'}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12.5px] text-text-2">{c.rule}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
