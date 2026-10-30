/**
 * TS-09 — Bloqueo (especificación 3.4, 3.15 y RN-BOV-03).
 *
 * Después del bloqueo ningún dato es accesible y las claves no quedan en el proceso principal ni
 * llegan a la interfaz. El E2E verifica lo mismo en la app real (pantalla y canales IPC).
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANALES_SIN_BOVEDA, IPC_CHANNELS, ipcContract, type IpcChannel } from '@qatlas/shared';
import { DetectorInactividad } from '../apps/desktop/src/main/boveda/inactividad';
import { BovedaBloqueada, ServicioBoveda } from '../apps/desktop/src/main/boveda/servicio';
import { createIpcHandler, makeSenderCheck } from '../apps/desktop/src/main/ipc/create-handler';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';

interface Interno {
  base: { open: boolean } | null;
  maestra: Buffer | null;
}

let carpeta: string;
let boveda: ServicioBoveda;
const interno = () => boveda as unknown as Interno;

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-ts09-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('TS-09 · Claves en el proceso principal', () => {
  it('al bloquear, sobrescribe la clave maestra con ceros y cierra la base', () => {
    const { maestra, base } = interno();
    expect(maestra?.some((b) => b !== 0)).toBe(true);
    expect(base?.open).toBe(true);

    boveda.bloquear();

    expect(maestra?.every((b) => b === 0)).toBe(true);
    expect(base?.open).toBe(false);
    expect(interno().maestra).toBeNull();
    expect(interno().base).toBeNull();
  });

  it('avisa una vez por bloqueo, con las claves ya borradas', async () => {
    boveda.bloquear();
    rmSync(carpeta, { recursive: true, force: true });
    const avisos: boolean[] = [];
    const conAviso = new ServicioBoveda({
      carpeta,
      alBloquear: () => {
        avisos.push((conAviso as unknown as Interno).maestra === null);
      },
    });
    await conAviso.crear(CONTRASENA, false);
    conAviso.bloquear();
    conAviso.bloquear();
    expect(avisos).toEqual([true]);
  });
});

describe('TS-09 · Datos con la bóveda bloqueada', () => {
  it('ninguna operación con datos funciona', async () => {
    boveda.bloquear();
    expect(boveda.estado()).toBe('bloqueada');
    expect(() => boveda.configuracion()).toThrow(BovedaBloqueada);
    expect(() => boveda.cambiarConfiguracion({ tema: 'dark' })).toThrow(BovedaBloqueada);
    expect(() => boveda.lapidas()).toThrow(BovedaBloqueada);
    expect(() => {
      boveda.crearCopia(path.join(carpeta, 'copia.qatlas'));
    }).toThrow(BovedaBloqueada);
    await expect(boveda.restaurar(path.join(carpeta, 'x'), CONTRASENA)).rejects.toThrow(
      BovedaBloqueada,
    );
  });

  it('un desbloqueo en curso no sobrevive a un bloqueo', async () => {
    boveda.bloquear();
    const desbloqueando = boveda.desbloquear(CONTRASENA);
    await Promise.resolve();
    await Promise.resolve();
    boveda.bloquear();
    await desbloqueando;
    expect(boveda.estado()).toBe('bloqueada');
    expect(interno().maestra).toBeNull();
  });
});

describe('TS-09 · Bloqueo automático', () => {
  it('por defecto a los 15 minutos, y solo si no hubo actividad', () => {
    const minutos = boveda.configuracion().bloqueoMinutos;
    expect(minutos).toBe(15);
    const limite = minutos * 60_000;
    const detector = new DetectorInactividad(limite, 0);
    detector.registrarActividad(limite - 1);
    expect(detector.venció(limite)).toBe(false);
    expect(detector.venció(2 * limite - 1)).toBe(true);
  });

  it('el proceso principal bloquea al suspender, al bloquear el sistema y al cerrar', () => {
    const fuente = readFileSync(
      new URL('../apps/desktop/src/main/index.ts', import.meta.url),
      'utf8',
    );
    expect(fuente).toMatch(/powerMonitor\.on\('suspend', bloquear\)/);
    expect(fuente).toMatch(/powerMonitor\.on\('lock-screen', bloquear\)/);
    expect(fuente).toMatch(/app\.on\('before-quit'/);
    // La inactividad la mide el proceso principal: la interfaz no puede evitarla.
    expect(fuente).toMatch(/webContents\.on\('input-event'/);
  });
});

describe('TS-09 · La interfaz con la bóveda bloqueada', () => {
  const APP = 'app://qatlas';
  const opciones = { isAllowedSender: makeSenderCheck([APP]), isVaultLocked: () => true };
  const desdeLaApp = { senderFrame: { url: `${APP}/index.html` } };

  const conDatos = IPC_CHANNELS.filter((canal) => !CANALES_SIN_BOVEDA.has(canal));

  it('los canales permitidos son solo los que no exponen datos', () => {
    expect([...CANALES_SIN_BOVEDA].sort()).toEqual(
      [
        'app:getInfo',
        'appearance:get',
        'security:getStatus',
        'vault:create',
        'vault:getStatus',
        'vault:lock',
        'vault:restoreBackup',
        'vault:unlock',
      ].sort(),
    );
  });

  it.each(conDatos)('rechaza %s antes de ejecutar nada', async (canal: IpcChannel) => {
    const implementacion = vi.fn();
    const handler = createIpcHandler(canal, implementacion as never, opciones);
    expect(await handler(desdeLaApp, undefined)).toEqual({ ok: false, error: 'BOVEDA_BLOQUEADA' });
    expect(implementacion).not.toHaveBeenCalled();
  });

  it('un canal nuevo queda bloqueado por defecto: es una lista de permitidos', () => {
    expect(CANALES_SIN_BOVEDA.has('proyectos:listar')).toBe(false);
  });

  it('ninguna respuesta del contrato de la bóveda puede llevar claves ni la contraseña', () => {
    const secretos = { contrasena: 'x', clave: 'x', maestra: 'x', maestraEnvuelta: 'x' };
    expect(
      ipcContract['vault:getStatus'].response.safeParse({
        estado: 'bloqueada',
        esperaSegundos: 0,
        ...secretos,
      }).success,
    ).toBe(false);
    expect(
      ipcContract['vault:getSettings'].response.safeParse({ bloqueoMinutos: 15, ...secretos })
        .success,
    ).toBe(false);
    expect(
      ipcContract['vault:unlock'].response.safeParse({ resultado: 'desbloqueada', ...secretos })
        .success,
    ).toBe(false);
    expect(
      ipcContract['vault:create'].response.safeParse({ resultado: 'creada', ...secretos }).success,
    ).toBe(false);
  });
});
