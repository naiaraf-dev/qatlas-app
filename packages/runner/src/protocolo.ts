import { IndicadorExito, PasoLogin } from '@qatlas/shared';
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

export const MensajeAlRunner = z.discriminatedUnion('tipo', [
  z
    .object({
      tipo: z.literal('escaneo'),
      configuracion: Configuracion,
      maxPaginas: z.number().int().positive(),
      maxRps: z.number().int().positive(),
      soloLectura: z.boolean(),
      exclusiones: z.array(z.string().max(200)).max(200),
    })
    .strict(),
  // El secreto llega solo acá, y solo para el login.
  z
    .object({
      tipo: z.literal('login'),
      configuracion: Configuracion,
      urlLogin: z.string().max(2048),
      pasos: z.array(PasoLogin).max(30),
      indicador: IndicadorExito,
      usuario: z.string().max(320),
      secreto: z.instanceof(Uint8Array),
    })
    .strict(),
  z.object({ tipo: z.literal('cancelar') }).strict(),
]);
export type MensajeAlRunner = z.infer<typeof MensajeAlRunner>;

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
      tipo: z.literal('escaneo-terminado'),
      paginasVisitadas: z.number().int().nonnegative(),
      linksExcluidos: z.number().int().nonnegative(),
    })
    .strict(),
  // Solo un resultado: ningún contenido de la página cruza este canal (EVI-01).
  z.object({ tipo: z.literal('login-terminado'), funciono: z.boolean() }).strict(),
  // La causa y el detalle van al log del proceso principal, no a la interfaz.
  z
    .object({
      tipo: z.literal('navegador-no-disponible'),
      causa: z.enum(['ruta', 'perfil-ruta-larga', 'sandbox', 'dependencias', 'otra']),
      detalle: z.string().max(300),
    })
    .strict(),
  z.object({ tipo: z.literal('rechazado') }).strict(),
]);
export type MensajeDelRunner = z.infer<typeof MensajeDelRunner>;
