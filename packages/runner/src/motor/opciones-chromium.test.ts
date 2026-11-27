import { describe, expect, it } from 'vitest';
import {
  ARGUMENTOS_CHROMIUM,
  FUNCIONES_APAGADAS_POR_PLAYWRIGHT,
  FUNCIONES_APAGADAS_POR_QATLAS,
  opcionesChromium,
} from './opciones-chromium';

/** Chromium se queda con el último `--disable-features`: lo que vale de verdad. */
const funcionesEfectivas = (args: readonly string[]) =>
  (
    args
      .filter((a) => a.startsWith('--disable-features='))
      .at(-1)
      ?.slice('--disable-features='.length) ?? ''
  ).split(',');

describe('opcionesChromium', () => {
  it('el Chromium verificado, con su sandbox y sin ventana', () => {
    expect(opcionesChromium()).toMatchObject({
      channel: 'chromium',
      headless: true,
      chromiumSandbox: true,
    });
  });

  it('un solo --disable-features, con lo de Playwright y lo de QAtlas', () => {
    const { args } = opcionesChromium({ funcionesApagadas: ['WebRtcHideLocalIpsWithMdns'] });
    expect(args.filter((a) => a.startsWith('--disable-features'))).toHaveLength(1);
    expect(funcionesEfectivas(args)).toEqual(
      expect.arrayContaining([
        ...FUNCIONES_APAGADAS_POR_PLAYWRIGHT,
        ...FUNCIONES_APAGADAS_POR_QATLAS,
        'WebRtcHideLocalIpsWithMdns',
      ]),
    );
    // Lo que trajo el CI: AI Mode a www.google.com y la hora de red a clients2.google.com.
    expect(funcionesEfectivas(args)).toEqual(
      expect.arrayContaining(['AimEnabled', 'NetworkTimeServiceQuerying']),
    );
  });

  it('los argumentos de la app también traen la lista completa', () => {
    expect(ARGUMENTOS_CHROMIUM.filter((a) => a.startsWith('--disable-features'))).toHaveLength(1);
    expect(funcionesEfectivas(ARGUMENTOS_CHROMIUM)).toEqual(
      expect.arrayContaining([...FUNCIONES_APAGADAS_POR_PLAYWRIGHT]),
    );
  });

  it('no deja pisar las funciones con un argumento suelto', () => {
    for (const argumento of ['--disable-features=Algo', '--enable-features=AimEnabled']) {
      expect(() => opcionesChromium({ argumentos: [argumento] })).toThrow('funcionesApagadas');
    }
    // Control: otros argumentos pasan.
    expect(opcionesChromium({ argumentos: ['--enable-quic'] }).args).toContain('--enable-quic');
  });

  it('el proxy, con los nombres de Playwright', () => {
    expect(
      opcionesChromium({ proxy: { servidor: 'http://127.0.0.1:1', usuario: 'u', clave: 'c' } })
        .proxy,
    ).toEqual({ server: 'http://127.0.0.1:1', username: 'u', password: 'c' });
    expect(opcionesChromium().proxy).toBeUndefined();
  });

  it('los controles de los tests sacan solo lo que dicen', () => {
    const base = opcionesChromium();
    expect(base.args).toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    const sinRed = opcionesChromium({ control: { sinArgumentosDeRed: true } });
    expect(sinRed.args).not.toContain('--webrtc-ip-handling-policy=disable_non_proxied_udp');
    expect(sinRed.args).not.toContain('--disable-quic');
    expect(sinRed.chromiumSandbox).toBe(true);
    expect(funcionesEfectivas(sinRed.args)).toContain('AimEnabled');
    expect(opcionesChromium({ control: { sinSandbox: true } }).chromiumSandbox).toBe(false);
    const encendida = opcionesChromium({ control: { funcionesEncendidas: ['AimEnabled'] } });
    expect(funcionesEfectivas(encendida.args)).not.toContain('AimEnabled');
    expect(funcionesEfectivas(encendida.args)).toContain('NetworkTimeServiceQuerying');
    expect(base.args).not.toContain('--disable-3d-apis');
    expect(opcionesChromium({ control: { sinWebGL: true } }).args).toContain('--disable-3d-apis');
  });

  it('sin WebGL por software: saca el --enable-unsafe-swiftshader de Playwright', () => {
    expect(opcionesChromium().ignoreDefaultArgs).toEqual(['--enable-unsafe-swiftshader']);
    expect(opcionesChromium({ headless: false }).ignoreDefaultArgs).toEqual([
      '--enable-unsafe-swiftshader',
    ]);
    const conSwiftshader = opcionesChromium({ control: { conSwiftshader: true } });
    expect(conSwiftshader.ignoreDefaultArgs).toEqual([]);
    expect(conSwiftshader.args).toContain('--use-angle=swiftshader');
    expect(opcionesChromium().args).not.toContain('--use-angle=swiftshader');
  });

  it('lo que Playwright 1.65 dejó de apagar, lo apaga QAtlas', () => {
    const { args } = opcionesChromium();
    expect(funcionesEfectivas(args)).toEqual(
      expect.arrayContaining(['Translate', 'DialMediaRouteProvider']),
    );
    expect(args).toContain('--disable-client-side-phishing-detection');
  });
});
