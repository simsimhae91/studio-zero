import { ArrowUp } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { stamp } from '../lib/format.ts';
import { Button, Problem } from '../ui.tsx';

/**
 * One entry on a worksheet. The margin says who wrote it and when, the way a notebook margin would; the
 * column beside it is the entry itself.
 */
export function Entry({ who, at, note, children }: { who: string; at?: number; note?: string | null; children: ReactNode }) {
  return (
    <li className="entry border-b border-border px-4 py-8 md:px-10">
      <div className="flex flex-row flex-wrap items-baseline gap-x-3 text-sm text-fg-muted md:flex-col md:gap-y-1 md:pt-1">
        <span className="font-medium text-fg">{who}</span>
        {at !== undefined ? (
          <time dateTime={new Date(at).toISOString()} title={new Date(at).toLocaleString('ko')}>
            {stamp(at)}
          </time>
        ) : null}
        {note ? <span>{note}</span> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </li>
  );
}

/** Something the owner wrote. The rule on the left is the owner's mark everywhere on a page. */
export function OwnWords({ children, clamp = false }: { children: string; clamp?: boolean }) {
  const long = clamp && children.length > 420;
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col items-start gap-2 border-l-4 border-accent pl-5">
      <p className={`whitespace-pre-wrap break-words text-xl ${long && !open ? 'line-clamp-4' : ''}`}>{children}</p>
      {long ? (
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-h-11 text-sm font-medium text-accent underline underline-offset-4">
          {open ? '접기' : '전체 보기'}
        </button>
      ) : null}
    </div>
  );
}

/** The agent is working: a pulsing mark and what it is doing, in the place the next entry will appear. */
export function Working({ children }: { children: ReactNode }) {
  return (
    <li className="entry px-4 py-8 md:px-10" aria-live="polite">
      <span className="hidden md:block" />
      <p className="flex items-center gap-3 text-base text-fg-muted">
        <span className="thinking-mark size-2 shrink-0 bg-accent" aria-hidden />
        {children}
      </p>
    </li>
  );
}

/** Keeps a scrolling page at its end while new entries arrive, unless the reader has scrolled up to read. */
export function useStickToEnd(dep: unknown, follow = true) {
  const ref = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = (): void => void (stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && follow && stuck.current) el.scrollTop = el.scrollHeight;
  }, [dep, follow]);
  return ref;
}

/**
 * The bar that floats over the foot of a page. Whatever is typed here goes to the agent without stopping it:
 * Enter sends, Shift+Enter breaks the line.
 */
export function Composer({ placeholder, sendLabel, onSend, error, above, tools }: { placeholder: string; sendLabel: string; onSend: (text: string) => Promise<boolean>; error?: string | null; above?: ReactNode; tools?: ReactNode }) {
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    const message = text.trim();
    if (message === '' || busy) return;
    setBusy(true);
    const ok = await onSend(message);
    setBusy(false);
    if (ok) setText('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    // While an input method is composing (Hangul, Kana), Enter confirms the syllable; it must not send.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send();
  };
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    void send();
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-4 pb-4">
      <form onSubmit={submit} className="pointer-events-auto flex w-full max-w-3xl flex-col gap-2 rounded-lg border border-control-border bg-surface p-2 shadow-md">
        {above}
        {error ? <Problem>{error}</Problem> : null}
        <div className="flex items-end gap-2">
          <label htmlFor={id} className="sr-only">
            {placeholder}
          </label>
          <textarea id={id} rows={1} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} className="grows min-h-11 min-w-0 flex-1 resize-none rounded-md bg-transparent px-3 py-2 text-lg text-fg placeholder:text-fg-muted" />
          {tools}
          <Button type="submit" variant="primary" busy={busy} disabled={text.trim() === ''} aria-label={sendLabel} title={sendLabel} icon={<ArrowUp className="size-5" aria-hidden />} />
        </div>
      </form>
    </div>
  );
}
