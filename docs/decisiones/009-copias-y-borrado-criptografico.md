# 009 — Copias de seguridad y borrado criptográfico

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

El borrado criptográfico (TS-10) destruye la clave de un proyecto. Pero una copia de seguridad anterior
conserva esa clave envuelta y sigue abriendo con la contraseña que tenía al crearse. Una copia que ya
salió del equipo no se puede borrar desde QAtlas.

## Opciones

| Opción                                     | Motivo                                                               |
| ------------------------------------------ | -------------------------------------------------------------------- |
| **Lápidas y aviso claro**                  | **Elegida.** Honesta sobre el límite y mantiene útil la copia        |
| Clave de las copias solo en la bóveda viva | Borrado real, pero la copia no sirve justo cuando se pierde el disco |
| Prohibir borrar proyectos si hay copias    | QAtlas no sabe dónde quedaron las copias ni si todavía existen       |

## Decisión

- La tabla `proyecto_lapida` guarda el ID y la fecha de cada proyecto eliminado.
- **Al restaurar sobre una bóveda existente: primero se combinan las lápidas de la bóveda actual con
  las de la copia, y después se purga.** Así, un proyecto eliminado después de hacer la copia no vuelve.
- La purga borra sus filas de todas las tablas de `TABLAS_DE_PROYECTO`, con `secure_delete` y `VACUUM`.
- La interfaz avisa que las copias anteriores todavía contienen los proyectos eliminados.

## Límites

- **Una copia fuera del equipo sigue conteniendo el proyecto.** Quien tenga esa copia y su contraseña
  puede abrirla con otra instalación de QAtlas, o con otras herramientas. Este límite no se puede
  eliminar sin perder la utilidad de la copia.
- **Restaurar en una instalación sin bóveda:** no hay lápidas actuales, así que un proyecto eliminado
  después de la copia vuelve a aparecer.
- **Con la bóveda bloqueada se rechaza** restaurar sobre ella: sus lápidas están cifradas. Por eso, quien
  **perdió la contraseña** de una bóveda sana todavía no puede restaurar desde la app. Queda pendiente,
  junto con el borrado completo de la bóveda (RN-BOV-04), que da la salida explícita.
- **Bóveda dañada:** se permite restaurar, porque no se pueden leer sus lápidas y la alternativa es
  perderlo todo. Se avisa antes con un diálogo que un proyecto eliminado podría volver.

## Verificación

`boveda.test.ts` prueba el orden con un proyecto eliminado antes de la copia, otro después y otro vivo.
La purga real de cada tabla se suma con la eliminación de proyectos (semana 4) y el TS-10 completo
(semana 9). `TABLAS_DE_PROYECTO` empieza vacía porque todavía no hay tablas de proyecto.
