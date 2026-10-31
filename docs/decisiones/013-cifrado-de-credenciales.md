# 013 — Cifrado de las credenciales

- **Estado:** aceptada
- **Fecha:** 2026-10-30

## Contexto

La sección 3.4 pide cifrado a nivel de campo: aun con la base abierta, el secreto solo se descifra al usarlo.
RN-PRY-04 dice que nunca se muestra completo. Quedaba definir qué ata el valor cifrado, si se muestra algún
indicio y qué pasa al reemplazar claves.

## Decisión

- **Cifrado:** `cifrarCampo` de `packages/crypto`: AES-256-GCM con la subclave de campos, derivada por HKDF de
  la clave del proyecto. Nonce aleatorio de 96 bits.
- **AAD:** además de versión y propósito, el contexto `credencial/<proyectoId>/<credencialId>/secreto`. Un
  valor copiado a otra credencial o a otro proyecto no se autentica. El usuario y el nombre no entran: se
  pueden editar sin volver a cifrar.
- **Sin indicio.** La interfaz recibe `secretoConfigurado: true` y la fecha del último reemplazo. Los últimos
  caracteres o el largo filtran información, y un hash permite probar contraseñas sin conexión. Es más estricto
  que RN-PRY-04, que lo permitía.
- **Un solo lugar descifra:** `ServicioProyectos.usarSecreto`, al que no llega ningún canal IPC. Exige
  autorización vigente y una URL de login admitida, y borra el valor al terminar, también si el uso falla.
- **Reemplazar:** sobrescribe el campo con un nonce nuevo y `secure_delete`. No hay forma de editarlo desde
  `credenciales:guardar`: el esquema rechaza mandar `credencialId` y `secreto` juntos.
- **Cambiar la contraseña maestra** no afecta a las credenciales: solo vuelve a envolver la clave maestra.
- **Rotar la clave del proyecto** no existe por ahora. Cuando exista, descifra y vuelve a cifrar todos los
  campos y archivos del proyecto, en una sola operación.

## Reglas sumadas al revisar la especificación

- **`url_login` dentro de los dominios del proyecto:** ahí se envía el secreto. Si después cambian los dominios
  o la opción de http, la credencial se marca «revisar» y `usarSecreto` se niega a entregarla hasta corregirla.
- **Pasos del login tipados:** `rellenar` con origen `usuario` o `secreto`, `click` y `esperar`, sin un campo de
  valor donde pueda quedar una contraseña escrita a mano. Un selector es texto libre, así que esto reduce el
  riesgo pero no lo elimina.

## Límites

- El secreto viaja de la interfaz al proceso principal como string de JavaScript, que no se puede borrar.
- Una copia de seguridad anterior conserva el secreto viejo. La pantalla de reemplazo lo avisa.
- El usuario de la credencial no tiene cifrado de campo: está protegido por SQLCipher, como dice el modelo de
  datos.

## Verificación

`security-tests/secreto-credenciales.test.ts`, también en el runtime de Electron: el canario no aparece en
ninguna tabla, en la auditoría, en los archivos ni en la salida de los canales, también codificado.
