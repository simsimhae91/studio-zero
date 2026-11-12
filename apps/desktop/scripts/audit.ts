// Puts this interface through the same measured audit the daemon applies to the projects it builds:
// every main screen, at phone, tablet and desktop size, in light and dark.
//
//   pnpm --filter @studio-zero/desktop build && node apps/desktop/scripts/audit.ts [screenshot-dir]
//
// Uses the fixture daemon (`?demo`), so it needs Chrome and nothing else. Exits non-zero on any measured blocker
// or major. The copy lint runs too and its findings are printed, but they do not fail the run yet: this
// interface's own wording predates that lint and has not been rewritten to it.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, devices, type Page } from 'playwright-core';
import { contract } from '@studio-zero/design';
import { auditCopy } from '@studio-zero/daemon/src/harness/TextSlopAuditor.ts';
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

/** Each screen: how to get there from a fresh load. On narrow windows the rail of projects and notes is behind a menu button. */
const rail = (page: Page) => page.getByRole('navigation', { name: '프로젝트와 작업 노트' });
const openRail = async (page: Page, narrow: boolean): Promise<void> => {
  if (narrow) await page.getByRole('button', { name: '프로젝트와 작업 노트' }).click();
};
const openFromIndex = (name: string) => async (page: Page, narrow: boolean) => {
  await openRail(page, narrow);
  // A project row has two buttons: the row itself and its menu. The row's name starts with the project's.
  await rail(page).getByRole('button', { name: new RegExp(`^${name}(?! 메뉴)`) }).first().click();
  await page.getByRole('heading', { level: 1, name }).waitFor();
};
/** The right-hand pane of a project. On a narrow window it is one of two panes, behind a switch. */
const workspaceTab = (project: string, tab: string) => async (page: Page, narrow: boolean) => {
  await openFromIndex(project)(page, narrow);
  if (narrow) await page.getByRole('radio', { name: '작업공간' }).click();
  await page.getByRole('tab', { name: tab }).click();
  await page.getByRole('tabpanel').waitFor();
};
const screens: { name: string; url: string; go: (page: Page, narrow: boolean) => Promise<void> }[] = [
  { name: 'connect', url: '/', go: async () => undefined },
  { name: 'home', url: '/?demo', go: async () => undefined },
  { name: 'home-deep', url: '/?demo', go: async (page) => void (await page.getByRole('radio', { name: /^설계부터/ }).click()) },
  { name: 'worksheet', url: '/?demo', go: openFromIndex('현장 기사용 청구서 앱') },
  { name: 'worksheet-papers', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('현장 기사용 청구서 앱')(page, narrow);
    await page.getByRole('button', { name: '명세와 결정 기록' }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'research', url: '/?demo', go: openFromIndex('이번 분기 AI 인프라 투자 규모') },
  { name: 'project', url: '/?demo', go: openFromIndex('Ledger') },
  { name: 'project-steps', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    // Open the plan, a failed command and the verification round: the stepper with its detail showing.
    for (const step of [/^완료 계획 \d+단계/, /^완료 의존성 설치/, /검증 1회차/]) await page.getByRole('button', { name: step }).first().click();
    await page.getByRole('button', { name: /Codex의 의견/ }).click();
  } },
  { name: 'project-session', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('tab', { name: 'refactor/dates' }).click();
  } },
  { name: 'project-menu', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: '프로젝트 설정' }).click();
    await page.getByRole('menu').waitFor();
  } },
  { name: 'project-delete', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: '프로젝트 설정' }).click();
    await page.getByRole('menuitem', { name: '프로젝트 삭제' }).click();
    await page.getByRole('dialog').waitFor();
  } },
  { name: 'project-keys', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: '프로젝트 설정' }).click();
    await page.getByRole('menuitem', { name: '외부 API 키' }).click();
    await page.getByRole('dialog', { name: '외부 API 키' }).waitFor();
  } },
  { name: 'project-create', url: '/?demo', go: async (page, narrow) => {
    await openRail(page, narrow);
    await page.getByRole('button', { name: '빈 프로젝트 만들기' }).click();
    await page.getByRole('dialog', { name: '빈 프로젝트 만들기' }).waitFor();
  } },
  { name: 'preview', url: '/?demo', go: workspaceTab('Ledger', '프리뷰') },
  { name: 'preview-phone', url: '/?demo', go: workspaceTab('Atlas 모바일', '프리뷰') },
  { name: 'files', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '파일')(page, narrow);
    await page.getByRole('treeitem', { name: 'src' }).click();
    await page.getByRole('treeitem', { name: 'App.tsx' }).click();
    await page.getByText('Unpaid invoices, oldest first.').waitFor();
  } },
  { name: 'terminal', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '터미널')(page, narrow);
    await page.getByText('데모 터미널입니다').waitFor();
  } },
  { name: 'history', url: '/?demo', go: workspaceTab('Ledger', '시점') },
  { name: 'audit', url: '/?demo', go: workspaceTab('Ledger', '감사') },
  { name: 'audit-unreviewed', url: '/?demo', go: workspaceTab('Atlas 모바일', '감사') },
  { name: 'task-suspended', url: '/?demo', go: openFromIndex('Atlas 모바일') },
  { name: 'ledger', url: '/?demo', go: workspaceTab('Ledger', '장부') },
  { name: 'quota', url: '/?demo', go: async (page) => {
    await page.getByRole('button', { name: '구독 사용 현황' }).click();
    await page.getByRole('menu').waitFor();
  } },
  { name: 'core', url: '/?demo', go: openFromIndex('Studio Zero Core') },
  { name: 'design-mockups', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByTitle('C안 첫 화면 시안').waitFor();
  } },
  { name: 'design-mockup-notes', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByRole('button', { name: '프리뷰에서 보기' }).nth(1).click();
    await page.getByTitle('B안 시안').waitFor();
    await page.getByRole('button', { name: '요소 고르기' }).click();
    await page.getByRole('textbox', { name: 'B안 전체에 대한 수정 메모' }).fill('합계 줄을 맨 위로 올리고 색을 더 차분하게');
    await page.getByRole('button', { name: '메모 추가' }).click();
    await page.getByRole('button', { name: '수정 요청 1건 보내기' }).waitFor();
  } },
  { name: 'proposals', url: '/?demo', go: workspaceTab('Ledger', '제안') },
  { name: 'learning', url: '/?demo', go: workspaceTab('Ledger', '학습') },
  { name: 'settings', url: '/?demo', go: async (page) => void (await page.getByRole('button', { name: '설정' }).first().click()) },
  { name: 'settings-add-server', url: '/?demo', go: async (page) => {
    await page.getByRole('button', { name: '설정' }).first().click();
    await page.getByRole('button', { name: 'MCP 서버 추가' }).click();
    await page.getByRole('radiogroup', { name: '연결 방식' }).scrollIntoViewIfNeeded();
  } },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const all: (Finding & { screen: string; scheme: string })[] = [];
const copy: (Finding & { screen: string; scheme: string })[] = [];
try {
  for (const viewport of viewports) {
    for (const scheme of ['light', 'dark'] as const) {
      const context = await browser.newContext({ ...viewport.context, colorScheme: scheme, reducedMotion: 'reduce' });
      // The app remembers which page was open; every screen here starts from a fresh window. The theme is set to
      // follow the system, so the light and the dark pass each audit their own palette.
      await context.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem('studio-zero.prefs', JSON.stringify({ theme: 'system', mono: 'geist-mono' }));
      });
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
        // The words of each screen, read as words: the copy lint the studio applies to what it builds.
        if (scheme === 'light') copy.push(...auditCopy(digest, { viewport: viewport.id, route: screen.name }, contract).findings.map((f) => ({ ...f, screen: screen.name, scheme })));
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
const habits = [...new Set(copy.filter((f) => f.severity !== 'minor').map((f) => `${f.rule}: ${f.message}`))];
console.log(`Copy lint (reported, not gating): ${habits.length} distinct habit(s) in this interface's own wording.${habits.map((h) => `\n  ${h}`).join('')}`);
process.exit(result.blockers + result.majors > 0 ? 1 : 0);
