/**
 * A design task's mock-ups, as the desk handles them: shown live, pointed at, and sent back with notes.
 *
 * A mock-up is a page an agent wrote. It is shown inside the app, so it is sealed first: nothing in it runs and
 * nothing in it is fetched. And what the owner says about it goes back as their own request, so nothing the
 * page says is copied into that request: an element is named by where it sits, not by what it reads.
 */

/** The pages a design task may write, in the order they are offered. */
export const MOCKUP_FILES = ['docs/mockups/a.html', 'docs/mockups/b.html', 'docs/mockups/c.html'] as const;

/**
 * Parsed before anything of the page's own: no scripts, no requests, pictures only from data the page carries,
 * and links that open nowhere. It goes first in the document, where a page cannot comment it out; in an
 * `srcdoc` frame that does not cost the page its standards mode.
 */
const SEAL = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:"><base target="_blank">`;

/** The document to hand an `srcdoc` frame. The frame's `sandbox` attribute is the other half: no `allow-scripts`. */
export const sealMockup = (html: string): string => SEAL + html;

/** One thing the owner wants changed. `selector` null: the page as a whole. */
export interface MockupNote {
  file: string;
  selector: string | null;
  text: string;
}

/** One step from the body down to the element: what the page calls it, and which of its like-named siblings it is. */
export interface PathStep {
  tag: string;
  id: string;
  classes: readonly string[];
  /** 1-based position among siblings with the same tag. */
  nth: number;
  /** How many siblings share the tag. */
  siblings: number;
}

const TAG = /^[a-z][a-z0-9-]{0,31}$/;
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
const MAX_STEPS = 12;

/**
 * Where an element sits, as a CSS selector an engine can find it by: `main > section:nth-of-type(2) > button.primary`.
 *
 * Tags, positions, and at most one id or class per step, each of them an identifier of letters, digits, `-`
 * and `_`. Nothing else of the page gets in: this string is sent as part of the owner's request.
 */
export function structuralSelector(path: readonly PathStep[]): string {
  const steps = path.slice(-MAX_STEPS).map((step) => {
    const tag = TAG.test(step.tag) ? step.tag : '*';
    if (NAME.test(step.id)) return `${tag}#${step.id}`;
    const named = step.classes.find((name) => NAME.test(name));
    return `${tag}${named ? `.${named}` : ''}${step.siblings > 1 ? `:nth-of-type(${step.nth})` : ''}`;
  });
  return steps.join(' > ');
}

/** A selector this desk could have produced. Checked again before a note is sent, whatever made it. */
const SELECTOR = /^[A-Za-z0-9_#.*:()> -]{1,600}$/;
const isMockupFile = (file: string): boolean => (MOCKUP_FILES as readonly string[]).includes(file);

/**
 * The request that sends a design back for changes: the owner's notes, grouped by page. The words are the
 * owner's; the selectors are positions. A note on a file this desk does not draw, or with a selector it could
 * not have made, is left out.
 */
export function revisionRequest(notes: readonly MockupNote[]): string {
  const kept = notes.filter((note) => note.text.trim() !== '' && isMockupFile(note.file) && (note.selector === null || SELECTOR.test(note.selector)));
  if (kept.length === 0) return '';
  const lines = ['시안을 아래 요청대로 고쳐줘. 적은 것만 고치고, 다른 시안과 설계 문서는 요청과 어긋나게 된 곳만 맞춰줘.'];
  let n = 0;
  for (const file of MOCKUP_FILES) {
    const mine = kept.filter((note) => note.file === file);
    if (mine.length === 0) continue;
    lines.push('', file);
    for (const note of mine) lines.push(`${++n}. ${note.selector === null ? '시안 전체' : `\`${note.selector}\` 요소`}: ${note.text.trim().replace(/\s+/g, ' ')}`);
  }
  return lines.join('\n');
}

/**
 * The request that has every mock-up drawn again from the start. `direction` is the owner's own steer, if they
 * gave one; without it the directions are found afresh.
 */
export function redrawRequest(direction: string): string {
  const steer = direction.replace(/\s+/g, ' ').trim().slice(0, 500);
  return `시안을 전부 새로 그려줘. 지금 있는 시안은 버리고 처음부터 다시 잡아. 설계 문서는 새 시안과 어긋나게 된 곳만 맞춰줘.${steer === '' ? '' : `\n\n원하는 방향: ${steer}`}`;
}
