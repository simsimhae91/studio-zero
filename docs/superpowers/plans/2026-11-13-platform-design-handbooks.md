# Platform Design Handbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give mobile and web engines a numbered design handbook (type, colour, composition, parts, pictures), fix every product to one of three typefaces, add the palette roles and the measurements the handbook needs, and prove which rules change the drawn screens with a before/after lab.

**Architecture:** The handbook is data (`harness/handbook.ts`: rules with ids) rendered into the engines' system prompt and the reviewer's brief, so both cite the same rule. The design contract and theme generator carry what the rules assume (one face, a second colour, a data series). The audit's collector reads composition off the page and `checks.ts` turns it into findings that name the rule. A lab (`scripts/design-lab/`) draws the same briefs from two source trees and measures both.

**Tech Stack:** TypeScript run directly by Node 24 (erasable syntax only, imports carry `.ts`), zod, node:test, playwright-core with the installed Chrome, Tailwind v4 theme CSS, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-13-platform-design-handbooks-design.md`

## Global Constraints

- Typefaces: exactly `pretendard`, `suit`, `suite`. One per product. Titles are the same face, heavier. No serif, no second sans, no italics.
- Monospace only inside `code`, `pre`, `kbd`, `samp`. Dates and figures use the body face with `tabular-nums`.
- A platform's handbook is at most 1,500 words in the prompt (a test holds it).
- Every new check's `fix` text begins with the rule id it enforces (`C2: …`).
- Check thresholds and severities are set from the lab's distribution, not guessed; a check that separates nothing is not added.
- Nothing is merged to `main` or deployed until the owner has seen the comparison page and said what stays.
- Repository conventions (from `CORE_SYSTEM_PROMPT`): tests use node:test beside each package and prefer the real thing (real Chrome for DOM checks); system prompts are constants; `docs/ARCHITECTURE.md` changes in the same branch as behaviour; comments say why, in plain sentences, no em-dashes.
- Commit each finished task on branch `design-handbook`. End commit messages with `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`.

## Review Focus

1. **A project made before this change** (its `theme.json` has `display`, its `theme.css` names Fraunces or Geist and lacks the new tokens): its next task must get a regenerated stylesheet from the same seed, not a wall of `type/foreign-font` findings it cannot fix. Test in Task 2 (`bootstrap` regenerates when the generator version is older).
2. **A product that is dark by design** (its paper token is dark in the light scheme too, or the whole screen is a media viewer): `color/dark-band` must not fire. Test in Task 6.
3. **A screen that is mostly a chart**: axis numerals at 11px are not "micro text overuse". Text inside `svg` is left out of the budget. Test in Task 5.
4. **A page with a large photograph**: saturated pixels inside `img`, `video`, `canvas` and CSS background images are not a colour flood. Test in Task 6.
5. **A page that names two of the three faces** (SUIT titles over Pretendard body): flagged as `type/second-family`, with the fix naming the theme's one face. Test in Task 5.

---

### Task 0: The lab and the baseline (done before any guidance changes)

**Files:**
- Create: `packages/daemon/scripts/design-lab/prompts.ts`, `server.ts`, `metrics.mjs`
- Data (not committed, `.design-lab/` is in `.git/info/exclude`): `.design-lab/briefs/{duel,dues,quote,orders}`, `.design-lab/src-baseline` (worktree at `962af1f`), `.design-lab/runs/baseline/<brief>/<row>/{prompt.md,ws/,checks/}`, `.design-lab/production/duel/{a,b,c}.html`

**Interfaces:**
- Produces: `node prompts.ts draw <briefDir> <outDir> <port>` (one folder per row), `node prompts.ts validate <briefDir>`, `node server.ts <port>` (`GET /check?ws=&file=` answers as `check_mockup` does and logs `checks/<n>.{html,txt,json}`), `node metrics.mjs <page> <template> <outPrefix>` (writes `<outPrefix>.json` and screenshots).

- [x] Baseline tree frozen, baseline server on `127.0.0.1:47811`.
- [x] Real brief `duel` copied from today's project; three briefs written by lead agents under the baseline prompt.
- [ ] Each brief passes `prompts.ts validate`; rows that do not hold are corrected by hand, keeping their meaning.
- [ ] Nine baseline pages drawn (Opus, effort high), one agent per row.
- [ ] `metrics.mjs` run on the nine pages and on the three production pages.

### Task 1: Three faces in the contract

**Files:**
- Modify: `packages/design/src/contract.ts`, `packages/design/src/theme.ts`, `packages/design/src/build.ts`, `packages/design/theme.css` (regenerated)
- Test: `packages/design/test/design.test.ts`

**Interfaces:**
- Produces:
  - `export const faces = ['pretendard', 'suit', 'suite'] as const; export type Face = (typeof faces)[number];`
  - `DesignContract.fonts: { face: Readonly<Record<Face, readonly string[]>>; fallback: readonly string[]; mono: readonly string[] }` with `face.pretendard = ['Pretendard Variable', 'Pretendard']`, `face.suit = ['SUIT Variable', 'SUIT']`, `face.suite = ['SUITE Variable', 'SUITE']`, `fallback = ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif']`.
  - `export function faceStack(face: Face, c?: DesignContract): string[]` (the face's families, then the fallback).
  - `contractFamilies()` = the three faces, mono, fallback. `hostedFamilies()` = the three faces and `mono[0]`.
  - `ThemeSeed.face?: Face` replaces `display`. `displayFaces` and `DisplayFace` are removed.
  - `export const THEME_GENERATOR = 3;` and the stylesheet's second line is `/* generator ${THEME_GENERATOR} */`.
  - `renderThemeCss(theme, c?, opts?: { fontFiles?: boolean })`: `--font-sans` and `--font-display` are both `faceStack(seed.face ?? 'pretendard')`; with `fontFiles` (default true) the sheet opens with one `@font-face` for the face: `src: url("./fonts/<file>") format("woff2-variations")`, files `PretendardVariable.woff2` (weights `45 920`), `SUIT-Variable.woff2` (`100 900`), `SUITE-Variable.woff2` (`300 900`), `font-display: swap`.
  - `seedFromName(name)` picks `face` from the name's hash; every face is reachable.

- [ ] **Step 1: Failing tests** in `design.test.ts`: the reference sheet has `--font-sans: "Pretendard Variable", "Pretendard", -apple-system,` and the same value for `--font-display`; `createTheme({...referenceSeed, face: 'suite'})` renders `"SUITE Variable", "SUITE"` first and an `@font-face` whose `src` is `url("./fonts/SUITE-Variable.woff2")`; `renderThemeCss(theme, contract, { fontFiles: false })` has no `@font-face`; `contractFamilies()` contains none of `Geist`, `Fraunces`, `Instrument Serif`, `Bricolage Grotesque`, `Noto Serif KR`, `Gowun Batang`; 200 seeds from names reach all three faces; the sheet's second line is `/* generator 3 */`.
- [ ] **Step 2:** Run `node --test packages/design/test/design.test.ts`; the new assertions fail.
- [ ] **Step 3:** Implement. Remove the display pairings; update the tests in this file that pinned them.
- [ ] **Step 4:** `pnpm design:build`, then the test file passes.
- [ ] **Step 5:** Commit.

### Task 2: The face through the studio (seed, files in projects, mock-ups, old projects)

**Files:**
- Create: `packages/daemon/src/harness/fontKit.ts`, `packages/design/fonts/suite/SUITE-Variable.woff2`, `packages/design/fonts/suite/OFL.txt`
- Modify: `packages/daemon/package.json` (add `@sun-typeface/suit`), `scripts/build.mjs` (copy `packages/design/fonts` to `dist/fonts`), `packages/daemon/src/harness/themeSeed.ts`, `bootstrap.ts`, `Toolbox.ts`, `Harness.ts`, `packages/daemon/src/scratch/Directions.ts`, `packages/daemon/src/qa/mockupFaces.ts`, `packages/daemon/src/qa/checks.ts` (one line: mono by `inCode` comes in Task 5; here only what stops compiling)
- Test: `packages/daemon/test/theme-seed.test.ts`, `mockups.test.ts`, `measured-mockups.test.ts`, `qa.test.ts`, `e2e.test.ts`, `slop-detector.test.ts` (fixtures that name removed faces)

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `ThemeChoice` has `face: z.enum(faces)` (described with when each fits: spec 4.1) and no `display`.
  - `chosenTheme(choice): { json: string; css: string; tokensCss: string; face: Face; report: string }` where `tokensCss` is the sheet without `@font-face` (what a direction engine copies into a page).
  - `fontKit.ts`: `export const FONT_DIR = '.studio-zero/fonts'; export function fontFile(face: Face): { name: string; read: () => Promise<Buffer> }` (Pretendard from the `pretendard` package's `dist/web/variable/woff2/PretendardVariable.woff2`, SUIT from `@sun-typeface/suit/fonts/variable/woff2/SUIT-Variable.woff2`, SUITE from `dist/fonts/suite/` beside the bundle or `packages/design/fonts/suite/` in development).
  - `themeSeed.ts`: `export async function writeProjectTheme(sandboxes, project, theme: { json: string; css: string; face: Face }): Promise<void>` writes the seed, the sheet, and the face's file when `.studio-zero/fonts/<name>` is missing (binary through `exec` with stdin). Bootstrap, `set_theme` and the harness's recommended-direction write all go through it.
  - `bootstrap.ts`: when a project has `theme.json` and its `theme.css` has no `/* generator N */` line with `N >= THEME_GENERATOR`, the sheet is regenerated from the stored seed (`display` ignored, `face` defaults to `pretendard`) and the font file written; `added` gets `'theme (regenerated)'`.
  - `Directions.ts`: two rows "share a look" when hue (within 30 degrees), corners and `face` are all the same.
  - `mockupFaces.ts`: `SUPPLIED_FACES = ['Pretendard Variable', 'SUIT Variable', 'SUITE Variable']`. Pretendard in pieces as now; SUIT and SUITE whole, under the family name the page uses (`SUIT Variable` or `SUIT`). The Latin display faces are gone.

- [ ] **Step 1: Failing tests.** `theme-seed.test.ts`: `set_theme` with `face: 'suit'` writes a sheet whose `--font-sans` starts `"SUIT Variable"` and the file `.studio-zero/fonts/SUIT-Variable.woff2` (non-empty); a choice with `display` and no `face` is refused naming `face`; a project whose stored sheet lacks the generator line is regenerated by `provisioner.ensure` from its seed and keeps its hue. `measured-mockups.test.ts`: a page naming `SUITE Variable` gets one `@font-face` for it with a `woff2` payload over 100,000 base64 characters; a page naming `Fraunces` gets nothing. `mockups.test.ts`: rows that differ only in `face` do not "share a look".
- [ ] **Step 2:** Run those files; they fail on the new assertions (and on `display` in fixtures).
- [ ] **Step 3:** Implement. Download `SUITE-Variable.woff2` and its licence from `https://cdn.jsdelivr.net/gh/sun-typeface/SUITE@2.0.4/` into `packages/design/fonts/suite/`. `pnpm add @sun-typeface/suit --filter @studio-zero/daemon` (sandbox off).
- [ ] **Step 4:** The four test files pass; `pnpm typecheck` passes. Prompt wording (`prompts.ts`, `houseBar.ts`, `vision.ts`) is Task 4's: here only the identifiers those files import are kept compiling.
- [ ] **Step 5:** Commit.

### Task 3: A second colour and a data series

**Files:**
- Modify: `packages/design/src/theme.ts`, `packages/design/theme.css` (regenerated), `packages/daemon/src/harness/themeSeed.ts`
- Test: `packages/design/test/design.test.ts`, `packages/daemon/test/theme-seed.test.ts`

**Interfaces:**
- Produces:
  - `colorTokens` gains `'second'`, `'on-second'`, `'second-soft'`, `'series-1'` … `'series-6'` (so `bg-second`, `text-on-second`, `bg-series-3` compile).
  - `ThemeSeed.secondHue?: number`; `ThemeChoice.second_hue` optional, described per spec C8 ("only when the product has two sides or categories; otherwise leave out").
  - `export function secondHueFor(seed: ThemeSeed): number`: the seed's own when given, else the brand's complement moved the least it takes to sit 30 degrees or more from 27, 75 and 152.
  - `second` is a fill like `brand` (same `fillAndText`), chroma `min(seed.chroma, 0.16)`; `second-soft` like `brand-soft`.
  - `series-n`: hue `brandHue + n * 60` (series-1 is the brand's hue), chroma `0.14`, lightness alternating `0.56` and `0.70` in the light scheme and `0.70` and `0.82` in the dark, each clamped to gamut.

- [ ] **Step 1: Failing tests.** Over hue 0..345 by 15, chroma {0.12, 0.2, 0.28}: `on-second` on `second` is at least 7:1 in both schemes; `secondHueFor` is at least 30 degrees from 27, 75, 152 and at least 60 from the brand hue; the six series colours are at least 3:1 against `bg` and `surface` in both schemes, and neighbours differ in OKLCH lightness by 0.1 or more; a seed with `secondHue: 200` keeps 200. `theme-seed.test.ts`: `set_theme` with `second_hue: 200` reports the second colour; without it the report says it was derived.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement; `pnpm design:build`.
- [ ] **Step 4:** Pass; typecheck.
- [ ] **Step 5:** Commit.

### Task 4: The handbook, in the engines' prompt

**Files:**
- Create: `packages/daemon/src/harness/handbook.ts`
- Modify: `packages/daemon/src/harness/prompts.ts`, `houseBar.ts`
- Test: `packages/daemon/test/handbook.test.ts` (new), `theme-seed.test.ts`, `mobile-kit.test.ts`, `house-bar.test.ts` (wording they pin)

**Interfaces:**
- Consumes: Tasks 1 to 3 (token and face names in the rule text).
- Produces:
  - `export interface Rule { id: string; says: string }` and `export const HANDBOOK: Readonly<Record<'type' | 'colour' | 'mobile' | 'parts' | 'page' | 'app' | 'pictures', readonly Rule[]>>` with the rules of spec 4.1 to 4.7 under the ids given there (T1..T7, C1..C8, M1..M16, K, P1..P10, A1..A10, I1..I7), each `says` one to three English sentences carrying the spec's numbers.
  - `export function handbookFor(template: Template): string`: for `mobile-expo` type + colour + mobile + parts + pictures; for the web templates type + colour + page + app + pictures. Rules are printed as `M3. …`.
  - `codingSystemPrompt(template)` includes `handbookFor(template)` in place of the `Type:` and `Fonts:` sentences of the design-system paragraph, items 3 and 5 of the mobile mandate, and the `Pictures.` paragraph's rules of when (the tool's mechanics stay). `MOCKUP_FACES` names the three supplied faces. `DIRECTIONS_RULES` says `"face"` where it said `"display"`.
  - `HOUSE_BAR_WEB` point 3 no longer offers a choice of face or a second face; point 4 no longer says "Warm paper".

- [ ] **Step 1: Failing tests** in `handbook.test.ts`: every id of the spec is present exactly once; `handbookFor('mobile-expo')` and `handbookFor('web-vite-react')` are each at most 1,500 words; the mobile text has `M3.` and no `P3.`, the web text has `P3.`, `A3.` and no `M3.`; both have `T1.`, `C2.`, `I1.`; `codingSystemPrompt('mobile-expo')` contains `handbookFor('mobile-expo')` and none of `Fraunces`, `Instrument Serif`, `Bricolage`, `Geist with`, `it may be a serif`; `MOCKUP_RULES` names `SUIT Variable` and `SUITE Variable`.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Write the rules and compose them. Update the wording assertions in the three existing test files to the new text.
- [ ] **Step 4:** Pass; typecheck.
- [ ] **Step 5:** Commit.

### Task 5: Composition, read off the page

**Files:**
- Modify: `packages/daemon/src/qa/collector.ts`, `packages/daemon/src/qa/checks.ts`
- Test: `packages/daemon/test/composition.test.ts` (new, real Chrome)

**Interfaces:**
- Produces:
  - `PageDigest.composition` (optional, so stored digests still parse): `{ microShare: number; microSentences: string[]; families: string[]; monoOutsideCode: string[]; figuresAtLargest: string[]; turnedText: string[]; stackedText: string[]; endAlignedText: string[]; controls: number; halfEmptyCards: { selector: string; w: number; h: number; reach: number }[]; nestedCards: number; figuresTwice: string[]; mediaBoxes: [number, number, number, number][] }`, all for the first screenful, computed as `scripts/design-lab/metrics.mjs` computes them, with text inside `svg` left out of `microShare`.
  - `export function compositionFindings(digest: PageDigest, ctx: CheckContext): Finding[]`, called from `runDomChecks` when `ctx.scope === 'full'`. Rules: `type/second-family`, `type/mono-outside-code`, `type/micro-overuse`, `type/micro-sentence`, `type/turned-text`, `type/stacked-text`, `type/end-aligned-block`, `layout/competing-figures`, `layout/half-empty-card`, `layout/nested-cards`, `layout/too-many-controls` (touch viewports only), `copy/figure-twice`. Thresholds live in one exported object `COMPOSITION_LIMITS` so the lab's numbers can be set in one place.

- [ ] **Step 1: Failing test:** one small page per rule that breaks only that rule, and one clean page (an app bar, a comparison block, a list of five rows, a dock) that breaks none; each is opened in Chrome through `collectDigest` and `runDomChecks`, and the rules found are compared. Review Focus 3 and 5 are two of the pages (a chart of 11px numerals: no `type/micro-overuse`; SUIT over Pretendard: `type/second-family`).
- [ ] **Step 2:** Run with the sandbox off; fail.
- [ ] **Step 3:** Implement. Initial limits: micro share over 0.40, sentence of 24 characters or more at 12px or under, turn over 15 degrees, three or more at the largest size (28px and up), a card of 140px or taller filled under 60%, more than 9 controls. Severity `major` for second-family, mono-outside-code, turned, stacked, micro-overuse, competing-figures, too-many-controls; `minor` for the rest. These are revisited in Task 8.
- [ ] **Step 4:** Pass; `qa.test.ts` and `measured-mockups.test.ts` still pass.
- [ ] **Step 5:** Commit.

### Task 6: Colour by the pixel

**Files:**
- Create: `packages/daemon/src/qa/pixels.ts`
- Modify: `packages/daemon/src/qa/VisualAuditor.ts`, `packages/daemon/src/qa/checks.ts`
- Test: `packages/daemon/test/composition.test.ts`

**Interfaces:**
- Consumes: `composition.mediaBoxes` from Task 5.
- Produces:
  - `export async function colourShares(browser: Browser, png: Buffer, opts: { mask: readonly [number, number, number, number][]; scale: number }): Promise<{ saturated: number; dark: number }>`: shares of the unmasked pixels, read in a blank helper page through a canvas (saturation over 0.45 with lightness 0.2 to 0.8; lightness under 0.12).
  - `CheckContext.shares?: { saturated: number; dark: number }`; `runDomChecks` adds `color/flood` (saturated over 0.15, major) and, on `mobile-expo` phone captures whose paper is light, `color/dark-band` (dark over 0.20, major).
  - `VisualAuditor` takes the first screenful's picture in the light scheme whenever it measures (also for `measurePages`, which takes none today) and passes the shares.

- [ ] **Step 1: Failing tests:** a phone page with a brand panel over a quarter of the screen: `color/flood`; the same page with the panel as an `img`: none (Review Focus 4); a paper page with a black band over a third: `color/dark-band`; a page whose `--sz-bg` is dark: none (Review Focus 2); today's production page b (`.design-lab/production/duel/b.html`, copied into `test/fixtures/duel-b.html`): both.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Pass; the mock-up check test still passes and now reports the two rules for the fixture.
- [ ] **Step 5:** Commit.

### Task 7: The reviewer reads the same handbook

**Files:**
- Modify: `packages/daemon/src/qa/vision.ts`
- Test: `packages/daemon/test/vision-bridge.test.ts`, `slop-detector.test.ts`

**Interfaces:**
- Consumes: `handbookFor` (Task 4).
- Produces: `visionParts(input).head` carries `handbookFor(input.template)` for every screen (not only the first), with the instruction to name the rule id a finding breaks; `VISION_SYSTEM_PROMPT`'s "What the project builds with" paragraph names one face, the second colour and the series, and no longer says a serif title is acceptable; the measured rules of Tasks 5 and 6 are listed among what "has already been computed".

- [ ] **Step 1: Failing tests:** the head for a `mobile-expo` input contains `M3.` and `C2.`; for a web input `P3.` and `A3.`; the system prompt contains none of `serif title`, `font-display, beside the body face`.
- [ ] **Step 2 to 5:** fail, implement, pass, commit.

### Task 8: The treatment run and the comparison

**Files:**
- Data: `.design-lab/runs/treatment/…`, `.design-lab/review/…`
- Create: the comparison page (published as a private artifact; its source kept at `.design-lab/compare/index.html`)

- [ ] Treatment check server from the working tree on `127.0.0.1:47812`; prompts built with `prompts.ts draw` from the working tree for the same four briefs.
- [ ] Nine treatment pages drawn by the same workflow as the baseline (Opus, effort high).
- [ ] `metrics.mjs` on all eighteen pages plus the first check of each treatment run (`checks/1.html`: guidance without feedback).
- [ ] Blind review: three reviewer agents, each given every page's phone screenshot (and desktop for web briefs) in a shuffled order with neutral ids, the baseline `VISION_SYSTEM_PROMPT`, and a structured answer (seven axes, slop score, three worst findings).
- [ ] Per rule: baseline and treatment distributions of its number, and whether review scores moved. Each rule is marked keep, rework or drop (spec 5, "판정").
- [ ] The comparison page: for each row, before and after side by side with the numbers; the per-rule table; what could not be tested. Shown to the owner.
- [ ] Thresholds in `COMPOSITION_LIMITS` and the flood and dark-band limits set from the two distributions; rules marked drop removed from `handbook.ts` and `checks.ts`.

### Task 9: After the owner's verdict

**Files:**
- Modify: `packages/daemon/src/harness/Harness.ts` (fast track: measure the first route once at the primary size after smoke, no reviewer, result in the summary and the audits tab, never a gate), `docs/ARCHITECTURE.md` (§7.1, §7.2, §7.4, §8.4, §8.6, §8.7, §17), `packages/daemon/package.json` (drop the `@fontsource*` packages the daemon no longer reads)
- Test: `packages/daemon/test/lean-loop.test.ts`

- [ ] Failing test: a Draft 0 task whose smoke passes emits one `audit.completed` with `visionReviewed: false`, asks no reviewer, and is not sent back for its findings.
- [ ] Implement; whole suite with the sandbox off; the real-engine test (`SZ_TEST_ENGINE=1`, alone); a real Vite project in a sandbox loads the face through the theme's `@font-face` (and the same for an Expo web export, or the template's own way is written down).
- [ ] Architecture document; commit; merge and deploy only on the owner's word.
