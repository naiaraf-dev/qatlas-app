import { useEffect, useState, type ReactNode } from 'react';
import type {
  ErrorValidacion,
  ProyectoDetalle,
  ProyectoEntrada,
  ProyectoResumen,
} from '@qatlas/shared';
import { Button, Card, PageHeader } from '../../ui/components';
import { Asistente } from './Asistente';
import {
  aLineas,
  Aviso,
  Campo,
  CamposAlcance,
  CamposControles,
  Casilla,
  CLASE_ENTRADA,
  Declaracion,
  erroresDe,
  InsigniaAutorizacion,
  limpiar,
  numerosValidos,
} from './comunes';
import { Credenciales } from './Credenciales';

export type VistaProyectos =
  | { tipo: 'lista' }
  | { tipo: 'nuevo' }
  | { tipo: 'detalle'; id: string }
  | { tipo: 'editar'; id: string };

export function Proyectos({ inicial }: { inicial: VistaProyectos }) {
  const [vista, setVista] = useState<VistaProyectos>(inicial);
  const lista = () => {
    setVista({ tipo: 'lista' });
  };
  const detalle = (id: string) => {
    setVista({ tipo: 'detalle', id });
  };

  switch (vista.tipo) {
    case 'lista':
      return (
        <Lista
          onNuevo={() => {
            setVista({ tipo: 'nuevo' });
          }}
          onAbrir={detalle}
        />
      );
    case 'nuevo':
      return <Asistente onCancelar={lista} onCreado={detalle} />;
    case 'detalle':
      return (
        <Detalle
          key={vista.id}
          id={vista.id}
          onVolver={lista}
          onEditar={() => {
            setVista({ tipo: 'editar', id: vista.id });
          }}
        />
      );
    case 'editar':
      return (
        <Edicion
          key={vista.id}
          id={vista.id}
          onListo={() => {
            detalle(vista.id);
          }}
        />
      );
  }
}

function Lista({ onNuevo, onAbrir }: { onNuevo: () => void; onAbrir: (id: string) => void }) {
  const [proyectos, setProyectos] = useState<ProyectoResumen[] | null>(null);

  useEffect(() => {
    void window.qatlas.proyectos.listar().then((res) => {
      setProyectos(res.ok ? res.data : []);
    });
  }, []);

  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Cada proyecto es una aplicación autorizada, con sus dominios y sus límites."
        actions={
          <Button variant="primary" icon="folderPlus" onClick={onNuevo}>
            Crear proyecto
          </Button>
        }
      />
      {proyectos?.length === 0 && (
        <Card>
          <p className="text-muted">Todavía no hay proyectos.</p>
        </Card>
      )}
      {proyectos && proyectos.length > 0 && (
        <ul className="flex flex-col gap-3">
          {proyectos.map((proyecto) => (
            <li key={proyecto.id}>
              <button
                type="button"
                onClick={() => {
                  onAbrir(proyecto.id);
                }}
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 text-left shadow-card transition-colors hover:bg-surface-2"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-semibold">{proyecto.nombre}</span>
                  <span className="text-[13.5px] break-all text-muted">{proyecto.urlBase}</span>
                </span>
                <InsigniaAutorizacion estado={proyecto.autorizacion} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted">{etiqueta}</dt>
      <dd className="break-words whitespace-pre-line">{children}</dd>
    </div>
  );
}

const siNo = (valor: boolean) => (valor ? 'Activado' : 'Desactivado');

function Detalle({
  id,
  onVolver,
  onEditar,
}: {
  id: string;
  onVolver: () => void;
  onEditar: () => void;
}) {
  const [proyecto, setProyecto] = useState<ProyectoDetalle | null | undefined>(undefined);

  const [refrescos, setRefrescos] = useState(0);
  const cargar = () => {
    setRefrescos((n) => n + 1);
  };

  useEffect(() => {
    void window.qatlas.proyectos.obtener({ id }).then((res) => {
      setProyecto(res.ok ? res.data : null);
    });
  }, [id, refrescos]);

  if (proyecto === undefined) return null;
  if (proyecto === null) {
    return (
      <>
        <PageHeader title="Proyecto no encontrado" />
        <div>
          <Button onClick={onVolver}>Volver a proyectos</Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={proyecto.nombre}
        description={proyecto.descripcion || undefined}
        actions={
          <>
            <Button onClick={onVolver}>Volver</Button>
            <Button variant="primary" onClick={onEditar}>
              Editar proyecto
            </Button>
          </>
        }
      />

      <Autorizacion proyecto={proyecto} onCambio={cargar} />

      <Card title="Alcance">
        <dl className="flex flex-col gap-3">
          <Dato etiqueta="URL base">{proyecto.urlBase}</Dato>
          <Dato etiqueta="Dominios permitidos">{aLineas(proyecto.dominios)}</Dato>
          <Dato etiqueta="Sistema interno">{siNo(proyecto.sistemaInterno)}</Dato>
          <Dato etiqueta="Permitir login sin cifrar (http)">
            {siNo(proyecto.permitirLoginHttp)}
          </Dato>
        </dl>
      </Card>

      <Card title="Límites y controles">
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <Dato etiqueta="Solicitudes por segundo">{proyecto.maxRps}</Dato>
          <Dato etiqueta="Máximo de páginas">{proyecto.maxPaginas}</Dato>
          <Dato etiqueta="Profundidad">{proyecto.maxProfundidad}</Dato>
          <Dato etiqueta="Timeout por página">{proyecto.timeoutPaginaSegundos} s</Dato>
          <Dato etiqueta="Modo solo lectura">{siNo(proyecto.soloLectura)}</Dato>
          <Dato etiqueta="Modo datos sensibles">{siNo(proyecto.modoDatosSensibles)}</Dato>
        </dl>
      </Card>

      <Credenciales
        proyectoId={proyecto.id}
        credenciales={proyecto.credenciales}
        onCambio={cargar}
      />

      <Eliminar proyecto={proyecto} onEliminado={onVolver} />
    </>
  );
}

function Autorizacion({ proyecto, onCambio }: { proyecto: ProyectoDetalle; onCambio: () => void }) {
  const [acepta, setAcepta] = useState(false);
  const [fallo, setFallo] = useState(false);

  const aceptar = async () => {
    setFallo(false);
    const res = await window.qatlas.proyectos.aceptarAutorizacion({
      id: proyecto.id,
      aceptacion: { aceptada: true, ...proyecto.declaracion },
    });
    if (res.ok && res.data.resultado === 'aceptada') {
      setAcepta(false);
      onCambio();
    } else {
      setFallo(true);
    }
  };

  return (
    <Card title="Autorización" action={<InsigniaAutorizacion estado={proyecto.autorizacion} />}>
      {proyecto.autorizacion.vigente ? (
        <p className="text-muted">
          Aceptada el{' '}
          {proyecto.aceptadaEn ? new Date(proyecto.aceptadaEn).toLocaleDateString('es') : '—'}.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <Aviso>
            Sin autorización vigente no se puede ejecutar nada en este proyecto. Revisá el alcance y
            aceptá la declaración.
          </Aviso>
          <Declaracion texto={proyecto.declaracion.texto} />
          <Casilla etiqueta="Acepto esta declaración" marcada={acepta} onChange={setAcepta} />
          {fallo && <Aviso tipo="peligro">No se pudo registrar la aceptación.</Aviso>}
          <div>
            <Button variant="primary" disabled={!acepta} onClick={() => void aceptar()}>
              Aceptar autorización
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Eliminar({
  proyecto,
  onEliminado,
}: {
  proyecto: ProyectoDetalle;
  onEliminado: () => void;
}) {
  const [confirmacion, setConfirmacion] = useState('');
  const [fallo, setFallo] = useState(false);

  const eliminar = async () => {
    setFallo(false);
    const res = await window.qatlas.proyectos.eliminar({
      id: proyecto.id,
      nombreConfirmacion: confirmacion,
    });
    if (res.ok && res.data.resultado === 'eliminado') onEliminado();
    else setFallo(true);
  };

  return (
    <Card title="Eliminar proyecto">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void eliminar();
        }}
      >
        <Aviso tipo="peligro">
          Se destruye la clave del proyecto y se borran sus credenciales y datos. No se puede
          deshacer.{' '}
          <strong className="font-semibold">
            Las copias de seguridad anteriores todavía contienen este proyecto
          </strong>
          : si alguna salió de este equipo, QAtlas no la puede borrar.
        </Aviso>
        <Campo etiqueta={`Para confirmar, escribí «${proyecto.nombre}»`}>
          {(props) => (
            <input
              {...props}
              className={CLASE_ENTRADA}
              value={confirmacion}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setConfirmacion(event.target.value);
              }}
            />
          )}
        </Campo>
        {fallo && <Aviso tipo="peligro">No se pudo eliminar el proyecto.</Aviso>}
        <div>
          <Button variant="primary" type="submit" disabled={confirmacion !== proyecto.nombre}>
            Eliminar definitivamente
          </Button>
        </div>
      </form>
    </Card>
  );
}

function aEntrada(detalle: ProyectoDetalle): ProyectoEntrada {
  return {
    nombre: detalle.nombre,
    descripcion: detalle.descripcion,
    urlBase: detalle.urlBase,
    dominios: detalle.dominios,
    maxRps: detalle.maxRps,
    maxPaginas: detalle.maxPaginas,
    maxProfundidad: detalle.maxProfundidad,
    timeoutPaginaSegundos: detalle.timeoutPaginaSegundos,
    soloLectura: detalle.soloLectura,
    exclusiones: detalle.exclusiones,
    modoDatosSensibles: detalle.modoDatosSensibles,
    selectoresSensibles: detalle.selectoresSensibles,
    sistemaInterno: detalle.sistemaInterno,
    permitirLoginHttp: detalle.permitirLoginHttp,
  };
}

function Edicion({ id, onListo }: { id: string; onListo: () => void }) {
  const [original, setOriginal] = useState<ProyectoDetalle | null>(null);
  const [valor, setValor] = useState<ProyectoEntrada | null>(null);
  const [dominiosTexto, setDominiosTexto] = useState('');
  const [errores, setErrores] = useState<ErrorValidacion[]>([]);
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    void window.qatlas.proyectos.obtener({ id }).then((res) => {
      if (!res.ok || !res.data) return;
      const entrada = aEntrada(res.data);
      setOriginal(res.data);
      setValor(entrada);
      setDominiosTexto(aLineas(entrada.dominios));
    });
  }, [id]);

  if (!valor || !original) return null;

  const cambiar = (cambios: Partial<ProyectoEntrada>) => {
    setValor({ ...valor, ...cambios });
    setErrores([]);
  };

  // Comparación local solo para avisar antes: la que decide es la del proceso principal.
  const alcanceCambiado =
    valor.urlBase !== original.urlBase ||
    dominiosTexto !== aLineas(original.dominios) ||
    valor.sistemaInterno !== original.sistemaInterno;

  const guardar = async () => {
    setFallo(false);
    const res = await window.qatlas.proyectos.actualizar({ id, proyecto: limpiar(valor) });
    if (!res.ok) setFallo(true);
    else if (res.data.resultado === 'actualizado') onListo();
    else setErrores(res.data.errores);
  };

  return (
    <>
      <PageHeader title={`Editar ${original.nombre}`} />
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void guardar();
          }}
        >
          <Campo etiqueta="Nombre" errores={erroresDe(errores, 'nombre')}>
            {(props) => (
              <input
                {...props}
                className={CLASE_ENTRADA}
                value={valor.nombre}
                maxLength={120}
                onChange={(event) => {
                  cambiar({ nombre: event.target.value });
                }}
              />
            )}
          </Campo>
          <Campo etiqueta="Descripción (opcional)">
            {(props) => (
              <textarea
                {...props}
                className={`${CLASE_ENTRADA} py-2`}
                rows={2}
                maxLength={2000}
                value={valor.descripcion}
                onChange={(event) => {
                  cambiar({ descripcion: event.target.value });
                }}
              />
            )}
          </Campo>
          <CamposAlcance
            valor={valor}
            onChange={cambiar}
            errores={errores}
            dominiosTexto={dominiosTexto}
            onDominiosTexto={setDominiosTexto}
          />
          {alcanceCambiado && (
            <Aviso>
              Cambiaste el alcance: al guardar, la autorización deja de valer y hay que aceptarla de
              nuevo.
            </Aviso>
          )}
          <Casilla
            etiqueta="Permitir login sin cifrar (http)"
            ayuda="Sin esta opción, la URL de login en http solo se acepta en localhost, 127.0.0.1 y .test."
            marcada={valor.permitirLoginHttp}
            onChange={(permitirLoginHttp) => {
              cambiar({ permitirLoginHttp });
            }}
          />
          {valor.permitirLoginHttp && (
            <Aviso tipo="peligro">
              Con esta opción, el usuario y el secreto pueden viajar sin cifrar: cualquiera en la
              misma red los podría leer. Usala solo en una red de confianza. Queda en la auditoría.
            </Aviso>
          )}
          <CamposControles valor={valor} onChange={cambiar} />
          {fallo && <Aviso tipo="peligro">No se pudo guardar. Revisá los datos.</Aviso>}
          <div className="flex flex-wrap gap-2.5">
            <Button
              variant="primary"
              type="submit"
              disabled={!valor.nombre.trim() || !numerosValidos(valor)}
            >
              Guardar cambios
            </Button>
            <Button variant="ghost" onClick={onListo}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
