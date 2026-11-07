import { useState } from 'react';
import type {
  CredencialResumen,
  ErrorValidacion,
  EstrategiaLogin,
  IndicadorExito,
  IpcResponse,
  PasoLogin,
} from '@qatlas/shared';
import {
  credencialUsable,
  ESTRATEGIAS_PENDIENTES,
  estrategiaDisponible,
  LIMITE_PRUEBAS_LOGIN,
} from '@qatlas/shared';
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

const TIPOS_DE_INDICADOR = [
  {
    valor: '',
    texto: 'Sin indicador',
    ayuda:
      'Sin indicador, la credencial no se puede probar ni usar en un escaneo. En la autenticación básica alcanza con que la URL no responda 401.',
  },
  {
    valor: 'url',
    texto: 'La URL coincide con un patrón',
    ayuda: 'URL sin query, con * como comodín. Ejemplo: https://app.lexora.test/panel*',
  },
  {
    valor: 'aparece',
    texto: 'Aparece un elemento',
    ayuda: 'Un selector que no esté en la pantalla de login, como #menu-usuario.',
  },
  {
    valor: 'desaparece',
    texto: 'Desaparece el formulario de login',
    ayuda: 'Un selector del formulario, como form[action="/login"].',
  },
] as const;

/** Una contraseña mala nunca puede dar verde: sin esto no hay forma de confirmar el ingreso. */
function EditorIndicador({
  indicador,
  onChange,
}: {
  indicador: IndicadorExito | null;
  onChange: (indicador: IndicadorExito | null) => void;
}) {
  const tipo = indicador?.tipo ?? '';
  const texto = indicador ? (indicador.tipo === 'url' ? indicador.patron : indicador.selector) : '';
  const aIndicador = (nuevoTipo: string, valor: string): IndicadorExito | null => {
    if (nuevoTipo === 'url') return { tipo: 'url', patron: valor };
    if (nuevoTipo === 'aparece' || nuevoTipo === 'desaparece') {
      return { tipo: nuevoTipo, selector: valor };
    }
    return null;
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-medium">Indicador de éxito</legend>
      <select
        aria-label="Tipo de indicador"
        className={`${CLASE_ENTRADA} w-auto`}
        value={tipo}
        onChange={(event) => {
          onChange(aIndicador(event.target.value, texto));
        }}
      >
        {TIPOS_DE_INDICADOR.map(({ valor, texto: etiqueta }) => (
          <option key={valor} value={valor}>
            {etiqueta}
          </option>
        ))}
      </select>
      {tipo !== '' && (
        <input
          aria-label="Valor del indicador"
          className={CLASE_ENTRADA}
          value={texto}
          spellCheck={false}
          onChange={(event) => {
            onChange(aIndicador(tipo, event.target.value));
          }}
        />
      )}
      <p className="text-[13px] text-muted">
        {TIPOS_DE_INDICADOR.find(({ valor }) => valor === tipo)?.ayuda}
      </p>
    </fieldset>
  );
}

/** Lo que pide cada forma de login (ADR 025). Las de fases siguientes, en la especificación. */
export const ESTRATEGIAS: Record<
  EstrategiaLogin,
  {
    nombre: string;
    ayuda: string;
    usuario: boolean;
    pasos: boolean;
    etiquetaSecreto: string | null;
    etiquetaReemplazo: string;
    etiquetaUrl: string | null;
    ayudaUrl: string;
  }
> = {
  formulario: {
    nombre: 'Formulario de login',
    ayuda: 'QAtlas completa el formulario del sistema con el usuario y el secreto.',
    usuario: true,
    pasos: true,
    etiquetaSecreto: 'Secreto',
    etiquetaReemplazo: 'Secreto nuevo',
    etiquetaUrl: 'URL de login',
    ayudaUrl: 'Dentro de los dominios permitidos.',
  },
  sso: {
    nombre: 'SSO con redirección',
    ayuda:
      'El sistema manda a otro dominio para entrar (OpenID Connect, OAuth o SAML) y vuelve. Los pasos se hacen en la pantalla del proveedor.',
    usuario: true,
    pasos: true,
    etiquetaSecreto: 'Secreto',
    etiquetaReemplazo: 'Secreto nuevo',
    etiquetaUrl: 'URL donde empieza el login',
    ayudaUrl:
      'La página del sistema que redirige al proveedor. El dominio del proveedor va en «Dominios de autenticación» del proyecto.',
  },
  'token-url': {
    nombre: 'Enlace con token',
    ayuda:
      'Se entra con un enlace que trae el token, como el que da un portal. El enlace completo es el secreto. Si es de un solo uso, cada login lo consume.',
    usuario: false,
    pasos: false,
    etiquetaSecreto: 'Enlace de entrada, con el token',
    etiquetaReemplazo: 'Enlace de entrada nuevo',
    etiquetaUrl: null,
    ayudaUrl: '',
  },
  asistido: {
    nombre: 'Login asistido',
    ayuda:
      'Se abre una ventana del navegador de pruebas y entrás a mano, con segundo factor, captcha o enlace por correo. QAtlas no guarda ningún secreto.',
    usuario: false,
    pasos: false,
    etiquetaSecreto: null,
    etiquetaReemplazo: '',
    etiquetaUrl: 'URL donde se abre la ventana',
    ayudaUrl: 'Dentro de los dominios permitidos o de autenticación.',
  },
  basica: {
    nombre: 'Autenticación HTTP básica',
    ayuda:
      'El servidor pide usuario y contraseña con el diálogo del navegador. Se mandan solo al origen de la URL base.',
    usuario: true,
    pasos: false,
    etiquetaSecreto: 'Secreto',
    etiquetaReemplazo: 'Secreto nuevo',
    etiquetaUrl: 'URL protegida para comprobar el login',
    ayudaUrl: 'Una página que sin credenciales responde 401.',
  },
};

function CampoSecreto({
  etiqueta,
  campo,
  errores = [],
}: {
  etiqueta: string;
  campo: CampoSensible;
  errores?: readonly string[];
}) {
  return (
    <Campo
      etiqueta={etiqueta}
      ayuda="Se guarda cifrado y nunca se vuelve a mostrar."
      errores={errores}
    >
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
  const [rol, setRol] = useState(credencial?.rol ?? '');
  const [estrategia, setEstrategia] = useState<EstrategiaLogin>(
    credencial?.estrategia ?? 'formulario',
  );
  const config = ESTRATEGIAS[estrategia];
  const [usuario, setUsuario] = useState(credencial?.usuario ?? '');
  const [urlLogin, setUrlLogin] = useState(credencial?.urlLogin ?? '');
  const [pasosLogin, setPasos] = useState<PasoLogin[]>(credencial?.pasosLogin ?? PASOS_POR_DEFECTO);
  const [indicadorExito, setIndicador] = useState<IndicadorExito | null>(
    credencial?.indicadorExito ?? null,
  );
  const campoSecreto = useCampoSensible();
  const [errores, setErrores] = useState<ErrorValidacion[]>([]);
  const [fallo, setFallo] = useState(false);

  const pideSecreto = !credencial && config.etiquetaSecreto !== null;
  const completa =
    nombre.trim() &&
    rol.trim() &&
    (!config.usuario || usuario) &&
    (config.etiquetaUrl === null || urlLogin.trim()) &&
    (!config.pasos || pasosLogin.every((p) => p.selector.trim())) &&
    (!indicadorExito ||
      (indicadorExito.tipo === 'url' ? indicadorExito.patron : indicadorExito.selector).trim()) &&
    (!pideSecreto || campoSecreto.tieneTexto);

  const guardar = async () => {
    setErrores([]);
    setFallo(false);
    const comunes = {
      proyectoId,
      nombre,
      rol,
      estrategia,
      usuario: config.usuario ? usuario : '',
      // En el enlace con token, la URL sale del enlace: la deriva el proceso principal.
      urlLogin: config.etiquetaUrl === null ? (credencial?.urlLogin ?? '') : urlLogin,
      pasosLogin: config.pasos ? pasosLogin : [],
      indicadorExito,
    };
    const res = await window.qatlas.credenciales.guardar(
      credencial
        ? { ...comunes, credencialId: credencial.id }
        : pideSecreto
          ? { ...comunes, secreto: campoSecreto.tomar() }
          : comunes,
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
      <Campo
        etiqueta="Rol"
        ayuda="Con qué rol entra esta credencial, como admin o lector. Uno por credencial; al lanzar un escaneo elegís con cuál."
        errores={erroresDe(errores, 'rol')}
      >
        {(props) => (
          <input
            {...props}
            className={CLASE_ENTRADA}
            value={rol}
            maxLength={60}
            autoComplete="off"
            onChange={(event) => {
              setRol(event.target.value);
            }}
          />
        )}
      </Campo>
      <Campo
        etiqueta="Forma de login"
        ayuda={
          credencial ? (
            `${config.ayuda} No se cambia: para otra forma, creá una credencial nueva.`
          ) : (
            <>
              {config.ayuda}
              {Object.entries(ESTRATEGIAS_PENDIENTES).map(([valor, pendiente]) => (
                <span key={valor} className="block">
                  {ESTRATEGIAS[valor as EstrategiaLogin].nombre}: llega en: {pendiente.llega}. Por
                  qué: {pendiente.motivo}
                </span>
              ))}
            </>
          )
        }
        errores={erroresDe(errores, 'estrategia')}
      >
        {(props) => (
          <select
            {...props}
            className={`${CLASE_ENTRADA} w-auto`}
            value={estrategia}
            disabled={Boolean(credencial)}
            onChange={(event) => {
              setEstrategia(event.target.value as EstrategiaLogin);
            }}
          >
            {(Object.keys(ESTRATEGIAS) as EstrategiaLogin[]).map((valor) => (
              <option key={valor} value={valor} disabled={!estrategiaDisponible(valor)}>
                {ESTRATEGIAS[valor].nombre}
                {estrategiaDisponible(valor)
                  ? ''
                  : ` (llega en: ${ESTRATEGIAS_PENDIENTES[valor]?.llega ?? ''})`}
              </option>
            ))}
          </select>
        )}
      </Campo>
      {config.usuario && (
        <Campo etiqueta="Usuario" errores={erroresDe(errores, 'usuario')}>
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
      )}
      {pideSecreto && config.etiquetaSecreto && (
        <CampoSecreto
          etiqueta={config.etiquetaSecreto}
          campo={campoSecreto}
          errores={erroresDe(errores, 'secreto')}
        />
      )}
      {config.etiquetaUrl !== null && (
        <Campo
          etiqueta={config.etiquetaUrl}
          ayuda={config.ayudaUrl}
          errores={erroresDe(errores, 'urlLogin')}
        >
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
      )}
      {config.pasos && <EditorPasos pasos={pasosLogin} onChange={setPasos} />}
      <EditorIndicador indicador={indicadorExito} onChange={setIndicador} />
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

const MOTIVOS_FALLO_LOGIN = {
  'no-confirmado': 'El login falló: no se cumplió el indicador de éxito.',
  'sin-indicador': 'El login no se probó: falta el indicador de éxito.',
  'estrategia-no-disponible': 'El login no se probó: esta forma de login todavía no se puede usar.',
  'credencial-a-revisar': 'El login no se probó: hay que corregir la URL de login.',
  'sin-autorizacion': 'El login no se probó: el proyecto no tiene una autorización vigente.',
  ocupado: 'El login no se probó: hay otra ejecución en curso.',
  'no-se-pudo-ejecutar':
    'El login no se probó: no se pudo abrir el navegador de pruebas o el proxy.',
  'ventana-cerrada': 'El login no se completó: la ventana se cerró antes de entrar.',
  'tiempo-agotado': 'El login no se completó: pasaron 5 minutos sin que se cumpla el indicador.',
  'ventana-no-disponible':
    'El login no se probó: no se pudo abrir la ventana del navegador de pruebas.',
} as const;

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
  const ayudaLoginId = `ayuda-login-${credencial.id}`;
  const [probando, setProbando] = useState(false);
  const [prueba, setPrueba] = useState<IpcResponse<'credenciales:probarLogin'> | null>(null);

  const probarLogin = async () => {
    setProbando(true);
    setPrueba(null);
    const res = await window.qatlas.credenciales.probarLogin({
      proyectoId,
      credencialId: credencial.id,
    });
    setProbando(false);
    setPrueba(res.ok ? res.data : { resultado: 'fallo', motivo: 'no-se-pudo-ejecutar' });
  };

  const [erroresDelReemplazo, setErroresDelReemplazo] = useState<ErrorValidacion[]>([]);
  const reemplazar = async () => {
    setFallo(false);
    setErroresDelReemplazo([]);
    const res = await window.qatlas.credenciales.reemplazarSecreto({
      proyectoId,
      credencialId: credencial.id,
      secreto: campoSecreto.tomar(),
    });
    if (!res.ok) {
      setFallo(true);
    } else if (res.data.resultado === 'reemplazado') {
      setModo('ver');
      onCambio();
    } else {
      setErroresDelReemplazo(res.data.errores);
    }
  };
  const etiquetaSecreto = ESTRATEGIAS[credencial.estrategia].etiquetaSecreto;
  const probable = credencialUsable(credencial);

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
        <p className="text-[13.5px]">
          Rol: {credencial.rol} · {ESTRATEGIAS[credencial.estrategia].nombre}
        </p>
        <p className="text-[13.5px] text-muted">
          {[credencial.usuario, credencial.urlLogin].filter(Boolean).join(' · ')}
        </p>
        {credencial.estrategia === 'asistido' && modo === 'ver' && (
          <p className="text-[13.5px]">Secreto: ninguno, entrás a mano en la ventana.</p>
        )}
        {/* Solo fuera del reemplazo: mientras tanto, esta línea no confirmaría nada. */}
        {modo === 'ver' && credencial.estrategia !== 'asistido' && (
          <p className="text-[13.5px]">
            Secreto: Configurado · reemplazado el{' '}
            {new Date(credencial.secretoActualizadoEn).toLocaleDateString('es')}
          </p>
        )}
      </div>
      {!estrategiaDisponible(credencial.estrategia) && (
        <Aviso>
          Esta credencial no se puede probar ni usar para escanear: «
          {ESTRATEGIAS[credencial.estrategia].nombre}» llega en la{' '}
          {ESTRATEGIAS_PENDIENTES[credencial.estrategia]?.llega}. Por qué:{' '}
          {ESTRATEGIAS_PENDIENTES[credencial.estrategia]?.motivo}
        </Aviso>
      )}
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
          <CampoSecreto
            etiqueta={ESTRATEGIAS[credencial.estrategia].etiquetaReemplazo}
            campo={campoSecreto}
            errores={erroresDe(erroresDelReemplazo, 'secreto')}
          />
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
      {modo === 'ver' && probable && credencial.estrategia !== 'asistido' && (
        <Aviso>
          «Probar login» hace un intento real contra el sistema, sin grabarlo. Un intento fallido
          puede bloquear la cuenta en el sistema probado.
        </Aviso>
      )}
      {modo === 'ver' && probable && credencial.estrategia === 'asistido' && (
        <Aviso>
          «Probar login» abre una ventana del navegador de pruebas: entrá ahí como siempre. Tenés 5
          minutos, y nada de esa ventana se graba.
        </Aviso>
      )}
      {modo === 'ver' && (
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={() => {
              setModo('editar');
            }}
          >
            Editar credencial
          </Button>
          {etiquetaSecreto !== null && (
            <Button
              onClick={() => {
                setModo('reemplazar');
              }}
            >
              Reemplazar secreto
            </Button>
          )}
          <Button variant="ghost" onClick={() => void eliminar()}>
            Eliminar credencial
          </Button>
          <Button
            disabled={!probable || probando}
            aria-describedby={ayudaLoginId}
            onClick={() => void probarLogin()}
          >
            {probando ? 'Probando…' : 'Probar login'}
          </Button>
          <span id={ayudaLoginId} className="text-[13px] text-muted">
            {probable
              ? `Máximo ${LIMITE_PRUEBAS_LOGIN.intentos} intentos cada ${LIMITE_PRUEBAS_LOGIN.ventanaMinutos} minutos.`
              : 'Configurá un indicador de éxito para poder probarla y escanear con esta credencial.'}
          </span>
        </div>
      )}
      {prueba?.resultado === 'funciono' && (
        <p role="status" className="rounded-lg bg-ok-bg p-3 text-[13.5px] font-medium text-ok-text">
          El login funcionó.
        </p>
      )}
      {prueba?.resultado === 'limite' && (
        <Aviso tipo="peligro">
          No se hizo ningún intento: llegaste al máximo de {LIMITE_PRUEBAS_LOGIN.intentos} cada{' '}
          {LIMITE_PRUEBAS_LOGIN.ventanaMinutos} minutos. Podés volver a probar en{' '}
          {Math.ceil(prueba.esperaSegundos / 60)} min.
        </Aviso>
      )}
      {prueba?.resultado === 'fallo' && (
        <Aviso tipo="peligro">{MOTIVOS_FALLO_LOGIN[prueba.motivo]}</Aviso>
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
