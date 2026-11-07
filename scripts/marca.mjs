/**
 * Íconos de QAtlas a partir de los SVG de `docs/marca/` (la fuente). Sin dependencias nuevas: renderiza
 * con el Chromium de Playwright, que ya es parte del proyecto, y arma el ICO a mano (PNG dentro de ICO).
 * Los archivos generados se versionan; esto se corre solo cuando cambia la marca.
 *
 *   node scripts/marca.mjs --limpiar   quita los metadatos de las imágenes de docs/marca y resources
 *   node scripts/marca.mjs --generar   genera resources/icon.ico, icon.png (1024) e icon-512.png
 *
 * Tamaños del ICO: 16, 24 y 32 con `icono-app-chico.svg` (trazos más gruesos, para que se lean), y 48,
 * 64 y 256 con `icono-app.svg`.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esPng, limpiarPng, limpiarSvg, metadatosDe } from './metadatos-imagenes.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARCA = path.join(RAIZ, 'docs/marca');
const RECURSOS = path.join(RAIZ, 'apps/desktop/resources');

function limpiarCarpeta(carpeta) {
  for (const nombre of readdirSync(carpeta)) {
    const ruta = path.join(carpeta, nombre);
    const extension = path.extname(nombre).slice(1).toLowerCase();
    const datos = readFileSync(ruta);
    if (extension === 'svg') writeFileSync(ruta, limpiarSvg(datos.toString('utf8')));
    else if (extension === 'png' && esPng(datos)) writeFileSync(ruta, limpiarPng(datos));
    else continue;
    const quedan = metadatosDe(readFileSync(ruta), extension);
    console.log(
      `[marca] ${path.relative(RAIZ, ruta)}: ${quedan.length === 0 ? 'limpio' : quedan.join(', ')}`,
    );
  }
}

/** ICO con las imágenes en PNG (Windows Vista en adelante), de menor a mayor. */
function armarIco(imagenes) {
  const cabecera = Buffer.alloc(6 + imagenes.length * 16);
  cabecera.writeUInt16LE(0, 0);
  cabecera.writeUInt16LE(1, 2);
  cabecera.writeUInt16LE(imagenes.length, 4);
  let desplazamiento = cabecera.length;
  imagenes.forEach(({ tamano, png }, i) => {
    const e = 6 + i * 16;
    cabecera[e] = tamano >= 256 ? 0 : tamano;
    cabecera[e + 1] = tamano >= 256 ? 0 : tamano;
    cabecera[e + 2] = 0;
    cabecera[e + 3] = 0;
    cabecera.writeUInt16LE(1, e + 4);
    cabecera.writeUInt16LE(32, e + 6);
    cabecera.writeUInt32LE(png.length, e + 8);
    cabecera.writeUInt32LE(desplazamiento, e + 12);
    desplazamiento += png.length;
  });
  return Buffer.concat([cabecera, ...imagenes.map(({ png }) => png)]);
}

async function generar() {
  const requerir = createRequire(path.join(RAIZ, 'packages/runner/package.json'));
  const { chromium } = requerir('playwright-core');
  const navegador = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
    // Sin red: el SVG va en línea como data URL.
    await pagina.route('**/*', (ruta) => ruta.abort());
    const renderizar = async (archivo, tamano) => {
      const svg = limpiarSvg(readFileSync(path.join(MARCA, archivo), 'utf8'));
      const url = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      await pagina.setViewportSize({ width: tamano, height: tamano });
      await pagina.setContent(
        `<!doctype html><html><body style="margin:0;background:transparent"><img id="i" src="${url}" width="${tamano}" height="${tamano}" style="display:block"></body></html>`,
      );
      await pagina.locator('#i').evaluate((img) => img.decode());
      const png = await pagina.screenshot({
        omitBackground: true,
        clip: { x: 0, y: 0, width: tamano, height: tamano },
      });
      return limpiarPng(png);
    };
    const ico = [];
    for (const tamano of [16, 24, 32])
      ico.push({ tamano, png: await renderizar('icono-app-chico.svg', tamano) });
    for (const tamano of [48, 64, 256])
      ico.push({ tamano, png: await renderizar('icono-app.svg', tamano) });
    writeFileSync(path.join(RECURSOS, 'icon.ico'), armarIco(ico));
    writeFileSync(path.join(RECURSOS, 'icon.png'), await renderizar('icono-app.svg', 1024));
    writeFileSync(path.join(RECURSOS, 'icon-512.png'), await renderizar('icono-app.svg', 512));
    console.log(
      '[marca] Generados icon.ico (16, 24, 32, 48, 64, 256), icon.png (1024) e icon-512.png.',
    );
  } finally {
    await navegador.close();
  }
}

const argumentos = process.argv.slice(2);
if (argumentos.includes('--limpiar')) {
  limpiarCarpeta(MARCA);
  limpiarCarpeta(RECURSOS);
}
if (argumentos.includes('--generar')) await generar();
if (!argumentos.includes('--limpiar') && !argumentos.includes('--generar')) {
  console.error('Uso: node scripts/marca.mjs --limpiar | --generar');
  process.exit(1);
}
