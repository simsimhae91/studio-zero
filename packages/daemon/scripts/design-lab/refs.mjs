// The design lab's look at what a screen is made of: how much of the first screenful is picture, icon, coloured
// surface and text. Run over products the owner calls alive and over the studio's own pages with one ruler, so
// "flat" becomes a number that can be compared.
//
//   node refs.mjs <outDir> <name>=<url or file.html> ...
//   writes <outDir>/<name>.png (first screen, phone) and <outDir>/material.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, devices } from 'playwright-core';

const [outDir, ...targets] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });

/** Runs in the page: what the first screenful is made of. */
function material() {
  const vw = innerWidth, vh = innerHeight, cell = 4, cols = Math.ceil(vw / cell), rows = Math.ceil(vh / cell);
  const grid = { picture: new Uint8Array(cols * rows), icon: new Uint8Array(cols * rows), tint: new Uint8Array(cols * rows), text: new Uint8Array(cols * rows) };
  const mark = (g, r) => {
    for (let y = Math.max(0, Math.floor(r.top / cell)); y < Math.min(rows, Math.ceil(r.bottom / cell)); y++) for (let x = Math.max(0, Math.floor(r.left / cell)); x < Math.min(cols, Math.ceil(r.right / cell)); x++) g[y * cols + x] = 1;
  };
  const sat = (css) => {
    const m = /rgba?\(([^)]+)\)/.exec(css);
    if (!m) return { s: 0, l: 1, a: 0 };
    const [r, g, b, a = 1] = m[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
    return { s: max === min ? 0 : l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min), l, a };
  };
  let pictures = 0, icons = 0, rounded = 0, shadowed = 0, bordered = 0, boxes = 0, chars = 0;
  const radii = new Map(), sizes = new Map(), hues = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
    const tag = el.tagName.toLowerCase();
    const bgImage = cs.backgroundImage.includes('url(');
    const isMedia = tag === 'img' || tag === 'video' || tag === 'canvas' || tag === 'picture' || bgImage || (tag === 'svg' && !el.closest('button, a') && r.width >= 64);
    if (isMedia && r.width * r.height >= 56 * 56) { mark(grid.picture, r); pictures += 1; }
    else if ((tag === 'svg' || tag === 'img' || bgImage || tag === 'i') && r.width <= 56 && r.height <= 56 && r.width >= 12) { mark(grid.icon, r); icons += 1; }
    const bg = sat(cs.backgroundColor);
    const gradient = cs.backgroundImage.includes('gradient');
    if ((bg.a > 0.5 && bg.s > 0.25 && bg.l > 0.25 && bg.l < 0.97 && !(bg.l > 0.94 && bg.s < 0.5)) || gradient) { mark(grid.tint, r); const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(cs.backgroundColor); if (m) { const [R, G, B] = m.slice(1).map(Number); const mx = Math.max(R, G, B), mn = Math.min(R, G, B); if (mx - mn > 40) hues.add(Math.round((mx === R ? ((G - B) / (mx - mn)) % 6 : mx === G ? (B - R) / (mx - mn) + 2 : (R - G) / (mx - mn) + 4) * 60 / 30)); } }
    if (r.width >= 80 && r.height >= 40 && (bg.a > 0.5 || cs.boxShadow !== 'none' || parseFloat(cs.borderTopWidth) > 0)) {
      boxes += 1;
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      if (rad >= 8) rounded += 1;
      radii.set(Math.round(rad), (radii.get(Math.round(rad)) ?? 0) + 1);
      if (cs.boxShadow !== 'none') shadowed += 1;
      if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') bordered += 1;
    }
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, ' ').trim();
    if (own) { mark(grid.text, r); chars += [...own].length; const size = Math.round(parseFloat(cs.fontSize)); sizes.set(size, (sizes.get(size) ?? 0) + [...own].length); }
  }
  const share = (g) => Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 1000) / 10;
  return { picturePct: share(grid.picture), iconPct: share(grid.icon), tintPct: share(grid.tint), textPct: share(grid.text), pictures, icons, chars, boxes, roundedBoxes: rounded, shadowedBoxes: shadowed, borderedBoxes: bordered, radii: [...radii].sort((a, b) => b[1] - a[1]).slice(0, 4), hueFamilies: hues.size, topSizes: [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 4), bodyBg: getComputedStyle(document.body).backgroundColor };
}

/** Runs in a blank page: how much of a screenshot is colour at strength, and how much is neither paper nor ink. */
async function pixels(b64) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  let n = 0, strong = 0, plain = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 510;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min);
    n += 1;
    if (s > 0.35 && l > 0.15 && l < 0.85) strong += 1;
    // Near-white, near-black, or a grey: paper, ink and hairlines.
    if (max - min < 14) plain += 1;
  }
  return { colourPct: Math.round((strong / n) * 1000) / 10, greyPct: Math.round((plain / n) * 1000) / 10 };
}

const helper = await (await browser.newContext()).newPage();
const results = existsSync(`${outDir}/material.json`) ? JSON.parse(readFileSync(`${outDir}/material.json`, 'utf8')) : {};
for (const target of targets) {
  const eq = target.indexOf('=');
  const [name, where] = [target.slice(0, eq), target.slice(eq + 1)];
  const isUrl = /^https?:/.test(where);
  const ctx = await browser.newContext({ ...devices['iPhone 15 Pro'], viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, locale: 'ko-KR', colorScheme: 'light', ...(isUrl ? {} : { javaScriptEnabled: false }) });
  const page = await ctx.newPage();
  try {
    if (isUrl) {
      await page.goto(where, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(2500);
    } else {
      await page.setContent(readFileSync(where, 'utf8'), { waitUntil: 'load', timeout: 30_000 });
      await page.waitForTimeout(800);
    }
    const dom = await page.evaluate(material);
    const shot = await page.screenshot({ type: 'png' });
    writeFileSync(`${outDir}/${name}.png`, shot);
    results[name] = { where, title: (await page.title()).slice(0, 60), ...dom, ...(await helper.evaluate(pixels, shot.toString('base64'))) };
    const m = results[name];
    process.stdout.write(`${name.padEnd(22)} picture ${String(m.picturePct).padStart(5)}%  icons ${String(m.icons).padStart(3)}  tint ${String(m.tintPct).padStart(5)}%  colour px ${String(m.colourPct).padStart(5)}%  grey px ${String(m.greyPct).padStart(5)}%  text ${String(m.textPct).padStart(5)}%  rounded ${m.roundedBoxes}/${m.boxes}  shadow ${m.shadowedBoxes}  border ${m.borderedBoxes}\n`);
  } catch (err) {
    process.stdout.write(`${name}: FAILED ${String(err).split('\n')[0]}\n`);
  } finally {
    await ctx.close();
  }
}
writeFileSync(`${outDir}/material.json`, JSON.stringify(results, null, 1));
await browser.close();
