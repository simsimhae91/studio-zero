/**
 * The house bar: what a first screen is checked against here before it is called done, said to the engines that
 * draw and build and to the reviewer that judges, in the same words.
 *
 * It is not a style. It was read out of work the studio's owner pointed at as good (2026-11-13), which shares
 * no colour, face or layout: a talk-to-it video editor (agentshot.si), a presenter's menu-bar helper
 * (usekuroko.com), a mouse finder (shapefinder.cc), an archive of a record-shop series (whatsintheirbag.com),
 * a terminal for coding agents (novadeck.dev), a gallery of components (forevercomponents.com), an engineer's
 * portfolio (hakonfreyr.com) and a notes app (getbraindump.com). Each was opened in the studio's own browser
 * and measured the way a reference is (`summariseReference`); what is written below is what they have in
 * common, as principles. Their numbers, palettes and marks stay theirs: a build that copies a reference's
 * values carries its smell (see `AnchorTable.ts`), and none of the sites is named to an engine.
 *
 * For a phone the owner's reference is the Apple Design Awards. The mobile bar is those awards' own
 * categories, in Apple's words for what a winner does (newsroom, June 2026), turned to what this studio can
 * build and look at: an Expo app, audited through its web target.
 */
export const HOUSE_BAR_WEB = `What that has looked like. The work this studio's owner points at as good shares no colour, typeface or layout, and comes down to the same few things. Check the first screen against them before you call it done.
1. One idea from the subject, carried into the small parts. Not a layout with a palette on it: what the product is about decides the vocabulary of the whole screen, down to how rows are numbered, what a label is called and what the one decoration is made of. An engineer's page drawn as a drawing sheet has a title block and a revision mark; a tool for marking up a screen marks up its own headline.
2. The real thing is on the first screen, and it works there. The product itself with real content in it and something to operate, or the first step of the task: a finder opens on its first question, not on a sentence about finding. Never a picture of a product that does not exist, an abstract shape or a stock scene in its place.
3. One typographic gesture carries the screen. A single line set several times the size of the running text, in the product's one face at a heavy weight, set tight (leading near 1, tracking a little negative at that size). Everything else is quiet and easy to read: running text at 16px or more, 45 to 85 characters a line. One face throughout; monospace only for code.
4. Colour is a clean neutral and one or two colours at full strength, flat: the strong colour in few places, meaning something each time (the one action, a mark, a figure). No gradient on a control. A gradient is weather in the background, or it is absent.
5. Shape is one decision, held. Square everywhere, or soft everywhere, or pills for actions on soft cards: chosen for this product. Never the same medium radius on everything because nothing was decided.
6. One thing made by hand. A mark that breaks the grid on purpose and is made of the product's own vocabulary: a tilted label, a ring drawn round a word, a word struck out, something looking over an edge. One or two a screen, never a scatter.
7. Words with a point of view. Short sentences to one person, concrete nouns and real numbers, and the nerve to say what the product is not. The price, or the catch, said plainly.
8. Density follows the job. A tool starts at once and explains nothing. A page that has to persuade gives each section one idea and one thing to operate or to look at.
None of this is a look to copy: two products held to it should still look nothing alike.`;

export const HOUSE_BAR_MOBILE = `The bar for a phone app is the one the Apple Design Awards hold, in the terms of their own categories.
- Interaction: "intuitive interfaces and effortless controls", tailored to the platform. A phone's own patterns, not a web page's in a phone frame: a stack that pushes and swipes back, sheets, pull to refresh, a long press for what is secondary. The first run teaches by letting the person do the thing; there is no wall of onboarding cards before it.
- Visuals and graphics: "skillfully drawn interfaces" and animation with a cohesive theme of the product's own. The subject's data is drawn as the instrument that fills the screen (the tide as its curve, the moon as the moon), the palette comes from the subject and may follow its state, and what moves is the data, not decoration.
- Delight: an experience that is "memorable, engaging, and satisfying". The moment the task lands is designed (a movement, a haptic, a line with some character), once, where it has been earned.
- Inclusivity: "a great experience for all". Text follows the system's size setting and the layout survives the largest; nothing is said by colour alone; every control has a spoken name; motion steps down when the system asks. Never switch font scaling off.
- Practical first. The award-winning tide chart is still read in a second: one glance answers the question the app exists for.`;

/** The version of Modern Web Guidance the engines are given. Pinned: what runs in a sandbox is not "whatever is latest today". */
export const WEB_GUIDANCE_VERSION = '1.0.0';

export const WEB_PLATFORM = `Platform first. Before you hand-write a behaviour the browser may already have, ask web_guidance (search for the need in plain words, then retrieve the guide that fits) and build it the way the guide says, fallback included. That covers what opens over the page or folds away (dialog, popover, menu, tooltip, drawer, toast, accordion, tabs), carousels and effects tied to scrolling, form validation and autofill, entry and exit animation and view transitions, placing one element against another, how text wraps and what a font falls back to, and light and dark colour. The habit is a library or a page of script where an element or a few lines of CSS now do it, with the focus handling and dismissal that hand-written code gets wrong. Build for what is Baseline widely available unless the guide gives a fallback. Before you stop on a build, run web_guidance with action "scan" and act on what holds under its own keep and drop conditions; what it lists is provisional, not a verdict.`;
