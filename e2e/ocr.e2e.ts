/**
 * El OCR de TS-06 y TS-01 (ADR 039): que nunca descarga nada, que lee lo que se ve, y que no entra en la
 * app. Sin esto, un TS-06 «sin el canario en los fotogramas» podría pasar porque el OCR no lee nada.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { chromium } from 'playwright-core';
import { contiene, crearOcr, normalizar } from './ocr';

test.describe.configure({ timeout: 120_000 });

test('sin los datos locales, el OCR intenta descargar y falla: la red está bloqueada', async () => {
  // Sin `langPath`, tesseract.js los pediría a un CDN. El worker no tiene red: falla.
  await expect(crearOcr({ trabajadores: 1, langPath: '' })).rejects.toThrow('qatlas-ocr: sin red');
});

test('con los datos locales, lee el texto de una captura de Chromium', async () => {
  const navegador = await chromium.launch();
  const ocr = await crearOcr({ trabajadores: 1 });
  try {
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 720 } });
    const texto = 'CANARIO-OCR-7310-QZX';
    await pagina.setContent(
      `<p style="font:40px monospace">${texto}</p><p style="font:20px sans-serif">Otra línea</p>`,
    );
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
