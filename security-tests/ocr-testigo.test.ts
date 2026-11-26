/**
 * El testigo de los «no aparece» con OCR (ADR 039, e2e/ocr-texto.ts): una imagen solo cuenta como revisada
 * si el OCR leyó el testigo en ella. Si no, la aserción falla como «no se pudo comprobar» en lugar de dar
 * por bueno que el secreto no está. Y el sandbox pone el testigo en toda página HTML.
 */
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  conTestigoEnHtml,
  instalarTestigo,
  TESTIGO_OCR,
} from '../apps/sandbox-site/src/testigo.mjs';
import { clasificar, contiene, veredicto } from '../e2e/ocr-texto';

const SECRETO = 'CANARIO-TS01-482915';
const leida = (texto: string) => ({ texto, uniforme: false });

describe('OCR: el testigo', () => {
  it('cada imagen se clasifica: vacía, con el secreto, sin testigo o comprobada', () => {
    expect(clasificar({ texto: '', uniforme: true }, [SECRETO], TESTIGO_OCR)).toBe('vacia');
    expect(clasificar(leida(`${TESTIGO_OCR} ${SECRETO}`), [SECRETO], TESTIGO_OCR)).toBe(
      'con-secreto',
    );
    // Un secreto leído pesa aunque no se haya leído el testigo.
    expect(clasificar(leida(SECRETO), [SECRETO], TESTIGO_OCR)).toBe('con-secreto');
    expect(clasificar(leida('Ficha de cliente'), [SECRETO], TESTIGO_OCR)).toBe('sin-testigo');
    expect(clasificar(leida(`Ficha ${TESTIGO_OCR}`), [SECRETO], TESTIGO_OCR)).toBe('comprobada');
    // Con las confusiones típicas del OCR (O por 0), el testigo se reconoce igual.
    expect(clasificar(leida('TEST1G0 0CR 2468'), [SECRETO], TESTIGO_OCR)).toBe('comprobada');
  });

  it('una imagen sin testigo hace que no se pueda comprobar, aunque las otras estén bien', () => {
    const r = veredicto(
      [leida(`A ${TESTIGO_OCR}`), leida('texto suelto, sin testigo'), leida(`B ${TESTIGO_OCR}`)],
      [SECRETO],
      TESTIGO_OCR,
    );
    expect(r.resultado).toBe('no-comprobable');
    expect(r.porClase['sin-testigo']).toEqual([1]);
  });

  it('solo imágenes vacías, o ninguna imagen: no se puede comprobar', () => {
    expect(veredicto([], [SECRETO], TESTIGO_OCR).resultado).toBe('no-comprobable');
    expect(veredicto([{ texto: '', uniforme: true }], [SECRETO], TESTIGO_OCR).resultado).toBe(
      'no-comprobable',
    );
  });

  it('el secreto leído en cualquier imagen gana: secreto visible', () => {
    const r = veredicto(
      [leida(TESTIGO_OCR), leida('sin testigo'), leida(`${TESTIGO_OCR} ${SECRETO}`)],
      [SECRETO],
      TESTIGO_OCR,
    );
    expect(r.resultado).toBe('secreto-visible');
  });

  it('control: todo leído, con testigo y sin el secreto, es limpio; las vacías no molestan', () => {
    const r = veredicto(
      [leida(`Inicio ${TESTIGO_OCR}`), { texto: '', uniforme: true }, leida(TESTIGO_OCR)],
      [SECRETO, 'otro-dato'],
      TESTIGO_OCR,
    );
    expect(r.resultado).toBe('limpio');
    expect(r.porClase.vacia).toEqual([1]);
    expect(contiene('nada que ver', TESTIGO_OCR)).toBe(false);
  });
});

describe('Sandbox: el testigo en toda página HTML', () => {
  it('va justo después de <body>, o donde el navegador abre el cuerpo', () => {
    expect(conTestigoEnHtml('<html><body class="x"><p>Hola</p></body></html>')).toMatch(
      /<body class="x"><style>.*data-qatlas-testigo.*<p>Hola/s,
    );
    expect(conTestigoEnHtml('<!doctype html><title>T</title><p>Hola</p>')).toMatch(
      /<\/title><style>.*TESTIGO OCR 2468.*<p>Hola/s,
    );
    expect(conTestigoEnHtml('<p>suelto</p>').startsWith('<style>')).toBe(true);
  });

  it('en las respuestas HTML, con el content-length corregido; lo demás pasa sin tocar', async () => {
    const servidor = createServer((req, res) => {
      instalarTestigo(res);
      if (req.url === '/html') {
        const cuerpo = '<!doctype html><body><p>Hola</p></body>';
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-length': Buffer.byteLength(cuerpo),
        });
        res.end(cuerpo);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"a":1}');
      }
    });
    await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
    const puerto = (servidor.address() as AddressInfo).port;
    const pedir = (ruta: string) =>
      new Promise<{ cuerpo: string; largo: string | undefined }>((listo, fallar) => {
        request({ host: '127.0.0.1', port: puerto, path: ruta }, (res) => {
          let cuerpo = '';
          res.setEncoding('utf8');
          res.on('data', (t: string) => (cuerpo += t));
          res.on('end', () => {
            listo({ cuerpo, largo: res.headers['content-length'] });
          });
        })
          .on('error', fallar)
          .end();
      });
    try {
      const html = await pedir('/html');
      expect(html.cuerpo).toContain(TESTIGO_OCR);
      expect(Number(html.largo)).toBe(Buffer.byteLength(html.cuerpo));
      expect((await pedir('/json')).cuerpo).toBe('{"a":1}');
    } finally {
      servidor.close();
    }
  });
});
