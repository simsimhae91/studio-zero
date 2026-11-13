// The design handbook: numbered rules for how a screen is put together, said to the engine that draws or builds
// and to the reviewer that judges, in the same words, so a finding can name the rule it breaks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDBOOK, handbookFor, rulesFor } from '../src/harness/handbook.ts';
import { HOUSE_BAR_WEB } from '../src/harness/houseBar.ts';
import { DIRECTIONS_RULES, MOCKUP_RULES, codingSystemPrompt } from '../src/harness/prompts.ts';
import { VISION_SYSTEM_PROMPT, visionParts, type VisionInput } from '../src/qa/vision.ts';

const range = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const MOBILE_IDS = [...range('T', 7), ...range('C', 8), ...range('M', 16), 'K', ...range('I', 7)];
const WEB_IDS = [...range('T', 7), ...range('C', 8), ...range('P', 10), ...range('A', 10), ...range('I', 7)];

test('each kind of product gets its own rules, each once, under the cap an engine will still read', () => {
  assert.deepEqual(rulesFor('mobile-expo').map((rule) => rule.id), MOBILE_IDS);
  assert.deepEqual(rulesFor('web-vite-react').map((rule) => rule.id), WEB_IDS);
  assert.deepEqual(rulesFor('web-next').map((rule) => rule.id), WEB_IDS);
  for (const template of ['mobile-expo', 'web-vite-react'] as const) {
    const text = handbookFor(template);
    assert.ok(text.split(/\s+/).length <= 1500, `${template}: ${text.split(/\s+/).length} words`);
    for (const rule of rulesFor(template)) assert.equal(text.split(`\n${rule.id}. `).length - 1, 1, `${template}: ${rule.id} is printed once, at the start of a line`);
    assert.match(text, /^<design_handbook>[\s\S]*<\/design_handbook>$/);
    assert.match(text, /depart from one only for a reason that comes from this product's subject/);
  }
  const [mobile, web] = [handbookFor('mobile-expo'), handbookFor('web-vite-react')];
  assert.ok(mobile.includes('\nM3. One figure.') && !mobile.includes('\nP3.') && !mobile.includes('\nA3.'));
  assert.ok(web.includes('\nP3. The first screen holds four things') && web.includes('\nA3. Tables.') && !web.includes('\nM3.'));
  // The sizes differ by kind of product; the id is the same.
  assert.match(mobile, /\nT2\. Every size has a role\. The one figure: text-3xl to text-5xl/);
  assert.match(web, /\nT2\. Every size has a role\. On a page: the one headline 56 to 96px/);
  assert.equal(Object.values(HANDBOOK).flat().every((rule) => !rule.says.includes('—')), true, 'written without em-dashes, as the pages should be');
});

test('the rules carry their numbers: a budget for strong colour and for small text, one face, upright text', () => {
  const says = (template: 'mobile-expo' | 'web-vite-react', id: string): string => rulesFor(template).find((rule) => rule.id === id)!.says;
  assert.match(says('mobile-expo', 'T1'), /Pretendard, SUIT or SUITE[\s\S]*no serif, no second sans, no italics[\s\S]*Monospace only inside code, pre and kbd/);
  assert.match(says('mobile-expo', 'T3'), /never a sentence[\s\S]*about a third of the text on a screen/);
  assert.match(says('mobile-expo', 'T5'), /no rotated labels, no Hangul stacked a syllable to a line, no numerals turned around a dial/);
  assert.match(says('mobile-expo', 'C2'), /about a tenth of the first screen[\s\S]*Never on a card, a panel, a column, a header bar or a section/);
  assert.match(says('mobile-expo', 'C4'), /the second colour is the other[\s\S]*applied as marks[\s\S]*never alone/);
  assert.match(says('mobile-expo', 'M3'), /one comparison block: one surface, the same size, the difference said once/);
  assert.match(says('mobile-expo', 'M5'), /No twin cards of equal height[\s\S]*as tall as its content, never stretched/);
  assert.match(says('web-vite-react', 'P4'), /No column of the first screen stays empty for more than a third of its height/);
  assert.match(says('web-vite-react', 'I1'), /draw it in code[\s\S]*its picture is content[\s\S]*Otherwise, no picture/);
});

test('the engines receive the handbook for their kind of product, and nothing that contradicts it', () => {
  for (const template of ['mobile-expo', 'web-vite-react'] as const) {
    const prompt = codingSystemPrompt(template);
    assert.ok(prompt.includes(handbookFor(template)), `${template}: the whole handbook, as written`);
    for (const gone of ['Fraunces', 'Instrument Serif', 'Bricolage', 'Geist with', 'it may be a serif', 'Warm paper', 'Two faces', 'a band, a figure', 'pretendard package', 'the title face']) assert.ok(!prompt.includes(gone), `${template}: "${gone}" is no longer said`);
    assert.match(prompt, /The face: one for the whole product, named by the theme and loaded by it from \.studio-zero\/fonts/);
    assert.match(prompt, /bg-second with text-on-second is a second colour for the other side/);
    assert.match(prompt, /measures how the screen is composed[\s\S]*the handbook's rules, by number/);
    assert.match(prompt, /Pictures\. Whether a product has pictures at all is the handbook's rule I1\./);
  }
  assert.ok(!codingSystemPrompt('mobile-expo').includes(handbookFor('web-vite-react')));
  assert.match(HOUSE_BAR_WEB, /in the product's one face at a heavy weight[\s\S]*One face throughout; monospace only for code\./);
  // A direction's page is set in the face its theme names, with the file the studio supplies.
  assert.match(MOCKUP_RULES, /the studio supplies the files for Pretendard Variable, SUIT Variable, SUITE Variable when it shows the page, and no other face/);
  assert.match(MOCKUP_RULES, /the handbook's measured rules: how much of the first screen is strong colour or dark/);
  assert.match(DIRECTIONS_RULES, /"face": the product's one typeface \("pretendard", "suit" or "suite"\)[\s\S]*"second_hue"/);
  assert.ok(!DIRECTIONS_RULES.includes('"display"'));
});

test('the reviewer judges every screen by the same handbook and names the rule a finding breaks', () => {
  const digest = { title: 't', lang: 'ko', width: 393, height: 852, scrollWidth: 393, scrollHeight: 852, loadedFonts: [], elements: [] };
  const input = (template: VisionInput['template'], firstScreen: boolean): VisionInput => ({ scope: { projectId: 'prj_x', taskId: null }, viewport: 'iphone-15-pro', route: '/', template, folds: [Buffer.from('x')], digest, measured: [], firstScreen });
  for (const first of [true, false]) {
    const head = visionParts(input('mobile-expo', first)).head;
    assert.ok(head.includes(handbookFor('mobile-expo')), 'not only on a first screen');
    assert.match(head, /begin its message with the rule's number/);
  }
  assert.ok(visionParts(input('web-vite-react', false)).head.includes('\nA3. Tables.'));
  assert.ok(!VISION_SYSTEM_PROMPT.includes('serif title is not a defect') && !VISION_SYSTEM_PROMPT.includes('a title face, font-display, beside the body face'));
  assert.match(VISION_SYSTEM_PROMPT, /one typeface for the whole product \(Pretendard, SUIT or SUITE\)/);
  assert.match(VISION_SYSTEM_PROMPT, /A second typeface, a serif, or monospace outside code is a defect\./);
  assert.match(VISION_SYSTEM_PROMPT, /how much of the first screen is strong colour or dark, how much of its text is small/);
});
