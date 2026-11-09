/**
 * Páginas para probar las evidencias (semana 7b): datos sensibles de prueba visibles, campos de
 * contraseña, elementos marcados como sensibles y un formulario largo, para el enmascarado de las
 * capturas, del snapshot y del modo datos sensibles. Todos los datos son inventados.
 *
 * Están fuera del recorrido de la raíz (no hay link desde «/»): el oráculo de los hallazgos no cambia.
 * Cada página con una falla plantada (una excepción de JavaScript) conserva su video; `/limpia` no tiene
 * fallas y su video se descarta (EVI-07).
 */

/** Lo que se ve en las páginas, para buscarlo en las evidencias. Inventado y armado por partes. */
export const DATOS_SENSIBLES_DE_PRUEBA = {
  nombre: 'Ana Prueba',
  documento: ['30', '111', '222'].join('.'),
  email: ['ana.prueba', 'example.com'].join('@'),
  telefono: ['+54 11', '5555', '0101'].join(' '),
  clave: ['clave', 'visible', 'nunca', '4471'].join('-'),
  oculto: ['token', 'oculto', 'de', 'prueba', '8820'].join('-'),
  nota: ['NOTA', 'VISIBLE', '4417'].join(' '),
};

/** El valor de cada campo del formulario largo: el número de campo y un sufijo fijo. */
export const valorDeCampo = (n) => `CAMPO ${String(n).padStart(2, '0')} VALOR 73`;
export const CAMPOS_DEL_FORMULARIO = 30;

const pagina = (titulo, cuerpo, { falla = true } = {}) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${titulo} · Evidencias del sandbox</title>
<style>body{font-family:sans-serif;font-size:22px;margin:24px}input{font-size:20px}.grande{font-size:40px;font-family:monospace}</style>
</head>
<body>
<main>
<h1>${titulo}</h1>
${cuerpo}
<p><a href="/evidencias/">Volver a las evidencias</a></p>
</main>
${falla ? "<script>setTimeout(() => { throw new Error('falla plantada para conservar el video'); }, 300);</script>" : ''}
</body>
</html>`;

const html = (res, cuerpo) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(cuerpo);
};

export function crearPaginasDeEvidencias({ canario }) {
  const d = DATOS_SENSIBLES_DE_PRUEBA;
  return {
    atender(req, res, ruta) {
      if (req.method !== 'GET') return false;
      switch (ruta) {
        case '/evidencias':
        case '/evidencias/':
          html(
            res,
            pagina(
              'Evidencias',
              `<ul>
  <li><a href="/evidencias/ficha">Ficha con datos sensibles</a></li>
  <li><a href="/evidencias/formulario">Formulario largo</a></li>
  <li><a href="/evidencias/limpia">Página sin fallas</a></li>
</ul>`,
              { falla: false },
            ),
          );
          return true;
        case '/evidencias/ficha':
          html(
            res,
            pagina(
              'Ficha de cliente',
              `<p>Nombre: ${d.nombre}</p>
<p class="dato-sensible" data-sensible="documento">Documento: ${d.documento}</p>
<p class="dato-sensible" data-sensible="email">Email: ${d.email}</p>
<p class="dato-sensible" data-sensible="telefono">Teléfono: ${d.telefono}</p>
<form>
  <label>Contraseña <input id="clave" type="password" value="${d.clave}"></label>
  <input type="hidden" name="csrf" value="${d.oculto}">
  <label>Nota <input id="nota" type="text" value="${d.nota}" size="24"></label>
</form>`,
            ),
          );
          return true;
        case '/evidencias/formulario': {
          const campos = Array.from({ length: CAMPOS_DEL_FORMULARIO }, (_, i) => {
            const n = i + 1;
            return `<p><label>Campo ${n} <input id="campo-${n}" name="campo-${n}" type="text" value="${valorDeCampo(n)}" size="22"></label></p>`;
          }).join('\n');
          html(
            res,
            pagina(
              'Formulario largo',
              `<form>
${campos}
<p><label>Observaciones <textarea id="observaciones">${d.nota}</textarea></label></p>
</form>`,
            ),
          );
          return true;
        }
        case '/evidencias/limpia':
          html(res, pagina('Página sin fallas', '<p>Nada que reportar.</p>', { falla: false }));
          return true;
        case '/evidencias/visible':
          // Control positivo del OCR: el canario, a la vista y grande, en una página con una falla.
          html(res, pagina('Canario visible', `<p class="grande" id="canario">${canario}</p>`));
          return true;
        default:
          return false;
      }
    },
  };
}
