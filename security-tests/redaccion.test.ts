/**
 * Redacción y logs técnicos (EVI-03, EVI-04, 3.13; ADR 030 a 034): análisis estático de que nada del
 * sitio llega a la base, a la interfaz o a un log sin pasar por la redacción. Las pruebas de
 * comportamiento están en `packages/redaction`, `apps/desktop/src/main/ejecuciones/redaccion.test.ts`,
 * `registro.test.ts` y, de punta a punta, en `e2e/ts-01-canario.e2e.ts`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { valorPermitido } from '../apps/desktop/src/main/registro';

const RAIZ = path.resolve(import.meta.dirname, '..');
/** Una llamada, no la palabra: «console.error» también es el nombre de un tipo de hallazgo. */
const LLAMADA_A_CONSOLA = /\bconsole\.(?:log|warn|error|info|debug|trace)\s*\(/;

function archivos(carpeta: string): { archivo: string; codigo: string }[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = path.join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    if (!/\.tsx?$/.test(nombre) || nombre.endsWith('.test.ts')) return [];
    return [{ archivo: path.relative(RAIZ, ruta), codigo: readFileSync(ruta, 'utf8') }];
  });
}

describe('Logs técnicos (ADR 034)', () => {
  it('el proceso principal no escribe a la consola fuera de registrar()', () => {
    const fuera = archivos(path.join(RAIZ, 'apps/desktop/src/main'))
      .filter(({ archivo }) => !archivo.endsWith(path.join('main', 'registro.ts')))
      .filter(({ codigo }) => LLAMADA_A_CONSOLA.test(codigo))
      .map(({ archivo }) => archivo);
    expect(fuera).toEqual([]);
  });

  it('el runner, el proxy y la redacción no escriben a la consola (sus procesos van sin stdio)', () => {
    const fuera = ['packages/runner/src', 'packages/redaction/src']
      .flatMap((carpeta) => archivos(path.join(RAIZ, carpeta)))
      .filter(({ codigo }) => LLAMADA_A_CONSOLA.test(codigo))
      .map(({ archivo }) => archivo);
    expect(fuera).toEqual([]);
    const procesos = readFileSync(
      path.join(RAIZ, 'apps/desktop/src/main/ejecuciones/procesos.ts'),
      'utf8',
    );
    expect(procesos.match(/stdio: 'ignore'/g)).toHaveLength(2);
  });

  it('una URL o un host nunca pasan, aunque estén redactados', () => {
    for (const valor of [
      'https://app.example.test/?token=[REDACTADO:parametro]',
      '[REDACTADO:credencial].example.test',
      'app.example.test:443',
      'localhost',
    ]) {
      expect(valorPermitido(valor), valor).toBe(false);
    }
  });

  it('los logs van dentro de la carpeta de datos', () => {
    const index = readFileSync(path.join(RAIZ, 'apps/desktop/src/main/index.ts'), 'utf8');
    expect(index).toContain("iniciarRegistro({ carpeta: path.join(dataDirectory, 'logs')");
  });
});

describe('Texto del sitio: solo redactado (ADR 032)', () => {
  it('las columnas con texto del sitio exigen TextoRedactado', () => {
    const esquema = readFileSync(path.join(RAIZ, 'packages/db/src/esquema.ts'), 'utf8');
    for (const columna of [
      "url: text('url').$type<TextoRedactado>()",
      "titulo: text('titulo').$type<TextoRedactado>()",
      "descripcion: text('descripcion').$type<TextoRedactado>()",
      "clave: text('clave').$type<TextoRedactado>()",
      "urlOrigen: text('url_origen').$type<TextoRedactado>()",
      "destino: text('destino').$type<TextoRedactado>()",
    ]) {
      expect(esquema, columna).toContain(columna);
    }
  });

  it('nadie fuera del paquete de redacción fabrica un TextoRedactado', () => {
    const fuera = ['apps', 'packages']
      .flatMap((carpeta) => archivos(path.join(RAIZ, carpeta)))
      .filter(({ archivo }) => !archivo.startsWith(path.join('packages', 'redaction')))
      .filter(({ codigo }) => /as TextoRedactado|comoRedactado/.test(codigo))
      .map(({ archivo }) => archivo);
    expect(fuera).toEqual([]);
  });

  it('el detalle de un hallazgo se cifra recién redactado, y la clave de un mensaje es un HMAC', () => {
    const servicio = readFileSync(
      path.join(RAIZ, 'apps/desktop/src/main/ejecuciones/servicio.ts'),
      'utf8',
    );
    expect(servicio).toContain('detalle.texto,');
    expect(servicio).not.toMatch(/hallazgo\.detalle,\n\s*\)/);
    expect(servicio).toContain('claveDeMensaje(enCurso.subclaveHallazgos');
    const runner = readFileSync(path.join(RAIZ, 'packages/runner/src/motor/runner.ts'), 'utf8');
    expect(runner).toContain('hallazgo: redactarHallazgo(hallazgo)');
  });

  it('lo guardado antes se redacta al abrir la base, también al restaurar', () => {
    const boveda = readFileSync(
      path.join(RAIZ, 'apps/desktop/src/main/boveda/servicio.ts'),
      'utf8',
    );
    expect(boveda).toMatch(/private activar[\s\S]*?this\.opciones\.alAbrir\?\.\(base, maestra\)/);
    const index = readFileSync(path.join(RAIZ, 'apps/desktop/src/main/index.ts'), 'utf8');
    expect(index).toContain('redactarLoGuardado(base, maestra)');
  });
});
