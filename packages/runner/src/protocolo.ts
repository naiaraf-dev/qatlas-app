import { IndicadorExito, PasoLogin, SeveridadHallazgo, TipoHallazgo } from '@qatlas/shared';
import { z } from 'zod';

/**
 * Lo que el proceso principal y los procesos de una ejecución se mandan. Esquemas estrictos: el
 * runner rechaza cualquier campo de más, y por construcción nunca recibe claves ni rutas de la
 * bóveda (especificación 3.7).
 */

export const Politica = z
  .object({
    urlBase: z.string().max(2048),
    dominios: z.array(z.string().max(300)).max(50),
    sistemaInterno: z.boolean(),
    puertosLocales: z.array(z.number().int().min(1).max(65535)).max(20),
  })
  .strict();

const Credencial = z.object({ usuario: z.string().min(1), clave: z.string().min(1) }).strict();

export const MensajeAlProxy = z
  .object({ tipo: z.literal('iniciar'), politica: Politica, credencial: Credencial })
  .strict();
export type MensajeAlProxy = z.infer<typeof MensajeAlProxy>;

const Regla = z.string().max(60);
const Destino = z.string().max(300);

export const MensajeDelProxy = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('listo'), puerto: z.number().int().min(1).max(65535) }).strict(),
  z
    .object({ tipo: z.literal('conexion'), destino: Destino, permitida: z.boolean(), regla: Regla })
    .strict(),
]);
export type MensajeDelProxy = z.infer<typeof MensajeDelProxy>;

const Configuracion = z
  .object({
    politica: Politica,
    proxy: z
      .object({ servidor: z.string().max(100), usuario: z.string(), clave: z.string() })
      .strict(),
    timeoutPaginaMs: z.number().int().positive(),
  })
  .strict();
export type Configuracion = z.infer<typeof Configuracion>;

const ProxyDeContexto = z
  .object({ servidor: z.string().max(100), usuario: z.string(), clave: z.string() })
  .strict();

/** Cómo se entra (ADR 025). Ningún campo lleva un secreto: ese viaja aparte, solo para el login. */
export const Autenticacion = z
  .object({
    estrategia: z.enum(['formulario', 'sso', 'token-url', 'asistido', 'basica']),
    urlLogin: z.string().max(2048),
    pasos: z.array(PasoLogin).max(30),
    indicador: IndicadorExito.nullable(),
    usuario: z.string().max(320),
    dominiosAutenticacion: z.array(z.string().max(300)).max(20),
    sesionMaxMs: z.number().int().positive().nullable(),
    /** «Permitir login sin cifrar» del proyecto: sin esto, la básica nunca va sobre http. */
    permitirLoginHttp: z.boolean(),
  })
  .strict();
export type Autenticacion = z.infer<typeof Autenticacion>;

/** El estado de sesión, con límites: lo arma el runner, pero sale de un sitio no confiable. */
export const EstadoSesion = z
  .object({
    cookies: z
      .array(
        z
          .object({
            name: z.string().max(300),
            value: z.string().max(8192),
            domain: z.string().max(300),
            path: z.string().max(2048),
            expires: z.number(),
            httpOnly: z.boolean(),
            secure: z.boolean(),
            sameSite: z.enum(['Strict', 'Lax', 'None']),
          })
          .strict(),
      )
      .max(300),
    origins: z
      .array(
        z
          .object({
            origin: z.string().max(2048),
            localStorage: z
              .array(z.object({ name: z.string().max(300), value: z.string().max(65536) }).strict())
              .max(300),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();

/**
 * Qué evidencias graba un escaneo (semana 7b). Con el modo datos sensibles (EVI-05): sin video, sin
 * snapshots del DOM y con todos los campos de formulario tapados en las capturas.
 */
export const OpcionesEvidencias = z
  .object({
    video: z.boolean(),
    snapshots: z.boolean(),
    capturas: z.boolean(),
    traza: z.boolean(),
    selectoresSensibles: z.array(z.string().min(1).max(500)).max(200),
    enmascararFormularios: z.boolean(),
    maxCapturas: z.number().int().nonnegative(),
  })
  .strict();
export type OpcionesEvidencias = z.infer<typeof OpcionesEvidencias>;

export const MensajeAlRunner = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('escaneo'),
      configuracion: Configuracion,
      maxPaginas: z.number().int().positive(),
      maxProfundidad: z.number().int().positive(),
      maxMinutos: z.number().int().positive(),
      maxRps: z.number().int().positive(),
      soloLectura: z.boolean(),
      exclusiones: z.array(z.string().max(200)).max(200),
      // Null: escaneo anónimo.
      autenticacion: Autenticacion.nullable(),
      // La sesión de un login anterior con la misma credencial, si sigue en memoria (ADR 026).
      sesionPrevia: z
        .object({
          estado: EstadoSesion,
          urlComprobacion: z.string().max(2048),
          edadMs: z.number().int().nonnegative(),
        })
        .strict()
        .nullable(),
      evidencias: OpcionesEvidencias,
    })
    .strict(),
  // Probar login: la configuración trae el proxy de login. El secreto llega solo en un login.
  z
    .object({
      tipo: z.literal('probar-login'),
      configuracion: Configuracion,
      autenticacion: Autenticacion,
      politicaDelEscaneo: Politica,
      secreto: z.instanceof(Uint8Array).nullable(),
    })
    .strict(),
  // La respuesta a «necesita-login»: el proxy de login, recién levantado, y el secreto.
  z
    .object({
      tipo: z.literal('datos-login'),
      proxy: ProxyDeContexto,
      politica: Politica,
      secreto: z.instanceof(Uint8Array).nullable(),
    })
    .strict(),
  // No hay login: límite, login fallido o pausa cancelada. El proceso principal sabe por qué.
  z.object({ tipo: z.literal('login-denegado') }).strict(),
  z.object({ tipo: z.literal('cancelar') }).strict(),
  // Qué textos de la página tienen un secreto: esos elementos se tapan en la captura (EVI-04).
  z
    .object({
      tipo: z.literal('tapar-en-captura'),
      indices: z.array(z.number().int().nonnegative()).max(2000),
    })
    .strict(),
  // El proceso principal ya escribió estos fotogramas: el runner puede mandar más (f5).
  z
    .object({ tipo: z.literal('evidencia-procesada'), fotogramas: z.number().int().positive() })
    .strict(),
]);
export type MensajeAlRunner = z.infer<typeof MensajeAlRunner>;

const Cantidad = z.number().int().nonnegative();
const Momento = z.number().nonnegative();
const Tramo = z.number().int().positive();
const Bytes = (maximo: number) =>
  z.instanceof(Uint8Array).refine((datos) => datos.byteLength > 0 && datos.byteLength <= maximo);
const Encabezados = z
  .array(z.object({ nombre: z.string().max(200), valor: z.string().max(8192) }).strict())
  .max(150);

/** Lo que el runner ve de la página para la traza. Texto del sitio: el principal lo redacta todo. */
export const EventoTraza = z.discriminatedUnion('clase', [
  z
    .object({
      clase: z.literal('navegacion'),
      t: Momento,
      tramo: Tramo.nullable(),
      url: z.string().max(2048),
    })
    .strict(),
  z
    .object({
      clase: z.literal('accion'),
      t: Momento,
      tramo: Tramo.nullable(),
      accion: z.enum(['click']),
      objetivo: z.string().max(300),
    })
    .strict(),
  z
    .object({
      clase: z.literal('red'),
      t: Momento,
      tramo: Tramo.nullable(),
      metodo: z.string().max(16),
      url: z.string().max(4096),
      tipoRecurso: z.string().max(30),
      estado: z.number().int().nullable(),
      encabezadosSolicitud: Encabezados,
      encabezadosRespuesta: Encabezados,
      cuerpoSolicitud: z.string().max(65_536).nullable(),
      tipoContenidoSolicitud: z.string().max(200).nullable(),
      error: z.string().max(200).nullable(),
      duracionMs: z.number().int().nullable(),
    })
    .strict(),
  z
    .object({
      clase: z.literal('consola'),
      t: Momento,
      tramo: Tramo.nullable(),
      nivel: z.string().max(20),
      texto: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      clase: z.literal('excepcion'),
      t: Momento,
      tramo: Tramo.nullable(),
      texto: z.string().max(2000),
    })
    .strict(),
  z
    .object({
      clase: z.literal('snapshot'),
      t: Momento,
      tramo: Tramo,
      html: z.string().max(1_000_100),
      enmascarados: Cantidad,
    })
    .strict(),
]);
export type EventoTraza = z.infer<typeof EventoTraza>;

/** Tamaños máximos de lo que llega en bytes. Lo que pasa de esto se rechaza. */
export const MAX_BYTES_FOTOGRAMA = 2 * 1024 * 1024;
export const MAX_BYTES_CAPTURA = 15 * 1024 * 1024;

export const MensajeDelRunner = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('conexion'),
      proceso: z.enum(['navegador', 'runner']),
      destino: Destino,
      permitida: z.boolean(),
      regla: Regla,
    })
    .strict(),
  z
    .object({
      tipo: z.literal('pagina'),
      url: z.string().max(2048),
      status: z.number().int().nullable(),
      tiempoCargaMs: z.number().nonnegative().nullable(),
      profundidad: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('hallazgo'),
      hallazgo: z
        .object({
          tipo: TipoHallazgo,
          severidad: SeveridadHallazgo,
          url: z.string().max(2048),
          urlOrigen: z.string().max(2048).nullable(),
          clave: z.string().max(300),
          titulo: z.string().max(300),
          detalle: z.string().max(2000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('escaneo-terminado'),
      paginasVisitadas: Cantidad,
      linksExcluidos: Cantidad,
      detenido: z.enum(['max-paginas', 'max-tiempo', 'sesion']).nullable(),
      noRecorridosSoloLectura: Cantidad,
      noRecorridosExclusiones: Cantidad,
      urlsDescartadas: Cantidad,
      websocketDescartados: Cantidad,
    })
    .strict(),
  // Solo un resultado: ningún contenido de la página cruza este canal (EVI-01).
  z
    .object({
      tipo: z.literal('login-terminado'),
      resultado: z.enum([
        'funciono',
        'fallo',
        'ventana-cerrada',
        'tiempo-agotado',
        'ventana-no-disponible',
      ]),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('necesita-login'),
      motivo: z.enum(['inicial', 'planificada', 'vencida']),
      // El anterior falló: el proceso principal decide si hay otro.
      reintento: z.boolean(),
    })
    .strict(),
  // El estado, para guardarlo cifrado en memoria. Nunca a la base ni al disco (ADR 026).
  z.discriminatedUnion('resultado', [
    z
      .object({
        tipo: z.literal('sesion'),
        resultado: z.literal('ok'),
        estado: EstadoSesion,
        urlComprobacion: z.string().max(2048),
      })
      .strict(),
    z
      .object({
        tipo: z.literal('sesion'),
        resultado: z.enum(['fallo', 'ventana-cerrada', 'tiempo-agotado']),
      })
      .strict(),
  ]),
  // La causa y el detalle van al log del proceso principal, no a la interfaz.
  z
    .object({
      tipo: z.literal('navegador-no-disponible'),
      causa: z.enum(['ruta', 'perfil-ruta-larga', 'sandbox', 'dependencias', 'pantalla', 'otra']),
      detalle: z.string().max(300),
    })
    .strict(),
  // La ventana del login asistido no se pudo abrir: el login no se reintenta. Al log, no a la interfaz.
  z
    .object({
      tipo: z.literal('ventana-no-disponible'),
      causa: z.enum(['ruta', 'perfil-ruta-larga', 'sandbox', 'dependencias', 'pantalla', 'otra']),
      detalle: z.string().max(300),
    })
    .strict(),
  z.object({ tipo: z.literal('rechazado') }).strict(),
  // Evidencias (semana 7b). Un tramo es una página del crawler: su video se conserva o se descarta.
  z.object({ tipo: z.literal('tramo-inicio'), tramo: Tramo }).strict(),
  z
    .object({
      tipo: z.literal('tramo-fin'),
      tramo: Tramo,
      errorNavegacion: z.boolean(),
      perdidos: Cantidad,
      // Los descartados después del último fotograma enviado: el hueco va al final del tramo.
      perdidosAlFinal: Cantidad,
    })
    .strict(),
  z
    .object({
      tipo: z.literal('fotograma'),
      tramo: Tramo,
      t: Momento,
      perdidosAntes: Cantidad,
      datos: Bytes(MAX_BYTES_FOTOGRAMA),
    })
    .strict(),
  z
    .object({
      tipo: z.literal('captura'),
      tramo: Tramo,
      enmascarados: Cantidad,
      datos: Bytes(MAX_BYTES_CAPTURA),
    })
    .strict(),
  z.object({ tipo: z.literal('traza'), evento: EventoTraza }).strict(),
  // Antes de una captura: el texto visible de cada elemento, para que el principal diga qué tapar.
  z
    .object({
      tipo: z.literal('textos-de-captura'),
      tramo: Tramo,
      textos: z.array(z.string().max(5000)).max(2000),
    })
    .strict(),
]);
export type MensajeDelRunner = z.infer<typeof MensajeDelRunner>;
