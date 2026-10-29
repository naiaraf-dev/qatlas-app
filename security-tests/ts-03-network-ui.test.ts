/**
 * TS-03 (parcial, interfaz) — Salida de red de la ventana de QAtlas.
 *
 * Verifica la segunda capa de la política "denegar por defecto". La prueba
 * completa de TS-03 (servidor que registra conexiones durante el uso de toda
 * la app, incluido el runner) se agrega en la semana 5 junto con el proxy.
 */
import { describe, expect, it } from 'vitest';
import {
  ConnectionLog,
  decideUiRequest,
  sanitizeUrlForLog,
} from '../apps/desktop/src/main/security/network-policy';

const production = { devServerOrigin: undefined };
const development = { devServerOrigin: 'http://localhost:5173' };

describe('TS-03 · Interfaz en producción', () => {
  it.each([
    'app://qatlas/index.html',
    'app://qatlas/assets/index-abc.js',
    'data:image/png;base64,AAAA',
    'blob:app://qatlas/1234',
  ])('permite recursos propios: %s', (url) => {
    expect(decideUiRequest(url, production).allowed).toBe(true);
  });

  it.each([
    'https://example.com/',
    'http://example.com/',
    'https://fonts.googleapis.com/css2?family=Inter',
    'https://cdn.jsdelivr.net/npm/react',
    'wss://example.com/socket',
    'ws://localhost:5173/',
    'http://localhost:5173/',
    'http://127.0.0.1:8080/',
    'ftp://example.com/archivo',
    'file:///C:/Windows/win.ini',
    'app://otro-host/index.html',
    'chrome://settings',
    'devtools://devtools/bundled/inspector.html',
    'no es una url',
  ])('bloquea: %s', (url) => {
    expect(decideUiRequest(url, production).allowed).toBe(false);
  });
});

describe('TS-03 · Interfaz en desarrollo', () => {
  it('permite solo el servidor de Vite (HTTP y WebSocket de recarga)', () => {
    expect(decideUiRequest('http://localhost:5173/src/main.tsx', development).allowed).toBe(true);
    expect(decideUiRequest('ws://localhost:5173/', development).allowed).toBe(true);
  });

  it.each([
    'http://localhost:5174/',
    'http://127.0.0.1:5173/',
    'https://example.com/',
    'http://localhost.evil.com:5173/',
  ])('sigue bloqueando: %s', (url) => {
    expect(decideUiRequest(url, development).allowed).toBe(false);
  });
});

describe('TS-03 · Registro de conexiones', () => {
  it('no guarda credenciales, query string ni fragmento (pueden tener tokens)', () => {
    const clean = sanitizeUrlForLog(
      'https://usuario:clave@api.example.com/v1/datos?token=abc123&api_key=xyz#access_token=jwt',
    );
    expect(clean).toBe('https://api.example.com/v1/datos');
    expect(clean).not.toMatch(/clave|abc123|xyz|jwt|usuario/);
  });

  it('limita la cantidad de entradas en memoria', () => {
    const log = new ConnectionLog(3);
    for (let i = 0; i < 5; i++) {
      log.record({
        origin: 'interfaz',
        url: `https://example.com/${i}`,
        allowed: false,
        rule: 'x',
      });
    }
    const entries = log.list(10);
    expect(entries).toHaveLength(3);
    expect(entries[0]?.destination).toBe('https://example.com/4');
  });
});
