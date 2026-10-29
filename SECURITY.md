# Política de seguridad

QAtlas maneja información sensible por naturaleza: URLs de sistemas internos, credenciales de
prueba, capturas y tráfico de red de las aplicaciones probadas. La seguridad es el requisito
central del proyecto.

## Principios

- **Local-first:** todo se procesa y guarda en el equipo del usuario.
- **Cero telemetría:** sin analíticas ni envío automático de errores.
- **Denegar por defecto:** ninguna conexión está permitida salvo las autorizadas.
- **Cifrado siempre:** ningún dato del usuario se escribe en disco sin cifrar.
- **Verificable:** cada control tiene un test automatizado (suite `security-tests/`).

Detalle completo: sección 3 de [la especificación](docs/especificacion-qatlas.md) y
[modelo de amenazas](docs/modelo-de-amenazas.md).

## Versiones con soporte

El proyecto está en desarrollo (versión 0.x). Solo la última versión de la rama `main` recibe
correcciones de seguridad.

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Usá el reporte privado de vulnerabilidades de GitHub
(pestaña _Security_ → _Report a vulnerability_) e incluí:

- descripción del problema y su impacto;
- pasos para reproducirlo;
- versión de QAtlas y sistema operativo.

Compromiso de respuesta: acuse de recibo en 7 días y evaluación inicial en 14 días. Se publica un
aviso y se reconoce a quien reportó, si así lo desea, una vez disponible la corrección.

## Alcance

**Dentro del alcance:** fugas de datos fuera del equipo, saltos de la contención de red, lectura de
datos de la bóveda sin la contraseña maestra, ejecución de código desde contenido de sitios
probados o archivos importados, escalamiento desde la interfaz al sistema.

**Fuera del alcance:** ataques que requieren control total del equipo mientras la bóveda está
desbloqueada (malware con privilegios de administrador), y vulnerabilidades en los sistemas que el
usuario prueba con QAtlas.
