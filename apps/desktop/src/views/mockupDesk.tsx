import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { MOCKUP_FILES, sealMockup, type MockupNote } from '../lib/mockups.ts';
import { useStudio } from '../lib/studio.tsx';
import { useFit } from './panels/MobileFramePreview.tsx';

/** A mock-up page as the workspace has it now. */
export interface MockupPage {
  file: string;
  html: string;
}

/**
 * What the conversation pane and the browser pane share about a project's mock-ups: the pages, which one is
 * chosen, and the notes the owner has pinned on them. One choice, shown in both places.
 */
export interface MockupDesk {
  pages: readonly MockupPage[];
  reload: () => void;
  /** The design task whose pages these are: the latest one that finished. Its card shows them live. */
  designTaskId: string | null;
  /** The chosen page, or null before any choice (the first page is then the one). */
  picked: string | null;
  /** Chooses a page; the browser pane follows. */
  pick: (file: string) => void;
  /** Chooses a page and brings the browser pane forward on it. */
  view: (file: string) => void;
  /** The same, and puts the cursor in the field where a change is written. `asked` counts the times. */
  ask: (file: string) => void;
  asked: number;
  /** What the browser pane shows: the running app, or the chosen mock-up. */
  source: 'app' | 'mockup';
  showApp: () => void;
  notes: readonly MockupNote[];
  addNote: (note: MockupNote) => void;
  removeNote: (index: number) => void;
  /** Sends the notes back as a revision of the design, with one more that is still in the field if there is one. */
  revise: (also?: MockupNote) => void;
  /** Has every mock-up drawn again from the start, toward `direction` if the owner gave one. */
  redraw: (direction: string) => void;
  revising: boolean;
  reviseError: string | null;
  /** False while a task holds the workspace, or when there is no finished design to revise. */
  canRevise: boolean;
}

const noDesk: MockupDesk = { pages: [], reload: () => undefined, designTaskId: null, picked: null, pick: () => undefined, view: () => undefined, ask: () => undefined, asked: 0, source: 'app', showApp: () => undefined, notes: [], addNote: () => undefined, removeNote: () => undefined, revise: () => undefined, redraw: () => undefined, revising: false, reviseError: null, canRevise: false };
export const MockupDeskContext = createContext<MockupDesk>(noDesk);
export const useMockupDesk = (): MockupDesk => useContext(MockupDeskContext);

/**
 * The mock-up pages in the project's workspace, as the daemon shows and measures them: each with its pictures
 * and the theme's faces inside it, so the page in the frame is the page that was audited and walked. `stamp`
 * changes when they may have changed (a task ended). A page that is missing or empty is simply not there.
 */
export function useMockupPages(projectId: string, stamp: string): { pages: readonly MockupPage[]; reload: () => void } {
  const { backend } = useStudio();
  const [pages, setPages] = useState<readonly MockupPage[]>([]);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    let stale = false;
    void Promise.all(
      MOCKUP_FILES.map((file) =>
        backend.call('mockups.page', { projectId, file }).then(
          (read): MockupPage | null => (read.html === null || read.html.trim() === '' ? null : { file, html: read.html }),
          () => null,
        ),
      ),
    ).then((read) => {
      if (!stale) setPages(read.filter((page): page is MockupPage => page !== null));
    });
    return () => {
      stale = true;
    };
  }, [backend, projectId, stamp, turn]);
  const reload = useCallback(() => setTurn((n) => n + 1), []);
  return { pages, reload };
}

/** The top of a phone screen: enough of a first screen to tell one direction from another. */
const THUMB = { width: 393, height: 560 } as const;

/**
 * A mock-up at a glance: the page itself at a phone's width, scaled to the column. Live, so it follows the
 * app's light or dark scheme as the browser pane does, and sealed: nothing in it runs and it cannot be touched.
 */
export function MockupThumb({ html, label }: { html: string; label: string }) {
  const { ref, scale } = useFit(THUMB.width, THUMB.height, 0);
  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-md border border-border bg-surface" style={{ aspectRatio: `${THUMB.width} / ${THUMB.height}` }}>
      <iframe title={label} srcDoc={sealMockup(html)} sandbox="" tabIndex={-1} referrerPolicy="no-referrer" className="pointer-events-none absolute left-0 top-0 border-0" style={{ inlineSize: THUMB.width, blockSize: THUMB.height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  );
}
