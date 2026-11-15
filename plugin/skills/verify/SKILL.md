---
name: verify
description: Use when a claim about software has to be shown true on the running product, not argued. How to launch, look at and operate a web page, an iOS app, an Electron desktop app, a web game and other targets with sz-eyes, and what counts as evidence.
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

**Web** (a dev server or a deployed URL). A server you start yourself gets its port from the machine and is ended by its own id, because other work of the owner's is listening on this machine too:

```
PORT=$(sz-eyes port) <the map's launch command> & pid=$!
...look, operate...
kill $pid
```

If the product cannot be told its port, say so as a finding and use the port the map names only when nothing is listening there (`lsof -nP -iTCP:<port> -sTCP:LISTEN` prints nothing). Never end what holds it. Before the first look, make sure it is this product that answers (its own words on the page), not another server on the same number.

```
sz-eyes web look <url> [--size phone|tablet|desktop] [--dark] [--wait "<words>"] --out <folder> --name <state>
sz-eyes web do <url> --step "tap:<words>" --step "type:<field>=<text>" --step "wait:<words>" --step "see:<words>" --step "shot:<name>" --out <folder> --name <flow>
```

A candidate for release or a live address is looked at the same way, and two more looks say what a public service must get right:

```
sz-eyes web live <url> [--commit <sha>]             # is it up, is it the version released (it says its commit at /healthz), what a person arriving trips on
sz-eyes web leaks <url> [--path <path>]... --env <the file with the server's secrets>     # is anything that must stay on the server in what a browser is given
sz-eyes web strangers <url> --as "<step>"... --other "<step>"... [--open <path>]...         # can one person get at what another stored
```

`strangers` is for any product where people have things of their own. `--as` signs a first person in and uses the product as them: open their things, make one, change one, remove one, and leave something in place that only they typed. `--other` signs a second person in. Everything the first person's browser asked of a server is then asked again as nobody and as the second person, and each change is tried by them first. A screen cannot show this fault: a screen only asks for what is its own. That is every page drawn on the server, every answer of an API and every file downloaded; the result lists what was asked again, so that what it covered can be read. Paths that are meant to answer everyone are named with `--open`, each for a reason the spec gives. Never run it without `--reads-only` on an address people are using.

A look waits for the page to load and then, for four seconds at most, for it to stop asking for things. What arrives later than that is named: `--wait "<words>"` on a look, a `wait:<words>` step in a walk.

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

**A desktop app built on Electron** (the map says its folder, what must be built first, and the variables below):

```
sz-eyes electron look <app folder> [--window "<words of its title or address>"] --env <ITS_DATA_VARIABLE>={data} --out <folder> --name <state>
sz-eyes electron do <app folder> --step "tap:<words>" --step "window:<words>" --step "see:<words>" ... --env <ITS_DATA_VARIABLE>={data} --out <folder> --name <flow>
```

The steps are those of `web do`, and `window:<words>` goes on in another window the app opened (a popover, its settings). The app is started on a folder of its own for what it stores (`{data}` stands for it), its windows are invisible on the owner's screen and take none of their clicks or keys, and it is ended by the process that was started, so the owner's own copy of the same app can stay open. An app that decides itself where it keeps its data (`app.setPath('userData', ...)`) is not started until it is pointed at `{data}` by its own variable: started bare it would open the owner's real data. Give it the map's other switches the same way (`--env`): the port it listens on, no update check, which window to open. What reaches outside the app (a browser extension it pairs with, a global shortcut, a login item) is not exercised unless the map says how it is kept off the owner's own.

**A web game, or a page that moves by itself:** hold its time and ask it (`sz:game`). `sz-eyes web do <url> --clock --step "press:Space" --step "run:3000" --step "expect:window.__game.state().score === 3" --step "hold:ArrowRight=500" --step "read:after=window.__game.state()"`: with `--clock` the page's time moves only on `run:` and `hold:`, so the same steps give the same state every time. `read:` and `expect:` work on any page (what is in storage, what a counter says).

**Anything else** (a desktop app, a CLI, a game in an engine): use what the map names: the project's test runner, a headless run that prints state, a screenshot command. Prefer a check that exposes state (a game that can print its state and step its clock) to one that needs a picture judged.

## What stood before

A product that has been worked on before keeps promises, and a change is not done until they are shown again:

```
sz-eyes standing                      # every claim earlier work proved, how each is shown, when it last held, which check files changed since
sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during <the contract being verified> --note "<what was run and what it showed>"
```

Run every standing claim that a flow, test or command shows (the project's whole check command in one go where it has one), and look again at the ones shown by a look where this work touched that screen. Where it says a check file changed since the claim last held, read the change (`git diff`, `git log -p -- <file>`) and decide whether the file still checks what the claim says: a check that was loosened so that it passes is `broken`, whatever it prints. Record every one you looked at. A standing claim that the work's own contract replaces is no longer listed.

## Recording a verdict

```
sz-eyes contract claim <contract id> <claim id> --status proven|refuted|unchecked --evidence <file relative to the evidence folder> --note "<what was done and what it showed, in one or two lines>"
```

`proven` needs evidence or a note that says what was run and what it said. `refuted` says what happened instead, with the picture. Do not edit the contract file by hand, and do not edit product source: a verifier that fixes what it finds has stopped verifying.
