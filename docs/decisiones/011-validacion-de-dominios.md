# 011 — Validación de dominios con la lista de sufijos públicos

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

RN-PRY-05 prohíbe comodines amplios como `*.com` o `*.co.uk`, y acepta `*.lexora.test`. Saber que `co.uk`
es un sufijo no se puede deducir con reglas: hace falta la lista de sufijos públicos.

## Opciones

| Opción                  | Motivo                                                         |
| ----------------------- | -------------------------------------------------------------- |
| **`tldts`**             | **Elegida.** Lista incluida, sin descargas, se publica seguido |
| `psl`                   | Sin versiones nuevas desde 2024: la lista queda vieja          |
| Lista propia en el repo | Hay que mantenerla y actualizarla a mano                       |
| Reglas propias          | No pueden saber que `co.uk` o `github.io` son sufijos          |

## Dependencias

| Paquete                          | Para qué                  | Script de instalación | Tamaño instalado | Licencia | Mantenimiento                        |
| -------------------------------- | ------------------------- | --------------------- | ---------------- | -------- | ------------------------------------ |
| `tldts` 7.4.19                   | Lista de sufijos públicos | No                    | 2,9 MB           | MIT      | Un mantenedor; publicación frecuente |
| `tldts-core` 7.4.20 (transitiva) | Lógica del anterior       | No                    | 513 KB           | MIT      | Mismo mantenedor                     |

Los datos provienen de la Public Suffix List, con licencia **MPL-2.0**: hay que citarla en los avisos de
terceros del instalador (semana 10). Se actualiza subiendo la versión con Dependabot. En ejecución no
descarga nada. Solo se usa en el proceso principal; la interfaz recibe el resultado por `proyectos:validar`,
así hay una sola regla.

## Decisión

Funciones puras en `packages/shared/src/dominios.ts`. Lo dudoso se rechaza. La entrada se normaliza a
minúsculas y punycode, sin esquema, puerto, ruta ni punto final.

- **Comodín:** solo `*.` al principio, sobre un dominio registrable. Se usa la sección privada de la lista,
  así que `*.github.io` también se rechaza. `*.lexora.test` no incluye a `lexora.test`.
- **Propuesta:** se propone el host exacto de la URL, no todo su dominio: no amplía el alcance por su cuenta.
- **Pertenencia:** por etiquetas completas. `lexora.test.evil.com` y `evillexora.test` no pertenecen a
  `lexora.test`.
- **Formas de engañar al parser:** se rechazan `@`, `\`, espacios y controles. El parser de URL convierte
  `2130706433`, `0x7f.1` y `010.0.0.1` en una IPv4, así que se compara con lo escrito: solo vale la forma
  decimal con puntos. También deja pasar `*` en un host, y por eso se exige un nombre DNS.
- **Siempre admitidos:** `localhost` y `127.0.0.1`, exactos. No `foo.localhost` ni `127.0.0.2`.

### Opciones relajables (principio 3.3)

Las dos, por proyecto, desactivadas por defecto y registradas en la auditoría.

| Opción                           | Qué habilita                                                                                               | ¿Invalida la autorización?           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Sistema interno                  | IPs privadas (10/8, 172.16/12, 192.168/16) y nombres de una etiqueta. Host exacto, sin comodines ni rangos | Sí: cambia a qué se puede llegar     |
| Permitir login sin cifrar (http) | `url_login` en http, que sin ella solo vale en `localhost`, `127.0.0.1` y `.test`                          | No: cambia cómo se envía, no a dónde |

**Siempre rechazados, aunque la opción esté activa:** `0.0.0.0` y 0/8, 169.254.0.0/16 (incluye el servicio de
metadatos de la nube), multicast, broadcast, reservadas, otros `127.x`, IPv6 y cualquier IP pública. Un sufijo
como `com` o `test` tampoco se admite como nombre de una etiqueta.

## Consecuencias

- **Tradeoff aceptado:** se confía en un paquete de un solo mantenedor, en su versión exacta.
- Un error de tipeo en el TLD (`lexora.tesst`) se acepta: la lista no puede saber si existe, y por eso no
  rechaza TLDs desconocidos, como `.test` o `.local`.
- **`127.0.0.1` sin puerto cubriría todos los servicios locales.** La lista guarda el dominio sin puerto, y
  **el proxy de la semana 5 debe limitar el acceso a loopback al puerto de la URL base**.
- La validación mira el nombre, no adónde resuelve: un dominio público que apunte a una IP privada se detiene
  en el proxy (semana 5).
- Un homógrafo se muestra en punycode, en la declaración incluida, para que se vea que no es el dominio en
  ASCII.

## Verificación

`packages/shared/src/dominios.test.ts`, con los bordes de cada rango: `172.15.255.255`, `172.16.0.0`,
`172.31.255.255`, `172.32.0.0`, etcétera.
