# 019 — QAtlas no usa archivos `.env`

- **Estado:** aceptada
- **Fecha:** 2026-11-01

## Decisión

QAtlas no lee archivos `.env`, y `.gitignore` los excluye por si alguien crea uno. Un test lo verifica.

- **Secretos de la app:** en la bóveda cifrada. Un archivo en texto plano es lo que la bóveda viene a evitar.
- **Secretos del CI:** en GitHub Secrets.
- **Nada con prefijo `VITE_` puede ser secreto:** Vite copia esas variables dentro del código de la interfaz, y ahí las
  puede leer cualquiera con el instalador.
- **Los procesos de una ejecución** reciben un entorno cerrado (ADR 017): aunque el proceso principal tuviera un secreto
  en su entorno, no lo heredan.
