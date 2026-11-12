import { X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react';
import { sealMockup, structuralSelector, type MockupNote, type PathStep } from '../../lib/mockups.ts';
import { mockupName } from '../../lib/steps.ts';
import { Button, IconButton, Problem, inputClass } from '../../ui.tsx';
import { useMockupDesk, type MockupPage } from '../mockupDesk.tsx';

/** An element the owner pointed at: where it sits (what is sent), and how it reads (shown here only). */
export interface Target {
  selector: string;
  label: string;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/** The steps from the body down to an element. Read from the page; `structuralSelector` decides what of it is kept. */
function pathTo(el: Element): PathStep[] {
  const steps: PathStep[] = [];
  for (let at: Element | null = el; at && at.localName !== 'body' && at.localName !== 'html'; at = at.parentElement) {
    const same = at.parentElement ? [...at.parentElement.children].filter((child) => child.localName === at!.localName) : [at];
    steps.unshift({ tag: at.localName, id: at.id, classes: [...at.classList], nth: same.indexOf(at) + 1, siblings: same.length });
  }
  return steps;
}

/** How an element reads to a person: its tag and the start of its text. Shown as text beside the note, never sent. */
const labelOf = (el: Element): string => {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return `<${el.localName}>${text ? ` ${text.slice(0, 40)}${text.length > 40 ? '…' : ''}` : ''}`;
};

/**
 * A mock-up, live: the page itself in a frame, at whatever size the pane is showing.
 *
 * The frame is sealed (no scripts, no requests) and shares this document's origin, which is what lets the desk
 * ask it "what is under the pointer" without anything of the page's own having to run. While `picking`, a pane
 * of glass lies over the page: moving over it outlines the element beneath, a click chooses it, and the wheel
 * still scrolls the page.
 */
export function MockupStage({ page, className, picking, target, onTarget }: { page: MockupPage; className: string; picking: boolean; target: Target | null; onTarget: (target: Target) => void }) {
  const { notes } = useMockupDesk();
  const frame = useRef<HTMLIFrameElement>(null);
  const [hover, setHover] = useState<Box | null>(null);
  // Bumped when the page has loaded or been scrolled: boxes are measured again.
  const [measured, setMeasured] = useState(0);
  const sealed = useMemo(() => sealMockup(page.html), [page.html]);

  const under = (e: MouseEvent<HTMLDivElement>): Element | null => {
    const doc = frame.current?.contentDocument;
    if (!doc) return null;
    // The glass may be drawn scaled (a phone or a tablet shrunk to fit): map the pointer back to the page's own pixels.
    const glass = e.currentTarget.getBoundingClientRect();
    const el = doc.elementFromPoint(((e.clientX - glass.left) / glass.width) * e.currentTarget.offsetWidth, ((e.clientY - glass.top) / glass.height) * e.currentTarget.offsetHeight);
    return el && el !== doc.documentElement && el !== doc.body ? el : null;
  };
  const find = (selector: string): Box | null => {
    try {
      const el = frame.current?.contentDocument?.querySelector(selector);
      return el ? boxOf(el) : null;
    } catch {
      return null;
    }
  };
  // Read on every render while picking: the page may have scrolled since the last one.
  void measured;
  const pinned = picking ? notes.flatMap((note, i) => (note.file === page.file && note.selector !== null ? [{ n: i + 1, box: find(note.selector) }] : [])) : [];
  const chosen = picking && target ? find(target.selector) : null;

  return (
    <div className={className}>
      <iframe ref={frame} title={`${mockupName(page.file)} 시안`} srcDoc={sealed} sandbox="allow-same-origin" referrerPolicy="no-referrer" className="block size-full border-0 bg-surface" onLoad={() => setMeasured((n) => n + 1)} />
      {picking ? (
        <div
          className="absolute inset-0 cursor-crosshair overflow-hidden"
          onMouseMove={(e) => {
            const el = under(e);
            setHover(el ? boxOf(el) : null);
          }}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            const el = under(e);
            if (el) onTarget({ selector: structuralSelector(pathTo(el)), label: labelOf(el) });
          }}
          onWheel={(e) => {
            frame.current?.contentWindow?.scrollBy(e.deltaX, e.deltaY);
            setHover(null);
            setMeasured((n) => n + 1);
          }}
        >
          {hover ? <Outline box={hover} tone="hover" /> : null}
          {chosen ? <Outline box={chosen} tone="chosen" /> : null}
          {pinned.map(({ n, box }) =>
            box ? (
              <Outline key={n} box={box} tone="pinned">
                <span className="absolute left-0 top-0 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent">{n}</span>
              </Outline>
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  );
}

function Outline({ box, tone, children }: { box: Box; tone: 'hover' | 'chosen' | 'pinned'; children?: ReactNode }) {
  return (
    <div className="mockup-outline" data-tone={tone} style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
      {children}
    </div>
  );
}

/**
 * The notes the owner is collecting on the mock-ups, and the way to send them. One field: with an element
 * chosen it writes a note on that element, without one a note on the page as a whole.
 */
export function MockupNotes({ file, target, onClear }: { file: string; target: Target | null; onClear: () => void }) {
  const desk = useMockupDesk();
  const [text, setText] = useState('');
  const add = (e: FormEvent): void => {
    e.preventDefault();
    if (text.trim() === '') return;
    desk.addNote({ file, selector: target?.selector ?? null, text: text.trim() } satisfies MockupNote);
    setText('');
    onClear();
  };
  return (
    <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
      {desk.notes.length > 0 ? (
        <ol className="flex flex-col gap-1">
          {desk.notes.map((note, i) => (
            <li key={i} className="flex max-w-none items-start gap-2">
              <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-on-accent">{i + 1}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg-muted">
                  {mockupName(note.file)} · {note.selector === null ? '시안 전체' : '고른 요소'}
                </span>
                <span className="break-words text-base">{note.text}</span>
              </span>
              <IconButton label={`${i + 1}번 메모 지우기`} onClick={() => desk.removeNote(i)}>
                <X className="size-4" aria-hidden />
              </IconButton>
            </li>
          ))}
        </ol>
      ) : null}
      {target ? (
        <p className="flex items-center gap-2 text-sm">
          <span className="font-medium">고른 요소</span>
          {/* What the page says there: shown so the owner can tell which element this is, and not sent. */}
          <code className="min-w-0 flex-1 truncate font-mono text-fg-muted">{target.label}</code>
          <button type="button" onClick={onClear} className="min-h-9 pointer-coarse:min-h-11 shrink-0 px-2 font-medium text-accent underline underline-offset-4">
            선택 해제
          </button>
        </p>
      ) : null}
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          aria-label={target ? '고른 요소에 대한 수정 메모' : `${mockupName(file)} 전체에 대한 수정 메모`}
          className={`${inputClass} min-w-40 flex-1`}
          value={text}
          maxLength={500}
          placeholder={target ? '이 요소를 어떻게 바꿀까요?' : `${mockupName(file)}에서 바꿀 것 (색, 배치, 문구…)`}
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" disabled={text.trim() === ''}>
          메모 추가
        </Button>
        <Button variant="primary" busy={desk.revising} disabled={desk.notes.length === 0 || !desk.canRevise} onClick={desk.revise}>
          {desk.notes.length > 0 ? `수정 요청 ${desk.notes.length}건 보내기` : '수정 요청 보내기'}
        </Button>
      </form>
      {desk.reviseError ? <Problem>{desk.reviseError}</Problem> : null}
      {!desk.canRevise && desk.notes.length > 0 ? <p className="text-sm text-fg-muted">진행 중인 작업이 끝나면 보낼 수 있습니다.</p> : null}
    </div>
  );
}
