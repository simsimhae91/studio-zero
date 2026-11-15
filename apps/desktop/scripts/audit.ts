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
import { interactionFindings, runDomChecks, scoreAudit } from '@studio-zero/daemon/src/qa/checks.ts';
import { PageDigest, collectDigest } from '@studio-zero/daemon/src/qa/collector.ts';
import { probeInteraction } from '@studio-zero/daemon/src/qa/InteractionProbe.ts';
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
/** The research note's document, opened for notes. */
const openNotes = async (page: Page, narrow: boolean): Promise<void> => {
  await openFromIndex('이번 분기 AI 인프라 투자 규모')(page, narrow);
  await page.getByRole('button', { name: '주석' }).click();
  await page.getByRole('dialog', { name: '주석' }).locator('[data-line-start]').first().waitFor();
};
/** Selects `text` in the document block that starts at `line`, as a hand would, and leaves a note on it. */
const addNote = async (page: Page, line: number, text: string, comment: string): Promise<void> => {
  await page.evaluate(([line, text]) => {
    const block = document.querySelector(`[role="dialog"] [data-line-start="${line}"]`);
    const walker = document.createTreeWalker(block ?? document.createElement('div'), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(text) ?? -1;
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + text.length);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return;
    }
    throw new Error(`no "${text}" at line ${line}`);
  }, [line, text] as const);
  await page.getByRole('region', { name: '문서에 메모 달기' }).getByText(`L${line}`, { exact: true }).waitFor();
  await page.getByRole('textbox', { name: '문서에 남길 메모' }).fill(comment);
  await page.getByRole('button', { name: '메모 추가' }).click();
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
  { name: 'document-notes', url: '/?demo', go: openNotes },
  { name: 'document-notes-two', url: '/?demo', go: async (page, narrow) => {
    await openNotes(page, narrow);
    await addNote(page, 5, '늘어난 금액의 대부분은', '얼마가 늘었는지 금액으로 적어 주세요');
    await addNote(page, 16, '4분기 가이던스를 확인한다', '전력 계약도 같이 확인할 항목으로 넣어 주세요');
    await page.getByRole('button', { name: '수정 요청 (메모 2개)' }).waitFor();
  } },
  { name: 'document-revised', url: '/?demo', go: async (page, narrow) => {
    await openNotes(page, narrow);
    await addNote(page, 5, '늘어난 금액의 대부분은', '얼마가 늘었는지 금액으로 적어 주세요');
    await addNote(page, 16, '4분기 가이던스를 확인한다', '전력 계약도 같이 확인할 항목으로 넣어 주세요');
    await page.getByRole('button', { name: '수정 요청 (메모 2개)' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText(/^수정본 완료/).waitFor();
  } },
  { name: 'project', url: '/?demo', go: openFromIndex('Ledger') },
  // While a task is at work, the field can start a quick fix beside it instead of speaking to it.
  { name: 'quick-fix-aside', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('radio', { name: '따로 고치기' }).click();
    await page.getByPlaceholder('따로 고칠 것 하나').waitFor();
  } },
  // A quick fix that landed and a full check, as their cards tell them.
  { name: 'quick-fix-landed', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    await page.getByRole('button', { name: /청구서 상세의 "결제 이력 보기" 버튼 글자가/ }).click();
    await page.getByRole('article', { name: /^작업: 청구서 상세의 "결제 이력 보기"/ }).waitFor();
  } },
  { name: 'full-check', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Ledger')(page, narrow);
    // The row of the past task (its request and its state), not the button in the field that starts a new one.
    await page.getByRole('button', { name: /^전체 점검 .+/ }).first().click();
    await page.getByRole('article', { name: '작업: 전체 점검' }).waitFor();
  } },
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
  { name: 'files-doc', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '파일')(page, narrow);
    await page.getByRole('treeitem', { name: 'README.md' }).click();
    // A markdown file opens as the document it is: headings, not lines of source beginning with "#".
    await page.getByRole('heading', { name: '화면', exact: true }).waitFor();
  } },
  { name: 'terminal', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '터미널')(page, narrow);
    await page.getByText('데모 터미널입니다').waitFor();
  } },
  { name: 'history', url: '/?demo', go: workspaceTab('Ledger', '시점') },
  { name: 'audit', url: '/?demo', go: workspaceTab('Ledger', '감사') },
  { name: 'audit-unreviewed', url: '/?demo', go: workspaceTab('Atlas 모바일', '감사') },
  { name: 'task-suspended', url: '/?demo', go: openFromIndex('Atlas 모바일') },
  // A product's roadmap: one being built (a milestone done, the next at work), the done milestone opened to what
  // its walk left, one that stopped, a project with none, and a map being written.
  { name: 'roadmap-running', url: '/?demo', go: workspaceTab('Tide 정산', '로드맵') },
  { name: 'roadmap-built', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Tide 정산', '로드맵')(page, narrow);
    await page.getByRole('button', { name: /^1\. 모여서 지출을 넣는다/ }).click();
    await page.getByRole('heading', { name: /걸으면서 찍은 화면/ }).waitFor();
    await page.getByRole('img', { name: 'H-02 화면' }).waitFor();
  } },
  { name: 'roadmap-stopped', url: '/?demo', go: workspaceTab('Atlas 모바일', '로드맵') },
  { name: 'roadmap-empty', url: '/?demo', go: workspaceTab('Ledger', '로드맵') },
  { name: 'roadmap-planning', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '로드맵')(page, narrow);
    await page.getByRole('textbox', { name: '어떤 제품인가요' }).fill('미수금을 한눈에 보는 청구서 관리 도구\n- 미결제 알림\n- 월말 정산');
    await page.getByRole('button', { name: '제품 지도 만들기' }).click();
    await page.getByText('제품 지도를 쓰는 중').waitFor();
  } },
  { name: 'plan-review', url: '/?demo', go: workspaceTab('Harbor 예약', '계획') },
  { name: 'plan-review-diff', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Harbor 예약', '계획')(page, narrow);
    await page.getByRole('button', { name: '앞 안과 비교' }).click();
    await page.getByRole('region', { name: /1번째 안과 2번째 안의 차이/ }).waitFor();
  } },
  { name: 'changes', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Ledger', '변경')(page, narrow);
    await page.getByRole('heading', { name: '이 작업이 바꾼 코드' }).waitFor();
  } },
  { name: 'changes-comment', url: '/?demo', go: async (page, narrow) => {
    await workspaceTab('Studio Zero Core', '변경')(page, narrow);
    await page.getByRole('button', { name: '바뀐 뒤 2번 줄에 코멘트' }).first().click();
    await page.getByRole('group', { name: '코멘트 쓰기' }).waitFor();
  } },
  { name: 'ledger', url: '/?demo', go: workspaceTab('Ledger', '장부') },
  { name: 'quota', url: '/?demo', go: async (page) => {
    await page.getByRole('button', { name: '구독 사용 현황' }).click();
    await page.getByRole('menu').waitFor();
  } },
  { name: 'core', url: '/?demo', go: openFromIndex('Studio Zero Core') },
  { name: 'design-drafting', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Pace 2주 식단')(page, narrow);
    await page.getByRole('region', { name: '그리는 중인 시안' }).waitFor();
  } },
  { name: 'design-mockups', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByTitle('C안 첫 화면 시안').waitFor();
  } },
  { name: 'design-mockup-notes', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByRole('button', { name: '눌러 보기', exact: true }).nth(1).click();
    await page.getByTitle('B안 시안').waitFor();
    await page.getByRole('button', { name: '요소 고르기' }).click();
    await page.getByRole('textbox', { name: 'B안 전체에 대한 수정 메모' }).fill('합계 줄을 맨 위로 올리고 색을 더 차분하게');
    // Writing one thing is enough to send; "one more" keeps it and clears the field for the next.
    await page.getByRole('button', { name: '수정 요청 1건 보내기' }).waitFor();
    await page.getByRole('button', { name: '하나 더 적기' }).click();
    await page.getByRole('textbox', { name: 'B안 전체에 대한 수정 메모' }).fill('금액을 더 크게');
    await page.getByRole('button', { name: '수정 요청 2건 보내기' }).waitFor();
  } },
  { name: 'design-screen-spec', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByRole('button', { name: /^화면 명세/ }).click();
    await page.getByRole('dialog', { name: '화면 명세' }).waitFor();
  } },
  { name: 'design-walk-film', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByRole('button', { name: '눌러 본 장면', exact: true }).first().click();
    await page.getByRole('dialog', { name: 'A안을 눌러 본 장면' }).waitFor();
  } },
  { name: 'design-mockup-redraw', url: '/?demo', go: async (page, narrow) => {
    await openFromIndex('Tide 정산')(page, narrow);
    await page.getByRole('button', { name: '전부 새로 그리기' }).click();
    await page.getByRole('textbox', { name: '새로 그릴 방향' }).fill('영수증보다 사람 사이의 흐름이 주인이 되게');
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
const tried = { press: 0, answered: 0, stops: 0, visible: 0 };
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
  // Each screen tried by hand, as the studio tries what it builds: every control of the first screenful held
  // down, the keyboard's focus walked through. At the desk's size, where this interface is used, and with motion
  // as most people have it: a press answered by movement has answered.
  const desk = viewports.find((v) => v.id === 'desktop-1440')!;
  const trying = await browser.newContext({ ...desk.context, colorScheme: 'light' });
  await trying.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('studio-zero.prefs', JSON.stringify({ theme: 'system', mono: 'geist-mono' }));
  });
  for (const screen of screens) {
    const page = await trying.newPage();
    await page.goto(base + screen.url, { waitUntil: 'networkidle' });
    await screen.go(page, false);
    await page.waitForTimeout(350);
    const probe = await probeInteraction(page, { touch: false });
    tried.press += probe.press.probed;
    tried.answered += probe.press.answered;
    tried.stops += probe.focus.probed;
    tried.visible += probe.focus.visible;
    all.push(...interactionFindings(probe, null, { viewport: desk.id, route: screen.name, touch: false }).map((f) => ({ ...f, screen: screen.name, scheme: 'light' })));
    await page.close();
  }
  await trying.close();
} finally {
  await browser.close();
  server.close();
}

for (const f of all) console.log(`[${f.severity}] ${f.screen} ${f.viewport} ${f.scheme} ${f.rule}: ${f.message}${f.selector ? `\n    at ${f.selector}` : ''}`);
const result = scoreAudit(all, null, 85);
console.log(`\n${screens.length} screens × ${viewports.length} viewports × 2 schemes. Distinct defects: ${result.blockers} blocker, ${result.majors} major, ${result.minors} minor.`);
console.log(`Tried by hand at the desk's size: ${tried.answered} of ${tried.press} controls answered a press, ${tried.visible} of ${tried.stops} focus stops could be seen.`);
const habits = [...new Set(copy.filter((f) => f.severity !== 'minor').map((f) => `${f.rule}: ${f.message}`))];
console.log(`Copy lint (reported, not gating): ${habits.length} distinct habit(s) in this interface's own wording.${habits.map((h) => `\n  ${h}`).join('')}`);
process.exit(result.blockers + result.majors > 0 ? 1 : 0);
