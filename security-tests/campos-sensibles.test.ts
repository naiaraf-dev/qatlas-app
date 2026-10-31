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
    expect(fuente).toContain('autoComplete="new-password"');
    expect(fuente).toContain('spellCheck={false}');
  });

  it('ninguna pantalla guarda una contraseña o un secreto en el estado de React', () => {
    const estado = /const \[\w*(contrasena|secreto|confirmacion)\w*,\s*set\w+\] = useState/i;
    expect(archivos.filter((nombre) => estado.test(leer(nombre)))).toEqual([]);
  });
});
