// The design lab's look at a screen over time: how it enters, what keeps moving once it has, and what answers a
// press. Run over products the owner calls alive and over the studio's own pages with one ruler, as refs.mjs is
// for what a screen is made of.
//
//   node motion.mjs <outDir> <name>=<url or file.html> ...
//   writes <outDir>/<name>-film.png (frames after load, side by side) and <outDir>/motion.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

const [outDir, ...targets] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const TIMES = [150, 400, 800, 1500, 3000, 5000];

/** Runs in a blank page: the share of pixels that differ between two pictures of the same size, inside a box when one is given. */
async function changed({ a, b, box }) {
  const load = async (b64) => { const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode(); return img; };
  const [x, y] = [await load(a), await load(b)];
  const [w, h] = [Math.min(x.width, y.width), Math.min(x.height, y.height)];
  const read = (img) => { const c = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true }); c.drawImage(img, 0, 0); return c.getImageData(0, 0, w, h).data; };
  const [p, q] = [read(x), read(y)];
  const [x0, y0, x1, y1] = box ? [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(w, box[2]), Math.min(h, box[3])] : [0, 0, w, h];
  let n = 0, diff = 0;
  for (let row = y0; row < y1; row += 2) for (let col = x0; col < x1; col += 2) {
    const i = (row * w + col) * 4;
    n += 1;
    if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 36) diff += 1;
  }
  return n === 0 ? 0 : Math.round((diff / n) * 1000) / 1000;
}

/** Runs in the page: what is declared to move, and what is moving now. */
function declared() {
  const vh = innerHeight, vw = innerWidth;
  const ms = (v) => v.split(',').map((t) => (t.trim().endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000)).filter((n) => n > 0);
  const transitions = new Map(), easings = new Map();
  let withTransition = 0, pressables = 0, pressablesWithTransition = 0, keyframed = 0;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue;
    const cs = getComputedStyle(el);
    const durations = ms(cs.transitionDuration);
    const press = el.matches('button, a[href], label[for], [role=button], [role=tab], summary');
    if (press) pressables += 1;
    if (durations.length > 0) {
      withTransition += 1;
      if (press) pressablesWithTransition += 1;
      for (const d of durations) transitions.set(Math.round(d / 10) * 10, (transitions.get(Math.round(d / 10) * 10) ?? 0) + 1);
      for (const e of cs.transitionTimingFunction.split(/,(?![^(]*\))/)) easings.set(e.trim(), (easings.get(e.trim()) ?? 0) + 1);
    }
    if (cs.animationName !== 'none') keyframed += 1;
  }
  const running = (typeof document.getAnimations === 'function' ? document.getAnimations() : []).filter((a) => a.playState === 'running');
  const timing = running.map((a) => a.effect?.getComputedTiming()).filter(Boolean);
  const top = (m) => [...m].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k}${typeof k === 'number' ? 'ms' : ''} ×${n}`);
  return {
    withTransition, pressables, pressablesWithTransition, keyframed,
    transitionMs: top(transitions), easing: top(easings),
    running: running.length, looping: timing.filter((t) => t.iterations === Infinity).length,
    runningMs: [...new Set(timing.map((t) => (typeof t.duration === 'number' ? Math.round(t.duration) : 0)).filter((d) => d > 0))].sort((a, b) => a - b).slice(0, 6),
    video: document.querySelectorAll('video').length,
  };
}

/** Runs in the page: up to six things to press on the first screen, spread down it. */
function pressTargets() {
  const vh = innerHeight, vw = innerWidth;
  const all = [...document.querySelectorAll('button, a[href], label[for], [role=button], [role=tab]')].map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ el, r }) => r.width >= 32 && r.height >= 28 && r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw && getComputedStyle(el).visibility === 'visible');
  const picked = [];
  for (const t of all.sort((a, b) => a.r.top - b.r.top)) if (!picked.some((p) => Math.abs(p.r.top - t.r.top) < 40 && Math.abs(p.r.left - t.r.left) < 60)) picked.push(t);
  const step = Math.max(1, Math.floor(picked.length / 6));
  return picked.filter((_, i) => i % step === 0).slice(0, 6).map(({ el, r }) => ({ text: (el.innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 16), x: r.left + r.width / 2, y: r.top + r.height / 2, box: [r.left - 8, r.top - 8, r.right + 8, r.bottom + 8] }));
}

const helper = await (await browser.newContext()).newPage();
const results = existsSync(`${outDir}/motion.json`) ? JSON.parse(readFileSync(`${outDir}/motion.json`, 'utf8')) : {};
for (const target of targets) {
  const eq = target.indexOf('=');
  const [name, where] = [target.slice(0, eq), target.slice(eq + 1)];
  const isUrl = /^(https?|file):/.test(where);
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, locale: 'ko-KR', colorScheme: 'light', ...(isUrl ? {} : { javaScriptEnabled: false }) });
  const page = await ctx.newPage();
  try {
    const started = Date.now();
    if (isUrl) await page.goto(where, { waitUntil: 'commit', timeout: 45_000 });
    else await page.setContent(readFileSync(where, 'utf8'), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const frames = [];
    for (const t of TIMES) {
      const wait = t - (Date.now() - started);
      if (wait > 0) await page.waitForTimeout(wait);
      frames.push({ at: Date.now() - started, png: (await page.screenshot({ type: 'png' })).toString('base64') });
    }
    const shares = [];
    for (let i = 1; i < frames.length; i++) shares.push(await helper.evaluate(changed, { a: frames[i - 1].png, b: frames[i].png }));
    const dom = await page.evaluate(declared);
    // What a press gives back: the picture of the control and its surroundings, held down against at rest.
    const presses = [];
    for (const t of await page.evaluate(pressTargets)) {
      const before = (await page.screenshot({ type: 'png' })).toString('base64');
      await page.mouse.move(t.x, t.y);
      await page.mouse.down();
      await page.waitForTimeout(140);
      const held = (await page.screenshot({ type: 'png' })).toString('base64');
      await page.mouse.move(2, 2);
      await page.mouse.up();
      await page.waitForTimeout(260);
      presses.push({ text: t.text, answered: (await helper.evaluate(changed, { a: before, b: held, box: t.box.map(Math.round) })) >= 0.01 });
    }
    // The film: the frames after load, side by side with their times.
    const sheet = await (await browser.newContext({ viewport: { width: frames.length * 206 + 6, height: 470 } })).newPage();
    await sheet.setContent(`<body style="margin:0;background:#1b1d22;display:flex;gap:6px;padding:6px;font:12px system-ui;color:#fff">${frames.map((f) => `<div><div style="padding:0 0 4px">${(f.at / 1000).toFixed(2)}s</div><img src="data:image/png;base64,${f.png}" style="width:200px;display:block"></div>`).join('')}</body>`);
    await sheet.waitForTimeout(300);
    writeFileSync(`${outDir}/${name}-film.png`, await sheet.screenshot({ type: 'png' }));
    await sheet.context().close();
    results[name] = { where, frameAtMs: frames.map((f) => f.at), changedShare: shares, ...dom, presses };
    const r = results[name];
    process.stdout.write(`${name.padEnd(20)} enter ${shares.map((s) => `${Math.round(s * 100)}%`).join(' ')} | still running ${r.running} (${r.looping} loop) ${r.runningMs.join('/')}ms | transitions on ${r.pressablesWithTransition}/${r.pressables} pressables ${r.transitionMs.join(', ')} | keyframed ${r.keyframed} | press answered ${presses.filter((p) => p.answered).length}/${presses.length}\n`);
  } catch (err) {
    process.stdout.write(`${name}: FAILED ${String(err).split('\n')[0]}\n`);
  } finally {
    await ctx.close();
  }
}
writeFileSync(`${outDir}/motion.json`, JSON.stringify(results, null, 1));
await browser.close();
