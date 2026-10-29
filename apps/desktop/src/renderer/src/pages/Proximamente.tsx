import { Icon } from '../ui/Icon';
import { Card, PageHeader } from '../ui/components';
import { PAGES, type PageId } from '../layout/Shell';

const ROADMAP: Partial<Record<PageId, { description: string; when: string }>> = {
  escaneos: {
    description: 'Recorrer una aplicación autorizada y detectar problemas automáticamente.',
    when: 'Fase 1 · semanas 5 y 6',
  },
  casos: {
    description: 'Importar casos desde Excel, crearlos sin código y agruparlos en suites.',
    when: 'Fase 2',
  },
  ejecuciones: {
    description: 'Lanzar escaneos y suites, seguirlos en vivo y comparar resultados.',
    when: 'Fase 1 · semana 6',
  },
  hallazgos: {
    description: 'Revisar los problemas detectados, con evidencia y detección de regresiones.',
    when: 'Fase 1 · semana 8',
  },
  reportes: {
    description: 'Generar reportes de bug y de ejecución, y exportarlos de forma segura.',
    when: 'Fase 1 · semana 9',
  },
  uat: {
    description: 'Ejecutar rondas de UAT paso a paso y emitir el acta de conformidad.',
    when: 'Fase 2',
  },
};

export function Proximamente({ page }: { page: PageId }) {
  const { label, icon } = PAGES[page];
  const info = ROADMAP[page];
  return (
    <>
      <PageHeader title={label} description={info?.description} />
      <Card>
        <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft text-accent-soft-text">
            <Icon name={icon} size={26} />
          </span>
          <h2 className="text-lg font-semibold">En construcción</h2>
          {info && (
            <p className="inline-flex items-center gap-2 text-muted">
              <Icon name="clock" size={16} />
              Llega en: {info.when}
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
