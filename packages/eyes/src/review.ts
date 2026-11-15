import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { z } from 'zod';
import { About, addSaid, readRound, type Round } from './feedback.ts';
import { SIZES, type Size } from './web.ts';

export interface ReviewOptions {
  size?: Size;
  dark?: boolean;
  /** No window: for a test, which then does what the owner would through `drive`. */
  headless?: boolean;
  drive?: (page: Page) => Promise<void>;
}

const Payload = z.object({ said: z.string().min(1).max(4000), about: About.nullable() });

/**
 * Opens the running product in a window of the eyes' own (a fresh Chrome profile, never the owner's) with a small
 * bar laid over it. The owner uses the product as usual; when something is to be said they press 말하기, point
 * at what they mean, and say it in their own words. Each thing said is kept in the round's folder with what was
 * pointed at and a picture of the screen at that moment. It ends when they press 끝내기 or close the window.
 * Nothing is added to the product: the bar lives in the browser the eyes opened.
 */
export async function reviewWeb(url: string, folder: string, opts: ReviewOptions = {}): Promise<Round> {
  const at = SIZES[opts.size ?? 'phone'];
  const browser = await chromium.launch({ channel: 'chrome', headless: opts.headless ?? false });
  try {
    const context = await browser.newContext({ ...at.context, colorScheme: opts.dark ? 'dark' : 'light' });
    let finish: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await context.exposeBinding('__szSay', async ({ page }, payload: unknown) => {
      const said = Payload.parse(payload);
      const n = readRound(folder).items.length + 1;
      const picture = `${n}.png`;
      // The bar hides itself and leaves a ring around what was pointed at, so the picture shows what was meant.
      await page.screenshot({ path: join(folder, picture), type: 'png' }).catch(() => undefined);
      addSaid(folder, { said: said.said, url: page.url(), about: said.about, picture: existsSync(join(folder, picture)) ? picture : null, at: new Date().toISOString() });
      return n;
    });
    await context.exposeBinding('__szCount', () => readRound(folder).items.length);
    await context.exposeBinding('__szDone', () => finish());
    await context.addInitScript(overlay);
    const page = await context.newPage();
    page.on('close', () => finish());
    browser.on('disconnected', () => finish());
    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    if (opts.drive) await opts.drive(page);
    await finished;
    await context.close().catch(() => undefined);
    return readRound(folder);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * The bar, as it runs inside the page. It is drawn in a shadow root above everything, takes no clicks except on
 * itself, and while the owner is pointing it keeps their click from reaching the product.
 */
function overlay(): void {
  const w = window as unknown as { __szReview?: boolean; __szSay: (payload: unknown) => Promise<number>; __szCount: () => Promise<number>; __szDone: () => Promise<void> };
  if (w.__szReview || window.top !== window) return;
  w.__szReview = true;

  const host = document.createElement('div');
  host.id = 'sz-review';
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    * { box-sizing: border-box; font: 500 13px/1.4 -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif; }
    [hidden] { display: none !important; }
    .bar, .hint, .note { pointer-events: auto; position: fixed; background: #1c1b18; color: #f4f2ec; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.35); }
    .bar, .hint { top: 8px; right: 8px; display: flex; align-items: center; gap: 2px; padding: 4px; }
    .bar.low, .hint.low { top: auto; bottom: 8px; }
    button { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 8px; color: inherit; min-height: 20px; }
    button:hover { background: rgba(255,255,255,.14); }
    .say, .save { background: #f4f2ec; color: #1c1b18; font-weight: 700; }
    .say:hover, .save:hover { background: #fff; }
    .count { padding: 0 8px; opacity: .75; font-variant-numeric: tabular-nums; }
    .hint span { padding: 0 6px 0 10px; opacity: .75; }
    .note { left: 8px; right: 8px; bottom: 8px; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
    .note.high { bottom: auto; top: 8px; }
    .note p { margin: 0; opacity: .75; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    textarea { all: unset; background: #2b2a26; color: #f4f2ec; border-radius: 8px; padding: 10px; min-height: 64px; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 15px; }
    .row { display: flex; justify-content: flex-end; gap: 4px; }
    .ring { position: fixed; border: 2px solid #ff5a36; border-radius: 6px; background: rgba(255,90,54,.12); pointer-events: none; }
  </style>
  <div class="ring" hidden></div>
  <div class="bar"><button class="say" type="button">말하기</button><span class="count">0</span><button class="flip" type="button" title="막대 옮기기">↕</button><button class="done" type="button">끝내기</button></div>
  <div class="hint" hidden><span>가리키세요</span><button class="whole" type="button">화면 전체</button><button class="cancel" type="button">취소</button></div>
  <form class="note" hidden><p></p><textarea placeholder="여기에 대해 하고 싶은 말" rows="3"></textarea><div class="row"><button class="cancel" type="button">취소</button><button class="save" type="submit">적어 두기</button></div></form>`;
  const $ = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
  const ring = $('.ring');
  const bar = $('.bar');
  const hint = $('.hint');
  const note = $<HTMLFormElement>('.note');
  const text = $<HTMLTextAreaElement>('textarea');
  const count = $('.count');

  let state: 'idle' | 'picking' | 'writing' | 'saving' = 'idle';
  let picked: Element | null = null;

  const show = (): void => {
    bar.hidden = state !== 'idle';
    hint.hidden = state !== 'picking';
    note.hidden = state !== 'writing';
    ring.hidden = picked === null || state === 'idle';
    if (document.documentElement) document.documentElement.style.cursor = state === 'picking' ? 'crosshair' : '';
  };
  const circle = (el: Element | null): void => {
    picked = el;
    if (!el) return;
    const box = el.getBoundingClientRect();
    ring.style.cssText = `left:${box.left - 3}px;top:${box.top - 3}px;width:${box.width + 6}px;height:${box.height + 6}px`;
    ring.hidden = false;
  };
  const under = (x: number, y: number): Element | null => {
    const el = document.elementFromPoint(x, y);
    return el && el !== host && el !== document.documentElement && el !== document.body ? el : null;
  };
  const write = (): void => {
    state = 'writing';
    const box = picked?.getBoundingClientRect();
    note.classList.toggle('high', !!box && box.top + box.height / 2 > window.innerHeight / 2);
    (note.querySelector('p') as HTMLElement).textContent = picked ? `“${wordsOf(picked) || picked.tagName.toLowerCase()}”에 대해` : '이 화면 전체에 대해';
    show();
    text.value = '';
    text.focus();
  };
  const idle = (): void => {
    state = 'idle';
    picked = null;
    show();
  };
  // What a person would call it: its accessible name, the label of a field, the words in it.
  const wordsOf = (el: Element): string => (el.getAttribute('aria-label') || (el as HTMLInputElement).labels?.[0]?.innerText || (el as HTMLElement).innerText || el.getAttribute('alt') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const pathOf = (el: Element): string => {
    const parts: string[] = [];
    for (let at: Element | null = el; at && at !== document.documentElement && parts.length < 5; at = at.parentElement) {
      if (at.id) {
        parts.unshift(`#${CSS.escape(at.id)}`);
        break;
      }
      const tag = at.tagName.toLowerCase();
      const same = at.parentElement ? [...at.parentElement.children].filter((child) => child.tagName === at!.tagName) : [];
      const cls = typeof at.className === 'string' && at.className.trim() ? `.${CSS.escape(at.className.trim().split(/\s+/)[0]!)}` : '';
      parts.unshift(`${tag}${cls}${same.length > 1 ? `:nth-of-type(${same.indexOf(at) + 1})` : ''}`);
    }
    return parts.join(' > ');
  };

  $('.say').addEventListener('click', () => {
    state = 'picking';
    picked = null;
    show();
  });
  // The bar sits in a corner and can be sent to the other one, so that what is under it can be pointed at too.
  $('.flip').addEventListener('click', () => {
    bar.classList.toggle('low');
    hint.classList.toggle('low');
  });
  $('.done').addEventListener('click', () => void w.__szDone());
  $('.whole').addEventListener('click', () => {
    picked = null;
    write();
  });
  for (const button of root.querySelectorAll('.cancel')) button.addEventListener('click', idle);
  note.addEventListener('submit', (event) => {
    event.preventDefault();
    const said = text.value.trim();
    if (said === '' || state !== 'writing') return;
    const box = picked?.getBoundingClientRect();
    const about = picked && box ? { words: wordsOf(picked), role: picked.getAttribute('role') || picked.tagName.toLowerCase(), box: [Math.round(box.left + window.scrollX), Math.round(box.top + window.scrollY), Math.round(box.width), Math.round(box.height)], selector: pathOf(picked).slice(0, 400) } : null;
    state = 'saving';
    show();
    // Two frames, so the picture is taken of the screen with the ring and without the box that was typed in.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        w.__szSay({ said, about })
          .then((n) => {
            count.textContent = String(n);
          })
          .catch(() => undefined)
          .finally(idle);
      }),
    );
  });

  const inside = (event: Event): boolean => event.composedPath().includes(host);
  window.addEventListener(
    'mousemove',
    (event) => {
      if (state === 'picking' && !inside(event)) circle(under(event.clientX, event.clientY));
    },
    true,
  );
  // While the owner is pointing, what they press is what they mean, not something the product should act on.
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart', 'touchend', 'dblclick', 'contextmenu']) {
    window.addEventListener(
      type,
      (event) => {
        if (state === 'picking' && !inside(event)) event.stopImmediatePropagation();
      },
      true,
    );
  }
  window.addEventListener(
    'click',
    (event) => {
      if (state !== 'picking' || inside(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      circle(under(event.clientX, event.clientY));
      write();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && (state === 'picking' || state === 'writing')) {
        event.stopImmediatePropagation();
        idle();
      }
    },
    true,
  );

  const mount = (): void => {
    if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host);
  };
  mount();
  document.addEventListener('DOMContentLoaded', mount);
  new MutationObserver(mount).observe(document, { childList: true, subtree: false });
  void w.__szCount().then((n) => {
    count.textContent = String(n);
  });
  show();
}
