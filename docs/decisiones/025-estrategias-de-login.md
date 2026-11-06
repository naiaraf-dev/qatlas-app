# 025 — Estrategias de login, roles y proxy de login

- **Estado:** aceptada
- **Fecha:** 2026-11-06

Hasta la semana 6a, una credencial era un formulario: usuario, secreto, URL de login y pasos. Los sistemas reales
entran de otras formas: un proveedor de identidad en otro dominio, un enlace de un portal, un segundo factor que
solo una persona puede completar, o la autenticación básica del servidor. El catálogo completo, con las fases de
las que llegan después, está en la especificación (6.2.1).

## Decisión

**Cinco estrategias en la fase 1:** formulario, SSO con redirección, enlace con token, login asistido y HTTP básica.
Ninguna tiene un campo de texto libre para un valor secreto: el contrato no sabe de estrategias, y es el proceso
principal el que valida lo que cada una exige.

- **SSO:** los pasos se hacen en la pantalla del proveedor. El proveedor va en los **dominios de autenticación**.
- **Enlace con token:** el secreto es el enlace completo, cifrado. La URL de login sale de él, sin la query: el token
  nunca queda en claro. El enlace se valida como una URL de login (alcance más dominios de autenticación, http solo
  con la opción).
- **Asistido:** no guarda ningún secreto. Ver ADR 028.
- **Básica:** la contraseña viaja al runner en el login y queda en su memoria todo el escaneo, porque va en cada
  pedido. Se va con el proceso, como el secreto de cualquier login (ADR 017).

**Dominios de autenticación:** por proyecto, aparte de los dominios del alcance. Son parte del alcance autorizado:
aparecen en la declaración, y cambiarlos invalida la autorización y queda en la auditoría. Se usan solo durante el
login; el escaneo nunca los visita.

**Proxy de login aparte.** El login corre en un contexto propio de Chromium con su propio proxy, que el proceso
principal levanta solo mientras dura el login, con el alcance más los dominios de autenticación. El proxy del
escaneo no conoce esos dominios: si una página del escaneo redirige al proveedor, se corta, y eso es la señal de que
la sesión venció (ADR 027). Una sonda mostró que en Chromium cada contexto usa el proxy que se le da.

**La básica la pone QAtlas, no Playwright.** Detrás de un proxy por contexto, Chromium nunca manda las
`httpCredentials` de Playwright: una sonda dio 401 con y sin `origin`, con y sin rutas. QAtlas agrega el encabezado
`Authorization` en una ruta del contexto, solo a los pedidos al origen de la URL base. Esa ruta se registra antes de
las protecciones, así que corre después de ellas: un pedido bloqueado nunca la lleva.

**Roles.** Cada credencial tiene un rol, único en el proyecto sin distinguir mayúsculas. Al lanzar un escaneo se
elige con qué credencial, o ninguna. La ejecución guarda la credencial y el rol. Comparar lo que ve cada rol llega en
la fase 4; la estructura ya está.

**La estrategia no se cambia.** El secreto guardado es de una forma: una contraseña no es un enlace, y pasar a
asistido dejaría un secreto que no se usa. Para otra estrategia se crea otra credencial.

**Migración 6.** SQLite no deja sacar el NOT NULL del secreto: la tabla de credenciales se reconstruye. Lo existente
queda como formulario, con el secreto intacto y el nombre como rol (con un número si dos tenían el mismo nombre).
Un test fabrica una copia con el esquema 5, comprueba que es igual a una base migrada hasta ahí, la restaura y
verifica las credenciales.

## Consecuencias

- Un login que no se puede automatizar (captcha, segundo factor) igual se puede escanear: con el asistido.
- El proxy de login es un proceso más, por poco tiempo.
- La contraseña de la básica vive más tiempo en el runner que la de un formulario. Es el mismo límite de E-11.
