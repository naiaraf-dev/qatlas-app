/**
 * Redacción de lo guardado antes de la semana 7 (ADR 033). Corre al abrir la base (desbloquear o
 * restaurar una copia), proyecto por proyecto, cada uno en una transacción: si algo se corta, ese
 * proyecto queda como estaba y se rehace en el próximo desbloqueo. Es idempotente: redactar lo ya
 * redactado no cambia nada. `proyecto.redaccion_version` dice hasta dónde se llegó.
 *
 * Redacta las URLs de las páginas (la corta y la completa, cifrada), las URLs, títulos y claves de los
 * hallazgos, el detalle cifrado de cada aparición y los destinos del monitor de conexiones. Las claves
 * de los mensajes se recalculan como HMAC con la subclave del proyecto (ADR 032).
 *
 * Sin `electron`, para probarlo con Vitest.
 */
import { abrirClaveProyecto, borrar, cifrarCampo, descifrarCampo } from '@qatlas/crypto';
import {
  agregarRedacciones,
  leerParaRedactar,
  marcarProyectoRedactado,
  proyectosSinRedactar,
  reescribirConexion,
  reescribirHallazgo,
  reescribirOcurrencia,
  reescribirPagina,
  type BaseCifrada,
  type FilaProyecto,
  type NuevaRedaccion,
} from '@qatlas/db';
import { contarRedacciones, type Resultado } from '@qatlas/redaction';
import { registrar } from '../registro';
import {
  claveDeMensaje,
  comparadorDelProyecto,
  filasDeRegistro,
  REDACTOR,
  subclaveDeHallazgos,
  TIPOS_DE_MENSAJE,
  VERSION_REDACCION,
  type Redactor,
} from './redaccion';
import { contextoDetalle, contextoUrlPagina } from './servicio';

export interface OpcionesRedaccionGuardada {
  redactor?: Redactor;
  /** Solo para tests: se llama antes de cada proyecto, para simular un corte. */
  antesDeCadaProyecto?: (proyectoId: string) => void;
}

export function redactarLoGuardado(
  base: BaseCifrada,
  maestra: Buffer,
  opciones: OpcionesRedaccionGuardada = {},
): { proyectos: number; fallidos: number } {
  let proyectos = 0;
  let fallidos = 0;
  for (const proyecto of proyectosSinRedactar(base, VERSION_REDACCION)) {
    try {
      base.transaction(() => {
        opciones.antesDeCadaProyecto?.(proyecto.id);
        const secretos = redactarProyecto(base, maestra, proyecto, opciones.redactor ?? REDACTOR);
        marcarProyectoRedactado(base, proyecto.id, VERSION_REDACCION);
        registrar('redaccion.proyecto-redactado', { proyecto: proyecto.id, secretos });
      })();
      proyectos++;
    } catch {
      // Queda como estaba (la transacción se revierte) y se rehace en el próximo desbloqueo.
      fallidos++;
      registrar('redaccion.proyecto-fallido', { proyecto: proyecto.id });
    }
  }
  return { proyectos, fallidos };
}

function redactarProyecto(
  base: BaseCifrada,
  maestra: Buffer,
  proyecto: FilaProyecto,
  redactor: Redactor,
): number {
  const comparador = comparadorDelProyecto(base, maestra, proyecto);
  const subclave = subclaveDeHallazgos(maestra, proyecto);
  const clave = abrirClaveProyecto(maestra, proyecto.id, proyecto.claveProyectoCifrada);
  const opciones = { comparador };
  const filas: NuevaRedaccion[] = [];
  let secretos = 0;
  const anotar = (origen: string, ejecucionId: string | null, resultado: Resultado | null) => {
    if (!resultado) return;
    secretos += contarRedacciones(resultado.registros);
    filas.push(...filasDeRegistro(proyecto.id, ejecucionId, origen, resultado.registros));
  };
  const descifrar = (contexto: string, sellado: Buffer): string => {
    const bytes = descifrarCampo(clave, contexto, sellado);
    try {
      return bytes.toString('utf8');
    } finally {
      borrar(bytes);
    }
  };
  const cifrar = (contexto: string, texto: string): Buffer => {
    const bytes = Buffer.alloc(Buffer.byteLength(texto, 'utf8'));
    bytes.write(texto, 'utf8');
    try {
      return cifrarCampo(clave, contexto, bytes);
    } finally {
      borrar(bytes);
    }
  };

  try {
    const datos = leerParaRedactar(base, proyecto.id);

    for (const pagina of datos.paginas) {
      const corta = redactor.url(pagina.url, opciones);
      let completa: Buffer | null = null;
      if (pagina.url_completa_cifrada) {
        const contexto = contextoUrlPagina(proyecto.id, pagina.ejecucion_id);
        const redactada = redactor.url(descifrar(contexto, pagina.url_completa_cifrada), opciones);
        anotar('pagina.url', pagina.ejecucion_id, redactada);
        completa = cifrar(contexto, redactada.texto);
      } else {
        anotar('pagina.url', pagina.ejecucion_id, corta);
      }
      reescribirPagina(base, pagina.id, { url: corta.texto, urlCompletaCifrada: completa });
    }

    // El detalle redactado de cada aparición, para recalcular la clave de su hallazgo.
    const detallePorHallazgo = new Map<string, Resultado>();
    for (const ocurrencia of datos.ocurrencias) {
      const url = redactor.url(ocurrencia.url, opciones);
      const urlOrigen =
        ocurrencia.url_origen === null ? null : redactor.url(ocurrencia.url_origen, opciones);
      let detalle: Resultado | null = null;
      let detalleCifrado: Buffer | null = null;
      if (ocurrencia.detalle_cifrado) {
        const contexto = contextoDetalle(proyecto.id, ocurrencia.id);
        detalle = redactor.texto(descifrar(contexto, ocurrencia.detalle_cifrado), opciones);
        detalleCifrado = cifrar(contexto, detalle.texto);
        if (!detallePorHallazgo.has(ocurrencia.hallazgo_id)) {
          detallePorHallazgo.set(ocurrencia.hallazgo_id, detalle);
        }
      }
      for (const [origen, resultado] of [
        ['hallazgo.url', url],
        ['hallazgo.url-origen', urlOrigen],
        ['hallazgo.detalle', detalle],
      ] as const) {
        anotar(origen, null, resultado);
      }
      reescribirOcurrencia(base, ocurrencia.id, {
        url: url.texto,
        urlOrigen: urlOrigen?.texto ?? null,
        detalleCifrado,
        // Se suma a lo que ya tenía: una segunda pasada no encuentra nada, y el aviso no se pierde.
        secretosRedactados:
          ocurrencia.secretos_redactados +
          [url, urlOrigen, detalle].reduce(
            (total, r) => total + contarRedacciones(r?.registros ?? []),
            0,
          ),
      });
    }

    for (const hallazgo of datos.hallazgos) {
      const titulo = redactor.texto(hallazgo.titulo, opciones);
      const descripcion = redactor.texto(hallazgo.descripcion, opciones);
      const url = redactor.url(hallazgo.url, opciones);
      anotar('hallazgo.titulo', null, titulo);
      let claveNueva;
      if (TIPOS_DE_MENSAJE.has(hallazgo.tipo)) {
        const detalle = detallePorHallazgo.get(hallazgo.id);
        // Sin detalle, solo queda el hash viejo: un HMAC encima, para que no se pueda atacar.
        claveNueva = detalle
          ? claveDeMensaje(subclave, detalle.texto)
          : claveDeMensaje(subclave, redactor.texto(hallazgo.clave).texto, false);
      } else {
        const delSitio = redactor.texto(hallazgo.clave, opciones);
        anotar('hallazgo.clave', null, delSitio);
        claveNueva = delSitio.texto;
      }
      reescribirHallazgo(base, hallazgo.id, {
        titulo: titulo.texto,
        descripcion: descripcion.texto,
        url: url.texto,
        clave: claveNueva,
      });
    }

    for (const conexion of datos.conexiones) {
      const destino = redactor.texto(conexion.destino, opciones);
      if (destino.texto === conexion.destino) continue;
      anotar('conexion.destino', null, destino);
      reescribirConexion(base, conexion.id, destino.texto);
    }

    agregarRedacciones(base, filas);
    return secretos;
  } finally {
    comparador.descartar();
    borrar(subclave, clave);
  }
}
