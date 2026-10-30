import {
  CANALES_SIN_BOVEDA,
  ipcContract,
  type IpcChannel,
  type IpcErrorCode,
  type IpcRequest,
  type IpcResponse,
  type IpcResult,
} from '@qatlas/shared';

/**
 * Envoltorio de seguridad de todos los handlers IPC (especificación 3.6).
 *
 * 1. Verifica que el mensaje venga de un frame de la interfaz de QAtlas.
 * 2. Valida la entrada con el esquema del contrato (rechaza campos extra).
 * 3. Valida la SALIDA con el esquema del contrato: si un handler devolviera
 *    un campo no declarado (por ejemplo, un secreto), la respuesta se rechaza.
 * 4. Nunca envía detalles de errores internos a la interfaz.
 *
 * No importa `electron`, así se puede probar sin abrir la app (TS-08).
 */
export interface IpcSenderLike {
  senderFrame?: { url: string } | null;
}

export type IpcImplementation<C extends IpcChannel> = (
  request: IpcRequest<C>,
) => IpcResponse<C> | Promise<IpcResponse<C>>;

export interface HandlerOptions {
  isAllowedSender: (frameUrl: string | undefined) => boolean;
  onRejected?: (channel: string, code: IpcErrorCode) => void;
  /** Si devuelve true, se rechazan los canales que no están en CANALES_SIN_BOVEDA (RN-BOV-03). */
  isVaultLocked?: () => boolean;
}

export function createIpcHandler<C extends IpcChannel>(
  channel: C,
  implementation: IpcImplementation<C>,
  options: HandlerOptions,
): (event: IpcSenderLike, rawRequest: unknown) => Promise<IpcResult<IpcResponse<C>>> {
  const schemas = ipcContract[channel];

  const fail = (code: IpcErrorCode): IpcResult<IpcResponse<C>> => {
    options.onRejected?.(channel, code);
    return { ok: false, error: code };
  };

  return async (event, rawRequest) => {
    if (!options.isAllowedSender(event.senderFrame?.url)) return fail('ORIGEN_NO_PERMITIDO');
    if (options.isVaultLocked?.() && !CANALES_SIN_BOVEDA.has(channel)) {
      return fail('BOVEDA_BLOQUEADA');
    }

    const parsedRequest = schemas.request.safeParse(rawRequest);
    if (!parsedRequest.success) return fail('ENTRADA_INVALIDA');

    try {
      const result = await implementation(parsedRequest.data as IpcRequest<C>);
      const parsedResponse = schemas.response.safeParse(result);
      if (!parsedResponse.success) return fail('ERROR_INTERNO');
      return { ok: true, data: parsedResponse.data as IpcResponse<C> };
    } catch {
      return fail('ERROR_INTERNO');
    }
  };
}

/** El origen del frame debe ser exactamente uno de los permitidos. */
export function makeSenderCheck(allowedOrigins: readonly string[]) {
  return (frameUrl: string | undefined): boolean => {
    if (!frameUrl) return false;
    try {
      const origin = new URL(frameUrl).origin;
      // URL.origin devuelve "null" para esquemas no estándar: se compara también
      // con protocolo + host para el esquema propio app://.
      const url = new URL(frameUrl);
      const schemeHost = `${url.protocol}//${url.host}`;
      return allowedOrigins.includes(origin) || allowedOrigins.includes(schemeHost);
    } catch {
      return false;
    }
  };
}
