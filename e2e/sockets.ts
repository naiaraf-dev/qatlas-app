/**
 * Los sockets en escucha de un conjunto de procesos, por PID (ADR 045). Sin Playwright: la parte pura se
 * prueba con Vitest (`security-tests/sockets-escucha.test.ts`).
 *
 * - TCP: los que están en escucha (`Listen`, estado `0A` en Linux).
 * - UDP: todos los ligados. UDP no tiene escucha: un socket ligado recibe lo que llegue a su dirección.
 *
 * Windows: `Get-NetTCPConnection` y `Get-NetUDPEndpoint`. Linux: los `socket:[inodo]` de
 * `/proc/<pid>/fd`, cruzados con `/proc/<pid>/net/{tcp,tcp6,udp,udp6}` (el espacio de red del proceso).
 *
 * Los mensajes no llevan la dirección cuando es del equipo: solo su clase. Los logs del CI son públicos.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, readlinkSync } from 'node:fs';

export type Protocolo = 'TCP' | 'UDP';
export type ClaseDeDireccion = 'loopback' | '0.0.0.0' | '::' | 'IP de la red';

export interface Socket {
  protocolo: Protocolo;
  direccion: string;
  puerto: number;
  pid: number;
}

/** Loopback: 127.0.0.0/8, ::1 y las IPv4 de loopback escritas como IPv6 (::ffff:127.x.x.x). */
export function claseDeDireccion(direccion: string): ClaseDeDireccion {
  const d = direccion.toLowerCase().replace(/%.*$/, '');
  if (d === '0.0.0.0' || d === '::ffff:0.0.0.0') return '0.0.0.0';
  if (d === '::' || d === '0:0:0:0:0:0:0:0') return '::';
  if (/^127\./.test(d) || /^::ffff:127\./.test(d) || d === '::1' || d === '0:0:0:0:0:0:0:1') {
    return 'loopback';
  }
  return 'IP de la red';
}

/** Lo que el test no admite: todo socket que no sea de loopback. */
export const fueraDeLoopback = (sockets: readonly Socket[]): Socket[] =>
  sockets.filter((s) => claseDeDireccion(s.direccion) !== 'loopback');

/** Para el mensaje de un test: protocolo, clase y puerto, sin la dirección. */
export const describir = (s: Socket): string =>
  `${s.protocolo} ${claseDeDireccion(s.direccion)} puerto ${String(s.puerto)}`;

/** Las líneas `TCP|dirección|puerto|pid` del script de Windows. */
export function leerSalidaWindows(salida: string): Socket[] {
  return salida
    .split(/\r?\n/)
    .map((linea) => /^(TCP|UDP)\|([^|]+)\|(\d+)\|(\d+)$/.exec(linea.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      protocolo: m[1] as Protocolo,
      direccion: m[2] ?? '',
      puerto: Number(m[3]),
      pid: Number(m[4]),
    }));
}

/**
 * Una dirección de `/proc/net/*` en hexadecimal: IPv4 en orden de bytes del equipo (little-endian, como
 * x86 y ARM), IPv6 en cuatro palabras de 32 bits, cada una así.
 */
export function direccionDeProc(hex: string): string {
  const bytes = (palabra: string) =>
    (palabra.match(/../g) ?? []).map((b) => parseInt(b, 16)).reverse();
  if (hex.length === 8) return bytes(hex).join('.');
  const todos = (hex.match(/.{8}/g) ?? []).flatMap(bytes);
  if (todos.slice(0, 10).every((b) => b === 0) && todos[10] === 0xff && todos[11] === 0xff) {
    return `::ffff:${todos.slice(12).join('.')}`;
  }
  const grupos: string[] = [];
  for (let i = 0; i < 16; i += 2)
    grupos.push((((todos[i] ?? 0) << 8) | (todos[i + 1] ?? 0)).toString(16));
  const texto = grupos.join(':');
  if (texto === '0:0:0:0:0:0:0:0') return '::';
  if (texto === '0:0:0:0:0:0:0:1') return '::1';
  return texto;
}

/**
 * Las filas de una tabla de `/proc/<pid>/net/{tcp,udp}[6]` cuyo inodo está en `inodos`. De TCP, solo las
 * que están en escucha (estado `0A`).
 */
export function leerTablaProc(
  tabla: string,
  protocolo: Protocolo,
  inodos: ReadonlyMap<string, number>,
): Socket[] {
  const salida: Socket[] = [];
  for (const linea of tabla.split('\n').slice(1)) {
    const campos = linea.trim().split(/\s+/);
    const [, local, , estado, , , , , , inodo] = campos;
    if (!local || !inodo || !inodos.has(inodo)) continue;
    if (protocolo === 'TCP' && estado !== '0A') continue;
    const [hex, puerto] = local.split(':');
    salida.push({
      protocolo,
      direccion: direccionDeProc(hex ?? ''),
      puerto: parseInt(puerto ?? '0', 16),
      pid: inodos.get(inodo) ?? 0,
    });
  }
  return salida;
}

function enWindows(pids: readonly number[]): Socket[] {
  const lista = pids.join(',');
  const script = `$ids = @(${lista})
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess } | ForEach-Object { "TCP|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }
Get-NetUDPEndpoint -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess } | ForEach-Object { "UDP|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)" }`;
  const resultado = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (resultado.status !== 0) throw new Error('No se pudieron listar los sockets');
  return leerSalidaWindows(resultado.stdout);
}

function enLinux(pids: readonly number[]): Socket[] {
  const salida: Socket[] = [];
  for (const pid of pids) {
    const inodos = new Map<string, number>();
    let descriptores: string[];
    try {
      descriptores = readdirSync(`/proc/${String(pid)}/fd`);
    } catch {
      continue; // Terminó entre la lista de procesos y esta lectura.
    }
    for (const fd of descriptores) {
      try {
        const m = /^socket:\[(\d+)\]$/.exec(readlinkSync(`/proc/${String(pid)}/fd/${fd}`));
        if (m?.[1]) inodos.set(m[1], pid);
      } catch {
        // El descriptor se cerró mientras se leía.
      }
    }
    if (inodos.size === 0) continue;
    for (const [archivo, protocolo] of [
      ['tcp', 'TCP'],
      ['tcp6', 'TCP'],
      ['udp', 'UDP'],
      ['udp6', 'UDP'],
    ] as const) {
      try {
        const tabla = readFileSync(`/proc/${String(pid)}/net/${archivo}`, 'utf8');
        salida.push(...leerTablaProc(tabla, protocolo, inodos));
      } catch {
        // Sin IPv6, o el proceso terminó.
      }
    }
  }
  return salida;
}

/** Los sockets TCP en escucha y UDP ligados de estos procesos. */
export function socketsDe(pids: readonly number[]): Socket[] {
  if (pids.length === 0) return [];
  if (process.platform === 'win32') return enWindows(pids);
  if (process.platform === 'linux') return enLinux(pids);
  throw new Error(`Listar sockets no está implementado en ${process.platform}`);
}
