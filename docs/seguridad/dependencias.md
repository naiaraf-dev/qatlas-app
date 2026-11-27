# Alertas de dependencias

Decisiones sobre alertas de seguridad de dependencias: qué se hizo, por qué y cuándo revisarlo.

`npm run audit:deps` corre `npm audit --audit-level=high` en el job de calidad del CI: falla con una alerta
alta o crítica. Las moderadas y bajas no lo frenan; se revisan acá.

## Regla: paquetes nativos nuevos esperan 30 días

Un paquete nuevo con binarios nativos (`.node`, ejecutables o bibliotecas compiladas) entra recién cuando
tiene **al menos 30 días desde su publicación** en el registro, aunque sea opcional o solo de desarrollo y
llegue como dependencia de otra. Así hay tiempo para que se detecte una versión maliciosa o retirada. La
excepción es una urgencia de seguridad: se documenta acá con el motivo.

Si una actualización trae un paquete así, esa actualización espera. Se revisa el lockfile
(`npm ls <paquete>` y `npm view <paquete> time.created`) antes de aceptarla.

## Vite 8.4.0: espera por `napi-windows-process-start-time` (2026-11-26)

- **Qué trae:** Vite 8.4.0 suma `napi-windows-process-start-time` 0.1.0 como `optionalDependency`: un
  binario nativo de Windows que su CLI usa para leer cuándo arrancó un proceso. Sin él, Vite usa PowerShell.
  Es solo de desarrollo y no va en la app.
- **Lo revisado:** sin script de instalación, licencia MIT, procedencia SLSA, mantenido por alguien del
  equipo de Vite.
- **Decisión:** se publicó el 2026-11-13. Por la regla de arriba, Vite y `@vitejs/plugin-react` quedan en
  8.3.5 y 6.2.1 hasta el 2026-12-13, o hasta que Dependabot traiga una versión más nueva y se revise de nuevo.

## minimatch < 11.0.1: denegación de servicio por amplificación de `globParts` (moderada)

- **Estado:** resuelta el 2026-11-26. `eslint` 10.15.0 pide `minimatch` ^11.0.5 (lo cita por la
  CVE-2026-118764) y `typescript-eslint` 8.74.0, ^11.0.1. Se sacó el `overrides` y su comentario: queda
  `minimatch` 11.0.9 en todo el árbol, y `npm audit` no reporta nada.
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
