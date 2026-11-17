# What planning hands to design

The plan of a product's screens is written as files, in words, and a designer draws from them. Planning decides what each screen says and does; design decides how it looks and where things sit. A plan that draws boxes takes the designer's decision before any reference has been looked at, and is drawn twice: write no layout, no colours, no part names, no wireframe.

Planning is not held to a clock. It is held to these rules, and to how shipped products do the same journeys.

## Before writing: how shipped products do it

For each journey this product has (the first run, the product's one moment, what a person does every day, how it ends and starts again), look at how two or three shipped products of the same kind take a person through it, step by step. The house library first: `sz-eyes refs kinds` lists what earlier work kept, and a journey is kept under a kind named for it ("온보딩 흐름", "초대 흐름"); `sz-eyes refs kind "<kind>"` gives its page and its entries. Search only for the journeys it does not hold. With Mobbin connected: `search_flows`, one journey a query, searched by the kind of journey and the kind of app and not by an app's name (load the `mobbin:search` skill first and follow it). A query carries only generic words: never the owner's product name, texts or data. Each flow you take something from goes into the library, so that the next plan has it without searching: `sz-eyes refs add --kind "<journey> 흐름" --product "<product>" --what "<the journey>" --link <its mobbin_url> --image <its image_url> --notes <a file saying its steps in order and what you took>`, and the kind's page is rewritten when it has gained entries.

Take from them what decides structure: how many steps before a person does the real thing, what is asked and what is put off, which sections sit in the tab bar, where the daily action lives, what the screen after the main action offers. Write what was taken in `frame.md` under 본 것, each with the product and its link. A step count, an order, a section: these are taken. Their words, their look, their numbers are not.

With no reference tool connected, the library is the source; where it has nothing, say so in that section and decide from the request alone.

## `.sz/plan/frame.md`: written first, whole, before any screen

1. **무엇이고 누구를 위한 것인가.** Two or three sentences: who, at what moment, doing what.
2. **반드시 잘해야 하는 한 가지.** The one thing. The designer builds the product's key screen around it. Then what it needs to be real, found before any screen is written: each key, source of data or service on its path (what a person gives, what is done with it, what they get back), where it was found (the address), and whether it is at hand (`sz-eyes secret has <vault id>`). Look for a public source, an open API, a free key the owner applies for; "not connected yet" is not an answer. What is not at hand is asked of the owner at the drawing, each with what it costs them and how it is given (a key: its vault id, and the command that prints the owner's line for it, `sz-eyes arm need <arm>` or `sz-eyes secret has <vault id>`; never a storing line of your own, which fails in the owner's shell).
3. **주인이 말한 것.** The owner's answers and words about feel, as they said them, and any product they named.
4. **본 것.** What shipped products do in these journeys, as above.
5. **시나리오.** Three to six, each as the steps one person takes, from opening the app to the outcome. Every screen in the list below is passed through by at least one of them: a screen no scenario reaches is not in this version.
6. **정보 구조.** The sections a person moves between (on a phone, the tabs: three to five) and what lives under each; what is reached from where; what is outside the sections (first run, sheets, the screen after an action).
7. **화면 목록.** One line a screen: an id (`HM-01`: two letters for the area, a number), its name, the section, what it is for, its states by name.
8. **흐름.** Each scenario as a row of screen ids with what is pressed between them: `HM-01 —대결 시작→ MT-01 —상대 찾기→ MT-02`.
9. **규칙과 숫자.** Every rule a screen shows and every limit that shapes a screen: the longest name, the longest sentence a person may write, the largest figure, how a score is worked out. A limit nobody stated is decided here and marked as decided here.
10. **아직 진짜가 아닌 것.** What a screen must say plainly is not real yet, an entry each in four parts: what it is; which of four reasons (`owner`: a key, an account, money or publishing only the owner can give; `people`: others not there yet, partners, reviews, the other side of a market; `device`: a device, a store's review or a machine this Mac does not have; `later`: the owner said later, in their words); what was tried and found (the address looked at, what `sz-eyes secret has` said); what it needs to be real, and from whom. "Not connected yet" and "nobody has read it yet" are not reasons: finding the source and reading it is the work. Never on it unless the owner said so, quoted: anything on the one thing's path, and anything the request names. What is built for real and only waits for people (an empty list with its plain line) is real.

## `.sz/plan/screens/<NN>-<id>.md`: one file a screen, ten to twenty-five lines

Written in the order of the product's main path (`01-…` first), each whole when it appears: write it under another name and rename it, so that a designer waiting for it never reads half a file.

- **이 화면이 하는 말.** One sentence a person would agree the screen says to them.
- **보이는 것.** What is on it, most important first, as content: "내 점수와 상대 점수, 그 차이, 남은 날". Never where it sits.
- **할 수 있는 것.** Each action and where it leads (a screen id, or what changes on this one). The one main action is named as the main one.
- **상태.** Each state by name with what it shows: first use or empty, the usual one, waiting, failed, ended.
- **예시.** Example values a designer can put on the screen as they are, in the product's language: names, figures, a sentence a person wrote. For everything a person types or a figure that grows, also the longest value the rules allow.
- **글.** The few lines of copy that matter (the headline, the main button, the empty state's line), in the product's own words: a sentence a person would say, a button that names its outcome.

When the last screen is written, an empty file `.sz/plan/screens/DONE`.

## What is not written

A screen spec is not a document for a meeting: no revision history, no table of contents, no personas beyond section 1, no success metrics, no notification catalogue unless a screen shows it, no PDF. What the build has to prove is the contract's business, not this plan's.
