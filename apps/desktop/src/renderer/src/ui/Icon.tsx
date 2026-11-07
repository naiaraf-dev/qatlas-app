import { useId } from 'react';

/**
 * Íconos de QAtlas: trazo de 2 px, esquinas redondeadas, 24×24.
 * Son decorativos (aria-hidden): el texto que los acompaña es el que da el nombre.
 * Un botón que solo tiene ícono debe llevar aria-label.
 */
const PATHS = {
  home: ['M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
  scan: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-3.5-3.5'],
  cases: ['M9 6h11M9 12h11M9 18h11', 'm3 6 1 1 2-2M3 12l1 1 2-2M3 18l1 1 2-2'],
  play: ['M7 4v16l13-8z'],
  alert: ['M12 3 2 20h20z', 'M12 10v4M12 17h.01'],
  report: ['M6 3h9l5 5v13H6z', 'M14 3v6h6M9 13h7M9 17h5'],
  uat: [
    'M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M2.5 20a6.5 6.5 0 0 1 13 0',
    'm16 11 2 2 4-4',
  ],
  shield: ['M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z'],
  shieldCheck: ['M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z', 'm9 12 2 2 4-4'],
  lock: ['M5 11h14v10H5z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  chevronDown: ['m7 10 5 5 5-5'],
  check: ['m5 12 5 5 9-10'],
  x: ['M6 6l12 12M18 6 6 18'],
  sun: [
    'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    'M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  ],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z'],
  monitor: ['M3 4h18v12H3z', 'M8 20h8M12 16v4'],
  folderPlus: [
    'M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
    'M12 10v6M9 13h6',
  ],
  sheet: ['M5 3h14v18H5z', 'M5 9h14M5 15h14M11 3v18'],
  refresh: ['M20 11a8 8 0 0 0-14.9-3M4 4v4h4', 'M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * El isotipo de QAtlas (docs/marca): el círculo es la aplicación que se prueba; la línea, el escaneo que
 * la recorre. Colores con los tokens de marca, que cambian con el modo. Por debajo de 32 px, la geometría
 * chica (trazos más gruesos, menos barras), como `icono-app-chico.svg`. Decorativo: el nombre va al lado.
 */
const ISOTIPO = {
  normal: {
    alto: 29,
    barras: [
      [12.23, 33.2, 11.46, 4.0],
      [26.07, 33.2, 11.86, 4.0],
      [40.3, 33.2, 11.46, 4.0],
      [14.0, 40.4, 13.5, 3.2],
      [30.56, 40.4, 19.44, 3.2],
      [17.99, 46.6, 16.11, 2.5],
      [36.48, 46.6, 9.52, 2.5],
      [26.23, 52, 11.53, 1.9],
    ],
    linea: 31,
    grosor: 1.8,
    punto: 2.6,
  },
  chica: {
    alto: 28.6,
    barras: [
      [12.89, 33.6, 16.82, 5.0],
      [34.29, 33.6, 16.82, 5.0],
      [15.69, 42.2, 32.61, 4.0],
      [22.58, 49.6, 18.83, 3.0],
    ],
    linea: 31.2,
    grosor: 3.0,
    punto: 3.8,
  },
} as const;

export function Logo({ size = 28 }: { size?: number }) {
  const recorte = useId();
  const g = size < 32 ? ISOTIPO.chica : ISOTIPO.normal;
  return (
    <svg width={size} height={size} viewBox="1.5 1 64 64" aria-hidden="true" data-marca="isotipo">
      <clipPath id={recorte}>
        <circle cx="32" cy="32" r="22" />
      </clipPath>
      <rect width="64" height={g.alto} clipPath={`url(#${recorte})`} fill="var(--qa-brand)" />
      {g.barras.map(([x, y, ancho, alto]) => (
        <rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={ancho}
          height={alto}
          rx={alto / 2}
          fill="var(--qa-brand)"
        />
      ))}
      <path
        d={`M5 ${g.linea}H59`}
        stroke="var(--qa-brand-scan)"
        strokeWidth={g.grosor}
        strokeLinecap="round"
      />
      <circle cx="59" cy={g.linea} r={g.punto} fill="var(--qa-brand-scan)" />
    </svg>
  );
}
