---
name: trial
description: Use when the owner asks whether the product is worth paying for, wants it tried as an end user or walked through as a user would ("유저 입장에서 써 봐", "end user proxy", "시나리오 완주해 줘", "돈 낼 만한 서비스인가", "뭐가 더 필요할까", "테스트 유저가 없어"), and first of all when they say they want to take money for it or take it to production. Stand-ins for the people it is for use the product the whole way, coming back on later days and reaching the moment it asks for money, and what stands between a person and paying comes out ranked, with the screens that show it.
---

# Trial: would a person pay for this

The checkout does not sell a product. A person pays when the thing has already given them something, they have a reason to come back, and what is behind the price is worth more to them than what they use today. An owner who says "I want to charge for this" is asking first whether that is true, and when it is not, what would make it so. Building the payment before knowing is the commonest way to finish a product nobody buys.

**The trial is run, not offered.** When the owner asks what the product needs before it can be charged for, the answer is what the trial finds. A list written from your own judgement, with the hosting and the payment company at the top, is the answer they did not want: it says how to take money and not whether anyone would give it. (The first session that was asked this built a checkout; the first one given this skill wrote such a list in a minute and offered the trial at the end, as an option.) Do not ask whether to run it and do not leave it as a suggestion: say in one line that stand-ins will now use the product and about how long that takes, and start. The owner is usually not there to answer, and this is the work they asked for.

People to try it on are hard to find, and each can be spent once. So before any of them: stand-ins use the product the whole way. A stand-in finds where a person is stopped, confused or left with nothing. It cannot know whether they would want it. The trial says which is which, and ends with what to ask the real people.

Read `.sz/map.md` (how the product is opened and operated), `.sz/spec.md` or the README and the landing page (who it says it is for), `.sz/owner.md`, and the last trial if there is one (`sz-eyes trial show`).

## 1. Who

Write two or three people, from who the product itself says it is for. Each: who they are and the moment they arrive in (what they were just doing, what they want right now); what they use for this today (a product is compared with that, never with nothing); what would have to be true for them to pay. One of them is the doubter: someone it is said to be for who gets by fine without it. Not demographics: a moment.

```
F=$(sz-eyes trial new)
sz-eyes trial person $F <id> --who "..." --instead "..." --pays-if "..."
```

Tell the owner the people in three lines and go on. They correct you if you have the wrong ones; that correction is worth having.

## 2. The stage

Each person gets a product of their own that nobody else has used: a copy of the data, a port from the machine, or for a desktop app its own data folder (`sz-eyes electron ... --data <trial folder>/<id>/data`, which also keeps what they did for the days that follow). Never the owner's own copy or data. What you try yourself to work the commands out (a first launch, a fault you want to see again) is kept under the trial's folder as well (`<trial folder>/_stage/`), never in a folder elsewhere on the machine.

Work out, and give each stand-in as exact commands:

- **how the product is opened** as this person would meet it, starting where people start (the landing page, the shared link, the first launch);
- **how a day passes.** Most of what decides whether someone pays happens on the second and the seventh day. A desktop app is started believing it is a later day, with nothing asked of the app: `sz-eyes electron ... --data <the person's folder> --days-later 1` (then 3, 7), which moves the clock of its main process and of every window. Closing it and opening it again is not a day passing: say `--days-later`, or the stand-in is shown the same day twice and reports what is not so. For anything else use the product's own way of moving its clock (a variable, a debug setting), or data put in place as it would be a week in. If the product has no way and time matters to it, that is the first finding, and the days after the first go untried;
- **the moment it asks for money**, and a test payment if the product has one.

## 3. Let them use it

Start one `sz:user` agent for each person, with their card, the commands above, and the trial's folder. Tell them nothing about how the product is built, what it is supposed to do, or what you hope they find. They may run side by side when each has a product of its own.

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

And what only real people can tell, as the questions to put to the first of them (`sz-eyes trial ask $F "..."`): whether they have the problem at all, what they would pay, what they would tell a friend it is.

## 5. Show it

`sz-eyes trial page $F` writes the page (it says so while anything is missing: every person has later days and a verdict; there are findings; there are questions for real people). Give the owner the path and one screen:

1. Each person in a line: got the one thing or not, came back or not, would pay or not, and the one reason.
2. The five things most worth doing, in the order of the page (blocks, return, worth, pay), each with its picture and size.
3. **What you would build first, and why.** One thing, two at most.
4. What only real people can tell.
5. If nobody reached wanting what is behind the price: say plainly that building the payment now would sell nothing, and what would have to be true first.

When the owner asked for a list of what is needed to charge for it or to go to production, the list is this, in this order and proportion: first what the trial found, in the page's order, each with its evidence; then, short and marked as what follows once someone would pay, what putting it online and taking money themselves need (from `sz:ship` and the Money part of `sz:backend`: a place to run, backups, the notices the law asks for, the payment company), with the part that is the owner's own (a registration, a contract). Never the second part alone, and never first.

Each finding goes to the backlog (`sz-eyes backlog add "<it> [S|M|L]" --from "써 보기 <date>"`). What the owner says to the page is `sz:feedback`; "1, 2, 3 해" is `sz:work` for each, or the `sz:build` workflow for several.

## When the request was "I want to charge for this"

Run the trial before anything is built for taking money. The plumbing (`sz:backend`, Money) is built when someone in the trial reached the price wanting what is behind it, or when the owner, having read the page, says to build it anyway. That is theirs to say.
