---
name: trial
description: Use only when the owner asks for it, by the command /sz:trial or in words that ask for exactly this: the product tried or walked through as its users would ("유저 입장에서 써 봐", "end user proxy", "시나리오 완주해 줘", "대역으로 써 보고 돈 낼 만한지 봐 줘"). Wanting to charge for a product or take it to production is not a request for a trial, and nothing else starts one. Stand-ins for the people it is for use the product the whole way, coming back on later days and reaching the moment it asks for money, and what stands between a person and paying comes out ranked, with the screens that show it.
---

# Trial: would a person pay for this

The checkout does not sell a product. A person pays when the thing has already given them something, they have a reason to come back, and what is behind the price is worth more to them than what they use today. An owner who says "I want to charge for this" is asking first whether that is true, and when it is not, what would make it so. Building the payment before knowing is the commonest way to finish a product nobody buys.

**It starts when the owner asks for it, and then it is run, not described.** A trial takes several agents and minutes; the owner decides when one is worth that, by the command or by asking for exactly this. It is not started because they said something near it ("이거 돈 받고 싶은데"), and not as a step of other work. Once it is asked for: do not answer from your own judgement and do not ask again whether to run it. Say in one line that stand-ins will now use the product and about how long that takes, and start.

People to try it on are hard to find, and each can be spent once. So before any of them: stand-ins use the product the whole way. A stand-in finds where a person is stopped, confused or left with nothing. It cannot know whether they would want it. The trial says which is which, and ends with what to ask the real people.

Read `.sz/map.md` (how the product is opened and operated), `.sz/spec.md` or the README and the landing page (who it says it is for), `.sz/owner.md`, and the last trial if there is one (`sz-eyes trial show`).

## 1. Who

Write two or three people, from who the product itself says it is for. Each: who they are and the moment they arrive in (what they were just doing, what they want right now); what they use for this today and what that costs them in money or minutes (a product is compared with that, never with nothing); what would have to be true for them to pay. One of them is the doubter: someone it is said to be for who gets by fine without it. Not demographics: a moment. The three differ in their moment and in what they use today, not in their names.

**A card is made of real people's words.** A stand-in given five things that people in that place actually wrote behaves measurably more like them than one given a description. If the owner had a case made (`sz-eyes worth show` lists one), take them from its `who`, `gap` and `switch` quotations. If not, find five to ten first, yourself, from what anyone can read (a store's low ratings of what they use today, a thread where they ask each other); do not make a case for this. A card with none is marked on the page as made of no one's words, and what it guessed is read as lighter.

```
F=$(sz-eyes trial new)
sz-eyes trial person $F <id> --who "..." --instead "<what, and what it costs>" --pays-if "..." --voice "<their words>" --voice "..." --model opus|sonnet
```

Tell the owner the people in three lines and go on. They correct you if you have the wrong ones; that correction is worth having.

## 2. The stage

Each person gets a product of their own that nobody else has used: a copy of the data, a port from the machine, or for a desktop app its own data folder (`sz-eyes electron ... --data <trial folder>/<id>/data`, which also keeps what they did for the days that follow). Never the owner's own copy or data. What you try yourself to work the commands out (a first launch, a fault you want to see again) is kept under the trial's folder as well (`<trial folder>/_stage/`), never in a folder elsewhere on the machine.

Work out, and give each stand-in as exact commands:

- **how the product is opened** as this person would meet it, starting where people start (the landing page, the shared link, the first launch);
- **how a day passes.** Most of what decides whether someone pays happens on the second and the seventh day. A desktop app is started believing it is a later day, with nothing asked of the app: `sz-eyes electron ... --data <the person's folder> --days-later 1` (then 3, 7), which moves the clock of its main process and of every window. Closing it and opening it again is not a day passing: say `--days-later`, or the stand-in is shown the same day twice and reports what is not so. For anything else use the product's own way of moving its clock (a variable, a debug setting), or data put in place as it would be a week in. If the product has no way and time matters to it, that is the first finding, and the days after the first go untried;
- **the moment it asks for money**, and a test payment if the product has one.

## 3. Let them use it

Start one `sz:user` agent for each person, with their card (the voices in it, word for word), the price they will be asked, the commands above, and the trial's folder. Tell them nothing about how the product is built, what it is supposed to do, or what you hope they find, and nothing of each other. They may run side by side when each has a product of its own. Give them different models in turn (`model: opus`, then `sonnet`, and say which with `--model` on the card): two models that both meet a thing are worth more than one model meeting it three times.

**Plant one fault, where a person has a copy of the code of their own** (a worktree, or a desktop app's data folder): something on the main path a person would trip on (a button with its words removed, a failure that says nothing, an entry that is broken on the second day). Tell nobody. Afterwards: `sz-eyes trial canary $F --planted "<what>" --found yes|no`. A run that walks past a fault it was handed found little because it sees little, and the page says so.

## 4. Check what they found

A stand-in is right about what happened to it and often wrong about why. For each place one was stuck or lost: do it yourself on the product, once, and now read the code for the cause. What you cannot make happen again is still written down, as something one of them met once. Then write each thing that stands between a person and paying:

```
sz-eyes trial finding $F "<what, as the owner would say it, with the figure or the words on the screen>" --kind block|return|worth|pay --basis seen|guessed --size S|M|L --evidence <id>/<picture>
```

- `block`: they cannot get to the one thing. Dealt with first: nothing after it is reached.
- `return`: they get it once and have no reason to come back.
- `worth`: what is behind the price is not yet worth it, set against what they use today.
- `pay`: they want it, and the paying itself fails, frightens or cannot be undone.

`seen` happened on the product. `guessed` is the stand-in's reading of how a person would take it: keep those, and never dress one as the other.

**Read what they said the way the evidence says to.** Stand-ins judge more kindly than people, more alike, and buy more readily. A "no" with its reason is worth acting on. A "yes" is not evidence that anyone will pay, and their verdicts are never added up ("two of three would pay" is not a sentence the page or you may say). Whether they would come back is not known to them either: what is known is what the product did on the later days (was their work there, did anything reach them, was there more than on the first day), and that is what a `return` finding says.

And what only real people can tell, as the questions to put to the first of them (`sz-eyes trial ask $F "..."`). Make them from every guess, every place the stand-ins disagreed, and the strongest reason one gave for "no"; ask about what the person did, never what they would do ("지난번에 이걸 할 때 무엇을 썼고, 얼마나 걸렸나요"). Put each question to one stand-in first: one that draws a vague or a flattering answer is rewritten or dropped.

## 5. Show it

`sz-eyes trial page $F` writes the page (it says so while anything is missing: every person has later days and a verdict; there are findings; there are questions for real people). Give the owner the path and one screen:

1. Each person in a line: got the one thing or not, what brought them back or that nothing did, what they chose at the price (pay, the free part, back to what they used, neither), and the reason in their words. Not a count of them.
2. The five things most worth doing, in the order of the page (blocks, return, worth, pay), each with its picture and size.
3. **What you would build first, and why.** One thing, two at most.
4. What only real people can tell.
5. If nobody reached wanting what is behind the price: say plainly that building the payment now would sell nothing, and what would have to be true first.

When the trial was asked for in order to know what the product needs before it is charged for, the list is this, in this order and proportion: first what the trial found, in the page's order, each with its evidence; then, short and marked as what follows once someone would pay, what putting it online and taking money themselves need (from `sz:ship` and the Money part of `sz:backend`), with the part that is the owner's own (a registration, a contract).

Each finding goes to the backlog (`sz-eyes backlog add "<it> [S|M|L]" --from "써 보기 <date>"`). What the owner says to the page is `sz:feedback`; "1, 2, 3 해" is `sz:work` for each, or the `sz:build` workflow for several.

## After it

What to build is the owner's to say. If nobody in the trial reached the price wanting what is behind it, say plainly that building the payment now would sell nothing; if they say to build it anyway, build it.
