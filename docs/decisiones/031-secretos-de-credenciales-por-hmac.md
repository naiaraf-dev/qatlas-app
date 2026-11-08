# 031 — Los secretos de las credenciales se buscan por su HMAC

- **Estado:** aceptada
- **Fecha:** 2026-11-07

## Contexto

Lo que más importa redactar es el secreto de una credencial del proyecto, si el sitio lo devuelve: en la
consola, en una URL, en un log. Para encontrarlo hay que compararlo con el texto, pero el detector no
puede guardar el valor en claro, ni tenerlo en memoria más de lo necesario.

## Decisión

**`ComparadorDeSecretos`** (`packages/redaction/src/comparador.ts`). Al empezar una ejecución, el proceso
principal descifra los secretos de las credenciales del proyecto, crea el comparador y los borra. El
comparador:

- calcula el HMAC-SHA-256 de cada variante del secreto (tal cual, codificado para URL o para un formulario,
  base64 con y sin relleno, base64url y hexadecimal), con una clave aleatoria propia;
- guarda solo el largo y el HMAC de cada variante;
- busca recorriendo el texto con una ventana de cada largo y comparando HMAC. Para los textos que maneja
  (detalles de hasta 2000 caracteres, URLs), son unos milisegundos.

Se descarta (se borra la clave y se olvidan los HMAC) cuando la ejecución termina: después de que el runner
y el proxy salieron, para que un mensaje tardío del proxy también se compare.

**Un secreto partido en dos mensajes consecutivos** (de la consola de una página): el comparador mira
también la unión con el mensaje anterior de la misma página. Si el secreto cruza el borde, se redacta la
parte que quedó en cada uno, y el anterior, que ya estaba guardado, se vuelve a cifrar. El último mensaje
de cada página se conserva sin redactar solo en memoria, y se olvida al terminar.

## Tradeoffs

- El largo de cada variante queda en memoria.
- Quien tuviera a la vez la clave del comparador y los HMAC podría probar candidatos. Los dos viven solo en
  la memoria del proceso principal, durante la ejecución.
- Los secretos de menos de 4 caracteres no se buscan: darían falsos positivos.
- Una codificación que no está en la lista (por ejemplo, el secreto dentro de un base64 más largo, sin
  alinearse) no se encuentra. Los patrones genéricos siguen corriendo.
- Alternativa descartada: mantener el valor en claro durante la ejecución. Es más simple, pero lo deja en
  memoria todo ese tiempo.
