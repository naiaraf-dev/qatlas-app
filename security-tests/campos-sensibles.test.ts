/**
 * Contraseñas y secretos en la interfaz: un campo controlado por React copia el valor al atributo
 * `value`, legible en el HTML. Todo campo de contraseña pasa por `EntradaSensible`, que no lo es.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const INTERFAZ = path.resolve(import.meta.dirname, '../apps/desktop/src/renderer/src');
const COMPONENTE = path.join('ui', 'EntradaSensible.tsx');

const archivos = (readdirSync(INTERFAZ, { recursive: true }) as string[]).filter((nombre) =>
  nombre.endsWith('.tsx'),
);
const leer = (nombre: string) => readFileSync(path.join(INTERFAZ, nombre), 'utf8');

describe('Campos sensibles', () => {
  it('el único campo de contraseña de la interfaz es EntradaSensible', () => {
    expect(archivos.filter((nombre) => leer(nombre).includes('type="password"'))).toEqual([
      COMPONENTE,
    ]);
  });

  it('no es controlado y lleva sus atributos', () => {
    const fuente = leer(COMPONENTE);
    expect(fuente).not.toMatch(/\b(value|defaultValue)=\{/);
    expect(fuente).toContain('autoComplete={autocompletar}');
    expect(fuente).toContain('spellCheck={false}');
  });

  it('new-password solo donde se define un valor; current-password donde ya existe', () => {
    const usos = (nombre: string, valor: string) =>
      leer(nombre).split(`autocompletar="${valor}"`).length - 1;
    const acceso = path.join('pages', 'Acceso.tsx');
    const boveda = path.join('pages', 'Boveda.tsx');
    const credenciales = path.join('pages', 'proyectos', 'Credenciales.tsx');
    // Acceso: primer inicio (dos campos) como nuevas; restauración y desbloqueo como existentes.
    expect(usos(acceso, 'new-password')).toBe(2);
    expect(usos(acceso, 'current-password')).toBe(2);
    expect(usos(boveda, 'new-password')).toBe(0);
    expect(usos(boveda, 'current-password')).toBe(1);
    expect(usos(credenciales, 'current-password')).toBe(0);
  });

  it('ninguna pantalla guarda una contraseña o un secreto en el estado de React', () => {
    const estado = /const \[\w*(contrasena|secreto|confirmacion)\w*,\s*set\w+\] = useState/i;
    expect(archivos.filter((nombre) => estado.test(leer(nombre)))).toEqual([]);
  });
});
