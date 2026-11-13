import type { Page } from 'playwright-core';
import { z } from 'zod';

/**
 * A page looked at over time.
 *
 * A screenshot is one frame. Some pages are their motion: a product demo that plays in the first screen, an
 * entrance that assembles the layout, a loop behind the headline. Measured from one frame, such a page reads as
 * a headline over a picture, and whatever is built from that reading misses what made the page work.
 *
 * So the page is played again from the start and photographed as it goes, then photographed a few screens down.
 * What comes back is a contact sheet a reviewing model can read as a sequence, and lines of measurement: how
 * much of the screen changed between frames, what is still running once the entrance is over, whether there is
 * video or a canvas and how large. The lines are observations of someone else's page, like the rest of a
 * reference: they travel as data.
 */
export interface Film {
  /** The frames, tiled and captioned, as one PNG. */
  sheet: Uint8Array;
  /** What was measured, one fact per line. */
  lines: string[];
}

/** When the frames are taken, in ms after the page starts again. Dense early, where an entrance happens. */
const TIMES_MS = [300, 1000, 2000, 3500, 5500] as const;
const MAX_SCROLL_STOPS = 3;
const TILE = { width: 360, height: 225, caption: 24, columns: 4 } as const;

/** Runs in the reference page: what is moving right now. Self-contained; its answer is validated before use. */
function collectLiveMotion(): unknown {
  let running = 0;
  let looping = 0;
  let minMs = 0;
  let maxMs = 0;
  const animations = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
  for (let i = 0; i < animations.length && i < 400; i++) {
    const a = animations[i]!;
    if (a.playState !== 'running') continue;
    running += 1;
    const timing = a.effect ? a.effect.getComputedTiming() : null;
    if (!timing) continue;
    if (timing.iterations === Infinity) looping += 1;
    const d = typeof timing.duration === 'number' ? timing.duration : 0;
    if (d > 0) {
      minMs = minMs === 0 ? d : Math.min(minMs, d);
      maxMs = Math.max(maxMs, d);
    }
  }
  const box = (el: Element): { w: number; h: number; inFirstScreen: boolean } => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), inFirstScreen: r.top < window.innerHeight && r.bottom > 0 && r.width > 0 };
  };
  const videos = Array.from(document.querySelectorAll('video'))
    .slice(0, 12)
    .map((v) => ({ ...box(v), playing: !v.paused && !v.ended && v.readyState > 2, autoplay: v.autoplay, loop: v.loop }));
  const canvases = Array.from(document.querySelectorAll('canvas'))
    .map(box)
    .filter((c) => c.w >= 50 && c.h >= 50)
    .slice(0, 12);
  return { running, looping, minMs: Math.round(minMs), maxMs: Math.round(maxMs), videos, canvases, screens: Math.max(0, Math.floor((document.documentElement.scrollHeight - window.innerHeight) / Math.max(1, window.innerHeight))) };
}

const Box = z.object({ w: z.number().min(0).max(100_000), h: z.number().min(0).max(100_000), inFirstScreen: z.boolean() });
const LiveMotion = z.object({
  running: z.number().int().min(0).max(400),
  looping: z.number().int().min(0).max(400),
  minMs: z.number().min(0).max(3_600_000),
  maxMs: z.number().min(0).max(3_600_000),
  videos: z.array(Box.extend({ playing: z.boolean(), autoplay: z.boolean(), loop: z.boolean() })).max(12),
  canvases: z.array(Box).max(12),
  screens: z.number().int().min(0).max(100_000),
});

/**
 * Runs in a blank page of the studio's own: lays the frames out as a captioned sheet, and compares each frame
 * taken over time with the one before it. Returns, per pair, the share of the picture that changed.
 */
async function layOut({ frames, timed, tile }: { frames: { label: string; src: string }[]; timed: number; tile: { width: number; height: number; caption: number; columns: number; gap?: number } }): Promise<number[]> {
  document.body.style.cssText = `margin:0;background:#111;display:grid;grid-template-columns:repeat(${tile.columns},${tile.width}px);gap:${tile.gap ?? 0}px;font:13px/${tile.caption}px system-ui,sans-serif;color:#eee`;
  const images: HTMLImageElement[] = [];
  for (const frame of frames) {
    const figure = document.createElement('figure');
    figure.style.cssText = 'margin:0';
    const img = new Image(tile.width, tile.height);
    img.src = frame.src;
    img.style.cssText = 'display:block;object-fit:cover;object-position:top';
    const caption = document.createElement('figcaption');
    caption.textContent = frame.label;
    caption.style.cssText = `height:${tile.caption}px;padding:0 8px;white-space:nowrap;overflow:hidden`;
    figure.append(img, caption);
    document.body.append(figure);
    images.push(img);
  }
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
  // Compared small: what matters is how much of the screen moved, not which pixels.
  const W = 96;
  const H = 60;
  const read = (img: HTMLImageElement): Uint8ClampedArray => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, W, H);
    return ctx.getImageData(0, 0, W, H).data;
  };
  const changed: number[] = [];
  let before = images[0] ? read(images[0]) : null;
  for (let i = 1; i < timed && before; i++) {
    const now = read(images[i]!);
    let n = 0;
    for (let p = 0; p < now.length; p += 4) if (Math.abs(now[p]! - before[p]!) > 28 || Math.abs(now[p + 1]! - before[p + 1]!) > 28 || Math.abs(now[p + 2]! - before[p + 2]!) > 28) n += 1;
    changed.push(n / (W * H));
    before = now;
  }
  return changed;
}

/** One picture of a sequence, with the caption the studio gives it. */
export interface Frame {
  label: string;
  jpeg: Buffer;
}
export interface Tile {
  width: number;
  height: number;
  caption: number;
  columns: number;
  /** Space between frames, in px. None when the frames are moments of one screen to be read as a strip. */
  gap?: number;
}

/**
 * Tiles frames into one captioned PNG, in a blank page of the studio's own that `open` supplies (and that is
 * closed here). The first `timed` frames are also compared, each with the one before: the share of the picture
 * that changed. The page that does this runs the studio's script, so it must come from a context where scripts
 * run; the frames themselves are only pictures by now.
 */
export async function contactSheet(open: () => Promise<Page>, frames: readonly Frame[], opts: { tile: Tile; timed?: number }): Promise<{ sheet: Uint8Array; changed: number[] }> {
  const tile = opts.tile;
  const sheetPage = await open();
  try {
    const columns = Math.max(1, Math.min(tile.columns, frames.length));
    const rows = Math.max(1, Math.ceil(frames.length / columns));
    const gap = tile.gap ?? 0;
    await sheetPage.setViewportSize({ width: columns * tile.width + (columns - 1) * gap, height: rows * (tile.height + tile.caption) + (rows - 1) * gap });
    const changed = await sheetPage.evaluate(layOut, { frames: frames.map((f) => ({ label: f.label, src: `data:image/jpeg;base64,${f.jpeg.toString('base64')}` })), timed: opts.timed ?? 0, tile: { ...tile, columns, gap } });
    const sheet = await sheetPage.screenshot({ type: 'png' });
    return { sheet, changed: z.array(z.number().min(0).max(1)).max(frames.length).catch([]).parse(changed) };
  } finally {
    await sheetPage.close().catch(() => undefined);
  }
}

const percent = (share: number): string => `${Math.round(share * 100)}%`;
const size = (b: { w: number; h: number }): string => `${b.w}x${b.h}`;
const largest = <T extends { w: number; h: number }>(boxes: readonly T[]): T => boxes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));

/**
 * Films a page that is already open. `replay` starts it again from the beginning (a reload), so the entrance is
 * on film. Leaves the page scrolled; the caller is done with it.
 */
export async function filmPage(page: Page, replay: () => Promise<unknown>): Promise<Film> {
  await replay();
  const started = Date.now();
  const frames: Frame[] = [];
  const at: string[] = [];
  for (const t of TIMES_MS) {
    const wait = t - (Date.now() - started);
    if (wait > 0) await page.waitForTimeout(wait);
    const label = `${((Date.now() - started) / 1000).toFixed(1)}s`;
    at.push(label);
    frames.push({ label: `${label} after load`, jpeg: await page.screenshot({ type: 'jpeg', quality: 70 }) });
  }
  const timed = frames.length;
  const live = LiveMotion.safeParse(await page.evaluate(collectLiveMotion).catch(() => null));
  const stops = Math.min(MAX_SCROLL_STOPS, live.success ? live.data.screens : 0);
  for (let i = 1; i <= stops; i++) {
    await page.evaluate((n) => window.scrollTo(0, n * window.innerHeight), i);
    await page.waitForTimeout(800);
    frames.push({ label: `scrolled ${i} screen${i === 1 ? '' : 's'} down`, jpeg: await page.screenshot({ type: 'jpeg', quality: 70 }) });
  }

  const { sheet, changed: shares } = await contactSheet(() => page.context().newPage(), frames, { tile: TILE, timed });

  const lines = [`over time: frames at ${at.join(', ')} after the page starts; share of the first screen that changed from each to the next: ${shares.map(percent).join(', ') || 'not measured'}`];
  const late = shares.slice(-2);
  if (shares.length >= 3) lines.push(late.every((s) => s < 0.01) ? (shares[0]! >= 0.05 ? 'it enters and then holds still: nothing moves once it has loaded' : 'it is still: nothing moves after load') : 'it keeps moving after its entrance: a loop, a video or a running demo is part of the first screen');
  if (live.success) {
    const m = live.data;
    if (m.running > 0) lines.push(`running animations at ${at.at(-1)}: ${m.running}${m.looping > 0 ? ` (${m.looping} looping)` : ''}${m.maxMs > 0 ? `, ${m.minMs === m.maxMs ? `${m.maxMs}ms` : `${m.minMs} to ${m.maxMs}ms`}` : ''}`);
    if (m.videos.length > 0) {
      const big = largest(m.videos);
      const playing = m.videos.filter((v) => v.playing).length;
      lines.push(`video: ${m.videos.length} (${playing} playing in this browser${m.videos.some((v) => v.autoplay) ? ', autoplay' : ''}${m.videos.some((v) => v.loop) ? ', loop' : ''}), the largest ${size(big)}${big.inFirstScreen ? ', in the first screen' : ', below the first screen'}`);
    }
    if (m.canvases.length > 0) {
      const big = largest(m.canvases);
      lines.push(`canvas: ${m.canvases.length}, the largest ${size(big)}${big.inFirstScreen ? ', in the first screen' : ''}`);
    }
    if (stops > 0) lines.push(`the page runs ${m.screens + 1} screens deep; ${stops} more ${stops === 1 ? 'was' : 'were'} photographed on the way down`);
  }
  return { sheet, lines };
}
