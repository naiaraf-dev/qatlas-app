import type { ThemePreference } from '@qatlas/shared';

/**
 * Aplica el tema efectivo como `data-theme` en <html> (styles.css lo usa).
 *
 * - "system": sigue la preferencia del sistema operativo y se actualiza sola
 *   cuando cambia (por ejemplo, Windows pasa a modo oscuro a la noche).
 * - "light" / "dark": fijo, elegido por la persona.
 *
 * Devuelve una función para dejar de escuchar los cambios del sistema.
 */
export function applyTheme(preference: ThemePreference): () => void {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const set = (theme: 'light' | 'dark') => {
    root.dataset.theme = theme;
  };

  if (preference !== 'system') {
    set(preference);
    return () => undefined;
  }

  const sync = () => {
    set(media.matches ? 'dark' : 'light');
  };
  sync();
  media.addEventListener('change', sync);
  return () => {
    media.removeEventListener('change', sync);
  };
}
