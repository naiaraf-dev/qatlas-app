/**
 * La parte pura de `e2e/sockets.ts` (ADR 045): clasificar direcciones y leer lo que dan Windows y Linux.
 * Las direcciones de red son de documentación (RFC 5737 y RFC 3849), inventadas.
 */
import { describe, expect, it } from 'vitest';
import {
  claseDeDireccion,
  describir,
  direccionDeProc,
  fueraDeLoopback,
  leerSalidaWindows,
  leerTablaProc,
  type Socket,
} from '../e2e/sockets';

describe('Clase de una dirección', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.5.6.7', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['0.0.0.0', '0.0.0.0'],
    ['::', '::'],
    ['192.0.2.10', 'IP de la red'],
    ['2001:db8::5', 'IP de la red'],
    ['fe80::1%12', 'IP de la red'],
  ])('%s → %s', (direccion, clase) => {
    expect(claseDeDireccion(direccion)).toBe(clase);
  });

  it('fuera de loopback deja solo lo que no es loopback, y el mensaje no lleva la dirección', () => {
    const sockets: Socket[] = [
      { protocolo: 'UDP', direccion: '127.0.0.1', puerto: 50000, pid: 10 },
      { protocolo: 'UDP', direccion: '192.0.2.10', puerto: 50001, pid: 10 },
    ];
    const fuera = fueraDeLoopback(sockets);
    expect(fuera).toHaveLength(1);
    expect(fuera.map(describir)).toEqual(['UDP IP de la red puerto 50001']);
    expect(describir(fuera[0] as Socket)).not.toContain('192.0.2.10');
  });
});

describe('Lo que da Windows', () => {
  it('lee las líneas del script y descarta lo demás', () => {
    const salida = ['TCP|0.0.0.0|8080|4242', 'UDP|::|5353|4243', 'una advertencia', ''].join(
      '\r\n',
    );
    expect(leerSalidaWindows(salida)).toEqual([
      { protocolo: 'TCP', direccion: '0.0.0.0', puerto: 8080, pid: 4242 },
      { protocolo: 'UDP', direccion: '::', puerto: 5353, pid: 4243 },
    ]);
  });
});

describe('Lo que da Linux (/proc/<pid>/net)', () => {
  it('direcciones IPv4 e IPv6 en hexadecimal, en el orden del equipo', () => {
    expect(direccionDeProc('0100007F')).toBe('127.0.0.1');
    expect(direccionDeProc('00000000')).toBe('0.0.0.0');
    expect(direccionDeProc('0A0200C0')).toBe('192.0.2.10');
    expect(direccionDeProc('00000000000000000000000000000000')).toBe('::');
    expect(direccionDeProc('00000000000000000000000001000000')).toBe('::1');
    expect(direccionDeProc('0000000000000000FFFF00000100007F')).toBe('::ffff:127.0.0.1');
    expect(direccionDeProc('B80D0120000000000000000005000000')).toBe('2001:db8:0:0:0:0:0:5');
  });

  const CABECERA =
    '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode';
  const fila = (local: string, estado: string, inodo: string) =>
    `   0: ${local} 00000000:0000 ${estado} 00000000:00000000 00:00000000 00000000  1000        0 ${inodo} 1`;

  it('de TCP, solo lo que está en escucha; de UDP, todo; y solo los inodos del proceso', () => {
    const inodos = new Map([
      ['111', 7],
      ['222', 7],
      ['333', 7],
    ]);
    const tcp = [
      CABECERA,
      fila('00000000:1F90', '0A', '111'), // 0.0.0.0:8080 en escucha
      fila('0100007F:1F91', '01', '222'), // establecida: no es una escucha
      fila('00000000:1F92', '0A', '999'), // de otro proceso
    ].join('\n');
    expect(leerTablaProc(tcp, 'TCP', inodos)).toEqual([
      { protocolo: 'TCP', direccion: '0.0.0.0', puerto: 8080, pid: 7 },
    ]);
    const udp = [CABECERA, fila('00000000:14E9', '07', '333')].join('\n');
    expect(leerTablaProc(udp, 'UDP', inodos)).toEqual([
      { protocolo: 'UDP', direccion: '0.0.0.0', puerto: 5353, pid: 7 },
    ]);
  });
});
