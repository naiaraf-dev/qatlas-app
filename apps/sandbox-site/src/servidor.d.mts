export const HOST_ESCUCHA: string;
export const PUERTO_POR_DEFECTO: number;
export const HOST_SITIO: string;
export const CREDENCIALES_DE_PRUEBA: { usuario: string; clave: string };
export const HOSTS_DE_FUGA: string[];
export const HOSTS_UDP_DE_FUGA: string[];
export const MAPA_DE_HOSTS: Readonly<Record<string, string>>;
export const REGLAS_RESOLVER: string;
export const HOST_IDP: string;
export const HOST_PORTAL: string;
export const USUARIOS_APP: Readonly<Record<'admin' | 'lector', { usuario: string; clave: string }>>;
export const USUARIO_BASICA: { usuario: string; clave: string };

export interface ZonaAutenticada {
  registro: {
    logins: { via: 'formulario' | 'sso' | 'token' | 'mfa'; rol: string }[];
    vencidas: string[];
    segundoFactor: number;
    basicaRechazada: number;
    rutasConSesion: string[];
  };
  vencerSesiones(): void;
  aprobarSegundoFactor(): void;
  emitirEnlace(rol: 'admin' | 'lector', opciones?: { reutilizable?: boolean }): string;
}

export interface SandboxActivo {
  puerto: number;
  /** Una API en otro puerto: llega si el proyecto lo declara. */
  puertoApi: number;
  /** Otro servicio local, no declarado: si algo llega acá, el proxy falló. */
  puertoTrampa: number;
  /** Receptor UDP: si llega algo, salió del navegador sin pasar por el proxy. */
  puertoUdp: number;
  /** 0 si no se le pasó un certificado. */
  puertoHttps: number;
  direccion: string;
  url: string;
  registro: {
    fugas: string[];
    trampas: string[];
    posts: string[];
    api: string[];
    puertoNoDeclarado: string[];
    websockets: string[];
    serviceWorkers: string[];
    hosts: string[];
    udp: number[];
    tls: (string | null)[];
    https: string[];
    intentosLogin: string[];
    /** Cada página pedida, en orden. Sirve de señal: el navegador llegó hasta acá. */
    rutas: string[];
    /** Lo que una página mandó por WebSocket. En solo lectura, nada. */
    wsMensajes: string[];
  };
  autenticacion: ZonaAutenticada;
  cerrar(): Promise<void>;
}

export function iniciarSandbox(opciones?: {
  puerto?: number;
  demoraLentaMs?: number;
  tls?: { key: string; cert: string };
  sesion?: { inactividadMs?: number; maximoMs?: number; maximoPaginas?: number };
  ahora?: () => number;
  hosts?: { app: string; idp: string; portal: string };
}): Promise<SandboxActivo>;
