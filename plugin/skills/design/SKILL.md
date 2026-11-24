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

Given: the plan, as `.sz/plan/frame.md` and one file a screen under `.sz/plan/screens/` (`references/handoff.md` says what each holds). If `.sz/plan/screens/DONE` is not there, planning is still writing: draw the screens that are there in their order, then wait for the next (`until [ -e .sz/plan/screens/DONE ] || [ "$(ls .sz/plan/screens | wc -l)" -gt <how many you have> ]; do sleep 5; done`). If nothing new has come for twenty minutes, planning has failed: stop waiting, and say in what you return which screens of the frame never came.

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
| 색 — 표면과 잉크 | | | |
| 색 — 포인트 | | | |
| 면과 모서리 | | | |
| 볼거리 | | | |
| 눌렀을 때와 쉴 때 | | | |

지킬 원리 (3–5):
표면: <이 제품의 종이가 온 재료 — 형광등 아래 진열대 / 영수증 종이 / 밤의 화면 / 흙 / 먹 / 유리> · 종이 L·hue 한 끗 · 잉크 <검정이 아닌 값>
온도: <따뜻함 / 차가움 / 중성 / 어둠> — <이 제품의 무엇이 그 온도를 부르는가>
버릴 기본값: <이 제품이 빠질 기본 골격, 이름으로> 그리고 <흰 바탕(#FFFFFF·#F8FAFC·#F7F7F8)에 인디고 #4F46E5 · 블루 #2563EB · 바이올렛 #8B5CF6 · 민트 #10B981 중 하나를 포인트로 쓰는 조합. 이 조합을 골랐다면 제품의 재료에서 온 이유 한 줄>
비워 둔 것과 정한 것: <brief가 비워 둔 배치마다 어디에 두었는지, 이유 한 줄>
빌더에게 넘긴 것: <아직 정하지 않은 입력·구현 세목마다 빌더가 지켜야 할 제약 한 줄>
주인이 고른 테마: 아직 없음 (내가 고른 것: <name>)
가져오지 않는 것: <the reference's name, words, logo, pictures, icons, its signature move>
```

The right-hand column never repeats a number from the left: a principle is taken, a value is not. A size, a ratio, a colour, a duration comes from this product's own subject and material. If a value could only have come from the reference, that row is copied: redo it. "볼거리" is what there is to look at on the first screen and where in this product's subject it comes from (its own data drawn, its own things, a real picture of its subject). A screen with nothing to look at is flat, and a picture that could sit on any product is not the cure.

The brief's boundary also holds in the drawing. “이게 빠지면 다른 제품이 되는가?” Keep that spine or signature effect. “빌더가 이걸 완전히 다르게 정해도 같은 제품인가?” Keep the constraint and decide only the visual part here. The builder decides the input and implementation.

Some materials to start from; choose the actual values from the product in front of you:

| 도메인 | 재료에서 온 표면 | 온도 | 피해야 할 관성 |
|---|---|---|---|
| 심야 편의점 게임 | 형광등 아래 진열대, 야간의 어둠 | 차가운 흰빛과 어둠 위 형광 한 색 | 흰 바탕과 인디고 |
| 금융·정산 | 미색 영수증 종이, 먹색 잉크, 인쇄 잉크 한 색 | 따뜻한 중성 | 흰 바탕과 블루 |
| 건강·기록 | 종이 기록의 따뜻한 회백, 측정값의 한 색 | 따뜻한 중성 | 민트 그린, 병원의 푸른 흰색 |
| 도구·데이터 | 종이와 흑연 | 중성 | 보라색 그라디언트 |

Then draw the product's key screen twice, from two different ideas (two ideas, not two colourings of one). Choose one and say why in two lines. The other stays in the prototype's first section for the owner to see.

Read `sz:taste` and the handbook for this kind of product, whole (`handbook-phone.md` or `handbook-web.md` under that skill's `references/`). Its rules about type, text, the hand and pictures hold. Its numbers for how a screen is composed are defaults: where the primary reference and this product's subject call for something else, follow them and list each departure in `direction.md` under 핸드북과 다른 곳, with the reason.

## 3. Parts before screens

At the top of `prototype.html`, once: the tokens as CSS custom properties (colour by role, the type scale with what each size is for, radii, spacing), then the parts as classes: the app bar, the tab bar, the buttons, the card, the row, the avatar, the badge, the field, the sheet, the toast, the empty state, and whatever this product has of its own (a score, a versus block). Every screen is composed from these. Nothing on a screen is styled by itself except where it sits. When a screen needs something new, it becomes a part and every earlier screen that should have had it gets it.

One hand, one file, one set of parts is what makes eighteen screens read as one product. Do not hand screens out to other agents.

**A theme, not a colour, and the owner picks it by pressing.** A product's palette is three decisions (the paper,
the ink, the brand) and everything else follows by role: paper (`--bg-bg`), surfaces (`--bg-surface`,
`--bg-sunken`, `--border-border`), ink (`--text-fg`, `--text-fg-muted`), the brand (`--bg-brand`,
`--text-on-brand`, `--text-accent`, `--bg-brand-soft`), the second colour and the states (handbook C1). Declare all
of them once at the root and derive what follows with `color-mix` / `oklch(from …)` with a fallback, so that a theme
sets them together. No screen carries a colour as a literal value: a literal does not follow the switch.

Beside the tokens in the parts gallery, and as a strip at the top of the overview, put three or four **themes**.
Show yours first, then the same product warmer or cooler, a dark reading where somebody uses it at night, or one
further out that still keeps its meanings apart. Each has a name and shows its paper, ink and brand values. A press
sets the theme on the root element (a `data-theme` attribute with one rule per theme, or three custom properties).
Every screen follows. Save the choice across screens and reloads (`localStorage` inside try/catch: a file opened
from disk may refuse it). Update the address with `?t=<name>`, preserving the screen's hash. On opening, take a
known theme from the address first, then the saved choice, then the designer's default. A fresh browser opening
that address must show the same paper, ink and brand. Text has to be readable and state and service colours distinct
in every theme; say in `direction.md` which candidates were left out and why.

The stock choice is a white page with one indigo accent. If that is this product's palette, name the material that
gave you its paper, ink and brand in `direction.md`. The switch is for choosing in the prototype. The product is
built in the chosen theme. Keep the name from the address when the owner approves the drawing: after its screens
hold in that theme, the line becomes `주인이 고른 테마: <name> — <file:///…/prototype.html?t=<name>>`. Until
they pick one, including a run they let go on without judging the drawing, keep `아직 없음 (내가 고른 것: <name>)`.

**The product's mark is drawn here, and made later.** In the prototype the mark in the app bar and on the first screen is the product's own object, drawn in two or three shapes as inline SVG in the brand token, so that it follows the theme; never an icon-set glyph on a tile. The app icon as a picture is made after the first pass stands, in the colour the owner chose (handbook I8): do not make it here, and say under 빌더에게 that the mark stands in for it until then. (An icon made during the design stayed lime when the owner pressed another colour.)

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

Do not trust that it holds, and do not measure a screen at a time. One command opens one browser and measures every screen. Use the theme named in `direction.md`: the owner's choice
when given, otherwise the designer's own. Set `theme` to that theme's URL-encoded name in the command below.

```
ls .sz/plan/screens | sed -n 's/^[0-9]*-\(.*\)\.md$/#\1/p' > .sz/design/screens.txt     # one "#<id>" a line; add a line for each drawing at its limits
sz-eyes web sweep "file://$PWD/.sz/design/prototype.html?t=$theme" --from .sz/design/screens.txt --size phone --out .sz/design/shots
```

The sweep prints, for each screen, either that it holds or what it found (text cut off, a page that scrolls sideways, something to press under 44px, text that cannot be read), and saves a picture of each. Fix everything it reports in one pass, cause by cause: a name cut off in one row is cut off in every row made from that part, so mend the part. Run it once more. A third run means a part is wrong, not a screen. If the session's command sandbox stops the browser, run that command outside it.

Take the key screen's picture in each theme (`…prototype.html?t=<name>#<id>`), saved under its own theme name outside the canonical screen pictures, and read them side by side: is the whole screen's temperature this product's, or is one button coloured on a page that could belong to anything?

Then walk the plan's main flow once by pressing, from its first screen to its last: `sz-eyes web do "file://$PWD/.sz/design/prototype.html?t=$theme#<first id>" --size phone --step "tap:<the words on what is pressed>" --step "read:at=location.hash" --step "tap:…" …`. A step presses and reads only what is shown, as a person does, so the same words on another screen of the file do not confuse it; a step that stops says why (words "found only where nothing is shown" mean the press before it did not lead where the plan says). A flow that cannot be walked is a prototype that is not pressable: mend it before the owner meets it.

Then open the pictures of the key screen and of the three or four screens a person sees most, beside the primary reference. Two questions: is each principle really kept in what was measured (is the contrast between the figure and the body really large, does the main action really stand alone), and is this different enough from the reference (not its colours, not its face, not its signature move)? Write the three largest gaps and fix them. Once.

## 7. Hand over

Finish `direction.md` with **빌더에게**. Give the chosen theme's name from `주인이 고른 테마` (use the designer's measured theme name while the owner's choice is pending), the theme block as it stands (paper, ink, brand, and what follows from them), the remaining tokens, the list of parts with what each is for, and for each screen the parts it is made of and its address in the prototype. On a web product the prototype's markup and CSS are meant to be carried into the build as they are; on a phone app the tokens, the parts and each screen's order are carried and the code is written again.

Return: where the files are, the idea in its one sentence, the primary reference, how many screens and states were drawn, what the last measurement reported, what departs from the handbook, and what you could not do (no reference tool, no image tool, a screen of the plan you could not draw and why).
