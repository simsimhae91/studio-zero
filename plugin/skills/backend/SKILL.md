---
name: backend
user-invocable: false
description: Use when a product needs somewhere to keep what people enter, accounts and sign-in (Kakao, Google, email), files, things people share live, payments, public data or a model that reads a picture, or a place to run for people; when choosing or changing what a product stands on; and before building anything that touches accounts, stored data or money. Says what to stand on and why, how it is run on this machine with no account, and what has to be proven about it.
---

# Backend: what a product stands on

A product that only runs on its maker's machine is a demo. What it stands on decides what it costs when nobody comes, whether it can be proven before anyone pays for anything, and how many ways it can give away what people stored in it.

## 1. A project that exists keeps what it has

Read the map. Its stack, its host and its database are the grain: build on them. Moving a product to another stack is a decision of the owner's, proposed with what it costs and what it buys, never done on the way to something else.

## 2. A new product: the smallest thing that carries it

Say in `.sz/spec.md`, in two lines, which and why.

| The product | Stand on | Why |
|---|---|---|
| Computes and shows; keeps nothing between people | Static files, no server | Nothing to run, nothing to leak |
| A web service with data of its own, with or without accounts (most of what is made here) | **A Cloudflare Worker with D1** (SQLite), R2 for files, a Durable Object for a room people share live | Costs nothing while nobody comes and $5 a month for every service the owner has together; commercial use is allowed on the free plan; runs in Seoul; runs whole on this machine with no account and no container |
| Mostly accounts and rows each person owns, live updates, or a native app that wants an SDK (Expo) | **Supabase** (Postgres, sign-in with Kakao and Google built in, files, realtime), Seoul region | What it has built in replaces weeks of work. It costs: free is two projects that are paused after a week without use; real is $25 a month and about $10 for each further project |
| Needs a process that stays up, all of Node, or is already a server with a database file | **A container with a volume** (Fly, Tokyo) | The image that was rehearsed is the thing that runs. Bills under $5 a month are waived |

These are as read on the providers' own pages on 2026-11-15 (`docs/research/2026-11-15-ship/`); terms move, so read the page again before telling the owner a price. Vercel's free plan forbids commercial use: a product meant to earn does not go there without the paid plan.

Building and proving need no account. The owner's account, and what it costs, come in at the first release (`sz:ship`), and are theirs to give.

## 3. On this machine, with no account

Everything is started on a port from the machine and ended by the id you kept (`sz:verify`).

- **Worker and D1.** `npx wrangler d1 migrations apply <binding> --local`, then `npx wrangler dev --ip 127.0.0.1 --port $(sz-eyes port) --var COMMIT:$(git rev-parse HEAD)`. State lives in `.wrangler/` of that folder (keep it out of git): every clone has a database of its own. Set `WRANGLER_SEND_METRICS=false` on every call. Migrations are numbered SQL files in `migrations/`; the same files are applied to the hosted database at a release. (Run here on 2026-11-15, wrangler 4.162: installs in ten seconds, answers in three.)
- **Supabase.** `sz-eyes supabase start --runtime docker --exclude studio,analytics --output-format json` in the project folder prints the address and the keys; `sz-eyes supabase stop` keeps the data. The schema is the migrations in `supabase/migrations/`. This door opens only on the stack on this machine and refuses anything that names a hosted project. (Measured here: 49 s the first time, 1 to 3 s after; about 65 MiB at rest.)
- **A container.** `sz-eyes docker build` and `sz-eyes docker run` with a named volume for the data and the port given by the machine. End it by the name you gave it. Build on the slim image of the runtime (`node:24-slim`, not `node:24`): the full one is 1.6 GB, which is minutes of every release to a host and gigabytes of the owner's disk.

## 4. Arms: what the server calls with the owner's keys

An arm is a service a product's server calls with a key of the owner's: public data (`public-data`), a model reading a picture or a document into fields (`read`), signing in with Kakao and Google (`login-kakao`, `login-google`). Each has a file in `arms/` beside this one: when a product takes it, how the server calls it, its limits, what users are told, how it is proven, and the owner's steps. `sz-eyes arm list` names them.

- The plan names the arms the product takes. Before the build, `sz-eyes arm need <names>`; when it exits 1, put what it prints to the owner, and build nothing that needs the key until it exits 0. A missing key is never worked around with an example.
- The key lives on the server: `sz-eyes secret run <NAME>=<vault id> -- <launch command>` while developing, the host's secrets when shipped; never in a file, never in what a browser or an app bundle receives.

## 5. Accounts

- **Signing in.** Email (a link or a code) needs no key and works on this machine. Kakao and Google go through the owner's one developer app with each, whose keys are the arms `login-kakao` and `login-google`. On this machine Kakao and Google sign-in goes through the login relay: `sz-eyes supabase start` reads the keys from the vault itself, switches the providers on with the relay's address as where the provider sends people back, registers the stack with the relay, starts the relay, and prints one line saying which providers are on. The owner registers the relay's one address (`http://localhost:49210/oauth/callback`) with each provider once, for every product (the line names it, with the guide); a builder never asks the owner to register a product's own local address (its port is the product's alone, and a provider sends a person back only to an address registered letter for letter). When signing in through a provider fails, `sz-eyes login relay status` says whether the relay is up and which backends it knows. A phone app: the provider sends the person back to the relay on this Mac, which the iOS Simulator reaches (its localhost is the Mac's) and a real phone does not; on a real phone, signing in with Kakao or Google waits for the pass that puts the product on a public address. If `sz-eyes arm need login-kakao login-google` exits 1, build with email, keep the provider buttons behind a setting, and put what it prints to the owner. Never invent a stand-in provider.
- **Do not write the cryptography.** On a Worker use a maintained library for sessions and OAuth; on Supabase, its own. The session is a cookie that scripts cannot read (`HttpOnly`, `Secure`, `SameSite=Lax`), not something kept where a script can take it.
- **A person can leave.** Deleting the account is in the product and no harder than joining; it removes what is theirs. Under 14: the product asks the year of birth, or it has a way to ask a parent.
- **Every table has an owner column or a reason not to.** On a Worker the server checks the owner on every read and every change. On Supabase every table has row security on, with a policy for each of read, add, change and remove. A policy that exists is not a policy that is right: the field study that found a tenth of one builder's apps open found policies in most of them.

## 6. What is proven, for any product where people have things of their own

One milestone's claims say these, each shown on the running product:

1. A person joins, signs in, leaves and comes back still signed in, and deletes their account.
2. What they stored is there after a reload and after the backend is restarted.
3. **Nobody else gets at it**: `sz-eyes web strangers` with two people (everything the first person's browser asked a server for, asked again as nobody and as the second person, and each change tried by them first), and a flow of the product's own in which the second person's screen never shows the first person's things. What is meant to be open to everyone is named, with the reason, in the spec.
4. Nothing that opens the database reaches the browser: `sz-eyes web leaks <address> --env <the server's secrets>`.
5. Where people share something, the second person's screen shows the first person's change.

## 7. Money

- The whole of a payment can be built and proven before the owner registers anything: Toss Payments' documented test keys approve nothing real, and the card is typed into Toss's window, never into the product. Build on the test keys and say so.
- **The server decides what is paid.** The amount is fixed on the server before the payment window opens and compared when the provider reports back; the provider's server-to-server notice is what marks an order paid, never the browser coming back to a page; a notice delivered twice changes nothing the second time. Each of those is a claim with a test.
- **The owner's part, said plainly when the product needs it:** a business registration (free, online, about two days), then the contract with the payment company, then the live keys into the place's secrets. An individual with no registration cannot contract with Toss, PortOne, KakaoPay or Naver Pay. For digital goods of about ₩5,000 and up, a merchant of record (Paddle) sells in the owner's place and takes Korean cards.
- **A service that sells shows**, on its first page or one link away: the trade name, the owner's name, address, phone, email, the registration number, the host's name, the terms, and the refund rule (seven days; what has been used is refunded or not as the page said before the purchase). A subscription says the amount, the next charge and how to stop before the first charge, and has a button that stops it.

## 8. What every service that keeps anything about a person has

- A page named 개인정보 처리방침, linked from every page: what is kept and why, how long, who else handles it (the host and the database, by name and country, since they are abroad), how to see and delete it, who to ask. Keep the least: an email is enough for most things.
- Counting how it is used without following anyone: no cookie that identifies a person, no session replay.
- Failures written where a command reads them back, and a count of the one thing the product is for. `sz:ship` and `sz:tend` read both.

## 9. When the stack is not the default

Write the reason in the spec and carry the same proofs. What changes is where the candidate runs (the provider's preview address, a branch of the database) and which commands the map names; what has to be shown does not.
