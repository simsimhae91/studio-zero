---
name: taste
description: Use when building or changing anything a person looks at (a screen, a page, a game's interface) in a product that is being made from scratch or that asks for a design pass. How a screen is put together so that it reads as made for its subject and not as generated: one idea, one figure, one hero, real things on the first screen. Not for a product that has its own design system unless the owner asks.
---

# Taste: a screen made for its subject

The owner's premise: a product with a bug loses a user; a product that looks generated never gets one. The standard is the consumer products people call alive: a game maker's store, a shopping app, a live-streaming service, a neighbourhood marketplace, a finance app. What they share is not a style. Each screen is built around one thing that is real, said in the product's own words, with colour and type doing a job.

## When this applies

- **A product made from scratch here:** all of it. Read the handbook for the kind of product before the first screen: `references/handbook-phone.md` (a phone app, a mini-app in a web view) or `references/handbook-web.md` (a web page or tool).
- **A product that already has its own design system** (brought in, or the owner's own): its design is its own. Follow it. From this skill take only the last section below, and only as questions to ask of your change.
- **A game:** the handbook's rules about type and text apply to its interface (menus, HUD, results); what is on the playfield is the game's own.

## The handbook in six lines

1. **One idea, from the subject.** Before layout: what is this product about, and what is the one thing on this screen that matters most? That thing is drawn large and first. Two products made here must not look alike because they were made here.
2. **One figure, one hero.** One number or word set as display type; one band or card in the product's own colour that holds its state. Everything else is quieter.
3. **Something real on the first screen.** The working thing with its data (a ring that fills, a table that sorts, the map with its pins), not a headline over a paragraph and a button. A person can do something real before reading anything.
4. **Type has roles, colour has roles.** One typeface. Each size is for one kind of thing; small grey text is for labels and units, never for what the screen exists to say. Strong colour is the hero, the primary action and what is selected, and nowhere else.
5. **The product's own words.** Every string is something this product says to this person at this moment. No slogan for a title, no button that could sit in any product, no sentence that explains the screen.
6. **Nothing by habit.** A gradient hero with a big number, identical rounded shadowed cards in a row, an all-caps label over every heading, emoji as icons, entrance animation on everything: each is fine when the content calls for it and a defect when it is there by habit.

The handbook files give each of these its numbers (sizes, weights, shares of a screen, counts): build to the numbers, and depart from one only for a reason that comes from this product's subject, saying so.

## In a contract

Taste is not proven by a test. In a contract it appears as:

- one or two claims a person can check by looking, each shown by `look` with a named state and written concretely ("첫 화면에서 가장 큰 글자는 오늘 점수다", "색이 강한 곳은 점수 카드와 '적기' 버튼뿐이다");
- one claim shown by `owner`: the screen reads as made for this product. The verifier attaches the pictures; the owner decides.

The measurable part is measured: `sz-eyes web look <url> --house` adds the handbook's measured rules (type scale and weights, share of small text, share of strong colour, what is turned or stacked, a card stretched half empty) for a product built on the studio's own theme. Without `--house` only what is true of any product is measured.

## Questions to ask of any change (any product)

- What is the first thing the eye lands on, and is it the thing that matters most here?
- Could this screen belong to any product, or only to this one? Which element says so?
- Is every label on one line, every figure whole, nothing cut off at the narrowest phone?
- Did the change add a colour, a size, a weight or a corner radius the screen did not already have? Why?
- Read the words back without the styling. Would the product's own user say them?
