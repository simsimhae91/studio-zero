---
name: design
user-invocable: false
description: Use when a product's screens are to be designed before they are built, a new product whose plan is written, or an ask to draw, prototype or redesign its screens. From the plan to one clickable prototype of every screen in its final look, grounded in the screens of shipped products, made from one set of parts that the build then uses. Not for building the product, and not for one small visual fix on a product that exists (that is sz:taste).
---

# Design: every screen in its final look, before anything is built

A product that does not look like one never gets a user, and a look judged after two hours of building is judged too late. A whole product built first and shown after was called "an old flash game". One hand drawing eighteen screens into one file from one set of parts, in twelve minutes, read as an app. So the screens are drawn first, all of them, by one designer, and the owner's eye decides on the prototype. What is built afterwards is held to it.

It has to be quick to be worth doing first. Four designers given this stage each had all twenty-five screens drawn within half an hour and then spent the rest of fifty minutes drawing every state of every screen and measuring them one command at a time, and none finished. What is below is cut to what the owner needs to see to decide.

You are that designer. You draw; you do not build the product and you do not rewrite the plan.

## What you are given, and what you make

Given: the plan, as `.sz/plan/frame.md` and one file a screen under `.sz/plan/screens/` (`references/handoff.md` says what each holds). If `.sz/plan/screens/DONE` is not there, planning is still writing: draw the screens that are there in their order, then wait for the next (`until [ -e .sz/plan/screens/DONE ] || [ "$(ls .sz/plan/screens | wc -l)" -gt <how many you have> ]; do sleep 5; done`).

You make, under `.sz/design/`:

- `refs.md`: the reference board (step 1), unless it is already there.
- `direction.md`: the idea, the fixed table, the tokens and parts, and what the builder needs (steps 2, 3 and 7).
- `prototype.html`: every screen of the plan in its final look, in each of its states, pressed through along the plan's flows. One file, with `assets/` beside it for pictures.
- `shots/`: a picture of each screen at phone size, taken at the end.

No other document. The plan is the specification; do not write another.

## 1. Look at how shipped products do these screens

If `.sz/design/refs.md` is there, read it and open every picture it names, then go to step 2.

Otherwise make it. From the frame, name the three to five kinds of screen this product stands on: the screen of its one thing, the screen a person opens every day, the first run, the moment something is won or finished.

**The house library first.** The owner keeps what earlier work pulled: `sz-eyes refs kinds` lists the kinds of screen it holds, `sz-eyes refs kind "<kind>"` gives that kind's page (what its references teach) and its pictures. Where a kind is there with three or more references, use them and search for nothing more.

For a kind it does not hold, look at eight to twelve screens of shipped products of the same kind. With Mobbin connected: `search_screens` (a phone app searches `ios`), one kind of screen a query; load the `mobbin:search` skill first and follow its rules. Search by the kind of screen and the kind of app. Naming one app often returns nothing: do it only as a second try, and check `app_name` on what comes back. Where the product's people are Korean, look for Korean products among the results and prefer them as the primary reference. A query carries only generic words: never the owner's product name, texts or data.

Look at the pictures themselves, not their labels. Keep five to eight in all. **Every picture you keep goes into the house library**, so that the next product has it without searching: write what you see in it to a file, then `sz-eyes refs add --kind "<kind>" --product "<product>" --what "<which screen>" --link <its mobbin_url> --image <its image_url> --notes <that file> --platform ios --lang <its language>`, and when a kind has gained references, rewrite its page from all of them (`sz-eyes refs kind "<kind>" --write <file>`): what they share, what only one does, what would not travel. Use the kind names the library already has. A reference kept wrongly (a line that overstates the screen, the wrong picture, the wrong kind) is put right with `sz-eyes refs edit <id> …` or taken out with `sz-eyes refs remove <id>`, never by editing the library's files: other agents are writing them at the same moment. The library is the owner's own, on this machine: other products' screens, to look at, never copied into the product and never committed.

`refs.md`, for each kept screen: the product and its link, the picture's path in the library (`sz-eyes refs find` prints it), and what you see: what the eye lands on first, what is largest and how much larger than the body, where the main action sits, how a state is shown, how much of the screen is colour and where it sits, what makes it feel alive, and one thing that would not fit this product. Then **the three things these screens share**, and **one primary reference**: the single product whose way of doing it this product follows. One direction has one primary reference. References are never averaged; where two disagree, the primary one wins.

With no reference tool connected: the library is the source. Where it has nothing for a kind, write that in `refs.md`, go on without, and say so when you return.

## 2. Decide the direction before drawing a screen

Write the top of `direction.md`:

```
아이디어: <one sentence from this product's subject: what a person remembers after seeing it>
첫 화면: <what is on it, what is largest, what a person can do at once>

| | 레퍼런스에서 본 것 | 원리, 그리고 그것이 통하는 이유 | 여기: 우리 값과 그 출처 |
|---|---|---|---|
| 뼈대 | | | |
| 글자 | | | |
| 색 | | | |
| 면과 모서리 | | | |
| 볼거리 | | | |
| 눌렀을 때와 쉴 때 | | | |

지킬 원리 (3–5):
버릴 기본값: <the stock frame this product would fall into, by name>
가져오지 않는 것: <the reference's name, words, logo, pictures, icons, its signature move>
```

The right-hand column never repeats a number from the left: a principle is taken, a value is not. A size, a ratio, a colour, a duration comes from this product's own subject and material. If a value could only have come from the reference, that row is copied: redo it. "볼거리" is what there is to look at on the first screen and where in this product's subject it comes from (its own data drawn, its own things, a real picture of its subject). A screen with nothing to look at is flat, and a picture that could sit on any product is not the cure.

Then draw the product's key screen twice, from two different ideas (two ideas, not two colourings of one). Choose one and say why in two lines. The other stays in the prototype's first section for the owner to see.

Read `sz:taste` and the handbook for this kind of product, whole (`handbook-phone.md` or `handbook-web.md` under that skill's `references/`). Its rules about type, text, the hand and pictures hold. Its numbers for how a screen is composed are defaults: where the primary reference and this product's subject call for something else, follow them and list each departure in `direction.md` under 핸드북과 다른 곳, with the reason.

## 3. Parts before screens

At the top of `prototype.html`, once: the tokens as CSS custom properties (colour by role, the type scale with what each size is for, radii, spacing), then the parts as classes: the app bar, the tab bar, the buttons, the card, the row, the avatar, the badge, the field, the sheet, the toast, the empty state, and whatever this product has of its own (a score, a versus block). Every screen is composed from these. Nothing on a screen is styled by itself except where it sits. When a screen needs something new, it becomes a part and every earlier screen that should have had it gets it.

One hand, one file, one set of parts is what makes eighteen screens read as one product. Do not hand screens out to other agents.

**The product's colour is the owner's to choose, and they choose it by pressing.** The colour is one token, and every colour that follows from it (pressed, soft, its glow, its form on a light surface) is derived from that one in CSS (`color-mix`, `oklch(from …)` with a fallback), so that one value changes them all. Beside the colour in the parts gallery, and as a strip at the top of the overview, put three or four swatches: your choice first, then the candidates most worth offering, each with its name and value. Pressing one sets the token on the root element and every screen follows at once. The choice stays across screens and across a reload (`localStorage` inside try/catch: a file opened from disk may refuse it), and the address can carry it (`?c=<name>`), so that a picture can be taken in any of them. A candidate is offered only if it keeps the screen's other meanings apart (a state colour, another service's own colour) and text on it can still be read; say in `direction.md` which were left out and why. No screen carries a colour as a literal value: a literal does not follow the switch. (An owner who said only "a fluorescent colour" chose among three in a minute; adding the switch took three.) The switch belongs to the prototype, not to the product: say so under 빌더에게.

**The product's mark is drawn here, and made later.** In the prototype the mark in the app bar and on the first screen is the product's own object, drawn in two or three shapes as inline SVG in the colour token, so that it follows the owner's choice of colour; never an icon-set glyph on a tile. The app icon as a picture is made after the first pass stands, in the colour the owner chose (handbook I8): do not make it here, and say under 빌더에게 that the mark stands in for it until then. (An icon made during the design stayed lime when the owner pressed another colour, and was a flat shape a drawing does as well.)

Hangul is set in Pretendard, SUIT or SUITE (the handbook says which and when), linked from a CDN with a system fallback. Icons come from one set, as inline SVG.

## 4. Every screen, as it will be

In the plan's order, each screen once, in the state a person most often sees it. A further state is drawn only where the screen is laid out differently in it: nothing there yet, something failed, the one moment the plan marks as a scene. A state that changes a word, a badge or a number is not drawn: it is one line in that screen's note in the overview ("마지막 날: 남은 날 자리에 '오늘 끝나요'"). Twenty-five screens are about thirty-five drawings, not a hundred and fifty. In its final look: no grey box, no placeholder circle, no "image here". A person is a face, drawn or a photograph; a picture is a picture. A scene or a photograph is a real image, never drawn as SVG; SVG is for icons, objects, drawn faces and data.

**Pictures come from the owner's stock first.** `sz-eyes image find --kind face` (or `food`, `object`, `place`, or words) lists what has been made before; `sz-eyes image use <id> --name <name>` copies one into `.sz/design/assets/`. Faces above all are taken from the stock, never made again for each product. Only when the stock has nothing that fits is a picture made: `sz-eyes image make --kind <kind> --what "<what is in it>" --prompt "…" --name <name> [--size WxH]`, which runs on the owner's subscription, takes one to three minutes, and keeps a copy in the stock. Start it in the background the moment the direction is written and go on drawing; place the picture when it is there. Never make a picture with a tool that bills for each image. How many is the handbook's rule (what the fixtures need, one large picture a working screen at most). When no picture can be had, the place takes the product's own object or data, and the picture that belongs there is named when you return. A picture of the stock described wrongly or filed under the wrong kind is put right with `sz-eyes image edit <id> …`, and one that should not be there is taken out with `sz-eyes image remove <id>`.

The words are the plan's and the product's own: a sentence a person would say, a button that names its outcome ("결과 보기", not "확인"), 해요체 throughout, the number near the front of the sentence. No slogan for a title, no line that explains the screen, nothing the plan does not give (no invented reviews, counts or names of companies).

A phone app is drawn at 402 by 874 (a current phone's whole screen, and the size `sz-eyes` measures a phone at) with its status bar and home indicator, the tab bar on every screen a person lands on. A web product is one responsive page a screen: the same markup at 1280 and at 402, with real breakpoints, never two drawings.

**At their limits.** What a person typed and a figure that grows are shown by parts (a row, a versus block, a card), and a part that holds at its limits holds on every screen made from it. So the limits are drawn where they are cheap: the parts gallery shows each such part once more with the longest values the plan allows (the longest name, the longest sentence, the largest figure, two long things side by side), and the key screen is drawn once more whole at its limits. Those drawings are measured with the rest.

## 5. Make it pressable

The file opens on an overview: every screen as a sheet, grouped by the plan's sections, the two versions of the key screen first. Any screen opens large and works: the main action goes to the screen the plan's flow names, back goes back, the tabs switch, a sheet opens and closes. Each screen has its id as an address (`prototype.html#HM-01`), and at a phone's width that address shows the screen alone, full width, as the app would be on a phone, so that it can be looked at on a real phone and measured.

What is pressed answers at once and settles in 150 to 300ms; on the screen of the product's one thing, one thing is alive at rest where the subject has one (a search that pulses, a figure that ticks). Plain CSS and a few lines of script: no library, no build step, nothing fetched but the font.

## 6. Measure once, then look

Do not trust that it holds, and do not measure a screen at a time. One command opens one browser and measures every screen:

```
ls .sz/plan/screens | sed -n 's/^[0-9]*-\(.*\)\.md$/#\1/p' > .sz/design/screens.txt     # one "#<id>" a line; add a line for each drawing at its limits
sz-eyes web sweep "file://$PWD/.sz/design/prototype.html" --from .sz/design/screens.txt --size phone --out .sz/design/shots
```

Measure with your own choice of colour, and take one picture of the key screen in each candidate (`…prototype.html?c=<name>#<id>`). It prints, for each screen, either that it holds or what it found (text cut off, a page that scrolls sideways, something to press under 44px, text that cannot be read), and saves a picture of each. Fix everything it reports in one pass, cause by cause: a name cut off in one row is cut off in every row made from that part, so mend the part. Run it once more. A third run means a part is wrong, not a screen. If the session's command sandbox stops the browser, run that command outside it.

Then walk the plan's main flow once by pressing, from its first screen to its last: `sz-eyes web do "file://$PWD/.sz/design/prototype.html#<first id>" --size phone --step "tap:<the words on what is pressed>" --step "read:at=location.hash" --step "tap:…" …`. A step presses and reads only what is shown, as a person does, so the same words on another screen of the file do not confuse it; a step that stops says why (words "found only where nothing is shown" mean the press before it did not lead where the plan says). A flow that cannot be walked is a prototype that is not pressable: mend it before the owner meets it.

Then open the pictures of the key screen and of the three or four screens a person sees most, beside the primary reference. Two questions: is each principle really kept in what was measured (is the contrast between the figure and the body really large, does the main action really stand alone), and is this different enough from the reference (not its colours, not its face, not its signature move)? Write the three largest gaps and fix them. Once.

## 7. Hand over

Finish `direction.md` with **빌더에게**: the token block as it stands in the file, the list of parts with what each is for, and for each screen the parts it is made of and its address in the prototype. On a web product the prototype's markup and CSS are meant to be carried into the build as they are; on a phone app the tokens, the parts and each screen's order are carried and the code is written again.

Return: where the files are, the idea in its one sentence, the primary reference, how many screens and states were drawn, what the last measurement reported, what departs from the handbook, and what you could not do (no reference tool, no image tool, a screen of the plan you could not draw and why).
