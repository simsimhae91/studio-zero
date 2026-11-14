// The design handbook: numbered rules for how a screen is put together, said to the engine that draws or builds
// and to the reviewer that judges, in the same words, so a finding can name the rule it breaks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HANDBOOK, handbookFor, materialFor, rulesFor } from '../src/harness/handbook.ts';
import { HOUSE_BAR_WEB } from '../src/harness/houseBar.ts';
import { DIRECTIONS_RULES, MOCKUP_RULES, codingSystemPrompt, directionBrief } from '../src/harness/prompts.ts';
import { VISION_SYSTEM_PROMPT, visionParts, type VisionInput } from '../src/qa/vision.ts';

const range = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
// What a screen is made of (E) is printed last: it is what the owner looks at first, and the end is where it is acted on.
const MOBILE_IDS = [...range('T', 7), ...range('C', 8), ...range('M', 16), 'K', ...range('I', 7), ...range('E', 9)];
const WEB_IDS = [...range('T', 7), ...range('C', 8), ...range('P', 10), ...range('A', 10), ...range('I', 7), ...range('E', 9)];

test('each kind of product gets its own rules, each once, under the cap an engine will still read', () => {
  assert.deepEqual(rulesFor('mobile-expo').map((rule) => rule.id), MOBILE_IDS);
  assert.deepEqual(rulesFor('web-vite-react').map((rule) => rule.id), WEB_IDS);
  assert.deepEqual(rulesFor('web-next').map((rule) => rule.id), WEB_IDS);
  for (const template of ['mobile-expo', 'web-vite-react'] as const) {
    const text = handbookFor(template);
    // 1,500 until the rules for what a screen is made of (E) and the measurements they are held to were added; the lab's drawing agents kept the longer text as they kept the shorter.
    assert.ok(text.split(/\s+/).length <= 2480, `${template}: ${text.split(/\s+/).length} words`);
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

test('the rules carry their numbers: one hero of strong colour, a budget for small text, one face, upright text, and what a screen is made of', () => {
  const says = (template: 'mobile-expo' | 'web-vite-react', id: string): string => rulesFor(template).find((rule) => rule.id === id)!.says;
  assert.match(says('mobile-expo', 'T1'), /Pretendard, SUIT or SUITE[\s\S]*no serif, no second sans, no italics[\s\S]*Monospace only inside code, pre and kbd/);
  assert.match(says('mobile-expo', 'T3'), /never a sentence[\s\S]*about a third of the text on a screen/);
  assert.match(says('mobile-expo', 'T5'), /no rotated labels, no Hangul stacked a syllable to a line, no numerals turned around a dial/);
  assert.match(says('mobile-expo', 'C2'), /lives on one hero \(E5\)[\s\S]*No second filled card[\s\S]*past 45% of the first screen is a flood, and under a fifth with no pictures is a grey screen/);
  assert.match(says('web-vite-react', 'C2'), /lives on one hero \(E5\)[\s\S]*past 45% of the first screen is a flood, and under a fifth with no pictures is a grey screen/);
  assert.match(says('web-vite-react', 'E5'), /A page and an app screen alike open on a band or a hero in bg-brand/);
  // Navigation: a tab bar on a phone, a bar across the top on the web, and what breaks a frame.
  assert.match(says('web-vite-react', 'E2'), /A navigation bar runs across the top and stays as the page scrolls: the product's mark at the start, its sections each with an icon/);
  assert.match(says('mobile-expo', 'T7'), /A figure never breaks onto a second line[\s\S]*No text is drawn over other text/);
  assert.match(says('mobile-expo', 'E4'), /What floats covers no text at rest, and the page ends clear of it/);
  // Floors, with their numbers, as the owner chose them on the page.
  // A picture is chosen by what it shows; nothing is drawn to fill a space. (The first version of E1 asked for a
  // quarter of the screen drawn, and the first real build filled its hero with a landscape.)
  // Twice corrected by the owner's eye: a scene went back, and so did screens with their faces and objects taken out.
  assert.match(says('mobile-expo', 'E1'), /Its data is drawn \(a chart, a meter, the instrument\)[\s\S]*avatars with a drawn face or a character, not a name or an initial alone[\s\S]*illustrated objects[\s\S]*the hero carries the one the product is about beside its figure[\s\S]*Objects and faces, never a scene: no landscape, no people doing something, no backdrop/);
  assert.match(says('mobile-expo', 'I1'), /What a picture shows decides what it is made of[\s\S]*drawn in code as an object or a face \(E1\)[\s\S]*a real image from generate_image or the owner's own file, never an SVG[\s\S]*A mood, a scene, a backdrop: nothing/);
  assert.match(says('mobile-expo', 'I2'), /a scene \(a landscape, people doing something, abstract shapes, a backdrop\)[\s\S]*a scene only sets a mood, and goes/);
  assert.match(says('mobile-expo', 'E2'), /Every row, tab, chip and stat has an icon[\s\S]*The first screen shows the bottom tab bar of three to five icon and label tabs[\s\S]*the audit looks for it/);
  assert.match(says('mobile-expo', 'E5'), /Strong colour is welcome: a fifth to a third of the first screen\. Open with a band or hero card in bg-brand[\s\S]*holds the state: the figure, its sentence, its instrument \(a meter, a small chart\) and the product's object drawn beside them/);
  assert.match(says('mobile-expo', 'C4'), /the second colour is the other[\s\S]*each side may fill its half[\s\S]*as marks[\s\S]*Never alone/);
  assert.match(says('mobile-expo', 'M3'), /one comparison block: one surface, the same size, the difference said once/);
  assert.match(says('mobile-expo', 'M5'), /No card in a card[\s\S]*as tall as its content, never stretched/);
  assert.match(says('mobile-expo', 'M1'), /carries the app's navigation[\s\S]*a tab bar of three to five tabs, each an icon and a label, one for each top-level screen of the screen spec[\s\S]*a pill floating above it[\s\S]*nothing at rest lies under it/);
  assert.match(says('web-vite-react', 'P4'), /No column of the first screen stays empty for more than a third of its height/);
  assert.match(says('web-vite-react', 'I1'), /What a picture shows decides what it is made of/);
  // What a screen is made of, for a phone app and a web product alike.
  for (const template of ['mobile-expo', 'web-vite-react'] as const) {
    assert.match(says(template, 'E1'), /made of the product's own things and not of text and rules alone[\s\S]*Objects and faces, never a scene/);
    assert.match(says(template, 'E4'), /The canvas is bg-sunken; content sits on bg-surface cards with rounded-xl \(16px or more\) and no border/);
    // The section is the last thing in the handbook, under the measurements it is held to, and can be had on its own.
    const [handbook, section] = [handbookFor(template), materialFor(template)];
    assert.match(section, /^<what_a_screen_is_made_of>\nWhat a screen is made of\.\nThe owner's standard is the consumer products people call alive[\s\S]*\| those products \| 15 to 60% of the screen \| 12 to 28 \| about a quarter \| none or one \|[\s\S]*\nE1\. Material\.[\s\S]*\nE8\. Voice\.[^\n]*\nE9\. Motion\. What is pressed answers at once[^\n]*settles in 150 to 300ms[^\n]*\n<\/what_a_screen_is_made_of>$/);
    assert.ok(handbook.endsWith(`${section.replace(/^<what_a_screen_is_made_of>\n/, '').replace(/\n<\/what_a_screen_is_made_of>$/, '')}\n</design_handbook>`));
  }
  // An engine that draws one direction is given the section again as the last thing before it closes.
  const brief = directionBrief({ file: 'docs/mockups/a.html', themeFile: 't', seed: 's', scene: 'sc', row: 'r', others: 'o', template: 'mobile-expo' });
  assert.ok(brief.includes(`hold its first screen to this. It is the handbook's last section, said again here because it is the first thing the owner sees.\n\n${materialFor('mobile-expo')}\n\nClose with one or two sentences`));
  assert.ok(!directionBrief({ file: 'f', themeFile: 't', seed: 's', scene: 'sc', row: 'r', others: 'o', template: 'web-vite-react' }).includes('The first screen shows the bottom tab bar'), 'a web product is given its own');
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
