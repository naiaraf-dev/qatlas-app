/**
 * El árbol de procesos, por PID y hora de creación (e2e/procesos.ts). Sin Playwright: se prueba con
 * Vitest (security-tests/e2e-procesos.test.ts).
 *
 * El PID solo no alcanza: Windows reutiliza los PID, y un proceso conserva el PID de su padre aunque el
 * padre haya muerto. Si ese número se reasigna a un proceso del test, el árbol «adoptaría» procesos ajenos
 * (pasó con la terminal que lanzó la corrida). Por eso un proceso se identifica por PID y hora de
 * creación, y un hijo cuenta solo si se creó después que su padre.
 */
import { spawnSync } from 'node:child_process';

export interface Proceso {
  pid: number;
  ppid: number;
  /** Milisegundos desde 1970. */
  creado: number;
  nombre: string;
}

/** Diferencia entre la época de FILETIME (1601) y la de Unix, en milisegundos. */
const DE_1601_A_1970_MS = 11_644_473_600_000;

/**
 * Todos los procesos del sistema: PID, padre, creación y nombre del ejecutable (solo para informar).
 * Sin el proceso que hace la lista ni sus hijos: no los lanzó el test.
 */
export function procesos(): Proceso[] {
  const windows = process.platform === 'win32';
  const [comando, args] = windows
    ? [
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) $($_.Name)" }',
        ],
      ]
    : ['ps', ['-eo', 'pid=,ppid=,etimes=,comm=']];
  const ahora = Date.now();
  const resultado = spawnSync(comando, args, { encoding: 'utf8', windowsHide: true });
  if (resultado.status !== 0) throw new Error('No se pudo listar los procesos');
  // Windows da la creación en unidades de 100 ns desde 1601; Linux, los segundos que lleva vivo.
  const creado = (valor: number) =>
    windows ? Math.floor(valor / 10_000) - DE_1601_A_1970_MS : ahora - valor * 1000;
  const propio = resultado.pid;
  return leer(resultado.stdout, creado).filter((p) => p.pid !== propio && p.ppid !== propio);
}

function leer(salida: string, creado: (valor: number) => number): Proceso[] {
  return salida
    .split(/\r?\n/)
    .map((linea) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(linea))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      creado: creado(Number(m[3])),
      nombre: (m[4] ?? '').trim(),
    }));
}

/** Margen para la creación: los relojes de Linux (`etimes`) tienen resolución de un segundo. */
const MARGEN_MS = process.platform === 'win32' ? 0 : 1000;

/**
 * Los descendientes de `raiz`, por PID de padre. Un hijo se cuenta solo si se creó después que el padre:
 * si no, su padre murió y el PID es de otro proceso.
 */
export function descendientes(todos: readonly Proceso[], raiz: number): Proceso[] {
  const porPid = new Map(todos.map((p) => [p.pid, p]));
  const hijos = new Map<number, Proceso[]>();
  for (const p of todos) hijos.set(p.ppid, [...(hijos.get(p.ppid) ?? []), p]);
  const salida: Proceso[] = [];
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    const padre = pendientes.pop() ?? -1;
    const creadoPadre = porPid.get(padre)?.creado ?? 0;
    for (const hijo of hijos.get(padre) ?? []) {
      if (hijo.pid === raiz || salida.some((p) => p.pid === hijo.pid)) continue;
      if (hijo.creado + MARGEN_MS < creadoPadre) continue;
      salida.push(hijo);
      pendientes.push(hijo.pid);
    }
  }
  return salida;
}

/** La identidad de un proceso: el PID solo se reutiliza. */
export const identidad = (p: Pick<Proceso, 'pid' | 'creado'>) =>
  `${String(p.pid)}@${String(p.creado)}`;
