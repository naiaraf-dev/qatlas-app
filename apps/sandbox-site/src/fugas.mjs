/**
 * Páginas que filtran secretos de prueba de las formas típicas (semana 7, TS-01 y TS-13). Todos los
 * secretos son inventados: el canario, un JWT y una clave PEM que se arman acá, por partes, para que
 * ninguno aparezca literal en el repo.
 *
 * Lo que QAtlas captura hoy (la consola, las URLs) tiene que quedar redactado. Lo que todavía no captura
 * (encabezados de respuesta, HTML, JSON) queda plantado para las evidencias de la semana 7b.
 */

/** El canario por defecto: el del oráculo. TS-01 pasa uno único. */
export const CANARIO_POR_DEFECTO = 'CANARIO-sandbox-de-prueba-0000';

const b64url = (texto) => Buffer.from(texto).toString('base64url');

/** Un JWT de prueba, firmado con nada: solo tiene la forma. */
export const JWT_DE_PRUEBA = [
  b64url('{"alg":"HS256","typ":"JWT"}'),
  b64url('{"sub":"ana-prueba","rol":"admin","iat":1767225600}'),
  'Firma0De0Prueba0Inventada0Para0El0Sandbox00',
].join('.');

/** Una clave privada de prueba: el cuerpo es relleno, no es una clave. */
export const PEM_DE_PRUEBA = [
  '-----BEGIN ' + 'PRIVATE KEY-----',
  'MIIB' + 'Relleno0De0Prueba0Sandbox0'.repeat(2),
  'Relleno0De0Prueba0Sandbox0'.repeat(2),
  '-----END ' + 'PRIVATE KEY-----',
].join('\n');

const pagina = (titulo, cuerpo) => `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>${titulo} · Sandbox</title></head>
<body>
<h1>${titulo}</h1>
${cuerpo}
<p><a href="/fugas">Volver a las fugas</a></p>
</body>
</html>`;

const html = (res, estado, cuerpo, encabezados = {}) => {
  res.writeHead(estado, { 'content-type': 'text/html; charset=utf-8', ...encabezados });
  res.end(cuerpo);
};

/** Para escribir un texto adentro de un script sin romperlo. */
const js = (texto) => JSON.stringify(texto).replace(/</g, '\\u003c');

/**
 * @param {{ canario: string }} opciones
 */
export function crearFugas({ canario }) {
  /** El «log del backend» (TS-13): lo que imprime el servidor de prueba. */
  const registroBackend = [];
  const mitad = Math.floor(canario.length / 2);

  const indice = pagina(
    'Fugas de secretos',
    `<ul>
  <li><a href="/fugas/consola">En la consola</a></li>
  <li><a href="/fugas/url?clave=${encodeURIComponent(canario)}&amp;vista=lista">En la URL</a></li>
  <li><a href="/fugas/encabezado">En un encabezado de respuesta</a></li>
  <li><a href="/fugas/html">En el HTML</a></li>
  <li><a href="/fugas/json">En un JSON</a></li>
  <li><a href="/fugas/registro">En el log del backend</a></li>
</ul>`,
  );

  return {
    registroBackend,
    /** Devuelve true si atendió el pedido. */
    atender(req, res, ruta) {
      if (req.method !== 'GET' || !ruta.startsWith('/fugas')) return false;
      switch (ruta) {
        case '/fugas':
        case '/fugas/':
          html(res, 200, indice);
          return true;
        case '/fugas/consola':
          // El canario, un JWT, una clave PEM y el canario partido en dos mensajes seguidos.
          html(
            res,
            200,
            pagina(
              'En la consola',
              `<p>Mensajes de depuración que no deberían estar.</p>
<script>
  console.error('depuración: la clave es ' + ${js(canario)});
  console.error('token de la sesión: ' + ${js(JWT_DE_PRUEBA)});
  console.error(${js(PEM_DE_PRUEBA)});
  console.error('primera mitad: ' + ${js(canario.slice(0, mitad))});
  console.error(${js(canario.slice(mitad))} + ' (segunda mitad)');
</script>`,
            ),
          );
          return true;
        case '/fugas/url':
          html(res, 200, pagina('En la URL', '<p>La clave viajó en la URL.</p>'));
          return true;
        case '/fugas/encabezado':
          html(res, 200, pagina('En un encabezado', '<p>Mirá los encabezados.</p>'), {
            'x-depuracion': canario,
          });
          return true;
        case '/fugas/html':
          html(res, 200, pagina('En el HTML', `<p>Clave de soporte: <code>${canario}</code></p>`));
          return true;
        case '/fugas/json':
          html(
            res,
            200,
            pagina(
              'En un JSON',
              `<p id="estado">Cargando…</p>
<script>
  fetch('/fugas/datos.json').then((r) => r.json()).then(() => {
    document.getElementById('estado').textContent = 'Listo';
  });
</script>`,
            ),
          );
          return true;
        case '/fugas/datos.json':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ usuario: 'ana', token: canario, jwt: JWT_DE_PRUEBA }));
          return true;
        case '/fugas/registro':
          // TS-13: el backend imprime el canario y un JWT en su log, y un panel de administración lo
          // muestra en la consola del navegador.
          registroBackend.push(`[api] login de ana con clave=${canario}`);
          registroBackend.push(`[api] emitido el token ${JWT_DE_PRUEBA}`);
          html(
            res,
            200,
            pagina(
              'En el log del backend',
              `<p>Últimas líneas del log.</p>
<script>
  fetch('/fugas/registro.json').then((r) => r.json()).then((lineas) => {
    for (const linea of lineas) console.error(linea);
  });
</script>`,
            ),
          );
          return true;
        case '/fugas/registro.json':
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(registroBackend.slice(-2)));
          return true;
        default:
          return false;
      }
    },
  };
}
