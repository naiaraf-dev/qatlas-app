/**
 * El runner y el proxy (especificación 3.7, ADR 016 y 017). Estático y por contrato: lo que no se
 * puede hacer con solo importar otra cosa. Las pruebas con procesos reales están en `e2e/`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MensajeAlRunner, MensajeDelRunner } from '../packages/runner/src/protocolo';

const RAIZ = path.resolve(import.meta.dirname, '..');
const RUNNER = path.join(RAIZ, 'packages/runner/src');

function fuentes(carpeta: string): { nombre: string; texto: string }[] {
  return (readdirSync(carpeta, { recursive: true }) as string[])
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))
    .map((nombre) => ({ nombre, texto: readFileSync(path.join(carpeta, nombre), 'utf8') }));
}

const importaciones = (texto: string): string[] =>
  [
    ...texto.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|^import\s+)['"]([^'"]+)['"]/gm),
  ].map((m) => m[1] as string);

const PROHIBIDOS_EN_EL_MOTOR =
  /^(?:node:)?(?:net|tls|http|https|http2|dgram|dns|dns\/promises|child_process|worker_threads|cluster)$|^electron$/;

const CONFIGURACION = {
  politica: {
    urlBase: 'http://localhost:5173/',
    dominios: ['localhost'],
    sistemaInterno: false,
    puertosLocales: [],
  },
  proxy: { servidor: 'http://127.0.0.1:1', usuario: 'u', clave: 'c' },
  timeoutPaginaMs: 1000,
};
const ESCANEO = {
  tipo: 'escaneo',
  configuracion: CONFIGURACION,
  maxPaginas: 1,
  maxRps: 1,
  soloLectura: true,
  exclusiones: [],
};

describe('El código del motor no abre red ni procesos por su cuenta', () => {
  const motor = fuentes(path.join(RUNNER, 'motor'));

  it('hay código que revisar', () => {
    expect(motor.map((f) => f.nombre).sort()).toEqual([
      'diagnostico.ts',
      'entrada-runner.ts',
      'motor.ts',
    ]);
  });

  it.each(motor)('$nombre no importa red, child_process ni electron', ({ texto }) => {
    expect(importaciones(texto).filter((i) => PROHIBIDOS_EN_EL_MOTOR.test(i))).toEqual([]);
  });

  it('el detector de importaciones detecta lo que dice', () => {
    for (const texto of [
      "import { net } from 'electron';",
      "import x from 'node:http';",
      "const c = require('child_process');",
      "const n = await import('node:net');",
      "import 'tls';",
    ]) {
      expect(importaciones(texto).filter((i) => PROHIBIDOS_EN_EL_MOTOR.test(i))).toHaveLength(1);
    }
  });

  it.each(motor)('$nombre no usa globales de red', ({ texto }) => {
    expect(texto).not.toMatch(/\bfetch\s*\(|new WebSocket\b|process\.binding|getBuiltinModule/);
  });
});

describe('Nada del paquete del runner toca la bóveda', () => {
  it.each(fuentes(RUNNER))('$nombre no importa crypto ni db', ({ texto }) => {
    expect(importaciones(texto).filter((i) => /@qatlas\/(crypto|db)|electron$/.test(i))).toEqual(
      [],
    );
  });

  it('el paquete no depende de ellos', () => {
    const { dependencies } = JSON.parse(
      readFileSync(path.join(RAIZ, 'packages/runner/package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    expect(Object.keys(dependencies).sort()).toEqual(['@qatlas/shared', 'playwright-core', 'zod']);
    expect(dependencies['playwright-core']).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('Contrato con el runner', () => {
  it('acepta un escaneo', () => {
    expect(MensajeAlRunner.safeParse(ESCANEO).success).toBe(true);
  });

  it.each(['claveMaestra', 'claveProyecto', 'rutaBoveda', 'secreto'])(
    'un escaneo con el campo %s se rechaza',
    (campo) => {
      expect(MensajeAlRunner.safeParse({ ...ESCANEO, [campo]: 'x' }).success).toBe(false);
    },
  );

  it('la configuración tampoco acepta campos de más', () => {
    const extra = { ...ESCANEO, configuracion: { ...CONFIGURACION, claveMaestra: 'x' } };
    expect(MensajeAlRunner.safeParse(extra).success).toBe(false);
  });

  it('lo que vuelve del login es solo un resultado: ningún contenido de la página', () => {
    expect(MensajeDelRunner.safeParse({ tipo: 'login-terminado', funciono: true }).success).toBe(
      true,
    );
    for (const campo of ['html', 'texto', 'url', 'titulo', 'error', 'captura']) {
      expect(
        MensajeDelRunner.safeParse({ tipo: 'login-terminado', funciono: false, [campo]: 'x' })
          .success,
      ).toBe(false);
    }
  });

  it('el secreto solo se acepta en bytes y solo en el login', () => {
    const login = {
      tipo: 'login',
      configuracion: CONFIGURACION,
      urlLogin: 'http://localhost:5173/login',
      pasos: [],
      indicador: { tipo: 'aparece', selector: '#x' },
      usuario: 'ana@example.com',
      secreto: new Uint8Array([1]),
    };
    expect(MensajeAlRunner.safeParse(login).success).toBe(true);
    expect(MensajeAlRunner.safeParse({ ...login, secreto: 'texto' }).success).toBe(false);
  });
});

describe('Configuración del navegador', () => {
  const motor = readFileSync(path.join(RUNNER, 'motor/motor.ts'), 'utf8');

  it('el sandbox de Chromium está encendido: Playwright lo trae apagado', () => {
    expect(motor).toContain('chromiumSandbox: true');
    expect(motor).not.toContain('--no-sandbox');
  });

  it('no se saltea el proxy en loopback, y apaga lo que el proxy no ve', () => {
    expect(motor).toContain('--proxy-bypass-list=<-loopback>');
    expect(motor).toContain("'--webrtc-ip-handling-policy=disable_non_proxied_udp'");
    // Esta variante no hace nada, y sin decir nada.
    expect(motor).not.toContain('--force-webrtc-ip-handling-policy');
    expect(motor).toContain('--disable-quic');
  });

  it('los service workers se bloquean y las descargas también', () => {
    expect(motor).toContain("serviceWorkers: 'block'");
    expect(motor).toContain('acceptDownloads: false');
  });

  it('no graba nada: sin video ni traza en el código del motor (EVI-01)', () => {
    expect(motor).not.toMatch(/recordVideo|recordHar|tracing\.start|\.screenshot\(/);
  });

  it('el navegador nunca se descarga solo', () => {
    expect(motor).not.toMatch(/\binstall\b|registry/);
  });
});

describe('Certificados', () => {
  it('aceptar un certificado inválido no es una opción de la app: solo de los tests', () => {
    const carpetas = [RUNNER, path.join(RAIZ, 'apps/desktop/src')];
    const usos = carpetas
      .flatMap(fuentes)
      .filter(({ texto }) =>
        /ignoreHTTPSErrors|ignore-certificate-errors|rejectUnauthorized|NODE_TLS_REJECT_UNAUTHORIZED|setCertificateVerifyProc/.test(
          texto,
        ),
      )
      .map(({ nombre }) => nombre);
    expect(usos).toEqual([]);
  });
});

describe('Procesos', () => {
  const procesos = readFileSync(
    path.join(RAIZ, 'apps/desktop/src/main/ejecuciones/procesos.ts'),
    'utf8',
  );

  it('el entorno y la salida están cerrados, en los dos procesos', () => {
    expect(procesos.match(/env: entornoMinimo\(/g)).toHaveLength(2);
    expect(procesos.match(/stdio: 'ignore'/g)).toHaveLength(2);
  });

  it('el proxy escucha en 127.0.0.1 y en un puerto elegido por el sistema', () => {
    const proxy = readFileSync(path.join(RUNNER, 'red/proxy.ts'), 'utf8');
    expect(proxy).toContain("servidor.listen(0, '127.0.0.1'");
  });
});

describe('.env (ADR 019)', () => {
  it('.gitignore los excluye', () => {
    const ignorados = readFileSync(path.join(RAIZ, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(ignorados).toContain('.env');
    expect(ignorados).toContain('.env.*');
  });
});
