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
  /**
   * El destino, si el socket está conectado. `null`: el sistema no lo informa (UDP en Windows). Un UDP sin
   * conectar tiene 0.0.0.0:0 o [::]:0.
   */
  remoto?: { direccion: string; puerto: number } | null;
  /** Linux: el estado de `/proc/net` (`0A` en escucha, `01` conectado, `07` cerrado). Windows: el de TCP. */
  estado?: string;
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

/** Privadas y de enlace local (RFC 1918, 169.254/16, fc00::/7, fe80::/10): son de la red del equipo. */
function esPrivada(direccion: string): boolean {
  const d = direccion.toLowerCase().replace(/^::ffff:/, '');
  return (
    /^10\./.test(d) ||
    /^192\.168\./.test(d) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(d) ||
    /^169\.254\./.test(d) ||
    /^f[cd][0-9a-f]{2}:/.test(d) ||
    /^fe[89ab][0-9a-f]:/.test(d)
  );
}

/**
 * Una dirección para el log público del CI: las IP de la red del equipo, solo por su clase; las públicas,
 * las de comodín y las de loopback, tal cual (no son del equipo).
 */
export function direccionParaElLog(direccion: string, local: boolean): string {
  if (claseDeDireccion(direccion) !== 'IP de la red') return direccion;
  if (local) return 'IP de la red (local)';
  return esPrivada(direccion) ? 'IP privada' : direccion;
}

const ESTADOS_PROC: Record<Protocolo, Record<string, string>> = {
  TCP: { '01': 'conectado', '0A': 'en escucha', '06': 'TIME_WAIT', '07': 'cerrado' },
  UDP: { '01': 'conectado', '07': 'sin conectar' },
};

/**
 * Todo lo que se sabe de un socket, para el log cuando el test falla: protocolo, local, remoto y estado.
 * Sin PID ni nada de la máquina.
 */
export function detallar(s: Socket): string {
  const local = `${direccionParaElLog(s.direccion, true)} puerto ${String(s.puerto)}`;
  const remoto =
    s.remoto === undefined || s.remoto === null
      ? 'no lo informa el sistema'
      : `${direccionParaElLog(s.remoto.direccion, false)} puerto ${String(s.remoto.puerto)}`;
  const estado = s.estado ? (ESTADOS_PROC[s.protocolo][s.estado] ?? s.estado) : 'sin dato';
  return `${s.protocolo} · local ${local} · remoto ${remoto} · estado ${estado}`;
}

/**
 * Las líneas del script de Windows: `TCP|dirección|puerto|pid|remota|puerto remoto|estado`, y
 * `UDP|dirección|puerto|pid`: Get-NetUDPEndpoint no da el destino, así que en Windows no se sabe si un UDP
 * está conectado.
 */
export function leerSalidaWindows(salida: string): Socket[] {
  return salida
    .split(/\r?\n/)
    .map((linea) =>
      /^(TCP|UDP)\|([^|]+)\|(\d+)\|(\d+)(?:\|([^|]*)\|(\d*)\|([^|]*))?$/.exec(linea.trim()),
    )
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      protocolo: m[1] as Protocolo,
      direccion: m[2] ?? '',
      puerto: Number(m[3]),
      pid: Number(m[4]),
      remoto: m[5] ? { direccion: m[5], puerto: Number(m[6] || 0) } : null,
      ...(m[7] ? { estado: m[7] } : {}),
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
    const [, local, remota, estado, , , , , , inodo] = campos;
    if (!local || !inodo || !inodos.has(inodo)) continue;
    if (protocolo === 'TCP' && estado !== '0A') continue;
    const [hex, puerto] = local.split(':');
    const [hexRemota, puertoRemoto] = (remota ?? '').split(':');
    salida.push({
      protocolo,
      direccion: direccionDeProc(hex ?? ''),
      puerto: parseInt(puerto ?? '0', 16),
      pid: inodos.get(inodo) ?? 0,
      remoto: {
        direccion: direccionDeProc(hexRemota ?? ''),
        puerto: parseInt(puertoRemoto ?? '0', 16),
      },
      estado: estado ?? '',
    });
  }
  return salida;
}

function enWindows(pids: readonly number[]): Socket[] {
  const lista = pids.join(',');
  const script = `$ids = @(${lista})
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ids -contains [int]$_.OwningProcess } | ForEach-Object { "TCP|$($_.LocalAddress)|$($_.LocalPort)|$($_.OwningProcess)|$($_.RemoteAddress)|$($_.RemotePort)|$($_.State)" }
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
