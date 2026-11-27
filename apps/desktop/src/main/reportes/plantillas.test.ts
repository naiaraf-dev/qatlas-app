/**
 * El contenido del reporte y sus formatos (6.5.2, ADR 048). Datos inventados.
 */
import { describe, expect, it } from 'vitest';
import {
  aHtml,
  aMarkdown,
  CSP_DOCUMENTO,
  escaparHtml,
  fuentesDelPdf,
  NAVEGADOR,
  prellenar,
  severidadMayor,
  VIEWPORT,
  type ContenidoReporte,
} from './plantillas';

const H = {
  id: 'h1',
  tipo: 'error-javascript' as const,
  severidad: 'alta' as const,
  titulo: 'Excepción no capturada',
  url: 'https://example.test/carrito?paso=2',
};
const O = {
  hallazgoId: 'h1',
  ejecucionId: 'e1',
  url: 'https://example.test/carrito?paso=2',
  urlOrigen: null,
  fecha: '2026-11-27T10:00:00.000Z',
  detalle: 'TypeError: total is undefined',
};

const CONTENIDO: ContenidoReporte = prellenar([H], [O]);
const FUENTES = { inter: Buffer.from('inter'), mono: Buffer.from('mono') };

describe('Prellenar (CU-05)', () => {
  it('un hallazgo: título con la ruta, paso, esperado según el tipo y el detalle en lo obtenido', () => {
    expect(CONTENIDO.titulo).toBe('[/carrito?paso=2] Excepción no capturada');
    expect(CONTENIDO.pasos).toEqual(['Abrir https://example.test/carrito?paso=2']);
    expect(CONTENIDO.esperado).toBe('La página carga sin excepciones de JavaScript.');
    expect(CONTENIDO.obtenido).toBe('Excepción no capturada: TypeError: total is undefined');
  });

  it('el entorno no lleva datos del equipo: navegador y ventana fijos', () => {
    expect(CONTENIDO.entorno).toEqual({
      url: O.url,
      navegador: NAVEGADOR,
      viewport: VIEWPORT,
      fecha: O.fecha,
      ejecucionId: 'e1',
    });
  });

  it('un link roto empieza en la página que lo tiene; varios hallazgos van en un solo título', () => {
    const roto = { ...H, id: 'h2', tipo: 'link-roto' as const, titulo: 'Link roto' };
    const ocurrencia = {
      ...O,
      hallazgoId: 'h2',
      url: 'https://example.test/nada',
      urlOrigen: 'https://example.test/',
    };
    const c = prellenar([H, roto], [O, ocurrencia]);
    expect(c.titulo).toBe('[2 hallazgos] Excepción no capturada');
    expect(c.pasos).toEqual([
      'Abrir https://example.test/carrito?paso=2',
      'Abrir https://example.test/',
      'Seguir el link a https://example.test/nada',
    ]);
  });

  it('el detalle se corta a 500 caracteres; sin hallazgos no hay reporte', () => {
    const largo = prellenar([H], [{ ...O, detalle: 'x'.repeat(2000) }]);
    expect(largo.obtenido.length).toBe(`${H.titulo}: `.length + 500);
    expect(() => prellenar([], [])).toThrow();
  });

  it('la severidad del reporte es la mayor de sus hallazgos', () => {
    expect(severidadMayor(['baja', 'critica', 'media'])).toBe('critica');
    expect(severidadMayor([])).toBe('informativa');
  });
});

describe('Markdown: imágenes solo en el ZIP', () => {
  const captura = { id: 'c1', clase: 'captura' as const, archivo: 'evidencias/c1.png' };

  it('en el ZIP, la captura va referida por su nombre por ID', () => {
    expect(aMarkdown(CONTENIDO, 'alta', [captura], true)).toContain(
      '![Captura c1](evidencias/c1.png)',
    );
  });

  it('control: sin el ZIP, no hay imagen; dice dónde está', () => {
    const md = aMarkdown(CONTENIDO, 'alta', [captura], false);
    expect(md).not.toContain('![');
    expect(md).toContain('Captura c1: va en el ZIP o en el PDF');
  });

  it('sin captura, la evidencia es el detalle, y el reporte lo dice (RN-REP-01)', () => {
    const md = aMarkdown(
      CONTENIDO,
      'alta',
      [{ id: 'o1', clase: 'detalle', texto: 'Error ```x```' }],
      false,
    );
    expect(md).toContain('Sin capturas: la evidencia es el detalle de cada aparición.');
    // El detalle no puede cerrar el bloque de código.
    expect(md).toContain("Error '''x'''");
  });
});

describe('HTML del PDF', () => {
  const malicioso: ContenidoReporte = {
    ...CONTENIDO,
    titulo: '<img src=x onerror=alert(1)>',
    obtenido: '<script>fetch("https://example.test")</script>',
  };
  const html = aHtml(malicioso, 'alta', [], FUENTES);

  it('título genérico, CSP cerrada y sin scripts: el texto del sitio se escapa', () => {
    expect(html).toContain('<title>Reporte de QAtlas</title>');
    expect(html).toContain(CSP_DOCUMENTO);
    expect(CSP_DOCUMENTO).toContain("default-src 'none'");
    expect(html).not.toMatch(/<script|<img src=x/i);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(escaparHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });

  it('solo las fuentes empaquetadas, sin familias genéricas de respaldo', () => {
    expect(html).toContain("font-family:'QAtlas Inter'");
    expect(html).toContain(`url(data:font/woff2;base64,${FUENTES.inter.toString('base64')})`);
    expect(html).not.toMatch(/font-family:[^;}]*(sans-serif|serif|monospace|system-ui)/);
  });
});

describe('Fuentes del PDF', () => {
  const pdf = (objetos: string[]) =>
    Buffer.from(objetos.map((o, i) => `${String(i + 1)} 0 obj\n${o}\nendobj\n`).join(''), 'latin1');

  it('Type 0: el nombre del /BaseFont, sin el prefijo del subconjunto', () => {
    expect(
      fuentesDelPdf(pdf(['<</Type /Font /Subtype /Type0 /BaseFont /AAAAAA+ArialMT>>'])),
    ).toEqual(['ArialMT']);
  });

  it('Type 3 (las variables de Chromium): el /FontName de su descriptor', () => {
    expect(
      fuentesDelPdf(
        pdf([
          '<</Type /Font /Subtype /Type3 /FontDescriptor 2 0 R>>',
          '<</Type /FontDescriptor /FontName /BAAAAA+Inter-Regular>>',
        ]),
      ),
    ).toEqual(['Inter-Regular']);
  });

  it('una fuente sin nombre identificable aparece vacía: quien llama la rechaza', () => {
    expect(fuentesDelPdf(pdf(['<</Type /Font /Subtype /Type3>>']))).toEqual(['']);
  });
});
