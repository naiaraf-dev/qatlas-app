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
  maxProfundidad: 1,
  maxMinutos: 1,
  maxRps: 1,
  soloLectura: true,
  exclusiones: [],
  autenticacion: null,
  sesionPrevia: null,
  evidencias: {
    video: true,
    snapshots: true,
    capturas: true,
    traza: true,
    selectoresSensibles: [],
    enmascararFormularios: false,
    maxCapturas: 200,
  },
};
const AUTENTICACION = {
  estrategia: 'formulario',
  urlLogin: 'http://localhost:5173/login',
  pasos: [],
  indicador: { tipo: 'aparece', selector: '#x' },
  usuario: 'ana@example.com',
  dominiosAutenticacion: [],
  sesionMaxMs: null,
  permitirLoginHttp: true,
};

describe('El código del motor no abre red ni procesos por su cuenta', () => {
  const motor = fuentes(path.join(RUNNER, 'motor'));

  it('hay código que revisar', () => {
    expect(motor.map((f) => f.nombre).sort()).toEqual([
      'chequeos.ts',
      'crawler.ts',
      'diagnostico.ts',
      'entrada-runner.ts',
      'gestor-sesion.ts',
      'grabacion.ts',
      'motor.ts',
      'runner.ts',
      'sesion.ts',
      'urls.ts',
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
    // La redacción es pura: sin red, sin archivos, sin la bóveda (ADR 030).
    expect(Object.keys(dependencies).sort()).toEqual([
      '@qatlas/redaction',
      '@qatlas/shared',
      'axe-core',
      'playwright-core',
      'zod',
    ]);
    expect(dependencies['playwright-core']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dependencies['axe-core']).toMatch(/^\d+\.\d+\.\d+$/);
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
    expect(
      MensajeDelRunner.safeParse({ tipo: 'login-terminado', resultado: 'funciono' }).success,
    ).toBe(true);
    for (const campo of ['html', 'texto', 'url', 'titulo', 'error', 'captura']) {
      expect(
        MensajeDelRunner.safeParse({ tipo: 'login-terminado', resultado: 'fallo', [campo]: 'x' })
          .success,
      ).toBe(false);
      expect(
        MensajeDelRunner.safeParse({ tipo: 'sesion', resultado: 'fallo', [campo]: 'x' }).success,
      ).toBe(false);
    }
  });

  it('el secreto solo se acepta en bytes, y solo en la prueba y en los datos de un login', () => {
    const probar = {
      tipo: 'probar-login',
      configuracion: CONFIGURACION,
      autenticacion: AUTENTICACION,
      politicaDelEscaneo: CONFIGURACION.politica,
      secreto: new Uint8Array([1]),
    };
    const datos = {
      tipo: 'datos-login',
      proxy: CONFIGURACION.proxy,
      politica: CONFIGURACION.politica,
      secreto: new Uint8Array([1]),
    };
    for (const mensaje of [probar, datos]) {
      expect(MensajeAlRunner.safeParse(mensaje).success).toBe(true);
      expect(MensajeAlRunner.safeParse({ ...mensaje, secreto: null }).success).toBe(true);
      expect(MensajeAlRunner.safeParse({ ...mensaje, secreto: 'texto' }).success).toBe(false);
    }
    // La autenticación del escaneo no tiene dónde llevarlo.
    expect(
      MensajeAlRunner.safeParse({
        ...ESCANEO,
        autenticacion: { ...AUTENTICACION, secreto: 'x' },
      }).success,
    ).toBe(false);
  });

  it('el estado de sesión que vuelve tiene forma fija y límites', () => {
    const estado = { cookies: [], origins: [] };
    const sesion = { tipo: 'sesion', resultado: 'ok', estado, urlComprobacion: 'http://x.test/' };
    expect(MensajeDelRunner.safeParse(sesion).success).toBe(true);
    expect(
      MensajeDelRunner.safeParse({ ...sesion, estado: { ...estado, indexedDB: [] } }).success,
    ).toBe(false);
    expect(
      MensajeDelRunner.safeParse({
        ...sesion,
        estado: {
          cookies: [],
          origins: [{ origin: 'x', localStorage: [{ name: 'a', value: 'x'.repeat(70_000) }] }],
        },
      }).success,
    ).toBe(false);
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

  it('nunca usa la grabación de Playwright, que escribe en disco en claro (ADR 036 y 037)', () => {
    for (const { nombre, texto } of fuentes(path.join(RUNNER, 'motor'))) {
      expect(texto, nombre).not.toMatch(/recordVideo|recordHar|tracing\.start|\.tracing\b/);
    }
  });

  it('solo grabacion.ts captura la pantalla, y en memoria: sin ruta ni archivo (6 del alcance)', () => {
    for (const { nombre, texto } of fuentes(path.join(RUNNER, 'motor'))) {
      if (nombre === 'grabacion.ts') continue;
      expect(texto, nombre).not.toMatch(/\.screenshot\(|screencast/);
    }
    const grabacion = readFileSync(path.join(RUNNER, 'motor/grabacion.ts'), 'utf8');
    expect(grabacion).not.toMatch(/path:|from 'node:fs'|writeFile|createWriteStream/);
  });

  it('el login nunca se graba: sesion.ts y gestor-sesion.ts no conocen la grabación (EVI-01)', () => {
    for (const archivo of ['sesion.ts', 'gestor-sesion.ts', 'motor.ts']) {
      const texto = readFileSync(path.join(RUNNER, 'motor', archivo), 'utf8');
      expect(texto, archivo).not.toMatch(/grabacion|Grabacion/);
    }
    // La grabación se vincula solo a las páginas del crawler.
    const crawler = readFileSync(path.join(RUNNER, 'motor/crawler.ts'), 'utf8');
    expect(crawler.match(/grabacion\?\.vincular\(/g)?.length).toBe(2);
  });

  it('cada contexto, también los de login y la ventana del asistido, bloquea service workers y descargas', () => {
    const sesion = readFileSync(path.join(RUNNER, 'motor/sesion.ts'), 'utf8');
    const contextos = sesion.match(/\.newContext\(\{[^}]*\}/gs) ?? [];
    expect(sesion.match(/\.newContext\(/g)?.length).toBe(2);
    expect(sesion.match(/serviceWorkers: 'block'/g)?.length).toBe(2);
    expect(sesion.match(/acceptDownloads: false/g)?.length).toBe(2);
    expect(contextos.length).toBeGreaterThan(0);
  });

  it('el navegador con ventana tiene el mismo sandbox y los mismos argumentos', () => {
    const visible =
      /export async function abrirNavegadorVisible[\s\S]*?\n}\n/.exec(motor)?.[0] ?? '';
    expect(visible).toContain('chromiumSandbox: true');
    expect(visible).toContain('args: [...ARGUMENTOS_CHROMIUM]');
    expect(visible).toContain('headless: false');
    // Es un perfil persistente: el contexto lo crea acá, con lo mismo que los demás.
    expect(visible).toContain("serviceWorkers: 'block'");
    expect(visible).toContain('acceptDownloads: false');
    expect(visible).toContain('permissions: []');
  });

  it('la ventana del asistido tiene el gestor de contraseñas apagado, y su perfil se borra (ADR 028)', () => {
    const visible =
      /export async function abrirNavegadorVisible[\s\S]*?\n}\n/.exec(motor)?.[0] ?? '';
    const preferencias =
      /export const PREFERENCIAS_VENTANA = \{[\s\S]*?\n\} as const;/.exec(motor)?.[0] ?? '';
    for (const clave of [
      'credentials_enable_service: false',
      'credentials_enable_autosignin: false',
      'password_manager_enabled: false',
      'password_manager_leak_detection: false',
    ]) {
      expect(preferencias).toContain(clave);
    }
    expect(preferencias).not.toContain('true');
    expect(visible).toContain('JSON.stringify(PREFERENCIAS_VENTANA)');
    expect(visible).toContain('launchPersistentContext(perfil');
    // En la carpeta de la ejecución, nunca en el temporal del sistema (ADR 018).
    expect(visible).toContain("mkdtemp(path.join(carpetaPerfil, 'asistido-'))");
    expect(motor).not.toMatch(/tmpdir/);
    const entrada = readFileSync(path.join(RUNNER, 'motor/entrada-runner.ts'), 'utf8');
    expect(entrada).toContain('carpetaPerfil: process.cwd()');
    const procesos = readFileSync(
      path.join(RAIZ, 'apps/desktop/src/main/ejecuciones/procesos.ts'),
      'utf8',
    );
    expect(procesos).toContain('cwd: perfil,');
    expect(visible.match(/borrarPerfil\(\)/g)?.length).toBe(2);
  });

  it('el navegador nunca se descarga solo', () => {
    expect(motor).not.toMatch(/\binstall\b|registry/);
  });
});

describe('Accesibilidad en un mundo aislado (ADR 021)', () => {
  const crawler = readFileSync(path.join(RUNNER, 'motor/crawler.ts'), 'utf8');

  it('axe se inyecta con CDP en un mundo aislado, nunca en el de la página', () => {
    expect(crawler).toContain('Page.createIsolatedWorld');
    expect(crawler).not.toMatch(
      /addScriptTag|addInitScript|page\.evaluate\(axe|@axe-core\/playwright/,
    );
  });

  it('el escaneo no lee el contenido de la página para mandarlo, salvo en el detalle', () => {
    expect(crawler).not.toMatch(/\.content\(\)|innerHTML|outerHTML/);
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

  it('las variables de pantalla van solo al runner, y la lista es de nombres exactos (ADR 028)', () => {
    // El proxy: entorno mínimo sin agregados.
    expect(procesos).toContain('env: entornoMinimo(process.env, {}),');
    expect(procesos.match(/variablesDePantalla\(/g)).toHaveLength(1);
    const runner =
      /iniciarRunner:[\s\S]*?utilityProcess\.fork[\s\S]*?\}\);/.exec(procesos)?.[0] ?? '';
    expect(runner).toContain('...variablesDePantalla(process.env, process.platform),');
    const perfiles = readFileSync(
      path.join(RAIZ, 'apps/desktop/src/main/ejecuciones/perfiles.ts'),
      'utf8',
    );
    expect(perfiles).toContain(
      "const VARIABLES_DE_PANTALLA_LINUX = ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY'] as const;",
    );
    // Se leen por nombre, nunca recorriendo el entorno del padre.
    expect(perfiles).not.toMatch(
      /Object\.(keys|entries)\(origen\)|startsWith|RegExp|for \(const \w+ in origen/,
    );
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
