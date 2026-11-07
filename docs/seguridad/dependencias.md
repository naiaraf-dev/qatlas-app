# Alertas de dependencias

Decisiones sobre alertas de seguridad de dependencias: qué se hizo, por qué y cuándo revisarlo.

`npm run audit:deps` corre `npm audit --audit-level=high` en el job de calidad del CI: falla con una alerta
alta o crítica. Las moderadas y bajas no lo frenan; se revisan acá.

## minimatch < 11.0.1: denegación de servicio por amplificación de `globParts` (moderada)

- **Fecha:** 2026-11-07.
- **Por dónde llega:** `eslint` 10.14.0 (y `@eslint/config-array`) y `typescript-eslint` 8.72.1, que piden
  `minimatch` ^10. Solo dependencias de desarrollo: `npm ls minimatch --omit=dev` da vacío, y el bundle
  de la app no la incluye.
- **Por qué no aplica en la práctica:** el ataque pide patrones controlados por un atacante. Acá los
  patrones son los de `eslint.config.js` y los que arma typescript-eslint, escritos en el repo.
- **Qué se hizo:** un `overrides` de npm a `minimatch` 11.0.1 en el `package.json` de la raíz, con un
  comentario (`//overrides`). Con el override, eslint revisa los mismos 150 archivos, con los mismos
  ignorados y sin errores, y `npm audit` no reporta nada. Suma una dependencia de desarrollo de minimatch
  11: `@isaacs/nonrecursive-glob-match`.
- **Cuándo sacarlo:** cuando `eslint` y `typescript-eslint` pidan `minimatch` 11. Si una versión nueva de
  eslint deja de funcionar con el override, no se fuerza: se saca y se vuelve a esta nota.
