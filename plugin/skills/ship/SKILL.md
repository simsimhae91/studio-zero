---
name: ship
description: Use when the owner asks to release, deploy, publish or launch a product, or to put it online ("출하해", "배포해 줘", "올려 줘", "라이브로"), to take a release back, or to look at what is live. Gets the product ready for the place it will run for people, rehearses the version that is about to go out, puts it there with the place's own commands, has it proven on what people reach by an agent that did not build it, and takes it back when it is not right.
---

# Ship: put it where people reach it, and prove what answers there

"The deploy succeeded" says the provider took the files. It does not say that what answers is the version you meant, that it works as built for production, that what people stored is still there, that nothing secret is in what a browser downloads, or that anyone can take it back. Those are what went wrong, in the field, with releases made by agents. A release is proven like any other work: by someone who did not build it, on the thing itself.

Read `.sz/map.md` (its "배포와 데이터" and "오류와 사용이 보이는 곳"), `sz-eyes release list`, and the last lines of `.sz/progress.md` first.

## Whose decision is what

**The owner's yes, each time, before it happens:** opening an account or anything that starts to cost money; the first release of a product to a place people can reach; a domain; a change to what is stored that drops, renames or narrows something people have stored in it; restoring a backup over live data (it loses what was written since); deleting anything live; going past a line of the gate that failed. Say what it is, what it costs, and what you recommend, in one message.

**Yours, without asking:** getting the product ready, the rehearsal, every later release to a place the owner has released to before once the gate's first half is shown, and taking a release back when what is live is broken (that restores what was agreed).

**Never yours:** deleting or resetting a hosted database, project, app, volume or bucket. The plugin refuses those commands; the owner runs them (`! <command>`). You do not hold the live database's address or an admin key while building: only the release steps use them, from the environment, never printed and never written to a file in the repository.

**Keys.** A key is the owner's and is in their vault under a name (`sz-eyes secret has <id>...` says which are there). The owner puts one in themselves, from the clipboard: `! pbpaste | sz-eyes secret set host/cloudflare/api-token`. A command that needs one gets it by name: `sz-eyes secret run CLOUDFLARE_API_TOKEN=host/cloudflare/api-token -- npx wrangler deploy`. Never ask for a key in the conversation, never read one into a variable or a file, and never put one in the repository; a live secret of the product goes from the vault into the place's own secret store the same way (`sz-eyes secret run V=<id> -- sh -c 'printf %s "$V" | npx wrangler secret put <NAME>'`).

In a session whose permission mode refuses production deploys, show the release command and let the owner allow it or run it.

## 1. The place

The map names each place the product runs for people: its name, the address, and the exact command for each of: build what goes out, release it, list releases, put the previous version back, read errors recorded since a time, take a copy of the data, restore a copy, set a secret. If the product has no place yet, choose one with `sz:backend` (a new product) or from what the project already uses (its CI, its config files), and ask the owner for the account: that is theirs.

## 2. Ready to run there (once, as work of lane M through `sz:work`)

A product is ready for a place when all of this is true, each a claim someone proves:

- **It says which version it is.** `/healthz` (or what the stack calls it) answers with the commit it was built from, put in at build time, never guessed at run time. Where `/healthz` is already promised to say something else, it says its version at another path, and the release is told so (`--version-at /version`).
- **Its settings come from the environment**, with no secret and no address of this machine in the code. One file lists the names it needs (`.env.example`), none of the values.
- **What people store has one named home** that survives a release, and a copy of it can be taken while it runs and restored. The copy is kept somewhere a deleted app does not take with it.
- **Failures are recorded where they can be read back by a command**, each with when, where and what.
- **The previous version can be put back by one command**, and that command has been tried.
- **Its checks can be pointed at a place.** A flow starts a server of its own only when it is not given one: `SZ_URL=<address> <the check command>` runs the same flows against that address. A flow that has to stop the server or read its files cannot be pointed at a place: it says so and is skipped there, and what it shows was shown at the same commit from the source. One flow, the **live walk**, does the product's one thing from start to end using only what it creates, names what it creates so that it can be told apart (`sz-walk-...`), and removes it at the end: it is the only flow ever run on what is live. If the product has no way to remove such a thing, the way that is added for the walk is one only the server's own key opens: a door that deletes whatever has a certain name is a door for everyone.

Write the place into the map as you go.

## 3. A release

1. **Nothing half-done.** `sz-eyes contract status` owes nothing, the tree is committed, the project's whole check passes. The release names a commit.
2. **The candidate.** Build that commit as it will go out and start it where people are not: a container on this machine (`sz-eyes docker ...`), the provider's preview address, a staging place. Production build, production settings, its own data. When there is live data, the candidate runs on a fresh copy of it, taken now.
3. **The gate.** `sz-eyes release new --place <name> --url <live address> --commit <sha> --candidate <address> ...` writes the same lines for every release and freezes them (`sz-eyes help` lists the flags). Each line is shown or waived with a reason the owner will read: a product with no accounts waives `rc-strangers` and says why. Never waive a line because showing it is work.
4. **Before the switch.** Start the `sz:verifier` agent with the release's id and "the rc- lines". It shows on the candidate that what stood still stands (the checks pointed at it), that nothing secret is downloaded (`sz-eyes web leaks`), that one person cannot get at another's data (`sz-eyes web strangers`, and the product's own flow with two people), that the new version starts on a copy of the live data with everything still there, that a copy restores, and that the way back works. **A line refuted here means it does not go out:** fix it as work of its own, then `sz-eyes release back <id> --note "내보내지 않음: <why>"` and start a release for the new commit.
5. **Copy the live data** (not on a first release), where a deleted app does not take it along.
6. **The switch**, by the map's release command. If what is stored changes shape, the change that adds goes out before the code that needs it, and nothing is dropped in the same release that stops using it (see below).
7. **After the switch.** `sz-eyes web live <address> --commit <sha>` at once: is what answers this version. Then the `sz:verifier` agent with "the live- lines": the live walk on what people reach, nothing secret downloaded there either, what was stored before is still there, no new errors recorded since the switch (look once at once and again ten minutes later, by the session's own timer; the release is not closed before the second look).
8. **If a live- line is refuted, take it back now** with the map's way back, check with `sz-eyes web live <address> --commit <the previous sha>` that the old version answers, and `sz-eyes release back <id> --note "<what failed, what was put back, what answers now>"`. Then tell the owner. Do not debug on what is live.
9. **Close and show.** `sz-eyes evidence <id>`, `sz-eyes contract close <id>`, a line in `.sz/progress.md`, and to the owner: the address, the version that answers, each line in a word, what was waived and why, what is unchecked, the way back, and the evidence page.

## What is stored changes shape

Putting back the previous version does not put back the data. So a change of shape is made in steps that each work with the version before and the version after: add (new column, new table, both versions run), move what is there, switch the code, and only in a later release, with the owner's yes, drop what is no longer used. A migration that drops, renames, narrows a type, makes a column required without a default, adds a rule to a table that has rows, or turns row security off is the dangerous kind. `sz-eyes migrations look --since <the commit that is live>` reads the migration files that changed, and the statements the code itself was given to say to the database (a product that changes the shape of its data when it starts has no file to show for it), and names each such statement; the gate's `rc-shape` line runs it for every release that changes one. A statement it names goes out only with the owner's yes to exactly that, in their words, written into the release (`--without "rc-shape|<what they said>"`). Every migration is rehearsed on a copy of live data (`rc-data`), never first on the data itself.

## Looking at what is live

`sz-eyes release check --place <name>` opens the second half of the last release as a new contract: is the version that answers still the one released, does the live walk pass, is anything secret downloaded, what errors were recorded. `sz:tend` does this for a product that is live. What it finds broken is fixed by a release, or by taking the last one back.

## What a look at a live address tells (`sz-eyes web live`, `sz-eyes web leaks`)

`web live` says what a person arriving from a shared link trips on as well: no https, a missing page that answers 200 or 500, no title or picture for a link shared in a messenger, no icon. `web leaks --env <the file with the server's secrets>` looks for those exact values, and for the shapes of admin keys, in everything the browser is given; give `--path` for the pages behind the first one. Both are for a candidate as much as for what is live, and neither changes anything.
