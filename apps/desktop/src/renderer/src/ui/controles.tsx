/**
 * Controles propios con el sistema Índigo, sobre react-aria-components (ADR 042): el patrón de WAI-ARIA de
 * cada uno (roles, estados, teclado y foco) lo pone la librería; el aspecto, los tokens.
 *
 * - Ningún control de acá guarda un secreto: los campos sensibles siguen con `EntradaSensible`, no
 *   controlado y sin reflejarse en el HTML.
 * - Los textos y los anuncios para lector de pantalla salen en español (`I18nProvider` con es-AR en
 *   `main.tsx`).
 * - Sin estilos en línea ni `<style>`: React Aria posiciona los popovers por CSSOM, que la CSP permite.
 *   El E2E de la CSP abre cada uno (`e2e/componentes.e2e.ts`).
 */
import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import {
  Button as BotonAria,
  CheckboxButton,
  CheckboxField,
  Dialog,
  Disclosure,
  DisclosurePanel,
  FieldError,
  Group,
  Heading,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  NumberField,
  Popover,
  Select,
  SelectValue,
  Slider,
  SliderOutput,
  SliderThumb,
  SliderTrack,
  Text,
  Tooltip,
  TooltipTrigger,
} from 'react-aria-components';
import { Button, cx } from './components';
import { Icon } from './Icon';

// --- Selector (patrón listbox con botón: «Select-Only Combobox» de las APG) ------------------------

export interface OpcionSelector<T extends string> {
  valor: T;
  texto: string;
  /** Visible, deshabilitada y con el motivo («Llega en: …»): nunca se esconde. */
  deshabilitada?: boolean;
  detalle?: string;
}

export function Selector<T extends string>({
  etiqueta,
  etiquetaOculta = false,
  valor,
  opciones,
  alCambiar,
  deshabilitado,
  ayuda,
  errores = [],
  'aria-labelledby': etiquetadoPor,
  'aria-describedby': descritoPor,
  className,
}: {
  /** El nombre accesible. Visible, salvo con `etiquetaOculta` (por ejemplo, en una fila con otros). */
  etiqueta: string;
  etiquetaOculta?: boolean;
  valor: T;
  opciones: readonly OpcionSelector<T>[];
  alCambiar: (valor: T) => void;
  deshabilitado?: boolean;
  ayuda?: ReactNode;
  errores?: readonly string[];
  /** Cuando la etiqueta visible está afuera (por ejemplo, en `Campo`). */
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  className?: string;
}) {
  return (
    <Select
      value={valor}
      onChange={(clave) => {
        if (clave !== null) alCambiar(clave as T);
      }}
      isDisabled={deshabilitado ?? false}
      isInvalid={errores.length > 0}
      disabledKeys={opciones.filter((o) => o.deshabilitada).map((o) => o.valor)}
      {...(descritoPor ? { 'aria-describedby': descritoPor } : {})}
      {...(etiquetadoPor
        ? { 'aria-labelledby': etiquetadoPor }
        : etiquetaOculta
          ? { 'aria-label': etiqueta }
          : {})}
      className={cx('flex flex-col gap-1.5', className)}
    >
      {!etiquetaOculta && !etiquetadoPor && <Label className="font-medium">{etiqueta}</Label>}
      <BotonAria
        className={cx(
          'flex min-h-11 w-full min-w-48 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border-strong bg-surface-2 px-3 text-left text-text',
          'transition-colors hover:bg-surface data-disabled:cursor-not-allowed data-disabled:opacity-50',
          'data-pressed:bg-surface',
        )}
      >
        <SelectValue className="truncate data-placeholder:text-muted" />
        <Icon name="chevronDown" size={16} />
      </BotonAria>
      {ayuda && (
        <Text slot="description" className="text-[13px] text-muted">
          {ayuda}
        </Text>
      )}
      <FieldError className="text-[13px] font-medium text-crit-text">
        {errores.join(' ')}
      </FieldError>
      <Popover
        offset={6}
        className={cx(
          'min-w-(--trigger-width) overflow-auto rounded-[var(--radius-control)] border border-border bg-surface shadow-card',
          'data-entering:animate-entrar data-exiting:animate-salir',
        )}
      >
        <ListBox className="flex max-h-80 flex-col gap-0.5 p-1 outline-none">
          {opciones.map((opcion) => (
            <ListBoxItem
              key={opcion.valor}
              id={opcion.valor}
              textValue={opcion.texto}
              className={cx(
                'flex cursor-default flex-col rounded-lg px-3 py-2 text-text outline-none',
                'data-focused:bg-accent-soft data-focused:text-accent-soft-text',
                'data-selected:font-semibold data-disabled:cursor-not-allowed data-disabled:text-muted',
              )}
            >
              {({ isSelected }) => (
                <>
                  <span className="flex items-center justify-between gap-3">
                    <span>{opcion.texto}</span>
                    {isSelected && <Icon name="check" size={15} />}
                  </span>
                  {opcion.detalle && (
                    <Text slot="description" className="text-[12.5px] text-muted">
                      {opcion.detalle}
                    </Text>
                  )}
                </>
              )}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

// --- Casilla (patrón checkbox) ----------------------------------------------------------------------

/**
 * Un input checkbox real, oculto a la vista, dentro de su etiqueta: el lector de pantalla lo anuncia como
 * casilla, con la ayuda como descripción.
 */
export function Casilla({
  etiqueta,
  ayuda,
  marcada,
  onChange,
  deshabilitada,
}: {
  etiqueta: ReactNode;
  ayuda?: ReactNode;
  marcada?: boolean;
  onChange?: (marcada: boolean) => void;
  deshabilitada?: boolean;
}) {
  return (
    <CheckboxField
      isSelected={marcada ?? false}
      {...(onChange ? { onChange } : {})}
      isDisabled={deshabilitada ?? false}
      className="flex flex-col gap-0.5"
    >
      <CheckboxButton className="qa-entrada-cubre group flex items-start gap-3 data-disabled:cursor-not-allowed data-disabled:text-muted">
        {({ isSelected }) => (
          <>
            <span
              aria-hidden="true"
              className={cx(
                'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border transition-colors',
                isSelected
                  ? 'border-accent bg-accent text-accent-fg'
                  : 'border-border-strong bg-surface',
                'group-data-focus-visible:outline-2 group-data-focus-visible:outline-offset-2 group-data-focus-visible:outline-accent',
                'group-data-disabled:opacity-50',
              )}
            >
              {isSelected && <Icon name="check" size={14} />}
            </span>
            <span className="font-medium">{etiqueta}</span>
          </>
        )}
      </CheckboxButton>
      {ayuda && (
        <Text slot="description" className="ml-8 text-[13px] text-muted">
          {ayuda}
        </Text>
      )}
    </CheckboxField>
  );
}

// --- Campo numérico (patrón spinbutton) -------------------------------------------------------------

/**
 * Sin mínimo ni máximo a propósito: React Aria recorta el valor al rango al salir del campo, y la app
 * deja escribir y muestra su propio error de validación (el mismo comportamiento que tenía el campo
 * nativo). Los límites los valida el contrato.
 */

export function CampoNumerico({
  etiqueta,
  valor,
  alCambiar,
  ayuda,
  errores = [],
}: {
  etiqueta: string;
  /** `NaN` mientras no hay valor (por ejemplo, cargando). */
  valor: number;
  alCambiar: (valor: number) => void;
  ayuda?: ReactNode;
  errores?: readonly string[];
}) {
  return (
    <NumberField
      value={valor}
      onChange={(n) => {
        if (!Number.isNaN(n)) alCambiar(n);
      }}
      isInvalid={errores.length > 0}
      // Sin separador de miles: «3650 días», como se escribe, no «3.650».
      formatOptions={{ useGrouping: false, maximumFractionDigits: 0 }}
      className="flex flex-col gap-1.5"
    >
      <Label className="font-medium">{etiqueta}</Label>
      <Group className="flex min-h-11 items-stretch overflow-hidden rounded-[var(--radius-control)] border border-border-strong bg-surface-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        <BotonAria
          slot="decrement"
          className="grid w-10 place-items-center text-text-2 hover:bg-surface data-disabled:opacity-40"
        >
          <Icon name="minus" size={15} />
        </BotonAria>
        <Input className="w-full min-w-16 bg-transparent px-2 text-center text-text outline-none" />
        <BotonAria
          slot="increment"
          className="grid w-10 place-items-center text-text-2 hover:bg-surface data-disabled:opacity-40"
        >
          <Icon name="plus" size={15} />
        </BotonAria>
      </Group>
      {ayuda && (
        <Text slot="description" className="text-[13px] text-muted">
          {ayuda}
        </Text>
      )}
      <FieldError className="text-[13px] font-medium text-crit-text">
        {errores.join(' ')}
      </FieldError>
    </NumberField>
  );
}

// --- Deslizador (patrón slider) ---------------------------------------------------------------------

export function Deslizador({
  etiqueta,
  valor,
  alCambiar,
  minimo,
  maximo,
  textoDelValor,
}: {
  etiqueta: string;
  valor: number;
  alCambiar: (valor: number) => void;
  minimo: number;
  maximo: number;
  /** Lo que se lee y se anuncia (aria-valuetext), por ejemplo «Fotograma 3 de 40 · 0:02». */
  textoDelValor: (valor: number) => string;
}) {
  // React Aria arma aria-valuetext con su formato de número («3») y no deja cambiarlo. Después de cada
  // render se escribe el texto completo en el input real del pulgar, que es lo que anuncia el lector.
  const entrada = useRef<HTMLInputElement>(null);
  useEffect(() => {
    entrada.current?.setAttribute('aria-valuetext', textoDelValor(valor));
  });
  return (
    <Slider
      value={valor}
      onChange={(n) => {
        alCambiar(n);
      }}
      minValue={minimo}
      maxValue={maximo}
      className="flex flex-col gap-2 text-[13.5px]"
    >
      <div className="flex justify-between gap-3">
        <Label className="font-medium">{etiqueta}</Label>
        <SliderOutput className="text-muted">
          {({ state }) => textoDelValor(state.values[0] ?? minimo)}
        </SliderOutput>
      </div>
      <SliderTrack className="relative h-6 w-full">
        {() => (
          <>
            <span className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-border-strong" />
            <SliderThumb
              inputRef={entrada}
              className="top-1/2 size-5 rounded-full border-2 border-surface bg-accent shadow-card data-dragging:bg-accent-hover data-focus-visible:outline-2 data-focus-visible:outline-offset-2 data-focus-visible:outline-accent"
            />
          </>
        )}
      </SliderTrack>
    </Slider>
  );
}

// --- Desplegable (patrón disclosure) ----------------------------------------------------------------

export function Desplegable({
  titulo,
  children,
  className,
  abiertoAlInicio = false,
  alCambiar,
}: {
  titulo: ReactNode;
  children: ReactNode;
  className?: string;
  abiertoAlInicio?: boolean;
  /** Por ejemplo, para cargar el contenido recién al abrir. */
  alCambiar?: (abierto: boolean) => void;
}) {
  return (
    <Disclosure
      defaultExpanded={abiertoAlInicio}
      {...(alCambiar ? { onExpandedChange: alCambiar } : {})}
      className={cx('group', className)}
    >
      <Heading className="m-0 text-[inherit] font-normal">
        <BotonAria
          slot="trigger"
          className="flex min-h-9 items-center gap-2 rounded-lg text-left font-medium text-text-2 hover:text-text"
        >
          <span className="transition-transform group-data-expanded:rotate-90">
            <Icon name="chevronRight" size={15} />
          </span>
          {titulo}
        </BotonAria>
      </Heading>
      <DisclosurePanel className="pt-2">{children}</DisclosurePanel>
    </Disclosure>
  );
}

// --- Ayuda emergente (patrón tooltip) ---------------------------------------------------------------

/**
 * Muestra `texto` al pasar el mouse o al enfocar con el teclado, y se cierra con Escape. El hijo tiene
 * que ser enfocable (un botón de React Aria). Nunca lleva información que no esté también en el nombre
 * accesible del control: es una ayuda visual.
 */
export function Ayuda({
  texto,
  children,
  lado = 'right',
  desactivada = false,
}: {
  texto: string;
  children: ReactElement;
  lado?: 'top' | 'right' | 'bottom' | 'left';
  desactivada?: boolean;
}) {
  return (
    <TooltipTrigger delay={300} closeDelay={100} isDisabled={desactivada}>
      {children}
      <Tooltip
        placement={lado}
        offset={8}
        className="max-w-64 rounded-lg bg-text px-2.5 py-1.5 text-[12.5px] font-medium text-bg shadow-card data-entering:animate-entrar data-exiting:animate-salir"
      >
        {texto}
      </Tooltip>
    </TooltipTrigger>
  );
}

// --- Diálogo de confirmación (patrón alertdialog) ---------------------------------------------------

/**
 * Para una acción que no se puede deshacer. El foco queda atrapado en el diálogo, empieza en «Cancelar»
 * (lo seguro) y vuelve al botón que lo abrió al cerrar. Escape cancela.
 */
export function DialogoConfirmacion({
  abierto,
  titulo,
  children,
  textoConfirmar,
  alConfirmar,
  alCancelar,
  peligroso = false,
}: {
  abierto: boolean;
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  alConfirmar: () => void;
  alCancelar: () => void;
  peligroso?: boolean;
}) {
  const idTexto = useId();
  return (
    <ModalOverlay
      isOpen={abierto}
      onOpenChange={(abre) => {
        if (!abre) alCancelar();
      }}
      isDismissable
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 data-entering:animate-aparecer data-exiting:animate-desaparecer"
    >
      <Modal className="w-full max-w-md rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-card data-entering:animate-entrar">
        <Dialog
          role="alertdialog"
          aria-describedby={idTexto}
          className="flex flex-col gap-4 outline-none"
        >
          {({ close }) => (
            <>
              <Heading slot="title" className="text-lg font-semibold">
                {titulo}
              </Heading>
              <div id={idTexto} className="flex flex-col gap-2 text-text-2">
                {children}
              </div>
              <div className="flex flex-wrap justify-end gap-2.5">
                <Button
                  autoFocus
                  onClick={() => {
                    close();
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  variant={peligroso ? 'danger' : 'primary'}
                  onClick={() => {
                    alConfirmar();
                  }}
                >
                  {textoConfirmar}
                </Button>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
