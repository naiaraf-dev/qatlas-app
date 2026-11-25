/**
 * El OCR de TS-06 y TS-01 (ADR 039): que nunca descarga nada, que lee lo que se ve, y que no entra en la
 * app. Sin esto, un TS-06 «sin el canario en los fotogramas» podría pasar porque el OCR no lee nada.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import { opcionesChromium } from '../packages/runner/src/motor/opciones-chromium';
import {
  ESTILO_FUENTE,
  FAMILIA_CONTROL,
  leerFuenteDeControl,
  RUTA_FUENTE,
} from '../apps/sandbox-site/src/servidor.mjs';
import { contiene, crearOcr, normalizar } from './ocr';
import { vigilarProcesos } from './procesos';

test.describe.configure({ timeout: 120_000 });

test('sin los datos locales, el OCR intenta descargar y falla: la red está bloqueada', async () => {
  // Sin `langPath`, tesseract.js los pediría a un CDN. El worker no tiene red: falla.
  await expect(crearOcr({ trabajadores: 1, langPath: '' })).rejects.toThrow('qatlas-ocr: sin red');
});

test('con los datos locales, lee el texto de una captura de Chromium', async () => {
  // El Chromium verificado por hash (ADR 020), como todos: nunca el headless shell.
  const navegador = await chromium.launch(opcionesChromium());
  const ocr = await crearOcr({ trabajadores: 1 });
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 720 } });
    const texto = 'CANARIO-OCR-7310-QZX';
    // Con la fuente empaquetada del sandbox, no la del sistema: lee lo mismo en Windows y en Linux.
    // Se sirve desde la memoria del test, sin red.
    const origen = 'http://ocr.example.test';
    await pagina.route(`${origen}/**`, (ruta) => {
      const esFuente = new URL(ruta.request().url()).pathname === RUTA_FUENTE;
      return ruta.fulfill(
        esFuente
          ? { contentType: 'font/woff2', body: leerFuenteDeControl() }
          : {
              contentType: 'text/html; charset=utf-8',
              body: `<!doctype html><head>${ESTILO_FUENTE}</head><body style="font-family:${FAMILIA_CONTROL}"><p style="font-size:40px">${texto}</p><p style="font-size:20px">Otra línea</p></body>`,
            },
      );
    });
    await pagina.goto(`${origen}/`);
    expect(await pagina.evaluate(() => document.fonts.check("40px 'QAtlas Control'"))).toBe(true);
    const leido = await ocr.leer(await pagina.screenshot({ type: 'jpeg', quality: 70 }));
    expect(contiene(leido, texto)).toBe(true);
    // Y no encuentra lo que no está.
    expect(contiene(leido, 'CANARIO-OCR-9999-ABC')).toBe(false);
  } finally {
    await ocr.cerrar();
    await navegador.close();
  }
});

test('la comparación tolera las confusiones típicas, sin volverse ciega', () => {
  expect(normalizar('Canario-0cr I5')).toBe('CANAR10OCR15'.replace(/O/g, '0'));
  expect(contiene('CANARI0-0CR-731O-QZX', 'CANARIO-OCR-7310-QZX')).toBe(true);
  expect(contiene('texto sin nada', 'CANARIO-OCR-7310-QZX')).toBe(false);
});

test('tesseract.js no entra en la app: ni en sus dependencias ni en el build', () => {
  const raiz = path.resolve(import.meta.dirname, '..');
  const paquete = JSON.parse(
    readFileSync(path.join(raiz, 'apps/desktop/package.json'), 'utf8'),
  ) as Record<string, Record<string, string> | undefined>;
  for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    expect(Object.keys(paquete[campo] ?? {}).join(' '), campo).not.toMatch(/tesseract/);
  }
  // El build existe (los E2E corren después de `npm run build`): si no, este test no prueba nada.
  const salida = path.join(raiz, 'apps/desktop/out');
  expect(existsSync(salida)).toBe(true);
  const conTesseract: string[] = [];
  const recorrer = (carpeta: string) => {
    for (const nombre of readdirSync(carpeta)) {
      const ruta = path.join(carpeta, nombre);
      if (statSync(ruta).isDirectory()) recorrer(ruta);
      else if (/tesseract|traineddata/i.test(nombre) || readFileSync(ruta).includes('tesseract')) {
        conTesseract.push(path.relative(salida, ruta));
      }
    }
  };
  recorrer(salida);
  expect(conTesseract).toEqual([]);
});

// Último: corre después de los afterAll del archivo (e2e/procesos.ts).
vigilarProcesos(test, import.meta.filename);
