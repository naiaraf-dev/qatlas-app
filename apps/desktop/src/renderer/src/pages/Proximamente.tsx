import { Icon } from '../ui/Icon';
import { Button, Card, PageHeader } from '../ui/components';
import { PAGES, type PageId } from '../layout/Shell';

/** Lo que ya se puede hacer desde el detalle de cada proyecto, y lo que falta, con su semana real. */
const DESDE_PROYECTOS: Partial<Record<PageId, { description: string; falta: string[] }>> = {
  escaneos: {
    description: 'Recorrer una aplicación autorizada y detectar problemas automáticamente.',
    falta: [
      'Escaneo con login: semana 6b.',
      'Hallazgos de todos los proyectos, con huella y regresiones: semana 8.',
    ],
  },
  ejecuciones: {
    description: 'Lanzar escaneos y suites, seguirlos en vivo y comparar resultados.',
    falta: [
      'Comparar ejecuciones y detectar regresiones: semana 8.',
      'Suites y casos: fase 2.',
      'Una lista de las ejecuciones de todos los proyectos: sin semana asignada.',
    ],
  },
};

const ROADMAP: Partial<Record<PageId, { description: string; when: string }>> = {
  casos: {
    description: 'Importar casos desde Excel, crearlos sin código y agruparlos en suites.',
    when: 'Fase 2',
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

export function Proximamente({
  page,
  onIrAProyectos,
}: {
  page: PageId;
  onIrAProyectos: () => void;
}) {
  const { label, icon } = PAGES[page];
  const desdeProyectos = DESDE_PROYECTOS[page];
  if (desdeProyectos) {
    return (
      <>
        <PageHeader title={label} description={desdeProyectos.description} />
        <Card>
          <div className="flex flex-col gap-4">
            <p>
              Hoy los escaneos se lanzan y se siguen desde el detalle de cada proyecto, en la
              tarjeta «Ejecuciones», con su progreso en vivo y sus hallazgos.
            </p>
            <div>
              <Button variant="primary" onClick={onIrAProyectos}>
                Ir a Proyectos
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="inline-flex items-center gap-2 font-medium">
                <Icon name="clock" size={16} />
                Lo que todavía falta
              </p>
              <ul className="list-disc pl-5 text-muted">
                {desdeProyectos.falta.map((linea) => (
                  <li key={linea}>{linea}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </>
    );
  }
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
