# Criptografía

> **Pendiente:** Fase 1, semana 2. Esta carpeta se reserva para mantener la estructura del monorepo.

Esquema de claves (Argon2id → KEK → clave maestra → claves por proyecto), cifrado de archivos con AES-256-GCM, borrado criptográfico.

Especificación: `docs/especificacion-qatlas.md`, sección 3.4.

Cuando se implemente, este paquete necesita `package.json`, `tsconfig.json`, tests unitarios y,
si corresponde, su test en `security-tests/`.
