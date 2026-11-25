import { useEffect, useId, useState, type SyntheticEvent } from 'react';
import {
  BLOQUEO_MINUTOS_MAX,
  BLOQUEO_MINUTOS_MIN,
  RETENCION_DIAS_MAX,
  RETENCION_DIAS_MIN,
} from '@qatlas/shared';
import { Button, Card, PageHeader } from '../ui/components';
import { EntradaSensible, useCampoSensible } from '../ui/EntradaSensible';
import { useAvisos } from '../ui/avisos';
import { CampoNumerico } from '../ui/controles';

export function Boveda() {
  const [minutos, setMinutos] = useState<number | null>(null);
  const [dias, setDias] = useState<number | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [guardadaRetencion, setGuardadaRetencion] = useState(false);
  const [mensajeCopia, setMensajeCopia] = useState<string | null>(null);
  const campoCopia = useCampoSensible();
  const [mensajeRestaurar, setMensajeRestaurar] = useState<string | null>(null);
  const avisar = useAvisos();
  const idContrasena = useId();

  useEffect(() => {
    void window.qatlas.vault.getSettings().then((res) => {
      if (res.ok) {
        setMinutos(res.data.bloqueoMinutos);
        setDias(res.data.retencionDias);
      }
    });
  }, []);

  const guardarAjustes = async () => {
    if (minutos === null || dias === null) return false;
    const res = await window.qatlas.vault.setSettings({
      bloqueoMinutos: minutos,
      retencionDias: dias,
    });
    return res.ok;
  };

  const guardar = async (event: SyntheticEvent) => {
    event.preventDefault();
    setGuardado(await guardarAjustes());
  };

  const guardarRetencion = async (event: SyntheticEvent) => {
    event.preventDefault();
    setGuardadaRetencion(await guardarAjustes());
  };

  const crearCopia = async () => {
    setMensajeCopia(null);
    const res = await window.qatlas.vault.createBackup();
    // Lo que sale bien es un aviso pasajero; lo que falla queda en la página (role="alert").
    if (!res.ok) setMensajeCopia('No se pudo crear la copia.');
    else if (res.data.resultado === 'creada') avisar('Copia creada.');
  };

  const restaurar = async (event: SyntheticEvent) => {
    event.preventDefault();
    setMensajeRestaurar(null);
    const res = await window.qatlas.vault.restoreBackup({ contrasena: campoCopia.tomar() });
    if (res.ok && res.data.resultado === 'restaurada') {
      // Recargar descarta el estado en memoria de la bóveda anterior.
      window.location.reload();
    } else if (!res.ok || res.data.resultado === 'rechazada') {
      setMensajeRestaurar('La contraseña no corresponde a la copia, o la copia no es válida.');
    }
  };

  return (
    <>
      <PageHeader
        title="Bóveda"
        description="Bloqueo y copias de seguridad de tus datos cifrados en este equipo."
      />

      <Card title="Bloqueo automático">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            void guardar(event);
          }}
        >
          <CampoNumerico
            etiqueta="Minutos sin actividad"
            ayuda={`De ${String(BLOQUEO_MINUTOS_MIN)} a ${String(BLOQUEO_MINUTOS_MAX)}.`}
            valor={minutos ?? Number.NaN}
            alCambiar={(n) => {
              setGuardado(false);
              setMinutos(n);
            }}
          />
          <Button type="submit">Guardar</Button>
          {guardado && <p className="self-center text-muted">Guardado.</p>}
        </form>
        <p className="mt-3 text-[13.5px] text-muted">
          También se bloquea al suspender o bloquear el sistema y al cerrar QAtlas. Atajo para
          bloquear: Ctrl + Mayús + L.
        </p>
      </Card>

      <Card title="Retención de las evidencias">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            void guardarRetencion(event);
          }}
        >
          <CampoNumerico
            etiqueta="Días que se guardan"
            ayuda={`De ${String(RETENCION_DIAS_MIN)} a ${String(RETENCION_DIAS_MAX)}.`}
            valor={dias ?? Number.NaN}
            alCambiar={(n) => {
              setGuardadaRetencion(false);
              setDias(n);
            }}
          />
          <Button type="submit">Guardar retención</Button>
          {guardadaRetencion && <p className="self-center text-muted">Guardado.</p>}
        </form>
        <p className="mt-3 text-[13.5px] text-muted">
          Capturas, videos, trazas y HAR de más días se eliminan con borrado criptográfico al
          desbloquear: sin su clave, ningún resto en el disco se puede leer. Las evidencias de los
          reportes se conservan (los reportes llegan en: semana 9). Cada eliminación queda en la
          auditoría.
        </p>
      </Card>

      <Card title="Copia de seguridad">
        <p className="mb-3 text-muted">
          La copia queda cifrada y se abre con la contraseña que tengas al momento de crearla. Si
          después eliminás un proyecto, las copias anteriores todavía lo contienen.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              void crearCopia();
            }}
          >
            Crear copia de seguridad
          </Button>
          {mensajeCopia && (
            <p role="alert" className="text-crit-text">
              {mensajeCopia}
            </p>
          )}
        </div>
      </Card>

      <Card title="Restaurar una copia">
        <p className="mb-3 text-muted">
          Reemplaza los datos actuales por los de la copia. Los proyectos que eliminaste no vuelven.
          Después se desbloquea con la contraseña de la copia.
        </p>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            void restaurar(event);
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={idContrasena} className="font-medium">
              Contraseña de la copia
            </label>
            <EntradaSensible
              id={idContrasena}
              campo={campoCopia}
              autocompletar="current-password"
            />
          </div>
          <Button type="submit" disabled={!campoCopia.tieneTexto}>
            Elegir copia y restaurar
          </Button>
        </form>
        {mensajeRestaurar && (
          <p role="alert" className="mt-3 text-crit-text">
            {mensajeRestaurar}
          </p>
        )}
      </Card>
    </>
  );
}
