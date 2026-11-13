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
  { id: 'T7', says: 'Leading: body 1.5 to 1.6, titles 1.2 to 1.3, the figure 1.0 to 1.1. A label never runs to a third line.' },
];

const COLOUR: readonly Rule[] = [
  { id: 'C1', says: 'Colours have roles, and only these exist: paper (bg-bg), surfaces (bg-surface, bg-sunken, border-border), ink (text-fg, text-fg-muted), the brand (bg-brand with text-on-brand, text-accent, bg-brand-soft), a second colour (bg-second with text-on-second, bg-second-soft), a data series (series-1 to series-6) and state (danger, success, warning). Invent no colour, and never dim text with opacity.' },
  { id: 'C2', on: 'mobile', says: 'Strong colour lives on one hero, and a first screen has one: a band or a card in bg-brand with text-on-brand that holds the product\'s state and its drawing, over a fifth to a third of the first screen. Elsewhere strong colour is the primary action, the mark of what is selected, icon tiles, badges and the fill of a meter. No second filled card: past 45% the audit calls it a flood.' },
  { id: 'C2', on: 'web', says: 'Strong colour lives on one hero. The product\'s state sits on one band or card in bg-brand with text-on-brand (bg-brand-soft for a quiet product about money or work), up to about a third of the first screen. Elsewhere strong colour is the primary action, the mark of what is selected, icon tiles, badges and the fill of a meter. No second filled card: past 45% the audit calls it a flood.' },
  { id: 'C3', says: 'No dark band across a light screen. On a phone or app screen, dark is the scheme of the whole screen, which the theme provides, never a panel dropped into a paper one. A web page may carry one inverse section, full width, below its first screen.' },
  { id: 'C4', says: 'Two sides, or several kinds. The brand is this side (me, ours, the current one) and the second colour is the other; in the one block that compares them, each side may fill its half. More than two kinds take series-1, series-2 and on, in order, as marks: an icon tile, the colour of a number, a dot, one segment of a bar. Never alone: a name or a position says the same thing.' },
  { id: 'C5', says: 'Washes. bg-brand-soft and bg-second-soft, or a series colour at 15% (bg-series-2/15), are for icon tiles, badges, the selected row and today\'s column. Not for a whole section.' },
  { id: 'C6', says: 'State colours mean state and nothing else.' },
  { id: 'C7', says: 'No gradient on a control or a surface.' },
  { id: 'C8', says: 'Choosing a palette: the hue from the subject\'s own thing; chroma 0.12 to 0.16 for tools and money, 0.17 to 0.22 for consumer products, 0.23 to 0.28 for play and sport; second_hue only when the product has two sides or kinds; corners sharp for tools and data, soft by default, round for friendly consumer products; Pretendard for neutral, dense products, SUIT for crisp geometric ones, SUITE for soft, wide ones.' },
];

const MATERIAL: readonly Rule[] = [
  { id: 'E1', on: 'mobile', says: 'A first screen is made of more than text and rules. Something drawn covers a fifth of it or more (the product\'s own working thing at size, the hero\'s drawing, pictures), and it carries a dozen or more icons and avatars. Text in ruled boxes on grey paper is unfinished however tidy it is, and the audit counts what is drawn.' },
  { id: 'E1', on: 'web', says: 'A first screen is made of more than text and rules: the product\'s own working thing at size, and around it its people, its things and its icons. Text in ruled boxes on grey paper is unfinished however tidy it is, and the audit counts what is drawn.' },
  { id: 'E2', says: 'People and things. A person is an avatar: a drawn face or character on a tinted disc, the same everywhere (initials only in a dense table). A thing the product names (the receipt, the scale, the coin, the trophy) is a small drawn object, and the state may take one hero drawing. Draw them as SVG in one style: flat rounded shapes, two or three tones from the theme\'s brand, second and series colours. Only this product\'s own nouns: never a scene that could sit on any product, a blob person, abstract shapes or a grey placeholder.' },
  { id: 'E3', on: 'mobile', says: 'Icons and badges. Every row, tab, chip and stat leads with its icon: on a tile of 36 to 44px (rounded-lg, a wash of its colour, C5), or bare at 20 to 24px in a tab bar. A count or a state rides on its thing as a badge.' },
  { id: 'E3', on: 'web', says: 'Icons and badges. A row, tab, chip or stat that names a kind of thing leads with its icon: on a tile of 36 to 44px (rounded-lg, a wash of its colour, C5), or bare at 20 to 24px in a navigation. A count or a state rides on its thing as a badge.' },
  { id: 'E4', says: 'Surfaces. The canvas is bg-sunken; content sits on bg-surface cards, rounded-xl, with no border and shadow-sm or none. Controls and chips are rounded-lg or pills. A hairline is a divider inside a surface, never a box round every block.' },
  { id: 'E5', says: 'Words last. A drawing, an icon, a figure or a badge before a sentence; one line of secondary text an item at most. The hero\'s headline is a plain sentence with the figure in it.' },
];

const MOBILE: readonly Rule[] = [
  { id: 'M1', says: 'Frame. An app bar (a title of 14 characters or fewer, one line of context, up to two actions) and a one-column body with 16px gutters. At the bottom of a top-level screen, a tab bar of three to five tabs, each an icon and a label, with the one primary action as a pill floating above it at the end side. On a deeper screen, a dock holding the one primary action. The body ends with room for what floats: nothing at rest lies under it.' },
  { id: 'M2', says: 'The first screenful answers three things, in this order: where I stand (the state, on the hero, two fifths of the height at most), what I do now (the action, always in view), what it rests on (the first evidence). The rest scrolls.' },
  { id: 'M3', says: 'One figure. One thing on the screen is at figure size. Two values compared sit in one comparison block: one surface, the same size, the difference said once.' },
  { id: 'M4', says: 'Say it once. A date, a round, a gap, a name with its score appears once on a screen. The app bar\'s title is not repeated in the body.' },
  { id: 'M5', says: 'Containers. A card (E4) holds one object or one group; a section is a text-lg heading and its cards, 24 to 32px apart. No card in a card. A container is as tall as its content, never stretched to match a neighbour.' },
  { id: 'M6', says: 'Lists. Things of one kind are rows on one card, not a card each: 56 to 72px tall, a leading avatar or icon tile of 40px, a text-base title at 600, one text-sm line of meta, a trailing value or chevron, dividers inset to the text. Three to six rows show on the first screen.' },
  { id: 'M7', says: 'Density and rhythm. Besides rows, the app bar and the tab bar, at most seven things can be pressed on the first screenful. A screen mixes kinds of block (the hero, a strip that scrolls sideways, a grid of two tiles, a short list): never one list or one table from top to bottom.' },
  { id: 'M8', says: 'Stats. A label (text-xs at 500) with its value (text-xl to text-3xl at 700, tabular) and the unit at about 60% of the value\'s size. Three in a row at most.' },
  { id: 'M9', says: 'Charts and instruments. When the product is about a trend or a measure, its instrument is the focal block. Draw the periods that have data and the next one: no grid of empty future. Label a line on the line, not in a floating box. One accent series; the rest ink, muted or the second colour.' },
  { id: 'M10', says: 'Input. Three fields or more: one question a screen. A field is 48 to 52px tall, label above (text-sm at 600), help below; numbers get the number pad; a small set is a segmented control or a stepper, not a dropdown; pickers open in a sheet.' },
  { id: 'M11', says: 'Answering back. A toast sits above the dock for three to five seconds with undo; an error appears beside its cause; a skeleton has the shape of what is loading.' },
  { id: 'M12', says: 'Empty, and first run. One small drawing of the thing that will be here (E2), one line, and the one action. No onboarding cards.' },
  { id: 'M13', says: 'Moving around. Push to go deeper (back at top left), a sheet for a side task, a full screen for long writing, tabs for three to five peers, a segmented control for two to four views of one data set.' },
  { id: 'M14', says: 'The hand. Primary action at the bottom; targets 44px or more, 8px apart or more.' },
  { id: 'M15', says: 'Motion. One entrance, an answer to each press, and the moment the outcome lands, once.' },
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
  { id: 'P6', says: 'Navigation. The wordmark is text in the product\'s face at 700 or 800; five links at most; one action.' },
  { id: 'P7', says: 'Proof and numbers are real or absent. The price is said plainly.' },
  { id: 'P8', says: 'On a phone a page is one column: the headline, the working thing, the action.' },
  { id: 'P9', says: 'A hand-made mark: one at most, tilted 12 degrees at most.' },
  { id: 'P10', says: 'The footer is quiet.' },
];

const APP: readonly Rule[] = [
  { id: 'A1', says: 'Shell. A side navigation 220 to 256px wide with five to eight items, or a top bar when there are five sections or fewer. The content\'s width follows the job: a table takes the width, a form 560 to 640px, reading 720px.' },
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
  { id: 'I1', says: 'Decide in this order. The product\'s own working thing and its data are drawn in code, and so are its people, its things and its icons (E2, E3). If the subject has a look people come for (food, a place, a room, goods, a face, the world of a game), its picture is content: have a small matching set made with generate_image.' },
  { id: 'I2', says: 'Never made: a stock scene, a 3D blob, abstract gradient art, a drawing of an interface, an emoji as an icon, a picture that names nothing this product has.' },
  { id: 'I3', says: 'Proportions: a thumbnail 1:1, a card picture 4:3 or 3:2, a hero 16:9 or 3:2.' },
  { id: 'I4', says: 'One set, one direction: the same light and distance, colours toward the theme, no words in the picture.' },
  { id: 'I5', says: 'How many: one for a mock-up direction; for a build, six for the fixtures and one hero at most.' },
  { id: 'I6', says: 'Words on a photograph sit on a plate or a scrim, never on the bare picture.' },
  { id: 'I7', says: 'Icons come from one set (lucide), with a 1.5 to 2px stroke: in ink when bare, in the tile\'s colour on a tile, in the accent when active.' },
];

export const HANDBOOK = { type: TYPE, colour: COLOUR, material: MATERIAL, mobile: MOBILE, parts: PARTS, page: PAGE, app: APP, pictures: PICTURES } as const;

const SECTIONS: Record<'mobile' | 'web', readonly { title: string; rules: readonly Rule[] }[]> = {
  mobile: [
    { title: 'Type', rules: TYPE },
    { title: 'Colour', rules: COLOUR },
    { title: 'What a screen is made of', rules: MATERIAL },
    { title: 'Composing a phone screen', rules: MOBILE },
    { title: 'Parts', rules: PARTS },
    { title: 'Pictures', rules: PICTURES },
  ],
  web: [
    { title: 'Type', rules: TYPE },
    { title: 'Colour', rules: COLOUR },
    { title: 'What a screen is made of', rules: MATERIAL },
    { title: 'A page', rules: PAGE },
    { title: 'An app screen', rules: APP },
    { title: 'Pictures', rules: PICTURES },
  ],
};

const platformOf = (template: Template): 'mobile' | 'web' => (template === 'mobile-expo' ? 'mobile' : 'web');

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
  const body = SECTIONS[platform]
    .map((section) => `${section.title}.\n${section.rules.filter((rule) => rule.on === undefined || rule.on === platform).map((rule) => `${rule.id}. ${rule.says}`).join('\n')}`)
    .join('\n\n');
  return `<design_handbook>
How a screen is put together here. Each rule is a default with its numbers: depart from one only for a reason that comes from this product's subject, and say so when you finish. The audit measures several and the reviewer judges by all, each by its number.

${body}
</design_handbook>`;
}
