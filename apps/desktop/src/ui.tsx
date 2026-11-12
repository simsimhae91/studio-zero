import * as Dialog from '@radix-ui/react-dialog';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { LoaderCircle, X } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';

/** See `.titlebar-space` in app.css. Place it as the first child of a pane that reaches the top of the window. */
export function TitlebarSpace() {
  return <div className="titlebar-space" aria-hidden data-tauri-drag-region />;
}

type Variant = 'primary' | 'quiet' | 'danger';

const variants: Record<Variant, string> = {
  primary: 'border border-transparent bg-accent text-on-accent',
  quiet: 'border border-control-border bg-surface text-fg',
  danger: 'border border-control-border bg-surface text-danger',
};
/**
 * A button that cannot be pressed looks like one: a flat, bordered, muted slab, the same for every variant.
 * A faded version of the live button (the accent at 60%) reads as a button in some other state, and gets pressed.
 */
const inactive = 'disabled:cursor-not-allowed disabled:border-border disabled:bg-sunken disabled:text-fg-muted';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  busy?: boolean;
  icon?: ReactNode;
}

/** Every button is 44px tall on every device: the same control works under a cursor and under a thumb. */
export function Button({ variant = 'quiet', busy = false, icon, children, className = '', disabled, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium ${inactive} ${variants[variant]} ${className}`}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" {...props} aria-label={label} title={label} className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-sunken hover:text-fg ${className}`}>
      {children}
    </button>
  );
}

type Tone = 'neutral' | 'good' | 'bad' | 'warn' | 'active';
const toneText: Record<Tone, string> = { neutral: 'text-fg-muted', good: 'text-success', bad: 'text-danger', warn: 'text-warning', active: 'text-accent' };

/** A state in words, with a small mark in the state's colour. The word carries the meaning; the colour repeats it. */
export function Status({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm font-medium ${toneText[tone]}`}>
      <span className="size-2 bg-current" aria-hidden />
      {children}
    </span>
  );
}

/** An empty pane says what will appear here and what to do about it. */
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 p-6">
      <h3 className="text-base font-semibold text-fg">{title}</h3>
      {children ? <div className="flex flex-col items-start gap-4 text-base text-fg-muted">{children}</div> : null}
    </div>
  );
}

export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="border-l-4 border-danger bg-sunken px-4 py-3 text-base text-fg">
      {children}
    </p>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint ? <span className="text-base text-fg-muted">{hint}</span> : null}
    </label>
  );
}

export const inputClass = 'min-h-11 w-full rounded-md border border-control-border bg-surface px-3 text-base text-fg placeholder:text-fg-muted';

/**
 * A few mutually exclusive options, all visible. Used where a native select would hide two or three choices behind a click.
 * Drawn as one control: a sunken track with the chosen option raised in it. It is a setting, so it stays quieter
 * than the button that acts on it; an inverted block for the chosen option read as a second primary button.
 */
export function Segmented<T extends string>({ label, value, options, onChange, disabled, compact = false }: { label: string; value: T; options: readonly { id: T; label: string }[]; onChange: (value: T) => void; disabled?: boolean; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full flex-wrap gap-1 self-start rounded-lg border border-border bg-sunken p-1">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} disabled={disabled} onClick={() => onChange(o.id)} className={`rounded-md border text-sm font-medium disabled:opacity-60 ${compact ? 'min-h-9 pointer-coarse:min-h-11 px-3' : 'min-h-11 min-w-11 px-4'} ${value === o.id ? 'border-control-border bg-surface text-fg shadow-sm' : 'border-transparent text-fg-muted hover:text-fg'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A panel that slides over the page from the right: settings, the spec, a preview, a terminal. */
export function Sheet({ open, onOpenChange, title, description, wide = false, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; wide?: boolean; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-sunken opacity-80" />
        <Dialog.Content className={`fixed inset-y-0 right-0 flex w-full flex-col border-l border-border bg-bg text-fg shadow-md ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
          <TitlebarSpace />
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="flex flex-col gap-1">
              <Dialog.Title className="text-2xl font-semibold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="text-base text-fg-muted">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close asChild>
              <IconButton label="닫기">
                <X className="size-5" aria-hidden />
              </IconButton>
            </Dialog.Close>
          </div>
          <div className="pane-scroll flex min-h-0 flex-1 flex-col">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A question that needs an answer before anything else happens: a name to give, a deletion to confirm. */
export function Modal({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-sunken opacity-80" />
        <Dialog.Content className="fixed inset-x-4 top-1/2 mx-auto flex max-h-full max-w-md -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-surface p-6 text-fg shadow-md">
          <div className="flex flex-col gap-2">
            <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
            {description ? <Dialog.Description className="text-base text-fg-muted">{description}</Dialog.Description> : null}
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A short list of things to do to whatever the trigger sits on. */
export function Menu({ trigger, children, align = 'end', open, onOpenChange }: { trigger: ReactElement; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <Dropdown.Root open={open} onOpenChange={onOpenChange}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align={align} sideOffset={4} className="z-10 flex max-h-(--radix-dropdown-menu-content-available-height) min-w-48 flex-col overflow-y-auto rounded-md border border-border bg-surface p-1 text-fg shadow-md">
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}

export function MenuItem({ onSelect, icon, danger = false, disabled = false, children }: { onSelect: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <Dropdown.Item onSelect={onSelect} disabled={disabled} className={`flex min-h-11 cursor-default select-none items-center gap-3 rounded-sm px-3 text-sm font-medium outline-hidden data-[disabled]:opacity-60 data-[highlighted]:bg-sunken ${danger ? 'text-danger' : 'text-fg'}`}>
      {icon}
      {children}
    </Dropdown.Item>
  );
}

export function MenuSeparator() {
  return <Dropdown.Separator className="my-1 border-t border-border" />;
}
