// Puts this interface through the same measured audit the daemon applies to the projects it builds:
// every main screen, at phone, tablet and desktop size, in light and dark.
//
//   pnpm --filter @studio-zero/desktop build && node apps/desktop/scripts/audit.ts [screenshot-dir]
//
// Uses the fixture daemon (`?demo`), so it needs Chrome and nothing else. Exits non-zero on any blocker or major.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import { runDomChecks, scoreAudit } from '@studio-zero/daemon/src/qa/checks.ts';
import { PageDigest, collectDigest } from '@studio-zero/daemon/src/qa/collector.ts';
import type { Finding, ViewportId } from '@studio-zero/protocol';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]!;
  const file = join(dist, path === '/' ? 'index.html' : path);
  if (!file.startsWith(dist) || !existsSync(file)) return void res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

const viewports: { id: ViewportId; width: number; touch: boolean; context: object }[] = [
  { id: 'iphone-15-pro', width: 393, touch: true, context: devices['iPhone 15 Pro']! },
  { id: 'ipad-pro-11', width: 834, touch: true, context: devices['iPad Pro 11']! },
  { id: 'desktop-1440', width: 1440, touch: false, context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
];

/** Each screen: how to get there from a fresh load. On narrow windows the index of worksheets is behind a menu button. */
const openFromIndex = (name: string) => async (page: Page, narrow: boolean) => {
  if (narrow) await page.getByRole('button', { name: '작업 노트와 프로젝트' }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).last().click();
  await page.getByRole('heading', { level: 1, name }).waitFor();
};
const projectPanel = (button: string | RegExp) => async (page: Page, narrow: boolean) => {
  await openFromIndex('Ledger')(page, narrow);
  await page.getByRole('button', { name: button }).first().click();
  await page.getByRole('dialog').waitFor();
};
const screens: { name: string; url: string; go: (page: Page, narrow: boolean) => Promise<void> }[] = [
  { name: 'connect', url: '/', go: async () => undefined },
  { name: 'home', url: '/?demo', go: async () => undefined },
  { name: 'home-build', url: '/?demo', go: async (page) => void (await page.getByRole('radio', { name: /^바로 만들기/ }).click()) },
  { name: 'worksheet', url: '/?demo', go: openFromIndex('현장 기사용 청구서 앱') },
  { name: 'worksheet-papers', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('현장 기사용 청구서 앱')(page, narrow);
    await page.getByRole('button', { name: '명세와 결정 기록' }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'research', url: '/?demo', go: openFromIndex('이번 분기 AI 인프라 투자 규모') },
  { name: 'project', url: '/?demo', go: openFromIndex('Ledger') },
  { name: 'project-work', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: /^작업 \d+단계/ }).first().click();
  } },
  { name: 'preview', url: '/?demo', go: projectPanel('프리뷰') },
  { name: 'audit', url: '/?demo', go: projectPanel('증거 보기') },
  { name: 'terminal', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: /^작업 \d+단계/ }).first().click();
    await page.getByRole('button', { name: '터미널로 전체 보기' }).first().click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'history', url: '/?demo', go: projectPanel(/^시점 \d+개/) },
  { name: 'proposals', url: '/?demo', go: projectPanel('제안') },
  { name: 'learning', url: '/?demo', go: projectPanel('학습') },
  { name: 'settings', url: '/?demo', go: async (page) => void (await page.getByRole('button', { name: '설정' }).first().click()) },
  { name: 'settings-add-server', url: '/?demo', go: async (page) => {
    await page.getByRole('button', { name: '설정' }).first().click();
    await page.getByRole('button', { name: 'MCP 서버 추가' }).click();
    await page.getByRole('radiogroup', { name: '연결 방식' }).scrollIntoViewIfNeeded();
  } },
  { name: 'project-atlas', url: '/?demo', go: openFromIndex('Atlas 모바일') },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const all: (Finding & { screen: string; scheme: string })[] = [];
try {
  for (const viewport of viewports) {
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ ...viewport.context, colorScheme: scheme, reducedMotion: 'reduce' });
      // The app remembers which page was open; every screen here starts from a fresh window.
      await context.addInitScript(() => localStorage.clear());
      for (const screen of screens) {
        const page = await context.newPage();
        await page.goto(base + screen.url, { waitUntil: 'networkidle' });
        await screen.go(page, viewport.width < 1024);
        await page.evaluate(async () => {
          await document.fonts.ready;
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
        await page.waitForTimeout(250);
        const digest = PageDigest.parse(await page.evaluate(collectDigest, 700));
        const findings = runDomChecks(digest, { viewport: viewport.id, viewportWidth: viewport.width, route: screen.name, touch: viewport.touch, scope: scheme === 'light' ? 'full' : 'color-only' }, contract);
        all.push(...findings.map((f) => ({ ...f, screen: screen.name, scheme })));
        if (shots) await page.screenshot({ path: join(shots, `${screen.name}-${viewport.id}-${scheme}.png`) });
        await page.close();
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  server.close();
}

for (const f of all) console.log(`[${f.severity}] ${f.screen} ${f.viewport} ${f.scheme} ${f.rule}: ${f.message}${f.selector ? `\n    at ${f.selector}` : ''}`);
const result = scoreAudit(all, null, 85);
console.log(`\n${screens.length} screens × ${viewports.length} viewports × 2 schemes. Distinct defects: ${result.blockers} blocker, ${result.majors} major, ${result.minors} minor.`);
process.exit(result.blockers + result.majors > 0 ? 1 : 0);
