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

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <rect width="28" height="28" rx="8" fill="var(--qa-accent)" />
      <circle cx="13" cy="13" r="6" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M17.5 17.5 21 21" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
