import type { Template } from '@studio-zero/protocol';

/**
 * The design handbook: how a screen is put together here, as numbered rules.
 *
 * The house bar (`houseBar.ts`) says what good work has in common and the contract says what is measured.
 * Neither says how to compose a screen, and on a real design task that is where the screens failed: a brand
 * panel over a sixth of a phone screen beside a black band over a third, four fifths of the text set at 12px or
 * under, numerals turned on a dial, a card stretched to match its neighbour and left half empty. The studio's own
 * check answered "nothing here holds the page back", because nothing of it was written down as a quantity or
 * measured.
 *
 * So each rule here carries a default with its numbers, and says what may override it. The rules are data: the
 * engines' system prompt and the reviewer's brief are both rendered from this list, and a check in the audit
 * names the rule it enforces by its id, so the three speak of the same thing in the same words. They are
 * defaults for a product to depart from with a reason drawn from its subject, not a house style: two products
 * held to them should still look nothing alike, and the palette, the shape and the composition remain the
 * product's own.
 *
 * The first version of these rules only took things away (colour to a tenth, icons in ink, people as initials,
 * every box a hairline), and the design lab showed what that makes: screens of text and rules on grey paper,
 * which the owner called flat beside the products people call alive. Measured with one ruler, those products'
 * first screens are a quarter strong colour, carry a dozen or more icons and pictures over a third of the
 * screen, and rule almost no box; ours had none of it, before the handbook and after alike. So the rules of
 * colour, surfaces and pictures now say what a screen is made of (E), and what is drawn must be the product's
 * own nouns, which is what keeps it from being clip-art.
 *
 * Ids: T type, C colour, E what a screen is made of, M composing a phone screen, K the parts' names, P a web
 * page, A a web app screen, I pictures. `on` limits a rule to one kind of product.
 */
export interface Rule {
  id: string;
  says: string;
  on?: 'mobile' | 'web';
}

const TYPE: readonly Rule[] = [
  { id: 'T1', says: 'One typeface. The product is set in the one face its theme names (Pretendard, SUIT or SUITE), Latin and Hangul alike, and the theme already loads its file: install and name no other. A title is that face made heavier: no serif, no second sans, no italics. Monospace only inside code, pre and kbd; dates and figures are the body face with tabular-nums.' },
  { id: 'T2', on: 'mobile', says: 'Every size has a role. The one figure: text-3xl to text-5xl (30 to 48px) at weight 800, tabular. Screen title: text-xl or text-2xl at 700. Section heading: text-lg at 700. Body: text-base (16px) at 400 or 500. Secondary: text-sm. Caption: text-xs at 500. Micro: text-2xs (11px) at 600.' },
  { id: 'T2', on: 'web', says: 'Every size has a role. On a page: the one headline 56 to 96px on a desktop and 36 to 44px on a phone, at 700 or 800, tracking -0.02em, leading 1.05 to 1.15; section heading text-3xl or text-4xl at 700; sub-heading text-xl or text-2xl; lead text-lg or text-xl; body text-base; small text-sm; caption text-xs. On an app screen: page title text-2xl or text-3xl at 700; section text-lg at 600 or 700; body and controls text-sm or text-base; table cells text-sm; table headers text-xs at 600; a headline figure text-2xl to text-4xl at 700.' },
  { id: 'T3', says: 'Small text has a budget. text-xs and text-2xs are for timestamps, units, badges, stat labels and column headers: never a sentence, never what the screen exists to say, and at most about a third of the text on a screen. A screen of mostly small grey labels has no body: promote what matters.' },
  { id: 'T4', says: 'Three weights a screen at most: 400 for reading, 600 or 700 for names, titles and values, 800 for the one figure.' },
  { id: 'T5', says: 'Text is upright and horizontal: no rotated labels, no Hangul stacked a syllable to a line, no numerals turned around a dial or laid along a curve.' },
  { id: 'T6', says: 'Text aligns to the start. Only numbers in a column align to the end; only a lone figure with its caption, or an empty state, is centred. A block of words never aligns to the end.' },
  { id: 'T7', says: 'Leading: body 1.5 to 1.6, titles 1.2 to 1.3, the figure 1.0 to 1.1. A label never runs to a third line. A figure never breaks onto a second line: give its column the width of its longest value, or set it a step smaller. No text is drawn over other text.' },
];

const COLOUR: readonly Rule[] = [
  { id: 'C1', says: 'Colours have roles, and only these exist: paper (bg-bg), surfaces (bg-surface, bg-sunken, border-border), ink (text-fg, text-fg-muted), the brand (bg-brand with text-on-brand, text-accent, bg-brand-soft), a second colour (bg-second with text-on-second, bg-second-soft), a data series (series-1 to series-6) and state (danger, success, warning). Invent no colour, and never dim text with opacity.' },
  { id: 'C2', on: 'mobile', says: 'Strong colour lives on one hero (E5): the band or card in bg-brand with text-on-brand that holds the product\'s state. Elsewhere it is the primary action, the mark of what is selected, icon tiles, badges and the fill of a meter. No second filled card. The audit counts it: past 45% of the first screen is a flood, and under a fifth with no pictures is a grey screen.' },
  { id: 'C2', on: 'web', says: 'Strong colour lives on one hero (E5): the band or card in bg-brand with text-on-brand that holds the product\'s state. Elsewhere it is the primary action, the mark of what is selected, icon tiles, badges and the fill of a meter. No second filled card. The audit counts it: past 45% of the first screen is a flood, and under a fifth with no pictures is a grey screen.' },
  { id: 'C3', says: 'No dark band across a light screen. On a phone or app screen, dark is the scheme of the whole screen, which the theme provides, never a panel dropped into a paper one. A web page may carry one inverse section, full width, below its first screen.' },
  { id: 'C4', says: 'Two sides, or several kinds. The brand is this side (me, ours, the current one) and the second colour is the other; in the one block that compares them, each side may fill its half. More than two kinds take series-1, series-2 and on, in order, as marks: an icon tile, the colour of a number, a dot, one segment of a bar. Never alone: a name or a position says the same thing.' },
  { id: 'C5', says: 'Washes. bg-brand-soft and bg-second-soft, or a series colour at 15% (bg-series-2/15), are for icon tiles, badges, the selected row and today\'s column. Not for a whole section.' },
  { id: 'C6', says: 'State colours mean state and nothing else.' },
  { id: 'C7', says: 'No gradient on a control or a surface.' },
  { id: 'C8', says: 'Choosing a palette: the hue from the subject\'s own thing; chroma 0.12 to 0.16 for tools and money, 0.17 to 0.22 for consumer products, 0.23 to 0.28 for play and sport; second_hue only when the product has two sides or kinds; corners sharp for tools and data, soft by default, round for friendly consumer products; Pretendard for neutral, dense products, SUIT for crisp geometric ones, SUITE for soft, wide ones.' },
];

const MATERIAL: readonly Rule[] = [
  { id: 'E1', on: 'mobile', says: 'Material. A first screen is made of the product\'s own things and not of text and rules alone: its data drawn (a chart, a meter, the instrument), an icon leading every row, its people as avatars, and real pictures where the subject has a look (I1). A drawing never pushes the work down: the first screen still shows the state, the action and the first rows of what it rests on (M2). No scene, no backdrop, nothing drawn to fill a space.' },
  { id: 'E1', on: 'web', says: 'Material. A first screen is made of the product\'s own things and not of text and rules alone: the working thing or its data drawn (a chart, a meter, the instrument), icons on its navigation, stats and sections, its people as avatars, and real pictures where the subject has a look (I1). A drawing never pushes the work down. No scene, no backdrop, nothing drawn to fill a space.' },
  { id: 'E2', on: 'mobile', says: 'Icons and navigation. Every row, tab, chip and stat has an icon: a glyph in a rounded tile of 36 to 44px, tinted with a soft wash of a series colour (C5). The first screen shows the bottom tab bar of three to five icon and label tabs, with the primary action floating above it (M1): the audit looks for it.' },
  { id: 'E2', on: 'web', says: 'Icons and navigation. A navigation bar runs across the top and stays as the page scrolls: the product\'s mark at the start, its sections each with an icon, and search, the account or the one action at the end; at a phone\'s width the sections become a bottom tab bar or a menu. Every tab, chip, stat and section heading has an icon: a glyph in a rounded tile of 36 to 44px, tinted with a soft wash of a series colour (C5). In a table the status and the kind of thing carry theirs.' },
  { id: 'E3', says: 'A diet of text. Text covers a quarter of the first screen at most. Cut meta lines; say it with a picture, an icon, a number or a badge. One line of secondary text an item at most.' },
  { id: 'E4', on: 'mobile', says: 'Surfaces. The canvas is bg-sunken; content sits on bg-surface cards with rounded-xl (16px or more) and no border: a soft shadow or nothing. Chips and buttons are pills. No hairline tables and no ruled ledgers: a list is rows on a card, with space or an inset divider between them. What floats covers no text at rest, and the page ends clear of it.' },
  { id: 'E4', on: 'web', says: 'Surfaces. The canvas is bg-sunken; content sits on bg-surface cards with rounded-xl (16px or more) and no border: a soft shadow or nothing. Chips and buttons are pills. A table sits on one card with dividers between its rows and no rule round it or its cells; sections part with space and a heading, not a line. What floats covers no text at rest, and the page ends clear of it.' },
  { id: 'E5', on: 'mobile', says: 'Colour. Strong colour is welcome: a fifth to a third of the first screen. Open with a band or hero card in bg-brand (text-on-brand) that holds the state as a figure, its sentence and its instrument (a meter, a small chart), not as an illustration, and takes two fifths of the screen at most so the first rows show. Tint icon tiles and badges; give the other side the second colour. Tokens only.' },
  { id: 'E5', on: 'web', says: 'Colour. Strong colour is welcome: a fifth to a third of the first screen. A page and an app screen alike open on a band or a hero in bg-brand (text-on-brand) that holds the state as a figure, its sentence and its instrument (a meter, a small chart), or on a page the working thing or a real picture of the subject. Tint icon tiles and badges; give the other side the second colour. Tokens only.' },
  { id: 'E6', on: 'mobile', says: 'Rhythm. Mix kinds of block on one screen: a hero card, a strip that scrolls sideways (cards or chips), a two-column grid of tiles, a short list. Never one table from top to bottom.' },
  { id: 'E6', on: 'web', says: 'Rhythm. Mix kinds of block: a hero, a row of tiles, a strip of cards, a list or the table. A page is never one column of paragraphs, and an app screen never a table alone.' },
  { id: 'E7', says: 'Badges ride on things: a count on a picture, a state chip on a card, the points a row earned.' },
  { id: 'E8', says: 'Voice. The headline is a friendly sentence with the number in it; the figure is heavy (800) and large.' },
  { id: 'E9', says: 'Motion. What is pressed answers at once (a press-in, a change of surface) and settles in 150 to 300ms, ease-out; a sheet, a drawer or a screen moves in 300 to 500ms. The outcome of the main action lands once, as motion: the figure rolls to its new value, the new row drops in, the stamp comes down. One thing on a first screen is alive at rest, and one only: a live dot that pulses, the hero\'s drawing breathing, a strip that advances every 3 to 5 seconds. The hero enters once, in 400 to 700ms. No entrance on every block, and prefers-reduced-motion is honoured.' },
];

const MOBILE: readonly Rule[] = [
  { id: 'M1', says: 'Frame. A screen a person lands on carries the app\'s navigation. At the top, a bar with the product\'s mark or the screen\'s title (14 characters or fewer) at the start and up to two actions at the end. At the bottom, fixed, a tab bar of three to five tabs, each an icon and a label, one for each top-level screen of the screen spec, the current one marked in the brand; the one primary action is a pill floating above it at the end side. Only a screen pushed for a single task (a sheet, a camera, a long form) drops the tab bar, and holds its one action in a dock. The body ends with room for what floats: nothing at rest lies under it.' },
  { id: 'M2', says: 'The first screenful answers three things, in this order: where I stand (the state, on the hero, two fifths of the height at most), what I do now (the action, always in view), what it rests on (the first evidence). The rest scrolls.' },
  { id: 'M3', says: 'One figure. One thing on the screen is at figure size. Two values compared sit in one comparison block: one surface, the same size, the difference said once.' },
  { id: 'M4', says: 'Say it once. A date, a round, a gap, a name with its score appears once on a screen. The app bar\'s title is not repeated in the body.' },
  { id: 'M5', says: 'Containers. A card (E4) holds one object or one group; a section is a text-lg heading and its cards, 24 to 32px apart. No card in a card. A container is as tall as its content, never stretched to match a neighbour.' },
  { id: 'M6', says: 'Lists. Things of one kind are rows on one card, not a card each: 56 to 72px tall, a leading avatar or icon tile of 40px, a text-base title at 600, one text-sm line of meta, a trailing value or chevron, dividers inset to the text. Three to six rows show on the first screen.' },
  { id: 'M7', says: 'Density. Besides rows, the app bar and the tab bar, at most seven things can be pressed on the first screenful.' },
  { id: 'M8', says: 'Stats. A label (text-xs at 500) with its value (text-xl to text-3xl at 700, tabular) and the unit at about 60% of the value\'s size. Three in a row at most.' },
  { id: 'M9', says: 'Charts and instruments. When the product is about a trend or a measure, its instrument is the focal block. Draw the periods that have data and the next one: no grid of empty future. Label a line on the line, not in a floating box. One accent series; the rest ink, muted or the second colour.' },
  { id: 'M10', says: 'Input. Three fields or more: one question a screen. A field is 48 to 52px tall, label above (text-sm at 600), help below; numbers get the number pad; a small set is a segmented control or a stepper, not a dropdown; pickers open in a sheet.' },
  { id: 'M11', says: 'Answering back. A toast sits above the dock for three to five seconds with undo; an error appears beside its cause; a skeleton has the shape of what is loading.' },
  { id: 'M12', says: 'Empty, and first run. One small drawing of the thing that will be here (E2), one line, and the one action. No onboarding cards.' },
  { id: 'M13', says: 'Moving around. Push to go deeper (back at top left), a sheet for a side task, a full screen for long writing, tabs for three to five peers, a segmented control for two to four views of one data set.' },
  { id: 'M14', says: 'The hand. Primary action at the bottom; targets 44px or more, 8px apart or more.' },
  { id: 'M15', says: 'Motion. As E9 says: an answer to each press, the moment the outcome lands, once, and one thing alive at rest.' },
  { id: 'M16', says: 'Dark, and large text. Tokens only, so dark follows. At 130% text rows grow and nothing is clipped.' },
];

const PARTS: readonly Rule[] = [
  { id: 'K', says: 'Parts. Compose a screen from these, each built the same way everywhere: AppBar, Dock, TabBar, Hero, Segmented, Section, Row, IconTile, Avatar, Stat, CompareBlock, Card, Sheet, Field, Chip, Badge, Toast, Empty, Skeleton, Meter, Chart. A part that is none of them needs a reason.' },
];

const PAGE: readonly Rule[] = [
  { id: 'P1', says: 'First decide what each route is: a page, which is read and persuades, or an app screen, which works. Rules P are for pages and rules A for app screens. Do not put a marketing hero on a tool, or lay a landing page out as a dashboard.' },
  { id: 'P2', says: 'Grid and measure. Content 1120 to 1200px wide, twelve columns, 24px gutters. A text column is 68 characters at most (38 to 42 in Hangul). Sections are 96 to 128px apart on a desktop and 56 to 72px on a phone.' },
  { id: 'P3', says: 'The first screen holds four things: one headline (two lines at most on a desktop, three on a phone), one supporting sentence (text-lg or text-xl), the working thing itself, with at least half of it in view on a desktop and its start within the first screen on a phone, and one primary action. Do not colour one word of the headline by habit.' },
  { id: 'P4', says: 'Balance. No column of the first screen stays empty for more than a third of its height. When the working thing is taller than the words, centre the words against it, make them stick, or stack the two.' },
  { id: 'P5', says: 'Sections. One claim (a heading) and one thing to operate or to look at. Five to seven sections at most. Three equal cards of features are not the default.' },
  { id: 'P6', says: 'Navigation. The bar of E2: the wordmark is text in the product\'s face at 700 or 800; five links at most; one action.' },
  { id: 'P7', says: 'Proof and numbers are real or absent. The price is said plainly.' },
  { id: 'P8', says: 'On a phone a page is one column: the headline, the working thing, the action.' },
  { id: 'P9', says: 'A hand-made mark: one at most, tilted 12 degrees at most.' },
  { id: 'P10', says: 'The footer is quiet.' },
];

const APP: readonly Rule[] = [
  { id: 'A1', says: 'Shell. The navigation of E2, as a top bar when there are five sections or fewer, or with a side navigation 220 to 256px wide for five to eight. The content\'s width follows the job: a table takes the width, a form 560 to 640px, reading 720px.' },
  { id: 'A2', says: 'Page head. A title (text-2xl or text-3xl at 700), one line of context, and the primary action at the right. Filters and search sit in one row below it.' },
  { id: 'A3', says: 'Tables. Rows 44 to 52px. Sticky headers in text-xs at 600. The first column is the name, at 600. Numbers are aligned to the end and tabular. A status is a badge: a dot and a word. Seven columns at most at 1280px; the rest is in the detail. Pressing a row opens its detail in a side panel. Selecting several brings up a floating bar of actions. The table has its empty, loading and error states.' },
  { id: 'A4', says: 'Detail. A side panel 400 to 480px wide to look, a full page to edit.' },
  { id: 'A5', says: 'Forms. One column, labels above (text-sm at 600), controls 40 to 44px tall, help below, the primary action at the bottom left. Validate in place.' },
  { id: 'A6', says: 'Dashboards. One headline figure and its trend, then two to four supporting stats, then the table that explains them. No wall of equal cards.' },
  { id: 'A7', says: 'Density. Base text-sm or text-base; spacing of 8, 12, 16 and 24px.' },
  { id: 'A8', says: 'Answering back. Toasts at the bottom right; a confirmation dialog only before something is destroyed; otherwise change at once and offer undo.' },
  { id: 'A9', says: 'Narrow. Under 1024px the navigation becomes a drawer. Under 640px a table becomes rows of two lines (the name and the key value) and the rest opens on press.' },
  { id: 'A10', says: 'Focus is visible and the keyboard reaches everything.' },
];

const PICTURES: readonly Rule[] = [
  { id: 'I1', says: 'What a picture shows decides what it is made of. Data or the working thing: drawn in code (a chart, a meter, an instrument), as large as it needs. A kind of thing, an action, a state: an icon. A thing the product names (the passbook, the trophy): one small drawing in code, 96px at most. A person: their photograph, or a drawn face on a disc of about 40px, never an initial alone, and only where the person is named (a row, a side of a comparison), not a crowd of faces in a summary. Something whose look is the content (food, goods, a place, a pet, a game\'s world): a real image from generate_image or the owner\'s own file, never an SVG. A mood, a scene, a backdrop: nothing.' },
  { id: 'I2', says: 'Never made, drawn or generated: a scene to fill a space (a landscape, people doing something, abstract shapes), a stock photograph, a 3D blob, a drawing of an interface, an emoji as an icon. The test: if the screen does the same job without the picture, the picture goes.' },
  { id: 'I3', says: 'Proportions: a thumbnail 1:1, a card picture 4:3 or 3:2, a hero 16:9 or 3:2.' },
  { id: 'I4', says: 'One set, one direction: the same light and distance, colours toward the theme, no words in the picture.' },
  { id: 'I5', says: 'How many: one for a mock-up direction; for a build, six for the fixtures and one hero at most.' },
  { id: 'I6', says: 'Words on a photograph sit on a plate or a scrim, never on the bare picture.' },
  { id: 'I7', says: 'Icons come from one set (lucide), with a 1.5 to 2px stroke: in ink when bare, in the tile\'s colour on a tile, in the accent when active.' },
];

export const HANDBOOK = { type: TYPE, colour: COLOUR, material: MATERIAL, mobile: MOBILE, parts: PARTS, page: PAGE, app: APP, pictures: PICTURES } as const;

/**
 * What the rules E are held against: the owner's references and the studio's own earlier pages, measured with
 * one ruler in the design lab on 2026-11-13. It is printed above the rules because it is what made them land:
 * drawn from the rules alone the lab's pages came out half way, and with this table in front of them they came
 * out where the references are, which is the version the owner chose.
 */
const MATERIAL_LEAD = `The owner's standard is the consumer products people call alive: a game maker's store, a shopping app, a live-streaming app, a neighbourhood marketplace, a finance app. Their first screens were measured on a phone with the studio's own ruler, beside the pages the studio used to draw:

| | pictures and drawn art | icons in view | strong colour | boxes ruled with a hairline |
|---|---|---|---|---|
| those products | 15 to 60% of the screen | 12 to 28 | about a quarter | none or one |
| the studio's earlier pages | 0% | 0 to 6 | 6% | nearly every box |

Filmed, the same products answer a press on four controls in five, move in 150 to 300ms (500ms for a sheet or a slide), and half of them keep something alive at rest (a banner that advances, a live dot), where the studio's pages answered every press and then sat still.

Their large pictures are the content itself (goods, streams, a game's art), never illustrations; their vector art is icons. Text and rules on grey paper is what the owner rejected as flat, and so is a drawn scene filling a card. Make the screen of the same material as those products. Its concept, its scene, its data and its core flow stay exactly its own.`;

const SECTIONS: Record<'mobile' | 'web', readonly { title: string; rules: readonly Rule[]; lead?: string }[]> = {
  mobile: [
    { title: 'Type', rules: TYPE },
    { title: 'Colour', rules: COLOUR },
    { title: 'Composing a phone screen', rules: MOBILE },
    { title: 'Parts', rules: PARTS },
    { title: 'Pictures', rules: PICTURES },
    { title: 'What a screen is made of', rules: MATERIAL, lead: MATERIAL_LEAD },
  ],
  web: [
    { title: 'Type', rules: TYPE },
    { title: 'Colour', rules: COLOUR },
    { title: 'A page', rules: PAGE },
    { title: 'An app screen', rules: APP },
    { title: 'Pictures', rules: PICTURES },
    { title: 'What a screen is made of', rules: MATERIAL, lead: MATERIAL_LEAD },
  ],
};

const platformOf = (template: Template): 'mobile' | 'web' => (template === 'mobile-expo' ? 'mobile' : 'web');

const printed = (section: { title: string; rules: readonly Rule[]; lead?: string }, platform: 'mobile' | 'web'): string =>
  `${section.title}.\n${section.lead ? `${section.lead}\n\n` : ''}${section.rules.filter((rule) => rule.on === undefined || rule.on === platform).map((rule) => `${rule.id}. ${rule.says}`).join('\n')}`;

/**
 * The handbook's last section on its own: what a screen is made of, under the measurements it is held
 * against. An engine that draws a page is given it a second time at the end of its brief, where the lab found
 * it is acted on.
 */
export function materialFor(template: Template): string {
  const platform = platformOf(template);
  return `<what_a_screen_is_made_of>\n${printed(SECTIONS[platform].find((section) => section.rules === MATERIAL)!, platform)}\n</what_a_screen_is_made_of>`;
}

/** The rules that hold for one kind of product, in the order they are printed. */
export function rulesFor(template: Template): Rule[] {
  const platform = platformOf(template);
  return SECTIONS[platform].flatMap((section) => section.rules.filter((rule) => rule.on === undefined || rule.on === platform));
}

/**
 * The handbook as an engine and a reviewer read it: the rules for this kind of product under their headings,
 * each led by its id.
 */
export function handbookFor(template: Template): string {
  const platform = platformOf(template);
  const body = SECTIONS[platform].map((section) => printed(section, platform)).join('\n\n');
  return `<design_handbook>
How a screen is put together here. Each rule is a default with its numbers: depart from one only for a reason that comes from this product's subject, and say so when you finish. The audit measures several and the reviewer judges by all, each by its number.

${body}
</design_handbook>`;
}
