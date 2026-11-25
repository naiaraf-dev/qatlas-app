import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXCLUSIONES_POR_DEFECTO,
  PROYECTO_POR_DEFECTO,
  type ProyectoEntrada,
} from '@qatlas/shared';
import { abrirBaseCifrada, MIGRACIONES, migrar, type BaseCifrada } from '@qatlas/db';
import { ServicioBoveda } from '../boveda/servicio';
import { ServicioProyectos } from './servicio';

/**
 * Una copia de seguridad hecha con el esquema de las semanas 4 y 5 se restaura y se migra: las
 * credenciales quedan como «formulario», con su nombre como rol y el secreto intacto (ADR 025).
 *
 * La copia vieja se genera acá: se crea una bóveda actual y se lleva su base al esquema 5, y se
 * comprueba que quedó igual a una base migrada solo hasta la versión 5. Nada versionado con datos.
 */

const CONTRASENA = 'tigre-morado-bajo-la-lluvia-73';
const SECRETO = 'CANARIO-secreto-de-la-semana-cinco-58';

const ENTRADA: ProyectoEntrada = {
  ...PROYECTO_POR_DEFECTO,
  nombre: 'Lexora',
  descripcion: '',
  urlBase: 'https://app.lexora.test/',
  dominios: ['app.lexora.test'],
  puertosLocales: [],
  exclusiones: [...EXCLUSIONES_POR_DEFECTO],
  selectoresSensibles: [],
  dominiosAutenticacion: [],
};

const CREDENCIAL = {
  nombre: 'Usuario de prueba',
  rol: 'admin',
  estrategia: 'formulario' as const,
  usuario: 'ana@example.com',
  urlLogin: 'https://app.lexora.test/login',
  pasosLogin: [{ accion: 'rellenar' as const, selector: '#clave', origen: 'secreto' as const }],
};

/** Lo inverso de la migración 6, solo para fabricar la copia vieja. */
const AL_ESQUEMA_5 = `
  -- Lo de la versión 8 (semana 7b, evidencias).
  DROP TABLE evidencia;
  ALTER TABLE hallazgo_ocurrencia DROP COLUMN pagina_visitada_id;
  -- Lo de la versión 7 (semana 7, redacción).
  DROP TABLE redaccion;
  ALTER TABLE proyecto DROP COLUMN redaccion_version;
  ALTER TABLE hallazgo_ocurrencia DROP COLUMN secretos_redactados;
  ALTER TABLE hallazgo_ocurrencia DROP COLUMN revision_pendiente;
  -- Lo de la versión 6.
  ALTER TABLE proyecto DROP COLUMN dominios_autenticacion;
  ALTER TABLE proyecto DROP COLUMN sesion_max_minutos;
  ALTER TABLE autorizacion DROP COLUMN dominios_autenticacion_aceptados;
  ALTER TABLE ejecucion DROP COLUMN credencial_id;
  ALTER TABLE ejecucion DROP COLUMN rol;
  CREATE TABLE credencial_vieja (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    proyecto_id TEXT NOT NULL REFERENCES proyecto(id),
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL,
    secreto BLOB NOT NULL,
    secreto_actualizado_en TEXT NOT NULL,
    url_login TEXT NOT NULL,
    pasos_login TEXT NOT NULL,
    indicador_exito TEXT
  );
  INSERT INTO credencial_vieja
    SELECT id, created_at, updated_at, proyecto_id, nombre, usuario, secreto, secreto_actualizado_en,
      url_login, pasos_login, indicador_exito
    FROM credencial;
  DROP TABLE credencial;
  ALTER TABLE credencial_vieja RENAME TO credencial;
  CREATE INDEX credencial_proyecto ON credencial(proyecto_id);
  PRAGMA user_version = 5;
`;

type Columna = { name: string; type: string; notnull: number; dflt_value: unknown; pk: number };

function columnas(base: BaseCifrada): Record<string, Columna[]> {
  const tablas = base
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[];
  return Object.fromEntries(
    tablas.map(({ name }) => [name, base.pragma(`table_info(${name})`) as Columna[]]),
  );
}

let carpeta: string;
const abiertas: ServicioBoveda[] = [];

beforeEach(() => {
  carpeta = mkdtempSync(path.join(os.tmpdir(), 'qatlas-migracion-'));
});

afterEach(() => {
  for (const boveda of abiertas.splice(0)) boveda.bloquear();
  rmSync(carpeta, { recursive: true, force: true });
});

describe('Migración 6: credenciales de una copia de la semana 5', () => {
  it('se restaura, se migra y las credenciales quedan como formulario con su secreto', async () => {
    // 1. Una bóveda con dos credenciales del mismo nombre, que en la semana 5 se podía.
    const original = new ServicioBoveda({ carpeta: path.join(carpeta, 'original') });
    abiertas.push(original);
    await original.crear(CONTRASENA, false);
    const proyectos = new ServicioProyectos(original);
    const { declaracion } = proyectos.validar(ENTRADA);
    if (!declaracion) throw new Error('Entrada inválida');
    const creado = proyectos.crear(ENTRADA, { aceptada: true, ...declaracion });
    if (creado.resultado !== 'creado') throw new Error('No se creó');
    const proyectoId = creado.id;
    const ids = ['admin', 'lector'].map((rol) => {
      const res = proyectos.guardarCredencial({ proyectoId, ...CREDENCIAL, rol, secreto: SECRETO });
      if (res.resultado !== 'guardada') throw new Error('No se guardó');
      return res.credencialId;
    });

    // 2. La base vuelve al esquema 5, y es igual a una migrada solo hasta ahí.
    const viejas = original.conAcceso((base) => {
      base.exec(AL_ESQUEMA_5);
      return columnas(base);
    });
    const referencia = abrirBaseCifrada(path.join(carpeta, 'referencia.db'), randomBytes(32));
    try {
      migrar(
        referencia,
        MIGRACIONES.filter((m) => m.version <= 5),
      );
      expect(viejas).toEqual(columnas(referencia));
    } finally {
      referencia.close();
    }

    // 3. La copia sale con el esquema 5 y se restaura en un equipo nuevo.
    const copia = path.join(carpeta, 'copia.qatlas');
    original.crearCopia(copia);
    original.bloquear();
    const nueva = new ServicioBoveda({ carpeta: path.join(carpeta, 'nueva') });
    abiertas.push(nueva);
    expect(await nueva.restaurar(copia, CONTRASENA)).toEqual({ resultado: 'restaurada' });

    // 4. Migrada: formulario, el nombre como rol sin repetirse, y el secreto descifra igual.
    const version = nueva.conAcceso((base) => base.pragma('user_version', { simple: true }));
    expect(version).toBe(MIGRACIONES.at(-1)?.version);
    const restaurados = new ServicioProyectos(nueva);
    const credenciales = restaurados.obtener(proyectoId)?.credenciales ?? [];
    expect(
      credenciales
        .map((c) => [c.estrategia, c.rol, c.secretoConfigurado])
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    ).toEqual([
      ['formulario', 'Usuario de prueba', true],
      ['formulario', 'Usuario de prueba (2)', true],
    ]);
    for (const id of ids) {
      expect(await restaurados.usarSecreto(proyectoId, id, (s) => s.toString('utf8'))).toBe(
        SECRETO,
      );
    }
  });
});
