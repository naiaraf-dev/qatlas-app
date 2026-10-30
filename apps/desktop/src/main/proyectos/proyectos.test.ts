import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXCLUSIONES_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  type ProyectoEntrada,
} from '@qatlas/shared';
import { abrirClaveProyecto, descifrarCampo } from '@qatlas/crypto';
import { leerAuditoria, type BaseCifrada } from '@qatlas/db';
import { BovedaBloqueada, ServicioBoveda } from '../boveda/servicio';
import {
  AutorizacionNoVigente,
  contextoSecreto,
  CredencialARevisar,
  EntidadNoEncontrada,
  ServicioProyectos,
} from './servicio';

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const SECRETO = 'clave-de-prueba-inventada-41';

const ENTRADA: ProyectoEntrada = {
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Lexora',
  descripcion: 'Entorno de prueba',
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.lexora.test'],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
};

const CREDENCIAL = {
  nombre: 'Usuario de prueba',
  usuario: 'ana@example.com',
  urlLogin: 'https://app.lexora.test/login',
  pasosLogin: [
    { accion: 'rellenar' as const, selector: '#usuario', origen: 'usuario' as const },
    { accion: 'rellenar' as const, selector: '#clave', origen: 'secreto' as const },
    { accion: 'click' as const, selector: 'button[type=submit]' },
  ],
};

let carpeta: string;
let boveda: ServicioBoveda;
let proyectos: ServicioProyectos;

const acceso = <T>(fn: (base: BaseCifrada, maestra: Buffer) => T): T => boveda.conAcceso(fn);
const acciones = () =>
  acceso((base) => leerAuditoria(base)).map((a) => [a.accion, a.detalle.campos ?? []]);

function declaracionDe(entrada: ProyectoEntrada) {
  const { declaracion } = proyectos.validar(entrada);
  if (!declaracion) throw new Error('La entrada de prueba no es válida');
  return declaracion;
}

function crear(entrada: ProyectoEntrada = ENTRADA): string {
  const declaracion = declaracionDe(entrada);
  const res = proyectos.crear(entrada, { aceptada: true, ...declaracion });
  if (res.resultado !== 'creado') throw new Error(JSON.stringify(res));
  return res.id;
}

function guardarCredencial(proyectoId: string, urlLogin = CREDENCIAL.urlLogin): string {
  const res = proyectos.guardarCredencial({
    proyectoId,
    ...CREDENCIAL,
    urlLogin,
    secreto: SECRETO,
  });
  if (res.resultado !== 'guardada') throw new Error(JSON.stringify(res));
  return res.credencialId;
}

function detalle(id: string) {
  const fila = proyectos.obtener(id);
  if (!fila) throw new Error('No existe');
  return fila;
}

function reaceptar(id: string) {
  const { declaracion } = detalle(id);
  return proyectos.aceptarAutorizacion(id, { aceptada: true, ...declaracion });
}

beforeEach(async () => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-proyectos-'));
  boveda = new ServicioBoveda({ carpeta });
  await boveda.crear(CONTRASENA, false);
  proyectos = new ServicioProyectos(boveda);
});

afterEach(() => {
  boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Crear (CU-01)', () => {
  it('guarda el proyecto con sus valores y la autorización vigente', () => {
    const id = crear();
    const fila = detalle(id);
    expect(fila).toMatchObject({
      nombre: 'Lexora',
      maxRps: 2,
      maxPaginas: 200,
      maxProfundidad: 5,
      timeoutPaginaSegundos: 30,
      soloLectura: true,
      sistemaInterno: false,
      permitirLoginHttp: false,
      autorizacion: { vigente: true },
    });
    expect(fila.aceptadaEn).not.toBeNull();
    expect(fila.exclusiones).toContain('logout');
    expect(proyectos.listar()).toEqual([
      {
        id,
        nombre: 'Lexora',
        urlBase: 'https://app.lexora.test/',
        autorizacion: { vigente: true },
        credenciales: 0,
      },
    ]);
  });

  it('guarda el alcance normalizado', () => {
    const id = crear({
      ...ENTRADA,
      urlBase: 'HTTPS://APP.lexora.test',
      dominios: ['APP.lexora.test.'],
    });
    expect(detalle(id)).toMatchObject({
      urlBase: 'https://app.lexora.test/',
      dominios: ['app.lexora.test'],
    });
  });

  it('no crea nada si la declaración no es la del alcance que se guarda', () => {
    const declaracion = declaracionDe(ENTRADA);
    const otra = { ...ENTRADA, urlBase: 'https://otro.lexora.test/', dominios: ['*.lexora.test'] };
    expect(proyectos.crear(otra, { aceptada: true, ...declaracion })).toEqual({
      resultado: 'rechazado',
      errores: [{ campo: 'declaracion', motivo: 'declaracion-distinta' }],
    });
    expect(proyectos.crear(ENTRADA, { aceptada: true, ...declaracion, version: 99 })).toMatchObject(
      {
        resultado: 'rechazado',
      },
    );
    expect(proyectos.listar()).toEqual([]);
  });

  it('rechaza un alcance inválido sin crear nada', () => {
    const entrada = { ...ENTRADA, dominios: ['*.com'] };
    expect(proyectos.validar(entrada)).toMatchObject({
      declaracion: null,
      dominioPropuesto: 'app.lexora.test',
    });
    expect(proyectos.crear(entrada, { aceptada: true, version: 1, texto: 'x' })).toMatchObject({
      resultado: 'rechazado',
      errores: [{ campo: 'dominios', motivo: 'comodin-amplio' }],
    });
    expect(proyectos.listar()).toEqual([]);
  });

  it.each(['lexora', 'LEXORA', '  Lexora  '])('el nombre %j ya está en uso', (nombre) => {
    crear();
    expect(proyectos.validar({ ...ENTRADA, nombre }).errores).toEqual([
      { campo: 'nombre', motivo: 'nombre-repetido' },
    ]);
  });

  it('la unicidad tampoco distingue mayúsculas en letras con acento', () => {
    crear({ ...ENTRADA, nombre: 'Ñandú' });
    expect(proyectos.validar({ ...ENTRADA, nombre: 'ñANDÚ' }).errores).toEqual([
      { campo: 'nombre', motivo: 'nombre-repetido' },
    ]);
  });
});

describe('Autorización (SEG-01, RN-PRY-01 y RN-PRY-03)', () => {
  it.each<[string, Partial<ProyectoEntrada>, string[]]>([
    ['la URL base', { urlBase: 'https://app.lexora.test/otra' }, ['urlBase']],
    ['los dominios', { dominios: ['app.lexora.test', 'api.lexora.test'] }, ['dominios']],
    ['Sistema interno', { sistemaInterno: true }, ['sistemaInterno']],
  ])('cambiar %s la invalida y exige aceptar de nuevo', (_nombre, cambios, campos) => {
    const id = crear();
    const res = proyectos.actualizar(id, { ...ENTRADA, ...cambios });
    expect(res).toEqual({
      resultado: 'actualizado',
      autorizacion: { vigente: false, motivo: 'alcance-cambiado' },
    });
    expect(proyectos.estadoAutorizacion(id).vigente).toBe(false);
    expect(() => {
      proyectos.exigirAutorizacion(id);
    }).toThrow(AutorizacionNoVigente);
    expect(acciones()).toContainEqual(['autorizacion.invalidar', campos]);

    expect(reaceptar(id)).toEqual({ resultado: 'aceptada' });
    expect(proyectos.estadoAutorizacion(id)).toEqual({ vigente: true });
    expect(() => {
      proyectos.exigirAutorizacion(id);
    }).not.toThrow();
  });

  it('volver al alcance anterior no la revive', () => {
    const id = crear();
    proyectos.actualizar(id, { ...ENTRADA, urlBase: 'https://app.lexora.test/otra' });
    const res = proyectos.actualizar(id, ENTRADA);
    expect(res).toMatchObject({ autorizacion: { vigente: false } });
  });

  it.each<[string, Partial<ProyectoEntrada>]>([
    ['el nombre', { nombre: 'Otro nombre' }],
    ['los límites', { maxRps: 5 }],
    ['el login en http', { permitirLoginHttp: true }],
    ['solo lectura', { soloLectura: false }],
  ])('cambiar %s no la invalida', (_nombre, cambios) => {
    const id = crear();
    expect(proyectos.actualizar(id, { ...ENTRADA, ...cambios })).toEqual({
      resultado: 'actualizado',
      autorizacion: { vigente: true },
    });
  });

  it('rechaza aceptar un texto distinto del que corresponde', () => {
    const id = crear();
    proyectos.actualizar(id, { ...ENTRADA, urlBase: 'https://app.lexora.test/otra' });
    expect(
      proyectos.aceptarAutorizacion(id, { aceptada: true, version: 1, texto: 'otro' }),
    ).toEqual({ resultado: 'declaracion-distinta' });
    expect(proyectos.estadoAutorizacion(id).vigente).toBe(false);
  });

  it('un proyecto inexistente no está autorizado', () => {
    expect(proyectos.estadoAutorizacion(randomUUID())).toEqual({
      vigente: false,
      motivo: 'sin-aceptar',
    });
    expect(proyectos.obtener(randomUUID())).toBeNull();
    expect(() => proyectos.actualizar(randomUUID(), ENTRADA)).toThrow(EntidadNoEncontrada);
  });

  it('guarda el texto, la versión y el alcance aceptados, una fila por aceptación', () => {
    const id = crear();
    proyectos.actualizar(id, { ...ENTRADA, urlBase: 'https://app.lexora.test/otra' });
    reaceptar(id);
    const filas = acceso((base) =>
      base
        .prepare(
          'SELECT texto_aceptado AS texto, version_texto AS version, url_base_aceptada AS url, invalidada_en AS invalidada FROM autorizacion WHERE proyecto_id = ? ORDER BY rowid',
        )
        .all(id),
    ) as { texto: string; version: number; url: string; invalidada: string | null }[];
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ version: 1, url: 'https://app.lexora.test/' });
    expect(filas[0]?.invalidada).not.toBeNull();
    expect(filas[1]?.invalidada).toBeNull();
    expect(filas[1]?.texto).toContain('https://app.lexora.test/otra');
  });
});

describe('Opciones relajables (3.3)', () => {
  const INTERNO = { urlBase: 'http://192.168.1.20/', dominios: ['192.168.1.20'] };

  it('sin Sistema interno no se aceptan IPs privadas; con la opción, sí', () => {
    expect(proyectos.validar({ ...ENTRADA, ...INTERNO }).errores).toContainEqual({
      campo: 'urlBase',
      motivo: 'requiere-sistema-interno',
    });
    expect(proyectos.validar({ ...ENTRADA, ...INTERNO, sistemaInterno: true }).errores).toEqual([]);
  });

  it('desactivar Sistema interno con una IP privada en el alcance se rechaza', () => {
    const id = crear({ ...ENTRADA, ...INTERNO, sistemaInterno: true });
    expect(proyectos.actualizar(id, { ...ENTRADA, ...INTERNO })).toMatchObject({
      resultado: 'rechazado',
    });
  });

  it('activar y desactivar cada opción queda en la auditoría, con su sentido', () => {
    const id = crear();
    proyectos.actualizar(id, { ...ENTRADA, permitirLoginHttp: true, sistemaInterno: true });
    proyectos.actualizar(id, ENTRADA);
    proyectos.actualizar(id, { ...ENTRADA, soloLectura: false });
    expect(acciones()).toEqual(
      expect.arrayContaining([
        ['opcion.activar', ['permitirLoginHttp']],
        ['opcion.activar', ['sistemaInterno']],
        ['opcion.desactivar', ['permitirLoginHttp']],
        ['opcion.desactivar', ['sistemaInterno']],
        ['opcion.desactivar', ['soloLectura']],
      ]),
    );
  });

  it('el login en http necesita la opción, salvo en .test', () => {
    const entrada = {
      ...ENTRADA,
      urlBase: 'https://portal.example/',
      dominios: ['portal.example'],
    };
    const id = crear(entrada);
    const datos = { proyectoId: id, ...CREDENCIAL, secreto: SECRETO };
    expect(
      proyectos.guardarCredencial({ ...datos, urlLogin: 'http://portal.example/login' }),
    ).toEqual({
      resultado: 'rechazado',
      errores: [{ campo: 'urlLogin', motivo: 'login-sin-cifrar' }],
    });
    proyectos.actualizar(id, { ...entrada, permitirLoginHttp: true });
    expect(
      proyectos.guardarCredencial({ ...datos, urlLogin: 'http://portal.example/login' }),
    ).toMatchObject({ resultado: 'guardada' });
    expect(
      guardarCredencial(crear({ ...ENTRADA, nombre: 'Otro' }), 'http://app.lexora.test/l'),
    ).toBeTruthy();
  });
});

describe('Credenciales (RN-PRY-04)', () => {
  it('la interfaz recibe solo "configurado"', () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    const [credencial] = detalle(id).credenciales;
    expect(credencial).toEqual({
      id: credencialId,
      nombre: 'Usuario de prueba',
      usuario: 'ana@example.com',
      urlLogin: 'https://app.lexora.test/login',
      pasosLogin: CREDENCIAL.pasosLogin,
      secretoConfigurado: true,
      secretoActualizadoEn: expect.any(String) as string,
      requiereRevision: false,
    });
    expect(JSON.stringify(detalle(id))).not.toContain(SECRETO);
    expect(proyectos.listar()[0]?.credenciales).toBe(1);
  });

  it.each([
    ['fuera de los dominios', 'https://evil.example/login', 'login-fuera-de-dominios'],
    ['parecida', 'https://app.lexora.test.evil.com/', 'login-fuera-de-dominios'],
    ['con datos de acceso', 'https://ana:x@example.test/', 'credenciales-en-url'],
  ])('rechaza una URL de login %s', (_nombre, urlLogin, motivo) => {
    const id = crear();
    expect(
      proyectos.guardarCredencial({ proyectoId: id, ...CREDENCIAL, urlLogin, secreto: SECRETO }),
    ).toEqual({ resultado: 'rechazado', errores: [{ campo: 'urlLogin', motivo }] });
    expect(detalle(id).credenciales).toEqual([]);
  });

  it('el secreto se descifra solo con su proyecto y su credencial (AAD)', () => {
    const id = crear();
    const otro = crear({ ...ENTRADA, nombre: 'Otro' });
    const credencialId = guardarCredencial(id);
    const segunda = guardarCredencial(id);

    acceso((base, maestra) => {
      const fila = base
        .prepare('SELECT secreto FROM credencial WHERE id = ?')
        .get(credencialId) as {
        secreto: Buffer;
      };
      const claveDe = (proyecto: string) => {
        const { envuelta } = base
          .prepare('SELECT clave_proyecto_cifrada AS envuelta FROM proyecto WHERE id = ?')
          .get(proyecto) as { envuelta: Buffer };
        return abrirClaveProyecto(maestra, proyecto, envuelta);
      };
      const clave = claveDe(id);
      expect(
        descifrarCampo(clave, contextoSecreto(id, credencialId), fila.secreto).toString(),
      ).toBe(SECRETO);
      // Copiado a otra credencial del mismo proyecto.
      expect(() => descifrarCampo(clave, contextoSecreto(id, segunda), fila.secreto)).toThrow();
      // Copiado a otro proyecto, con su contexto y con su clave.
      expect(() =>
        descifrarCampo(clave, contextoSecreto(otro, credencialId), fila.secreto),
      ).toThrow();
      expect(() =>
        descifrarCampo(claveDe(otro), contextoSecreto(id, credencialId), fila.secreto),
      ).toThrow();
    });
  });

  it('usar el secreto lo entrega y lo borra después', async () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    let visto: Buffer | undefined;
    const texto = await proyectos.usarSecreto(id, credencialId, (secreto) => {
      visto = secreto;
      return secreto.toString('utf8');
    });
    expect(texto).toBe(SECRETO);
    expect(visto?.every((byte) => byte === 0)).toBe(true);
  });

  it('también lo borra si el uso falla', async () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    let visto: Buffer | undefined;
    await expect(
      proyectos.usarSecreto(id, credencialId, (secreto) => {
        visto = secreto;
        throw new Error('fallo');
      }),
    ).rejects.toThrow('fallo');
    expect(visto?.every((byte) => byte === 0)).toBe(true);
  });

  it('sin autorización vigente el secreto no se descifra', async () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    proyectos.actualizar(id, { ...ENTRADA, urlBase: 'https://app.lexora.test/otra' });
    await expect(proyectos.usarSecreto(id, credencialId, () => 'x')).rejects.toThrow(
      AutorizacionNoVigente,
    );
  });

  it('si la URL de login queda fuera de los dominios, se marca y no se puede usar', async () => {
    const entrada = { ...ENTRADA, dominios: ['*.lexora.test'] };
    const id = crear(entrada);
    const credencialId = guardarCredencial(id, 'https://login.lexora.test/');
    expect(detalle(id).credenciales[0]?.requiereRevision).toBe(false);

    proyectos.actualizar(id, ENTRADA);
    reaceptar(id);
    expect(detalle(id).credenciales[0]?.requiereRevision).toBe(true);
    await expect(proyectos.usarSecreto(id, credencialId, () => 'x')).rejects.toThrow(
      CredencialARevisar,
    );

    // Corregirla sin tocar el secreto la vuelve a habilitar.
    expect(
      proyectos.guardarCredencial({ proyectoId: id, credencialId, ...CREDENCIAL }),
    ).toMatchObject({ resultado: 'guardada' });
    expect(detalle(id).credenciales[0]?.requiereRevision).toBe(false);
    expect(await proyectos.usarSecreto(id, credencialId, (s) => s.toString())).toBe(SECRETO);
  });

  it('editar conserva el secreto y reemplazar lo cambia', async () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    proyectos.guardarCredencial({
      proyectoId: id,
      credencialId,
      ...CREDENCIAL,
      nombre: 'Editada',
    });
    expect(detalle(id).credenciales[0]?.nombre).toBe('Editada');
    expect(await proyectos.usarSecreto(id, credencialId, (s) => s.toString())).toBe(SECRETO);

    const NUEVO = 'otra-clave-inventada-58';
    expect(proyectos.reemplazarSecreto(id, credencialId, NUEVO)).toEqual({
      resultado: 'reemplazado',
    });
    expect(await proyectos.usarSecreto(id, credencialId, (s) => s.toString())).toBe(NUEVO);
  });

  it('una credencial de otro proyecto no se puede tocar', () => {
    const id = crear();
    const otro = crear({ ...ENTRADA, nombre: 'Otro' });
    const credencialId = guardarCredencial(id);
    expect(() => proyectos.reemplazarSecreto(otro, credencialId, 'x')).toThrow(EntidadNoEncontrada);
    expect(() => proyectos.eliminarCredencial(otro, credencialId)).toThrow(EntidadNoEncontrada);
    expect(() =>
      proyectos.guardarCredencial({
        proyectoId: otro,
        credencialId,
        ...CREDENCIAL,
        urlLogin: 'https://app.lexora.test/',
      }),
    ).toThrow(EntidadNoEncontrada);
  });

  it('eliminar quita la credencial', () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    expect(proyectos.eliminarCredencial(id, credencialId)).toEqual({ resultado: 'eliminada' });
    expect(detalle(id).credenciales).toEqual([]);
  });
});

describe('Eliminar (ADR 009)', () => {
  const contar = (tabla: string, id: string) =>
    acceso(
      (base) =>
        base
          .prepare(
            `SELECT count(*) AS c FROM ${tabla} WHERE ${tabla === 'proyecto' ? 'id' : 'proyecto_id'} = ?`,
          )
          .get(id) as { c: number },
    ).c;

  it('exige el nombre exacto', () => {
    const id = crear();
    for (const nombre of ['lexora', 'Lexora ', '']) {
      expect(proyectos.eliminar(id, nombre)).toEqual({ resultado: 'nombre-no-coincide' });
    }
    expect(proyectos.obtener(id)).not.toBeNull();
    expect(boveda.lapidas()).toEqual([]);
  });

  it('borra la clave y los datos, deja la lápida y no toca otros proyectos', () => {
    const id = crear();
    const otro = crear({ ...ENTRADA, nombre: 'Otro' });
    guardarCredencial(id);
    const delOtro = guardarCredencial(otro);

    expect(proyectos.eliminar(id, 'Lexora')).toEqual({ resultado: 'eliminado' });

    for (const tabla of ['proyecto', 'credencial', 'autorizacion']) {
      expect(contar(tabla, id)).toBe(0);
    }
    expect(boveda.lapidas().map((l) => l.proyectoId)).toEqual([id]);
    expect(proyectos.listar().map((p) => p.id)).toEqual([otro]);
    expect(detalle(otro).credenciales[0]?.id).toBe(delOtro);
    expect(acceso((base) => base.pragma('freelist_count', { simple: true }))).toBe(0);
  });

  it('el nombre queda libre', () => {
    const id = crear();
    proyectos.eliminar(id, 'Lexora');
    expect(proyectos.validar(ENTRADA).errores).toEqual([]);
  });

  it('un borrado cortado se completa al desbloquear', async () => {
    const id = crear();
    guardarCredencial(id);
    // Como si la app se cerrara después de la lápida y antes de borrar.
    boveda.registrarLapidas([{ proyectoId: id, eliminadoEn: new Date().toISOString() }]);
    boveda.bloquear();
    await boveda.desbloquear(CONTRASENA);
    expect(proyectos.listar()).toEqual([]);
    expect(contar('credencial', id)).toBe(0);
    expect(acceso((base) => base.pragma('freelist_count', { simple: true }))).toBe(0);
  });

  it('no se puede eliminar lo que no existe', () => {
    expect(() => proyectos.eliminar(randomUUID(), 'x')).toThrow(EntidadNoEncontrada);
  });
});

describe('Auditoría (SEG-07)', () => {
  it('registra cada acción, con solo IDs y nombres de campos', () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    proyectos.reemplazarSecreto(id, credencialId, 'otra-clave-inventada-58');
    proyectos.actualizar(id, { ...ENTRADA, nombre: 'Nombre nuevo', maxRps: 7 });
    proyectos.eliminarCredencial(id, credencialId);
    proyectos.eliminar(id, 'Nombre nuevo');

    const filas = acceso((base) => leerAuditoria(base));
    expect(filas.map((f) => f.accion)).toEqual(
      [
        'proyecto.crear',
        'autorizacion.aceptar',
        'credencial.guardar',
        'credencial.reemplazar_secreto',
        'proyecto.editar',
        'credencial.eliminar',
        'proyecto.eliminar',
      ].sort(
        (a, b) => filas.findIndex((f) => f.accion === a) - filas.findIndex((f) => f.accion === b),
      ),
    );
    expect(filas.find((f) => f.accion === 'proyecto.editar')?.detalle).toEqual({
      campos: ['nombre', 'maxRps'],
    });
    expect(filas.find((f) => f.accion === 'credencial.guardar')).toMatchObject({
      entidad: 'credencial',
      entidadId: credencialId,
      detalle: { proyectoId: id },
    });

    const todo = JSON.stringify(filas);
    for (const prohibido of ['Lexora', 'Nombre nuevo', 'lexora.test', 'ana@example.com', SECRETO]) {
      expect(todo).not.toContain(prohibido);
    }
  });

  it('una edición sin cambios no deja rastro', () => {
    const id = crear();
    const antes = acciones().length;
    proyectos.actualizar(id, ENTRADA);
    expect(acciones()).toHaveLength(antes);
  });
});

describe('Bóveda bloqueada (RN-BOV-03)', () => {
  it('ninguna operación funciona', async () => {
    const id = crear();
    const credencialId = guardarCredencial(id);
    boveda.bloquear();
    expect(() => proyectos.listar()).toThrow(BovedaBloqueada);
    expect(() => proyectos.obtener(id)).toThrow(BovedaBloqueada);
    expect(() => proyectos.validar(ENTRADA)).toThrow(BovedaBloqueada);
    expect(() => proyectos.eliminar(id, 'Lexora')).toThrow(BovedaBloqueada);
    expect(() => {
      proyectos.exigirAutorizacion(id);
    }).toThrow(BovedaBloqueada);
    await expect(proyectos.usarSecreto(id, credencialId, () => 'x')).rejects.toThrow(
      BovedaBloqueada,
    );
  });
});
