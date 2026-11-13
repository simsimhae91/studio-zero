// The design lab's own ruler: what the studio's checks do not yet measure, taken off a mock-up page the way a
// person would see it. Each number here is a candidate for a rule: whichever of them separates a screen that
// reads well from one that does not is promoted into the audit, and the rest are dropped.
//
//   node metrics.mjs <page.html> <mobile-expo|web-vite-react|web-next> <outPrefix>
//   writes <outPrefix>.json, <outPrefix>-phone.png (first screen), <outPrefix>-phone-full.png, and for a web
//   product <outPrefix>-desktop.png and <outPrefix>-desktop-full.png
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const [file, template, out] = process.argv.slice(2);
const html = readFileSync(file, 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };

/** Runs in the page: everything that can be read off the DOM. */
function read() {
  const vw = innerWidth, vh = innerHeight;
  const root = getComputedStyle(document.documentElement);
  // A token as the bytes it is painted in: computed styles keep oklch() as written, a canvas does not.
  const paint = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgb = (name) => {
    const v = root.getPropertyValue(name).trim();
    if (!v) return null;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = '#000';
    paint.fillStyle = v;
    paint.fillRect(0, 0, 1, 1);
    return [...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const tokens = Object.fromEntries(['--sz-brand', '--sz-brand-soft', '--sz-accent', '--sz-bg', '--sz-surface', '--sz-fg', '--sz-brand-2', '--sz-second'].map((n) => [n, rgb(n)]));

  const visible = (el, cs, r) => r.width >= 1 && r.height >= 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  const inFirst = (r) => r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const angleOf = (el) => {
    // The turn a piece of text ends up with, from every transform above it.
    let deg = 0;
    if (el instanceof SVGGraphicsElement && typeof el.getScreenCTM === 'function') {
      const m = el.getScreenCTM();
      if (m) return Math.abs((Math.atan2(m.b, m.a) * 180) / Math.PI);
    }
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const t = getComputedStyle(a).transform;
      const m = /matrix\(([^)]+)\)/.exec(t);
      if (m) {
        const [p, q] = m[1].split(',').map(Number);
        deg += (Math.atan2(q, p) * 180) / Math.PI;
      }
      const rot = getComputedStyle(a).rotate;
      if (rot && rot !== 'none') deg += parseFloat(rot) || 0;
    }
    return Math.abs(((deg % 360) + 360) % 360 > 180 ? 360 - (((deg % 360) + 360) % 360) : ((deg % 360) + 360) % 360);
  };

  const texts = [];
  for (const el of document.querySelectorAll('body *')) {
    if (['SCRIPT', 'STYLE', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) continue;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
    own = own.replace(/\s+/g, ' ').trim();
    if (!own) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r)) continue;
    const size = parseFloat(cs.fontSize);
    const hangul = /[가-힣]/.test(own);
    texts.push({
      text: own.slice(0, 60),
      chars: [...own].length,
      size: Math.round(size * 10) / 10,
      weight: Number(cs.fontWeight) || 400,
      family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
      first: inFirst(r),
      turned: Math.round(angleOf(el)),
      // One glyph to a line: a word set down a narrow column.
      stacked: hangul && [...own].length >= 2 && r.width < size * 1.6 && r.height > size * 2.4 && !el.closest('svg'),
      vertical: cs.writingMode !== 'horizontal-tb',
      alignEnd: ['right', 'end'].includes(cs.textAlign) && [...own].length >= 8 && !/^[\d\s.,:+\-−%₩$kgKG점원회번일차/·]+$/.test(own),
      mono: /mono|menlo|courier|consolas/i.test(cs.fontFamily.split(',')[0]),
      inCode: !!el.closest('code, pre, kbd, samp'),
      svg: !!el.closest('svg'),
    });
  }

  // Boxes that read as a card: a surface of their own with an edge, large enough to hold something.
  const cards = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('svg')) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (!visible(el, cs, r) || r.width < 120 || r.height < 72 || r.width > vw * 0.999 && r.height > vh * 0.9) continue;
    const edged = parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0 || cs.boxShadow !== 'none';
    const filled = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== getComputedStyle(el.parentElement ?? document.body).backgroundColor;
    if (!edged && !filled) continue;
    // How much of the box's height its own content reaches.
    let top = Infinity, bottom = -Infinity, kids = 0;
    for (const k of el.querySelectorAll('*')) {
      const kr = k.getBoundingClientRect();
      const kcs = getComputedStyle(k);
      if (kr.width < 1 || kr.height < 1 || kcs.visibility === 'hidden') continue;
      const hasInk = [...k.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || ['IMG', 'svg', 'INPUT', 'BUTTON', 'CANVAS', 'VIDEO', 'PROGRESS', 'METER'].includes(k.tagName) || (kcs.backgroundColor !== 'rgba(0, 0, 0, 0)' && kr.height < r.height * 0.9);
      if (!hasInk) continue;
      kids += 1;
      top = Math.min(top, kr.top);
      bottom = Math.max(bottom, kr.bottom);
    }
    const padTop = parseFloat(cs.paddingTop), padBottom = parseFloat(cs.paddingBottom);
    const inner = Math.max(1, r.height - padTop - padBottom);
    const reach = kids === 0 ? 0 : Math.min(1, (bottom - top) / inner);
    cards.push({ w: Math.round(r.width), h: Math.round(r.height), first: inFirst(r), reach: Math.round(reach * 100) / 100, nested: !!el.parentElement?.closest('[data-lab-card]'), kids });
    el.setAttribute('data-lab-card', '');
  }
  for (const el of document.querySelectorAll('[data-lab-card]')) el.removeAttribute('data-lab-card');

  // What can be pressed in the first screenful. A label and the box it sets are one control.
  const controls = new Set();
  for (const el of document.querySelectorAll('button, a[href], summary, select, textarea, input:not([type=hidden]), label[for], [role=button], [role=tab], [role=switch], [role=radio], [role=checkbox], [popovertarget]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (el.tagName === 'INPUT' && (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) continue;
    if (el.tagName === 'INPUT' && (r.width < 4 || r.height < 4 || Number(cs.opacity) < 0.05 || cs.position === 'absolute' && (r.width <= 2 || parseFloat(cs.clipPath ? '0' : '1') === 0))) continue;
    if (!visible(el, cs, r) || !inFirst(r)) continue;
    controls.add(el);
  }

  const firstTexts = texts.filter((t) => t.first);
  const sum = (list, pick) => list.reduce((n, t) => n + pick(t), 0);
  const share = (list, test) => (sum(list, (t) => t.chars) === 0 ? 0 : Math.round((sum(list.filter(test), (t) => t.chars) / sum(list, (t) => t.chars)) * 1000) / 10);
  const by = (list, key) => {
    const m = new Map();
    for (const t of list) m.set(t[key], (m.get(t[key]) ?? 0) + t.chars);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  const largest = Math.max(0, ...firstTexts.map((t) => t.size));
  const seen = new Map();
  for (const t of firstTexts) if (t.chars >= 3 && !t.svg) seen.set(t.text, (seen.get(t.text) ?? 0) + 1);
  // The same figure stated in two places (a gap as a badge and again as a sentence), among text large enough to be a statement.
  const figures = new Map();
  for (const t of firstTexts) {
    if (t.svg || t.size < 13.5) continue;
    for (const num of new Set(t.text.match(/\d[\d,.]*\d|\d{2,}/g) ?? [])) figures.set(num, (figures.get(num) ?? 0) + 1);
  }

  // A page's headline: the largest text of the first screen, and how many lines it runs to.
  const headEl = [...document.querySelectorAll('h1, h2, [role=heading], p, div, span')].filter((el) => {
    const r = el.getBoundingClientRect();
    return inFirst(r) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length >= 4);
  }).sort((a, b) => parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize))[0];
  const headline = headEl ? (() => {
    const cs = getComputedStyle(headEl);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    return { text: headEl.textContent.replace(/\s+/g, ' ').trim().slice(0, 60), px: parseFloat(cs.fontSize), lines: Math.max(1, Math.round(headEl.getBoundingClientRect().height / lh)), weight: Number(cs.fontWeight) };
  })() : null;

  return {
    title: document.title,
    headline,
    seed: document.querySelector('meta[name="theme-seed"]')?.getAttribute('content') ?? null,
    tokens,
    viewport: { vw, vh },
    screensLong: Math.round((document.documentElement.scrollHeight / vh) * 10) / 10,
    type: {
      families: by(texts, 'family'),
      sizesFirstScreen: by(firstTexts, 'size').sort((a, b) => a[0] - b[0]),
      distinctSizes: new Set(texts.map((t) => t.size)).size,
      distinctSizesFirstScreen: new Set(firstTexts.map((t) => t.size)).size,
      // Share of what is written, by characters, set at 12px or under.
      microSharePct: share(texts, (t) => t.size <= 12.5),
      microSharePctFirstScreen: share(firstTexts, (t) => t.size <= 12.5),
      // A sentence set in the size of a label.
      sentencesAtMicro: texts.filter((t) => t.size <= 12.5 && t.chars >= 24).map((t) => t.text),
      bodySharePct: share(texts, (t) => t.size >= 15.5 && t.size <= 18.5),
      largestPx: largest,
      // How many things are set at (nearly) the largest size on the first screen: more than two compete.
      figuresAtLargest: firstTexts.filter((t) => largest >= 28 && t.size >= largest * 0.85).map((t) => t.text),
      heavyWeightSharePct: share(texts, (t) => t.weight >= 700),
      turnedText: texts.filter((t) => t.turned > 15).map((t) => `${t.text} (${t.turned}deg)`),
      stackedText: texts.filter((t) => t.stacked || t.vertical).map((t) => t.text),
      endAlignedText: texts.filter((t) => t.alignEnd).map((t) => t.text),
      monoOutsideCode: texts.filter((t) => t.mono && !t.inCode).map((t) => t.text),
    },
    layout: {
      controlsFirstScreen: controls.size,
      cards: cards.length,
      cardsFirstScreen: cards.filter((c) => c.first).length,
      // A card whose content stops well short of its bottom edge: stretched to match a neighbour.
      halfEmptyCards: cards.filter((c) => c.h >= 140 && c.reach < 0.6).map((c) => `${c.w}x${c.h} filled ${Math.round(c.reach * 100)}%`),
      nestedCards: cards.filter((c) => c.nested).length,
      saidTwice: [...seen].filter(([, n]) => n >= 2).map(([t, n]) => `${t} x${n}`),
      figuresTwice: [...figures].filter(([, n]) => n >= 2).map(([t, n]) => `${t} x${n}`),
    },
  };
}

/** Runs in a blank page: how the pixels of one screenshot divide. */
async function pixels({ b64, brand, second }) {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  const near = (r, g, b, c) => c && Math.abs(r - c[0]) + Math.abs(g - c[1]) + Math.abs(b - c[2]) < 36;
  // How much of each half of the screen is bare paper: the most common colour of the picture, untouched.
  const counts = new Map();
  for (let i = 0; i < data.length; i += 64) {
    const key = (data[i] >> 2 << 12) | (data[i + 1] >> 2 << 6) | (data[i + 2] >> 2);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const paper = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const half = [[0, 0], [0, 0]];
  let n = 0, sat = 0, dark = 0, isBrand = 0, isSecond = 0;
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const side = ((i / 4) % img.width) < img.width / 2 ? 0 : 1;
    half[side][1] += 1;
    if (((r >> 2 << 12) | (g >> 2 << 6) | (b >> 2)) === paper) half[side][0] += 1;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510;
    const s = max === min ? 0 : l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min);
    n += 1;
    // A colour at strength: neither a tint of the paper nor an ink.
    if (s > 0.45 && l > 0.2 && l < 0.8) sat += 1;
    if (l < 0.12) dark += 1;
    if (near(r, g, b, brand)) isBrand += 1;
    if (near(r, g, b, second)) isSecond += 1;
  }
  const pct = (v) => Math.round((v / n) * 1000) / 10;
  return { saturatedPct: pct(sat), darkPct: pct(dark), brandPct: pct(isBrand), secondPct: pct(isSecond), blankLeftPct: Math.round((half[0][0] / half[0][1]) * 1000) / 10, blankRightPct: Math.round((half[1][0] / half[1][1]) * 1000) / 10 };
}

const result = { file, template };
const sizes = template === 'mobile-expo' ? [['phone', PHONE]] : [['desktop', DESKTOP], ['phone', PHONE]];
const helperCtx = await browser.newContext();
const helper = await helperCtx.newPage();
for (const [name, opts] of sizes) {
  const ctx = await browser.newContext({ ...opts, javaScriptEnabled: false, colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
  await page.waitForTimeout(1200);
  const dom = await page.evaluate(read);
  const shot = await page.screenshot({ type: 'png' });
  writeFileSync(`${out}-${name}.png`, shot);
  writeFileSync(`${out}-${name}-full.png`, await page.screenshot({ type: 'png', fullPage: true }));
  const colour = await helper.evaluate(pixels, { b64: shot.toString('base64'), brand: dom.tokens['--sz-brand'], second: dom.tokens['--sz-brand-2'] ?? dom.tokens['--sz-second'] });
  result[name] = { ...dom, colour };
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}.json`, JSON.stringify(result, null, 1));
const p = result.phone;
process.stdout.write(`${file}: brand ${p.colour.brandPct}% saturated ${p.colour.saturatedPct}% dark ${p.colour.darkPct}% | micro ${p.type.microSharePctFirstScreen}% body ${p.type.bodySharePct}% sizes ${p.type.distinctSizesFirstScreen} families ${p.type.families.map((f) => f[0]).join('+')} | figures ${p.type.figuresAtLargest.length} controls ${p.layout.controlsFirstScreen} halfEmpty ${p.layout.halfEmptyCards.length} turned ${p.type.turnedText.length} stacked ${p.type.stackedText.length} twice ${p.layout.saidTwice.length}\n`);
