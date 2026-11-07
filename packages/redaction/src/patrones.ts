/**
 * Patrones de secretos con formato conocido (EVI-04). Lista propia, de alta precisión: cada patrón tiene
 * un prefijo o una estructura que un texto común no tiene. Algunos se adaptaron de las reglas de gitleaks
 * (https://github.com/gitleaks/gitleaks, licencia MIT, Copyright (c) 2019 Zachary Rice): aws, github,
 * gitlab, slack, stripe, google-api, npm, sendgrid y clave-privada.
 *
 * Mantenimiento (ADR 030): un patrón nuevo entra con un ejemplo positivo y uno negativo en
 * `patrones.test.ts`, inventados y armados por partes. Revisar esta lista cuando gitleaks publique
 * reglas nuevas para servicios que el equipo use.
 */
import type { TipoRedaccion } from './tipos';

export interface Patron {
  id: string;
  tipo: TipoRedaccion;
  /** Con la bandera `g`. Si tiene un grupo con nombre `secreto`, se redacta solo ese grupo. */
  expresion: RegExp;
  descripcion: string;
}

export const PATRONES: readonly Patron[] = [
  {
    id: 'clave-privada-pem',
    tipo: 'clave-privada',
    // Hasta el END; si el bloque llegó cortado, hasta el final del texto.
    expresion:
      /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g,
    descripcion: 'Clave privada en formato PEM (RSA, EC, OpenSSH, PKCS #8, PGP).',
  },
  {
    id: 'jwt',
    tipo: 'jwt',
    expresion: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    descripcion: 'JSON Web Token: cabecera y contenido en base64url que empiezan con «{"».',
  },
  {
    id: 'aws-access-key',
    tipo: 'clave-api',
    expresion: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b/g,
    descripcion: 'ID de clave de acceso de AWS.',
  },
  {
    id: 'github-token',
    tipo: 'clave-api',
    expresion: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{82}\b/g,
    descripcion: 'Token de GitHub (personal, OAuth, de app o fine-grained).',
  },
  {
    id: 'gitlab-token',
    tipo: 'clave-api',
    expresion: /\bglpat-[A-Za-z0-9_-]{20}\b/g,
    descripcion: 'Token personal de GitLab.',
  },
  {
    id: 'slack-token',
    tipo: 'clave-api',
    expresion: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
    descripcion: 'Token de Slack.',
  },
  {
    id: 'stripe-key',
    tipo: 'clave-api',
    expresion: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    descripcion: 'Clave secreta o restringida de Stripe.',
  },
  {
    id: 'google-api-key',
    tipo: 'clave-api',
    expresion: /\bAIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])/g,
    descripcion: 'Clave de API de Google.',
  },
  {
    id: 'npm-token',
    tipo: 'clave-api',
    expresion: /\bnpm_[A-Za-z0-9]{36}\b/g,
    descripcion: 'Token de acceso de npm.',
  },
  {
    id: 'anthropic-key',
    tipo: 'clave-api',
    expresion: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    descripcion: 'Clave de API de Anthropic.',
  },
  {
    id: 'openai-key',
    tipo: 'clave-api',
    expresion: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{32,}/g,
    descripcion: 'Clave de API de OpenAI.',
  },
  {
    id: 'sendgrid-key',
    tipo: 'clave-api',
    expresion: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g,
    descripcion: 'Clave de API de SendGrid.',
  },
  {
    id: 'bearer',
    tipo: 'bearer',
    expresion: /\b(?:Bearer|Token)\s+(?<secreto>[A-Za-z0-9\-._~+/]{8,}=*)/gi,
    descripcion: 'Token después de «Bearer» o «Token», como en un encabezado Authorization.',
  },
  {
    id: 'basica',
    tipo: 'basica',
    expresion: /\bBasic\s+(?<secreto>[A-Za-z0-9+/]{8,}={0,2})/g,
    descripcion: 'Usuario y contraseña de la autenticación básica (base64).',
  },
  {
    id: 'url-con-usuario',
    tipo: 'url-con-usuario',
    expresion: /\b[a-z][a-z0-9+.-]*:\/\/(?<secreto>[^\s/@:?#]+:[^\s/@?#]+)@/gi,
    descripcion: 'Usuario y contraseña dentro de una URL.',
  },
];
