---
name: verify
description: Use when a claim about software has to be shown true on the running product, not argued. How to launch, look at and operate a web page, an iOS app, and other targets with sz-eyes, and what counts as evidence.
---

# Verify: show it on the running product

A claim is unproven until something shows it. "The code looks right" shows nothing. A passing test shows what the test checks. Operating the product shows what a person will meet.

## What counts

- **State over pictures.** Decide by what can be read exactly: the words on the screen, the controls and their sizes, a flow's steps, a command's exit, a row that was saved. A vision model misses most subtle visual defects; do not call a layout right because a screenshot looks fine to you.
- **Pictures are for the owner.** Keep a picture of every state a claim is about, and a before/after pair when something changed. They go in the evidence folder and on the evidence page.
- **Try to break it.** The empty case, the long name, the second time, the wrong input, going back. One happy path proves one happy path.
- **What cannot be checked is said.** No device, no account, needs a human ear or judgement (is it fun, does it feel right): the claim is `unchecked`, with the reason. Never `proven` by assumption.

## The eyes

Everything is kept under the contract's evidence folder: `.sz/evidence/<contract id>/`. Give `--out` an absolute path under it.

**Web** (a dev server or a deployed URL):

```
sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait "<words>"] --out <folder> --name <state>
sz-eyes web do <url> --step "tap:<words>" --step "type:<field>=<text>" --step "wait:<words>" --step "see:<words>" --step "shot:<name>" --out <folder> --name <flow>
```

`look` gives the words on the page, what can be pressed with names and sizes, what the page logged, and what was measured (contrast, touch targets, text cut off, sideways scroll, a label broken over two lines). `do` carries out steps as a person would and pictures what each press led to; it stops at the first step that cannot be done and says why. Add `--house` only for a product built on the studio's own design system.

**iOS** (a simulator build; the map says where the app is and its bundle id):

```
sz-eyes ios spare                                   # the eyes' own simulator; prints its id. Never use one of the owner's.
sz-eyes ios install <udid> <path.app> --bundle-id <id> [--metro <port>]
sz-eyes ios flow <udid> <flow.yaml> --out <folder> --video      # Maestro; the project's own flow, or one you write for this claim
sz-eyes ios look <udid> --out <folder> --name <state>
sz-eyes ios rest <udid> --erase                     # when done: a booted simulator holds gigabytes
```

Check free disk space first (`df -h /System/Volumes/Data`): a simulator's first boot takes about 3 GB. If there is not room, say so and mark the claim `unchecked`. A React Native debug build needs its packager running on the port given to `--metro`, started from a clone or worktree, never on the owner's own port.

**Anything else** (a game, a desktop app, a CLI): use what the map names: the project's test runner, a headless run that prints state, a screenshot command. Prefer a check that exposes state (a game that can print its state and step its clock) to one that needs a picture judged.

## Recording a verdict

```
sz-eyes contract claim <contract id> <claim id> --status proven|refuted|unchecked --evidence <file relative to the evidence folder> --note "<what was done and what it showed, in one or two lines>"
```

`proven` needs evidence or a note that says what was run and what it said. `refuted` says what happened instead, with the picture. Do not edit the contract file by hand, and do not edit product source: a verifier that fixes what it finds has stopped verifying.
