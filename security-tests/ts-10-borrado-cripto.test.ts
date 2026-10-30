/**
 * TS-10 (base, especificación 3.4 y 3.15): destruir la clave de un proyecto deja
 * ilegibles sus archivos y campos, aunque el resto de la bóveda siga intacta. El TS-10
 * completo, con la base real y sus restos en disco, llega con la eliminación de proyectos.
 */
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import {
  abrirBoveda,
  abrirClaveProyecto,
  borrar,
  cifrarCampo,
  contrasenaABuffer,
  crearBoveda,
  crearCifradorArchivo,
  crearClaveProyecto,
  crearDescifradorArchivo,
  descifrarCampo,
  ErrorCripto,
} from '@qatlas/crypto';

const CONTRASENA = () => contrasenaABuffer('contraseña larga para el test');
const EVIDENCIA = Buffer.from('captura con datos sensibles '.repeat(10000));

async function pasar(transformador: NodeJS.ReadWriteStream, datos: Buffer): Promise<Buffer> {
  const salida: Buffer[] = [];
  const destino = new Writable({
    write(trozo: Buffer, _codificacion, listo) {
      salida.push(trozo);
      listo();
    },
  });
  await pipeline(Readable.from([datos]), transformador, destino);
  return Buffer.concat(salida);
}

/** Bóveda con dos proyectos, y un archivo y un campo cifrados en cada uno. */
async function escenario() {
  const { sellada, maestra } = await crearBoveda(CONTRASENA());
  const a = crearClaveProyecto(maestra, 'proyecto-a');
  const b = crearClaveProyecto(maestra, 'proyecto-b');
  const archivoA = await pasar(crearCifradorArchivo(a.clave, 'ev-a'), EVIDENCIA);
  const archivoB = await pasar(crearCifradorArchivo(b.clave, 'ev-b'), EVIDENCIA);
  const campoA = cifrarCampo(a.clave, 'cred-a', Buffer.from('secreto-a'));
  return { sellada, a, b, archivoA, archivoB, campoA };
}

describe('TS-10 · Borrado criptográfico', () => {
  it('con la clave todavía disponible, los datos se leen (control del propio test)', async () => {
    const { a, archivoA, campoA } = await escenario();
    expect(
      (await pasar(crearDescifradorArchivo(a.clave, 'ev-a'), archivoA)).equals(EVIDENCIA),
    ).toBe(true);
    expect(descifrarCampo(a.clave, 'cred-a', campoA).toString()).toBe('secreto-a');
  });

  it('sin la clave de proyecto, ni la contraseña ni la maestra recuperan los datos', async () => {
    const { sellada, a, archivoA, campoA } = await escenario();
    // Eliminar el proyecto: se borra de memoria y se destruye la envoltura.
    borrar(a.clave, a.envuelta);

    const maestra = await abrirBoveda(CONTRASENA(), sellada);
    expect(() => abrirClaveProyecto(maestra, 'proyecto-a', a.envuelta)).toThrow(ErrorCripto);

    // La clave era aleatoria: no se deriva de la maestra. Tampoco sirve la maestra en su lugar.
    await expect(pasar(crearDescifradorArchivo(maestra, 'ev-a'), archivoA)).rejects.toMatchObject({
      codigo: 'AUTENTICACION',
    });
    expect(() => descifrarCampo(maestra, 'cred-a', campoA)).toThrow(ErrorCripto);
  });

  it('un proyecto nuevo con el mismo ID no recupera los datos del eliminado', async () => {
    const { sellada, a, archivoA } = await escenario();
    borrar(a.clave, a.envuelta);
    const maestra = await abrirBoveda(CONTRASENA(), sellada);
    const nuevo = crearClaveProyecto(maestra, 'proyecto-a');
    await expect(
      pasar(crearDescifradorArchivo(nuevo.clave, 'ev-a'), archivoA),
    ).rejects.toMatchObject({ codigo: 'AUTENTICACION' });
  });

  it('los demás proyectos siguen funcionando', async () => {
    const { sellada, a, b, archivoB } = await escenario();
    borrar(a.clave, a.envuelta);
    const maestra = await abrirBoveda(CONTRASENA(), sellada);
    const claveB = abrirClaveProyecto(maestra, 'proyecto-b', b.envuelta);
    expect((await pasar(crearDescifradorArchivo(claveB, 'ev-b'), archivoB)).equals(EVIDENCIA)).toBe(
      true,
    );
  });

  it('LÍMITE documentado: una copia de la envoltura todavía abre la clave', async () => {
    const { sellada, a } = await escenario();
    const copiaEnUnRespaldo = Buffer.from(a.envuelta);
    const claveOriginal = Buffer.from(a.clave);
    borrar(a.clave, a.envuelta);
    const maestra = await abrirBoveda(CONTRASENA(), sellada);
    expect(abrirClaveProyecto(maestra, 'proyecto-a', copiaEnUnRespaldo)).toEqual(claveOriginal);
  });
});
