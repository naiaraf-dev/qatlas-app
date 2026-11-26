import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from 'react-aria-components';
import { App } from './App';
import './styles.css';
import { applyTheme } from './theme';
import { ProveedorDeAvisos } from './ui/avisos';

// Antes del primer render, para que no haya un destello con el tema equivocado.
applyTheme('system');

const container = document.getElementById('root');
if (!container) throw new Error('No se encontró el contenedor #root');

createRoot(container).render(
  <StrictMode>
    {/* Textos y anuncios de los controles en español (ADR 042). */}
    <I18nProvider locale="es-AR">
      <ProveedorDeAvisos>
        <App />
      </ProveedorDeAvisos>
    </I18nProvider>
  </StrictMode>,
);
