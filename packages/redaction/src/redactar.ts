/**
 * Redacción (EVI-03) y detector de secretos (EVI-04). Funciones puras: reciben texto y devuelven el texto
 * con `[REDACTADO:tipo]` en lugar de cada secreto, más el registro de qué se redactó y por qué regla.
 * Nunca devuelven ni registran el valor.
 *
 * Cada detector marca tramos sobre el texto original; los tramos se unen y el texto se arma una sola
 * vez. Así un secreto que dos reglas encuentran se redacta una vez, y una marca nunca se vuelve a
 * analizar.
 */
import type { ComparadorDeSecretos } from './comparador';
import { pareceSecreto } from './entropia';
import { ENCABEZADOS_SENSIBLES, esNombreSensible, esNombreSospechoso } from './nombres';
import { PATRONES } from './patrones';
import {
  comoRedactado,
  marca,
  type RegistroRedaccion,
  type Resultado,
  type TextoRedactado,
  type TipoRedaccion,
} from './tipos';

export interface OpcionesRedaccion {
  /** Los secretos de las credenciales del proyecto, sin guardarlos (ADR 031). */
  comparador?: ComparadorDeSecretos | null;
}

interface Tramo {
  inicio: number;
  fin: number;
  tipo: TipoRedaccion;
  regla: string;
  /** Menor gana cuando dos tramos se superponen. */
  prioridad: number;
}

const PRIORIDAD = {
  credencial: 0,
  patron: 1,
  parametro: 2,
  campo: 3,
  entropia: 4,
} as const;

/** Los patrones con la bandera `d`, para saber dónde empieza el grupo `secreto`. */
const PATRONES_CON_INDICES = PATRONES.map((patron) => ({
  ...patron,
  expresion: new RegExp(patron.expresion.source, `${patron.expresion.flags}d`),
}));

/**
 * `nombre=valor`, `nombre: valor`, `"nombre": "valor"`. El nombre decide: sensible, se redacta siempre;
 * sospechoso, solo si el valor parece un secreto.
 */
const NOMBRE_Y_VALOR =
  /(?<![\w-])(["']?)([A-Za-z_][\w.-]{0,63})\1\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s&,;"'<>{}[\]()]+))/dg;

/** Valores que un nombre sensible puede tener sin ser un secreto: «code: 404», «token: null». */
function valorInofensivo(valor: string): boolean {
  return (
    valor === '' ||
    valor.startsWith('[REDACTADO') ||
    // El esquema de Authorization: el token que sigue lo encuentran los patrones.
    /^(?:Bearer|Basic|Token|Digest|Negotiate)$/i.test(valor) ||
    /^\d{1,4}$/.test(valor) ||
    /^(?:true|false|null|undefined|none|nil)$/i.test(valor)
  );
}

function tramosDeCredenciales(texto: string, comparador?: ComparadorDeSecretos | null): Tramo[] {
  if (!comparador || comparador.estaVacio) return [];
  return comparador.buscar(texto).map(({ inicio, fin }) => ({
    inicio,
    fin,
    tipo: 'credencial',
    regla: 'secreto-de-credencial',
    prioridad: PRIORIDAD.credencial,
  }));
}

function tramosDePatrones(texto: string): Tramo[] {
  const tramos: Tramo[] = [];
  for (const patron of PATRONES_CON_INDICES) {
    patron.expresion.lastIndex = 0;
    for (const coincidencia of texto.matchAll(patron.expresion)) {
      const rango = coincidencia.indices?.groups?.secreto ?? coincidencia.indices?.[0];
      if (!rango || rango[1] <= rango[0]) continue;
      tramos.push({
        inicio: rango[0],
        fin: rango[1],
        tipo: patron.tipo,
        regla: patron.id,
        prioridad: PRIORIDAD.patron,
      });
    }
  }
  return tramos;
}

function tramosDeNombres(texto: string): Tramo[] {
  const tramos: Tramo[] = [];
  NOMBRE_Y_VALOR.lastIndex = 0;
  for (const coincidencia of texto.matchAll(NOMBRE_Y_VALOR)) {
    const nombre = coincidencia[2] ?? '';
    const grupo = [3, 4, 5].find((g) => coincidencia[g] !== undefined);
    if (grupo === undefined) continue;
    const valor = coincidencia[grupo] ?? '';
    const rango = coincidencia.indices?.[grupo];
    if (!rango || valorInofensivo(valor)) continue;
    if (esNombreSensible(nombre)) {
      tramos.push({
        inicio: rango[0],
        fin: rango[1],
        tipo: 'campo',
        regla: 'nombre-sensible',
        prioridad: PRIORIDAD.campo,
      });
    } else if (esNombreSospechoso(nombre) && pareceSecreto(valor)) {
      tramos.push({
        inicio: rango[0],
        fin: rango[1],
        tipo: 'entropia',
        regla: 'entropia-en-contexto',
        prioridad: PRIORIDAD.entropia,
      });
    }
  }
  return tramos;
}

/** Todo lo que se redacta de un texto libre. */
function tramosDeTexto(texto: string, opciones: OpcionesRedaccion): Tramo[] {
  return [
    ...tramosDeCredenciales(texto, opciones.comparador),
    ...tramosDePatrones(texto),
    ...tramosDeNombres(texto),
  ];
}

/** Une los tramos superpuestos y arma el texto con las marcas. */
function aplicar(texto: string, tramos: Tramo[]): Resultado {
  const ordenados = [...tramos].sort((a, b) => a.inicio - b.inicio || a.prioridad - b.prioridad);
  const unidos: Tramo[] = [];
  for (const tramo of ordenados) {
    const anterior = unidos.at(-1);
    if (anterior && tramo.inicio < anterior.fin) {
      anterior.fin = Math.max(anterior.fin, tramo.fin);
      if (tramo.prioridad < anterior.prioridad) {
        anterior.tipo = tramo.tipo;
        anterior.regla = tramo.regla;
        anterior.prioridad = tramo.prioridad;
      }
    } else {
      unidos.push({ ...tramo });
    }
  }
  let salida = '';
  let cursor = 0;
  const cuentas = new Map<string, RegistroRedaccion>();
  for (const tramo of unidos) {
    salida += texto.slice(cursor, tramo.inicio) + marca(tramo.tipo);
    cursor = tramo.fin;
    const clave = `${tramo.regla}|${tramo.tipo}`;
    const registro = cuentas.get(clave) ?? { regla: tramo.regla, tipo: tramo.tipo, cantidad: 0 };
    registro.cantidad += 1;
    cuentas.set(clave, registro);
  }
  salida += texto.slice(cursor);
  return { texto: comoRedactado(salida), registros: [...cuentas.values()] };
}

/** Un texto libre: un mensaje de consola, una excepción, un selector, una línea de log. */
export function redactarTexto(texto: string, opciones: OpcionesRedaccion = {}): Resultado {
  return aplicar(texto, tramosDeTexto(texto, opciones));
}

/** `nombre=valor` de una query, un fragmento o un formulario, con el valor sin decodificar. */
const PARAMETRO = /(?:^|[?&;#])([^=&;#?]+)=([^&;#]*)/dg;

function tramosDeParametros(texto: string, desde: number): Tramo[] {
  const tramos: Tramo[] = [];
  const parte = texto.slice(desde);
  PARAMETRO.lastIndex = 0;
  for (const coincidencia of parte.matchAll(PARAMETRO)) {
    let nombre = coincidencia[1] ?? '';
    try {
      nombre = decodeURIComponent(nombre.replace(/\+/g, ' '));
    } catch {
      // Un nombre mal codificado se compara tal cual.
    }
    const rango = coincidencia.indices?.[2];
    if (!rango || rango[1] <= rango[0] || !esNombreSensible(nombre)) continue;
    if ((coincidencia[2] ?? '').startsWith('[REDACTADO')) continue;
    tramos.push({
      inicio: desde + rango[0],
      fin: desde + rango[1],
      tipo: 'parametro',
      regla: 'parametro-sensible',
      prioridad: PRIORIDAD.parametro,
    });
  }
  return tramos;
}

/**
 * Una URL: los valores de los parámetros con nombre sensible (en la query y en el fragmento), el usuario y
 * la contraseña, y cualquier secreto en la ruta. El resto queda como estaba, sin volver a codificar.
 */
export function redactarUrl(url: string, opciones: OpcionesRedaccion = {}): Resultado {
  const query = url.search(/[?#]/);
  const tramos = tramosDeTexto(url, opciones);
  if (query >= 0) tramos.push(...tramosDeParametros(url, query));
  return aplicar(url, tramos);
}

/** Un cuerpo de formulario (`application/x-www-form-urlencoded`). */
export function redactarFormulario(cuerpo: string, opciones: OpcionesRedaccion = {}): Resultado {
  return aplicar(cuerpo, [...tramosDeTexto(cuerpo, opciones), ...tramosDeParametros(cuerpo, 0)]);
}

type Json = null | boolean | number | string | Json[] | { [clave: string]: Json };

/**
 * Un cuerpo JSON: el valor de cada campo con nombre sensible se reemplaza entero, y el resto de los
 * textos pasa por el detector. Si no es JSON válido, se trata como texto libre.
 */
export function redactarJson(cuerpo: string, opciones: OpcionesRedaccion = {}): Resultado {
  let datos: Json;
  try {
    datos = JSON.parse(cuerpo) as Json;
  } catch {
    return redactarTexto(cuerpo, opciones);
  }
  const registros: RegistroRedaccion[] = [];
  const recorrer = (valor: Json): Json => {
    if (typeof valor === 'string') {
      const resultado = redactarTexto(valor, opciones);
      registros.push(...resultado.registros);
      return resultado.texto;
    }
    if (Array.isArray(valor)) return valor.map(recorrer);
    if (valor && typeof valor === 'object') {
      return Object.fromEntries(
        Object.entries(valor).map(([clave, interno]) => {
          if (esNombreSensible(clave) && interno !== null && interno !== '') {
            registros.push({ regla: 'nombre-sensible', tipo: 'campo', cantidad: 1 });
            return [clave, marca('campo')];
          }
          return [clave, recorrer(interno)];
        }),
      );
    }
    return valor;
  };
  const texto = JSON.stringify(recorrer(datos));
  return { texto: comoRedactado(texto), registros: unirRegistros(registros) };
}

export function unirRegistros(registros: readonly RegistroRedaccion[]): RegistroRedaccion[] {
  const cuentas = new Map<string, RegistroRedaccion>();
  for (const registro of registros) {
    const clave = `${registro.regla}|${registro.tipo}`;
    const actual = cuentas.get(clave);
    if (actual) actual.cantidad += registro.cantidad;
    else cuentas.set(clave, { ...registro });
  }
  return [...cuentas.values()];
}

export interface EncabezadoRedactado {
  nombre: string;
  valor: TextoRedactado;
}

/**
 * Encabezados de un pedido o una respuesta (EVI-03): Authorization, Proxy-Authorization, Cookie y
 * Set-Cookie siempre; los de nombre sensible (`X-API-Key`, `X-Auth-Token`) también; el resto pasa por el
 * detector.
 */
export function redactarEncabezados(
  encabezados: readonly { nombre: string; valor: string }[],
  opciones: OpcionesRedaccion = {},
): { encabezados: EncabezadoRedactado[]; registros: RegistroRedaccion[] } {
  const registros: RegistroRedaccion[] = [];
  const salida = encabezados.map(({ nombre, valor }) => {
    if (ENCABEZADOS_SENSIBLES.has(nombre.toLowerCase()) || esNombreSensible(nombre)) {
      registros.push({ regla: 'encabezado-sensible', tipo: 'encabezado', cantidad: 1 });
      return { nombre, valor: comoRedactado(marca('encabezado')) };
    }
    const resultado = redactarTexto(valor, opciones);
    registros.push(...resultado.registros);
    return { nombre, valor: resultado.texto };
  });
  return { encabezados: salida, registros: unirRegistros(registros) };
}

/** El cuerpo de una respuesta: por defecto no se guarda (EVI-03). */
export function redactarCuerpo(): Resultado {
  return {
    texto: comoRedactado(marca('cuerpo')),
    registros: [{ regla: 'cuerpo-de-respuesta', tipo: 'cuerpo', cantidad: 1 }],
  };
}

/**
 * Mensajes consecutivos (por ejemplo, de la consola de una página): además de cada uno por separado, el
 * comparador de credenciales mira la unión, para un secreto partido en dos mensajes. Si cruza el borde,
 * se redacta la parte que quedó en cada uno.
 */
export function redactarSecuencia(
  textos: readonly string[],
  opciones: OpcionesRedaccion = {},
): Resultado[] {
  const unido = textos.join('');
  const deCredenciales = tramosDeCredenciales(unido, opciones.comparador);
  let desde = 0;
  return textos.map((texto) => {
    const hasta = desde + texto.length;
    const propios = deCredenciales
      .filter((t) => t.inicio < hasta && t.fin > desde)
      .map((t) => ({
        ...t,
        inicio: Math.max(t.inicio, desde) - desde,
        fin: Math.min(t.fin, hasta) - desde,
      }));
    desde = hasta;
    return aplicar(texto, [...tramosDeTexto(texto, { ...opciones, comparador: null }), ...propios]);
  });
}
