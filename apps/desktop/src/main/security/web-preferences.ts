import type { WebPreferences } from 'electron';

/**
 * Preferencias de seguridad de TODAS las ventanas de QAtlas (especificación 3.6).
 *
 * Es una constante exportada para que la suite de seguridad (TS-07) pueda
 * verificarla. No se crean ventanas con otras preferencias.
 */
export const SECURE_WEB_PREFERENCES = {
  // Aislamiento: el código de la página y el preload viven en mundos separados.
  contextIsolation: true,
  // La interfaz corre en el sandbox de Chromium, sin acceso al sistema.
  sandbox: true,
  // Sin Node.js en la interfaz, en workers ni en subframes.
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  // Política del mismo origen y sin contenido mixto.
  webSecurity: true,
  allowRunningInsecureContent: false,
  // Sin <webview>, sin funciones experimentales de Chromium.
  webviewTag: false,
  experimentalFeatures: false,
  // Arrastrar un archivo o link a la ventana no navega a él.
  navigateOnDragDrop: false,
  // El corrector ortográfico de Chromium descarga diccionarios desde servidores
  // de Google: sería una conexión saliente no autorizada.
  spellcheck: false,
  // Evita que la página bloquee la app con diálogos en bucle.
  safeDialogs: true,
  // El clic del medio en un link puede abrir navegación por fuera de los
  // controles de will-navigate.
  disableBlinkFeatures: 'Auxclick',
} as const satisfies WebPreferences;

/** Claves que deben tener exactamente este valor en cada ventana (usado por TS-07). */
export const REQUIRED_PREFERENCE_VALUES: Readonly<Record<string, boolean>> = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
};
