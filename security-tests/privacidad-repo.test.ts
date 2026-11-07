/**
 * Datos personales en el repositorio. El repo es público: ningún archivo versionado puede
 * identificar a la autora ni a su equipo (ver "Reglas de seguridad" en CLAUDE.md).
 *
 * Los hallazgos dicen archivo, línea y regla, y NUNCA el valor encontrado ni los valores de la
 * máquina, porque los logs del CI son públicos.
 *
 * Límite: solo reconoce formatos (rutas, emails) y los valores de la máquina donde corre. Un nombre y
 * apellido o el nombre de una organización no se pueden detectar sin escribirlos acá, así que eso sigue
 * dependiendo de la revisión.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXTENSIONES_DE_IMAGEN,
  limpiarPng,
  limpiarSvg,
  metadatosDe,
} from '../scripts/metadatos-imagenes.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

/** Nombres ficticios o de CI aceptados en rutas: "ana" es el de los ejemplos, "runner" el de GitHub Actions. */
const NOMBRES_PERMITIDOS = new Set(['ana', 'runner']);

/**
 * Valores de la máquina que se ignoran porque darían falsos positivos: palabras comunes (la
 * documentación en español dice "usuario" cientos de veces) y nombres que Windows o Linux usan por
 * defecto, que tampoco identifican a nadie. También se ignora lo que tenga menos de 4 caracteres.
 * Una ruta completa con uno de estos nombres sigue fallando por la regla de rutas de usuario.
 */
const VALORES_GENERICOS = new Set([
  'usuario',
  'usuarios',
  'user',
  'users',
  'admin',
  'administrador',
  'administrator',
  'equipo',
  'desktop',
  'laptop',
  'localhost',
  'home',
  'root',
  'test',
  'prueba',
]);
const LARGO_MINIMO = 4;

const DOMINIOS_PERMITIDOS = ['example.com', 'example.test'];
const EMAILS_NOREPLY_GITHUB = /^(?:noreply@github\.com|[^@\s]+@users\.noreply\.github\.com)$/i;

const NOMBRE = String.raw`[A-Za-z0-9][^\s\\/'"\x60<>()\[\]{}$*:,;]*`;
const SEP = String.raw`(?:\\\\|\\|/)`;

/** El nombre de usuario queda en el grupo 1. El lookbehind evita tomar rutas dentro de una URL. */
const RUTAS_DE_USUARIO = [
  new RegExp(String.raw`[A-Za-z]:${SEP}Users${SEP}(${NOMBRE})`, 'gi'),
  new RegExp(String.raw`(?<![\w.:/-])(?:/[a-z])?/(?:Users|home)/(${NOMBRE})`, 'g'),
];

// El dominio termina en letras: así no toma versiones de paquetes como "react@19.3.1".
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;

interface ValoresMaquina {
  usuario: string;
  carpetaPersonal: string;
  equipo: string;
}

function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function esEspecifico(valor: string): boolean {
  const v = valor.toLowerCase();
  return v.length >= LARGO_MINIMO && !VALORES_GENERICOS.has(v) && !NOMBRES_PERMITIDOS.has(v);
}

/** Palabra completa: que "ana" no coincida dentro de "mañana" ni un equipo "pc1" dentro de "pc10". */
function comoPalabra(valor: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapar(valor)}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Devuelve solo nombres de reglas. Nunca incluye los valores, ni siquiera para depurar. */
function reglasDeMaquina(valores: ValoresMaquina): { regla: string; patron: RegExp }[] {
  const reglas: { regla: string; patron: RegExp }[] = [];
  const segmentos = valores.carpetaPersonal.split(/[\\/]+/).filter(Boolean);
  const ultimo = segmentos.at(-1) ?? '';

  if (esEspecifico(valores.usuario)) {
    reglas.push({ regla: 'usuario de la máquina', patron: comoPalabra(valores.usuario) });
  }
  if (esEspecifico(ultimo)) {
    reglas.push({ regla: 'carpeta personal de la máquina', patron: comoPalabra(ultimo) });
  }
  if (segmentos.length > 1 && !NOMBRES_PERMITIDOS.has(ultimo.toLowerCase())) {
    // En cualquier formato de separador: barra invertida, barra invertida escapada o barra.
    const ruta = segmentos.map(escapar).join(SEP + '+');
    reglas.push({ regla: 'carpeta personal de la máquina', patron: new RegExp(ruta, 'i') });
  }
  if (esEspecifico(valores.equipo)) {
    reglas.push({ regla: 'nombre del equipo', patron: comoPalabra(valores.equipo) });
  }
  return reglas;
}

function emailPermitido(email: string, dominio: string): boolean {
  const d = dominio.toLowerCase();
  return (
    EMAILS_NOREPLY_GITHUB.test(email) ||
    DOMINIOS_PERMITIDOS.some((p) => d === p || d.endsWith(`.${p}`))
  );
}

/** Reglas que se incumplen en una línea, sin el contenido encontrado. */
function reglasIncumplidas(
  linea: string,
  deMaquina: { regla: string; patron: RegExp }[],
): string[] {
  const incumplidas = new Set<string>();
  for (const patron of RUTAS_DE_USUARIO) {
    for (const [, nombre] of linea.matchAll(patron)) {
      if (!NOMBRES_PERMITIDOS.has((nombre ?? '').toLowerCase())) {
        incumplidas.add('ruta de usuario con un nombre no permitido');
      }
    }
  }
  for (const [email, dominio] of linea.matchAll(EMAIL)) {
    if (!emailPermitido(email, dominio ?? '')) incumplidas.add('email no permitido');
  }
  for (const { regla, patron } of deMaquina) {
    if (patron.test(linea)) incumplidas.add(regla);
  }
  return [...incumplidas];
}

/** Archivos versionados y los nuevos sin ignorar, para detectarlo también antes de commitear. */
function archivosDelRepo(): string[] {
  const salida = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
    { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return salida.split('\0').filter(Boolean);
}

function leerSiEsTexto(archivo: string): string | null {
  let contenido: Buffer;
  try {
    contenido = readFileSync(path.join(RAIZ, archivo));
  } catch {
    return null; // Borrado en la copia de trabajo y todavía no commiteado.
  }
  return contenido.includes(0) ? null : contenido.toString('utf8');
}

describe('Datos personales en el repositorio', () => {
  const deMaquina = reglasDeMaquina({
    usuario: os.userInfo().username,
    carpetaPersonal: os.homedir(),
    equipo: os.hostname(),
  });

  it('ningún archivo contiene rutas de usuario, emails ni datos de esta máquina', () => {
    const archivos = archivosDelRepo();
    expect(archivos.length).toBeGreaterThan(0);

    const hallazgos: string[] = [];
    for (const archivo of archivos) {
      for (const regla of reglasIncumplidas(archivo, deMaquina)) {
        hallazgos.push(`${archivo} (nombre del archivo): ${regla}`);
      }
      const texto = leerSiEsTexto(archivo);
      if (texto === null) continue;
      texto.split('\n').forEach((linea, i) => {
        for (const regla of reglasIncumplidas(linea, deMaquina)) {
          hallazgos.push(`${archivo}:${i + 1}: ${regla}`);
        }
      });
    }
    // El mensaje solo lleva archivo, línea y regla: los logs del CI son públicos.
    expect(hallazgos).toEqual([]);
  });
});

describe('Metadatos en las imágenes', () => {
  it('ninguna imagen del repo trae metadatos (EXIF, XMP, comentarios, software, C2PA)', () => {
    const imagenes = archivosDelRepo().filter((archivo) => EXTENSIONES_DE_IMAGEN.test(archivo));
    expect(imagenes.length).toBeGreaterThan(0);
    const hallazgos: string[] = [];
    for (const archivo of imagenes) {
      let datos: Buffer;
      try {
        datos = readFileSync(path.join(RAIZ, archivo));
      } catch {
        continue; // Borrado en la copia de trabajo y todavía no commiteado.
      }
      for (const metadato of metadatosDe(datos, path.extname(archivo))) {
        hallazgos.push(`${archivo}: ${metadato}`);
      }
    }
    // Solo el archivo y el tipo de metadato, nunca su contenido. Se quitan con scripts/marca.mjs --limpiar.
    expect(hallazgos).toEqual([]);
  });

  it('el detector encuentra los metadatos, y la limpieza los saca', () => {
    // Un PNG mínimo de 1×1 con un chunk de texto (como el que dejan muchas herramientas).
    const chunk = (tipo: string, datos: Buffer) => {
      const largo = Buffer.alloc(4);
      largo.writeUInt32BE(datos.length);
      return Buffer.concat([largo, Buffer.from(tipo, 'latin1'), datos, Buffer.alloc(4)]);
    };
    const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('tEXt', Buffer.from('Software Editor de ejemplo', 'latin1')),
      chunk('IDAT', Buffer.from([0])),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    expect(metadatosDe(png, '.png')).toEqual(['chunk tEXt']);
    expect(metadatosDe(limpiarPng(png), '.png')).toEqual([]);

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://example.com/i" inkscape:version="1"><!-- hecho a mano --><metadata><rdf:RDF/></metadata><rect width="1" height="1"/></svg>';
    expect(metadatosDe(Buffer.from(svg), '.svg')).toEqual(
      expect.arrayContaining(['metadata', 'comentario', 'RDF', 'Inkscape']),
    );
    const limpio = limpiarSvg(svg);
    expect(metadatosDe(Buffer.from(limpio), '.svg')).toEqual([]);
    expect(limpio).toContain('<rect width="1" height="1"/>');

    // Un formato que el detector no sabe revisar falla cerrado.
    expect(metadatosDe(Buffer.from([0xff, 0xd8]), '.jpg')).toEqual([
      'formato .jpg sin revisar: agregarlo a scripts/metadatos-imagenes.mjs',
    ]);
  });
});

// Las muestras se arman en tiempo de ejecución para que este archivo, que también se escanea, no
// dispare sus propias reglas. Todos los nombres son inventados.
const N = 'zoe';
const FICTICIO = `${N}.ficticia`;
const CORREO = 'correo.invalid';
const EJEMPLO = 'example.com';

describe('Datos personales · el detector funciona', () => {
  const maquina = reglasDeMaquina({
    usuario: FICTICIO,
    carpetaPersonal: `C:\\Users\\${FICTICIO}`,
    equipo: 'EQUIPO-FICTICIO-42',
  });

  it.each([
    ['Windows', `C:\\Users\\${N}\\AppData`],
    ['Windows escapada', `C:\\\\Users\\\\${N}\\\\AppData`],
    ['Windows con barras', `C:/Users/${N}/AppData`],
    ['minúsculas', `c:\\users\\${N}`],
    ['macOS', `cd /Users/${N}/proyecto`],
    ['Linux', `"/home/${N}/.config"`],
    ['Git Bash', `/c/Users/${N}/proyecto`],
  ])('detecta una ruta de usuario: %s', (_nombre, linea) => {
    expect(reglasIncumplidas(linea, [])).toEqual(['ruta de usuario con un nombre no permitido']);
  });

  it.each([
    'C:\\Users\\ana\\AppData\\Local\\QAtlas\\boveda.db',
    '/home/runner/work',
    '/Users/ana/proyecto',
    'https://example.com/home/inicio',
    'GET /users/42',
    'X:\\Users\\<nombre>, /Users/<nombre>',
  ])('acepta: %s', (linea) => {
    expect(reglasIncumplidas(linea, [])).toEqual([]);
  });

  it.each(['ana@example.com', 'qa@sub.example.test', '123+ana@users.noreply.github.com'])(
    'acepta el email %s',
    (linea) => {
      expect(reglasIncumplidas(linea, [])).toEqual([]);
    },
  );

  it.each([`ana@${CORREO}`, `ana@sub.${CORREO}`, `ana@no${EJEMPLO}`])(
    'rechaza un email fuera de los dominios permitidos',
    (linea) => {
      expect(reglasIncumplidas(linea, [])).toEqual(['email no permitido']);
    },
  );

  it('no confunde versiones de paquetes con emails', () => {
    expect(reglasIncumplidas('npx paquete@1.10.3 y @types/node@22.0.0', [])).toEqual([]);
  });

  it.each([
    ['usuario', `hola ${FICTICIO}`, 'usuario de la máquina'],
    ['equipo', 'en equipo-ficticio-42.', 'nombre del equipo'],
    ['carpeta con barras', `en C:/Users/${FICTICIO}/x`, 'carpeta personal de la máquina'],
    ['carpeta escapada', `en C:\\\\Users\\\\${FICTICIO}`, 'carpeta personal de la máquina'],
  ])('detecta un valor de la máquina: %s', (_nombre, linea, regla) => {
    expect(reglasIncumplidas(linea, maquina)).toContain(regla);
  });

  it('ignora valores genéricos o muy cortos, y coincide solo con palabras completas', () => {
    const generica = reglasDeMaquina({
      usuario: 'admin',
      carpetaPersonal: 'admin',
      equipo: 'pc1',
    });
    expect(generica).toEqual([]);

    const corta = reglasDeMaquina({ usuario: 'zoel', carpetaPersonal: '', equipo: '' });
    expect(reglasIncumplidas('la zoelandia', corta)).toEqual([]);
    expect(reglasIncumplidas('dijo zoel', corta)).toEqual(['usuario de la máquina']);
  });

  it('una carpeta personal completa con nombre genérico sigue detectándose', () => {
    const generico = 'admin';
    const reglas = reglasDeMaquina({
      usuario: generico,
      carpetaPersonal: `C:\\Users\\${generico}`,
      equipo: '',
    });
    expect(reglasIncumplidas(`en C:/Users/${generico}`, reglas)).toContain(
      'carpeta personal de la máquina',
    );
    expect(reglasIncumplidas('el admin del sistema', reglas)).toEqual([]);
  });

  it('el resultado nunca incluye el valor encontrado', () => {
    const resultado = reglasIncumplidas(
      `C:\\Users\\${N}\\x ${N}@${CORREO} ${FICTICIO} EQUIPO-FICTICIO-42`,
      maquina,
    );
    expect(resultado).toHaveLength(5);
    expect(JSON.stringify(resultado)).not.toMatch(/zoe|FICTICIO|correo/i);
  });
});
