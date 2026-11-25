/**
 * El árbol de procesos, por PID (e2e/procesos.ts). Sin Playwright: se prueba con Vitest
 * (security-tests/e2e-procesos.test.ts).
 */
import { spawnSync } from 'node:child_process';

export interface Proceso {
  pid: number;
  ppid: number;
  nombre: string;
}

/**
 * Todos los procesos del sistema: PID, padre y nombre del ejecutable (solo para informar). Sin el
 * proceso que hace la lista ni sus hijos: no los lanzó el test.
 */
export function procesos(): Proceso[] {
  const [comando, args] =
    process.platform === 'win32'
      ? [
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }',
          ],
        ]
      : ['ps', ['-eo', 'pid=,ppid=,comm=']];
  const resultado = spawnSync(comando, args, { encoding: 'utf8', windowsHide: true });
  if (resultado.status !== 0) throw new Error('No se pudo listar los procesos');
  const todos = leer(resultado.stdout);
  const propio = resultado.pid;
  return todos.filter((p) => p.pid !== propio && p.ppid !== propio);
}

function leer(salida: string): Proceso[] {
  return salida
    .split(/\r?\n/)
    .map((linea) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(linea))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), nombre: (m[3] ?? '').trim() }));
}

/** Los descendientes de `raiz`, por PID de padre. */
export function descendientes(todos: readonly Proceso[], raiz: number): Proceso[] {
  const hijos = new Map<number, Proceso[]>();
  for (const p of todos) hijos.set(p.ppid, [...(hijos.get(p.ppid) ?? []), p]);
  const salida: Proceso[] = [];
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    for (const hijo of hijos.get(pendientes.pop() ?? -1) ?? []) {
      if (hijo.pid === raiz || salida.some((p) => p.pid === hijo.pid)) continue;
      salida.push(hijo);
      pendientes.push(hijo.pid);
    }
  }
  return salida;
}
