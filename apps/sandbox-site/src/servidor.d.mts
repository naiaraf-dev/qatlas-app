export const HOST_ESCUCHA: string;
export const PUERTO_POR_DEFECTO: number;
export const HOST_SITIO: string;
export const CREDENCIALES_DE_PRUEBA: { usuario: string; clave: string };
export const HOSTS_DE_FUGA: string[];
export const MAPA_DE_HOSTS: Readonly<Record<string, string>>;
export const REGLAS_RESOLVER: string;

export interface SandboxActivo {
  puerto: number;
  direccion: string;
  url: string;
  registro: { fugas: string[]; trampas: string[]; posts: string[] };
  cerrar(): Promise<void>;
}

export function iniciarSandbox(opciones?: {
  puerto?: number;
  demoraLentaMs?: number;
}): Promise<SandboxActivo>;
