import { useState } from 'react';
import type { CredencialResumen, ErrorValidacion, PasoLogin } from '@qatlas/shared';
import { Button, Card } from '../../ui/components';
import { EntradaSensible, useCampoSensible, type CampoSensible } from '../../ui/EntradaSensible';
import { Aviso, Campo, CLASE_ENTRADA, erroresDe } from './comunes';

const PASOS_POR_DEFECTO: PasoLogin[] = [
  { accion: 'rellenar', selector: 'input[type=email]', origen: 'usuario' },
  { accion: 'rellenar', selector: 'input[type=password]', origen: 'secreto' },
  { accion: 'click', selector: 'button[type=submit]' },
];

const ACCIONES = [
  { valor: 'rellenar-usuario', texto: 'Escribir el usuario' },
  { valor: 'rellenar-secreto', texto: 'Escribir el secreto' },
  { valor: 'click', texto: 'Hacer clic' },
  { valor: 'esperar', texto: 'Esperar a que aparezca' },
] as const;
type ValorAccion = (typeof ACCIONES)[number]['valor'];

function valorDeAccion(paso: PasoLogin): ValorAccion {
  if (paso.accion === 'rellenar') {
    return paso.origen === 'usuario' ? 'rellenar-usuario' : 'rellenar-secreto';
  }
  return paso.accion;
}

function aPaso(valor: ValorAccion, selector: string): PasoLogin {
  if (valor === 'rellenar-usuario') return { accion: 'rellenar', selector, origen: 'usuario' };
  if (valor === 'rellenar-secreto') return { accion: 'rellenar', selector, origen: 'secreto' };
  return { accion: valor, selector };
}

/** Sin campo de valor: lo que se escribe sale siempre de la credencial, nunca de un paso. */
function EditorPasos({
  pasos,
  onChange,
}: {
  pasos: PasoLogin[];
  onChange: (pasos: PasoLogin[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">Pasos del login</legend>
      {pasos.map((paso, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Acción del paso ${i + 1}`}
            className={`${CLASE_ENTRADA} w-auto`}
            value={valorDeAccion(paso)}
            onChange={(event) => {
              onChange(
                pasos.map((p, j) =>
                  j === i ? aPaso(event.target.value as ValorAccion, p.selector) : p,
                ),
              );
            }}
          >
            {ACCIONES.map(({ valor, texto }) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
          <input
            aria-label={`Selector del paso ${i + 1}`}
            className={`${CLASE_ENTRADA} w-auto min-w-48 flex-1`}
            value={paso.selector}
            spellCheck={false}
            onChange={(event) => {
              onChange(
                pasos.map((p, j) => (j === i ? aPaso(valorDeAccion(p), event.target.value) : p)),
              );
            }}
          />
          <Button
            variant="ghost"
            aria-label={`Quitar el paso ${i + 1}`}
            onClick={() => {
              onChange(pasos.filter((_, j) => j !== i));
            }}
          >
            Quitar
          </Button>
        </div>
      ))}
      <div>
        <Button
          onClick={() => {
            onChange([...pasos, { accion: 'click', selector: 'button' }]);
          }}
        >
          Agregar paso
        </Button>
      </div>
    </fieldset>
  );
}

function CampoSecreto({ etiqueta, campo }: { etiqueta: string; campo: CampoSensible }) {
  return (
    <Campo etiqueta={etiqueta} ayuda="Se guarda cifrado y nunca se vuelve a mostrar.">
      {(props) => (
        <EntradaSensible {...props} campo={campo} autocompletar="new-password" className="w-full" />
      )}
    </Campo>
  );
}

function FormularioCredencial({
  proyectoId,
  credencial,
  onListo,
  onCancelar,
}: {
  proyectoId: string;
  credencial?: CredencialResumen;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const [nombre, setNombre] = useState(credencial?.nombre ?? '');
  const [usuario, setUsuario] = useState(credencial?.usuario ?? '');
  const [urlLogin, setUrlLogin] = useState(credencial?.urlLogin ?? '');
  const [pasosLogin, setPasos] = useState<PasoLogin[]>(credencial?.pasosLogin ?? PASOS_POR_DEFECTO);
  const campoSecreto = useCampoSensible();
  const [errores, setErrores] = useState<ErrorValidacion[]>([]);
  const [fallo, setFallo] = useState(false);

  const completa =
    nombre.trim() &&
    usuario &&
    urlLogin.trim() &&
    pasosLogin.every((p) => p.selector.trim()) &&
    (credencial || campoSecreto.tieneTexto);

  const guardar = async () => {
    setErrores([]);
    setFallo(false);
    const comunes = { proyectoId, nombre, usuario, urlLogin, pasosLogin };
    const res = await window.qatlas.credenciales.guardar(
      credencial
        ? { ...comunes, credencialId: credencial.id }
        : { ...comunes, secreto: campoSecreto.tomar() },
    );
    if (!res.ok) setFallo(true);
    else if (res.data.resultado === 'guardada') onListo();
    else setErrores(res.data.errores);
  };

  return (
    <form
      aria-label={credencial ? 'Editar credencial' : 'Nueva credencial'}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void guardar();
      }}
    >
      <Campo etiqueta="Nombre de la credencial">
        {(props) => (
          <input
            {...props}
            className={CLASE_ENTRADA}
            value={nombre}
            maxLength={120}
            onChange={(event) => {
              setNombre(event.target.value);
            }}
          />
        )}
      </Campo>
      <Campo etiqueta="Usuario">
        {(props) => (
          <input
            {...props}
            className={CLASE_ENTRADA}
            value={usuario}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setUsuario(event.target.value);
            }}
          />
        )}
      </Campo>
      {!credencial && <CampoSecreto etiqueta="Secreto" campo={campoSecreto} />}
      <Campo etiqueta="URL de login" errores={erroresDe(errores, 'urlLogin')}>
        {(props) => (
          <input
            {...props}
            className={CLASE_ENTRADA}
            value={urlLogin}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setUrlLogin(event.target.value);
            }}
          />
        )}
      </Campo>
      <EditorPasos pasos={pasosLogin} onChange={setPasos} />
      {fallo && <Aviso tipo="peligro">No se pudo guardar. Revisá los datos.</Aviso>}
      <div className="flex flex-wrap gap-2.5">
        <Button variant="primary" type="submit" disabled={!completa}>
          Guardar credencial
        </Button>
        <Button variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function FilaCredencial({
  proyectoId,
  credencial,
  onCambio,
}: {
  proyectoId: string;
  credencial: CredencialResumen;
  onCambio: () => void;
}) {
  const [modo, setModo] = useState<'ver' | 'editar' | 'reemplazar'>('ver');
  const campoSecreto = useCampoSensible();
  const [fallo, setFallo] = useState(false);
  const proximamenteId = `proximamente-login-${credencial.id}`;

  const reemplazar = async () => {
    setFallo(false);
    const res = await window.qatlas.credenciales.reemplazarSecreto({
      proyectoId,
      credencialId: credencial.id,
      secreto: campoSecreto.tomar(),
    });
    if (res.ok) {
      setModo('ver');
      onCambio();
    } else {
      setFallo(true);
    }
  };

  const eliminar = async () => {
    setFallo(false);
    const res = await window.qatlas.credenciales.eliminar({
      proyectoId,
      credencialId: credencial.id,
    });
    if (res.ok) onCambio();
    else setFallo(true);
  };

  if (modo === 'editar') {
    return (
      <FormularioCredencial
        proyectoId={proyectoId}
        credencial={credencial}
        onCancelar={() => {
          setModo('ver');
        }}
        onListo={() => {
          setModo('ver');
          onCambio();
        }}
      />
    );
  }

  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-1">
        <h3 className="font-semibold">{credencial.nombre}</h3>
        <p className="text-[13.5px] text-muted">
          {credencial.usuario} · {credencial.urlLogin}
        </p>
        {/* Solo fuera del reemplazo: mientras tanto, esta línea no confirmaría nada. */}
        {modo === 'ver' && (
          <p className="text-[13.5px]">
            Secreto: Configurado · reemplazado el{' '}
            {new Date(credencial.secretoActualizadoEn).toLocaleDateString('es')}
          </p>
        )}
      </div>
      {credencial.requiereRevision && (
        <Aviso>
          La URL de login quedó fuera de los dominios o en http sin la opción habilitada. Hasta
          corregirla, esta credencial no se puede usar.
        </Aviso>
      )}
      {modo === 'reemplazar' && (
        <form
          aria-label="Reemplazar secreto"
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void reemplazar();
          }}
        >
          <CampoSecreto etiqueta="Secreto nuevo" campo={campoSecreto} />
          <p className="text-[13px] text-muted">
            Las copias de seguridad anteriores conservan el secreto viejo.
          </p>
          <div className="flex flex-wrap gap-2.5">
            <Button variant="primary" type="submit" disabled={!campoSecreto.tieneTexto}>
              Guardar secreto
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                campoSecreto.vaciar();
                setModo('ver');
              }}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}
      {fallo && <Aviso tipo="peligro">No se pudo completar la operación.</Aviso>}
      {modo === 'ver' && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => {
              setModo('editar');
            }}
          >
            Editar credencial
          </Button>
          <Button
            onClick={() => {
              setModo('reemplazar');
            }}
          >
            Reemplazar secreto
          </Button>
          <Button variant="ghost" onClick={() => void eliminar()}>
            Eliminar credencial
          </Button>
          <Button disabled aria-describedby={proximamenteId}>
            Probar login
          </Button>
          <span id={proximamenteId} className="text-[13px] text-muted">
            Llega en: semana 5
          </span>
        </div>
      )}
    </li>
  );
}

export function Credenciales({
  proyectoId,
  credenciales,
  onCambio,
}: {
  proyectoId: string;
  credenciales: CredencialResumen[];
  onCambio: () => void;
}) {
  const [agregando, setAgregando] = useState(false);
  return (
    <Card
      title="Credenciales de prueba"
      action={
        !agregando && (
          <Button
            onClick={() => {
              setAgregando(true);
            }}
          >
            Agregar credencial
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
        {credenciales.length === 0 && !agregando && (
          <p className="text-muted">Todavía no hay credenciales en este proyecto.</p>
        )}
        {credenciales.length > 0 && (
          <ul className="flex flex-col gap-3">
            {credenciales.map((credencial) => (
              <FilaCredencial
                key={credencial.id}
                proyectoId={proyectoId}
                credencial={credencial}
                onCambio={onCambio}
              />
            ))}
          </ul>
        )}
        {agregando && (
          <FormularioCredencial
            proyectoId={proyectoId}
            onCancelar={() => {
              setAgregando(false);
            }}
            onListo={() => {
              setAgregando(false);
              onCambio();
            }}
          />
        )}
      </div>
    </Card>
  );
}
