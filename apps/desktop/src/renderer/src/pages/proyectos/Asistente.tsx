import { useState } from 'react';
import type { ErrorValidacion, IpcResponse, ProyectoEntrada } from '@qatlas/shared';
import { Button, Card, PageHeader } from '../../ui/components';
import {
  Aviso,
  Campo,
  CamposAlcance,
  CamposControles,
  Casilla,
  CLASE_ENTRADA,
  Declaracion,
  erroresDe,
  limpiar,
  numerosValidos,
  proyectoNuevo,
} from './comunes';

type Paso = 'datos' | 'alcance' | 'controles' | 'autorizacion';
const PASOS: readonly { id: Paso; titulo: string }[] = [
  { id: 'datos', titulo: 'Datos' },
  { id: 'alcance', titulo: 'Alcance' },
  { id: 'controles', titulo: 'Límites y controles' },
  { id: 'autorizacion', titulo: 'Autorización' },
];

const ERROR_INTERNO: ErrorValidacion = { campo: 'declaracion', motivo: 'declaracion-distinta' };

/** CU-01: nada se guarda hasta aceptar la autorización, que es el último paso. */
export function Asistente({
  onCancelar,
  onCreado,
}: {
  onCancelar: () => void;
  onCreado: (id: string) => void;
}) {
  const [valor, setValor] = useState<ProyectoEntrada>(proyectoNuevo);
  const [paso, setPaso] = useState<Paso>('datos');
  const [dominiosTexto, setDominiosTexto] = useState('');
  const [dominiosEditados, setDominiosEditados] = useState(false);
  const [errores, setErrores] = useState<ErrorValidacion[]>([]);
  const [declaracion, setDeclaracion] =
    useState<IpcResponse<'proyectos:validar'>['declaracion']>(null);
  const [acepta, setAcepta] = useState(false);
  const [fallo, setFallo] = useState(false);

  const cambiar = (cambios: Partial<ProyectoEntrada>) => {
    setValor((actual) => ({ ...actual, ...cambios }));
    setErrores([]);
    // Si el alcance cambia, lo aceptado ya no corresponde.
    setAcepta(false);
  };

  const validar = async () => {
    setFallo(false);
    const res = await window.qatlas.proyectos.validar({ proyecto: limpiar(valor) });
    if (!res.ok) {
      setFallo(true);
      return null;
    }
    return res.data;
  };

  const irAAlcance = async () => {
    const datos = await validar();
    if (!datos) return;
    const errorDeNombre = datos.errores.filter((e) => e.campo === 'nombre');
    if (errorDeNombre.length > 0) {
      setErrores(errorDeNombre);
      return;
    }
    if (datos.dominioPropuesto && !dominiosEditados) {
      setDominiosTexto(datos.dominioPropuesto);
      setValor((actual) => ({ ...actual, dominios: [datos.dominioPropuesto as string] }));
    }
    setErrores([]);
    setPaso('alcance');
  };

  const irAControles = async () => {
    const datos = await validar();
    if (!datos) return;
    if (datos.errores.length > 0) {
      setErrores(datos.errores);
      return;
    }
    setPaso('controles');
  };

  const irAAutorizacion = async () => {
    const datos = await validar();
    if (!datos) return;
    if (datos.errores.length > 0 || !datos.declaracion) {
      setErrores(datos.errores);
      return;
    }
    setDeclaracion(datos.declaracion);
    setAcepta(false);
    setPaso('autorizacion');
  };

  const crear = async () => {
    if (!declaracion) return;
    setFallo(false);
    const res = await window.qatlas.proyectos.crear({
      proyecto: limpiar(valor),
      aceptacion: { aceptada: true, ...declaracion },
    });
    if (!res.ok) {
      setFallo(true);
    } else if (res.data.resultado === 'creado') {
      onCreado(res.data.id);
    } else {
      setErrores(res.data.errores.length > 0 ? res.data.errores : [ERROR_INTERNO]);
    }
  };

  const indice = PASOS.findIndex((p) => p.id === paso);
  const anterior = PASOS[indice - 1];

  return (
    <>
      <PageHeader
        title="Nuevo proyecto"
        description="Un proyecto es la aplicación que vas a probar y sus límites de seguridad."
      />

      <ol aria-label="Pasos" className="flex flex-wrap gap-2">
        {PASOS.map((p, i) => (
          <li
            key={p.id}
            aria-current={p.id === paso ? 'step' : undefined}
            className={
              p.id === paso
                ? 'rounded-full bg-accent-soft px-3 py-1 text-[13px] font-semibold text-accent-soft-text'
                : 'rounded-full border border-border px-3 py-1 text-[13px] text-muted'
            }
          >
            {i + 1}. {p.titulo}
          </li>
        ))}
      </ol>

      <Card title={PASOS[indice]?.titulo ?? ''}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {paso === 'datos' && (
            <>
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
              <Campo etiqueta="URL base" ayuda="La dirección donde empiezan las pruebas.">
                {(props) => (
                  <input
                    {...props}
                    className={CLASE_ENTRADA}
                    value={valor.urlBase}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(event) => {
                      cambiar({ urlBase: event.target.value });
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
            </>
          )}

          {paso === 'alcance' && (
            <CamposAlcance
              valor={valor}
              onChange={cambiar}
              errores={errores}
              dominiosTexto={dominiosTexto}
              onDominiosTexto={(texto) => {
                setDominiosTexto(texto);
                setDominiosEditados(true);
              }}
              ayudaDominios="Se propone el de la URL. Uno por línea; *.lexora.test cubre sus subdominios. Toda conexión a otro dominio se bloquea y se registra."
            />
          )}

          {paso === 'controles' && <CamposControles valor={valor} onChange={cambiar} />}

          {paso === 'autorizacion' && declaracion && (
            <>
              <Declaracion texto={declaracion.texto} />
              {erroresDe(errores, 'declaracion').map((error) => (
                <Aviso key={error} tipo="peligro">
                  {error}
                </Aviso>
              ))}
              <Casilla etiqueta="Acepto esta declaración" marcada={acepta} onChange={setAcepta} />
            </>
          )}

          {fallo && <Aviso tipo="peligro">No se pudo completar. Revisá los datos.</Aviso>}

          <div className="flex flex-wrap gap-2.5">
            {paso === 'datos' && (
              <Button
                variant="primary"
                disabled={!valor.nombre.trim() || !valor.urlBase.trim()}
                onClick={() => void irAAlcance()}
              >
                Siguiente
              </Button>
            )}
            {paso === 'alcance' && (
              <Button variant="primary" onClick={() => void irAControles()}>
                Siguiente
              </Button>
            )}
            {paso === 'controles' && (
              <Button
                variant="primary"
                disabled={!numerosValidos(valor)}
                onClick={() => void irAAutorizacion()}
              >
                Siguiente
              </Button>
            )}
            {paso === 'autorizacion' && (
              <Button variant="primary" disabled={!acepta} onClick={() => void crear()}>
                Crear proyecto
              </Button>
            )}
            {anterior && (
              <Button
                onClick={() => {
                  setErrores([]);
                  setPaso(anterior.id);
                }}
              >
                Atrás
              </Button>
            )}
            <Button variant="ghost" onClick={onCancelar}>
              Cancelar
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
