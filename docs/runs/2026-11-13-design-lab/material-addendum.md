
---
# What a screen is made of (lab arm "material": where this differs from the handbook above, this wins)

The owner's references for this product are consumer apps that people call alive: a game maker's store, a shopping app, a live-streaming app, a neighbourhood marketplace, a finance super-app. Their first screens were measured on a phone with the studio's own ruler, beside the studio's recent pages:

| | pictures and drawn art | icons in view | text | boxes with a hairline border |
|---|---|---|---|---|
| the references | 15 to 60% of the screen | 12 to 28 | 3 to 21% of the screen | none or one |
| the studio's pages so far | 0% | 0 to 6 | 36 to 69% | every box |

The studio's pages are text and rules on grey paper. That is what the owner rejected as flat. Make this screen of the same material as the references: the concept, the scene, the data and the core flow stay exactly as your brief gives them.

E1. Material. At least a quarter of the first screen is picture or drawn art. People are avatars with a face or a character, not a name alone. Things are illustrated objects (the receipt, the scale, the coin, the shoe, the trophy). The state of the product (ahead or behind, money in the pot, a streak) gets one hero illustration. Draw them as inline SVG in one consistent style: flat, rounded shapes, two or three tones per object taken from the theme's brand, second and series colours, friendly proportions. They must read as finished illustrations, never as geometric placeholders, grey boxes or emoji.
E2. Icons. Every row, tab, chip and stat has an icon: a glyph in a rounded tile of 36 to 44px, tinted with a soft wash of a series colour. A top-level screen has a bottom tab bar of four or five icon and label tabs (the dock's primary action floats above it).
E3. A diet of text. Text covers a quarter of the first screen at most. Cut meta lines; say it with a picture, an icon, a number or a badge. One line of secondary text an item at most.
E4. Surfaces. The canvas is bg-sunken; content sits on bg-surface cards with a radius of 16 to 24px and no border (a soft shadow or nothing). Chips and buttons are pills. No hairline tables and no ruled ledgers: a list is rows on a card, with space or an inset divider between them. Use these radii whatever the theme's corner tokens say.
E5. Colour. Strong colour is welcome here: a fifth to a third of the first screen. Open with a band or hero card in bg-brand (text-on-brand) that holds the state; tint icon tiles and badges; give the other side the second colour. Tokens only, as before.
E6. Rhythm. Mix kinds of block on one screen: a hero card, a strip that scrolls sideways (cards or chips), a two-column grid of tiles, a short list. Never one table from top to bottom.
E7. Badges ride on things: a count on a picture, a state chip on a card, the points a row earned.
E8. Voice. The headline is a friendly sentence with the number in it; the figure is heavy (800) and large.

The check_mockup command still applies, except that in this arm you ignore its findings named color/flood, layout/too-many-controls and layout/nested-cards.
