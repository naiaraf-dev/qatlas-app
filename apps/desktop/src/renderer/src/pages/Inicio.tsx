import { Icon, type IconName } from '../ui/Icon';
import { Button, Card, PageHeader } from '../ui/components';
import type { PageId } from '../layout/Shell';

const CAPABILITIES: ReadonlyArray<{ icon: IconName; title: string; text: string; when: string }> = [
  {
    icon: 'scan',
    title: 'Escanear',
    text: 'Recorre una aplicación autorizada y detecta errores HTTP, links rotos, errores de JavaScript y problemas de accesibilidad.',
    when: 'Fase 1',
  },
  {
    icon: 'sheet',
    title: 'Probar desde tus planillas',
    text: 'Importá casos de prueba y scripts de UAT desde Excel, ejecutalos paso a paso y devolvé los resultados en el mismo formato.',
    when: 'Fase 2',
  },
  {
    icon: 'report',
    title: 'Reportar con evidencia',
    text: 'Cada falla se convierte en un reporte de bug con capturas, pasos y logs, con los datos sensibles ocultos.',
    when: 'Fase 1',
  },
];

export function Inicio({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  return (
    <>
      <PageHeader
        title="Te damos la bienvenida a QAtlas"
        description="Testing de aplicaciones web en tu equipo: todo queda cifrado en esta computadora y nada sale a internet sin que lo decidas."
      />

      <Card>
        <div className="flex flex-col items-center gap-4 px-4 py-8 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-text">
            <Icon name="folderPlus" size={26} />
          </span>
          <div className="flex flex-col gap-1.5">
            <h2 className="text-lg font-semibold">Todavía no hay proyectos</h2>
            <p className="max-w-md text-muted">
              Un proyecto es la aplicación que vas a probar: su dirección, los dominios permitidos y
              las credenciales de prueba.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button
              variant="primary"
              icon="folderPlus"
              disabled
              aria-describedby="proximamente-proyectos"
            >
              Crear proyecto
            </Button>
            <Button icon="sheet" disabled aria-describedby="proximamente-excel">
              Importar casos desde Excel
            </Button>
          </div>
          <p className="text-[13px] text-muted">
            <span id="proximamente-proyectos">Crear proyectos llega en la semana 4.</span>{' '}
            <span id="proximamente-excel">La importación desde Excel, en la fase 2.</span>
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
        {CAPABILITIES.map((c) => (
          <div
            key={c.title}
            className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-5 shadow-card"
          >
            <div className="flex items-center justify-between">
              <span className="grid size-9 place-items-center rounded-lg bg-accent-soft text-accent-soft-text">
                <Icon name={c.icon} />
              </span>
              <span className="text-xs font-medium text-muted">{c.when}</span>
            </div>
            <h3 className="font-semibold">{c.title}</h3>
            <p className="text-[13.5px] leading-relaxed text-muted">{c.text}</p>
          </div>
        ))}
      </div>

      <Card
        title="Tu información, protegida"
        action={
          <Button
            variant="ghost"
            onClick={() => {
              onNavigate('privacidad');
            }}
          >
            Ver detalle
          </Button>
        }
      >
        <p className="text-muted">
          La interfaz no puede conectarse a internet ni acceder a tus archivos. Podés comprobarlo
          vos misma en <strong className="font-semibold text-text">Privacidad y conexiones</strong>.
        </p>
      </Card>
    </>
  );
}
