export const meta = {
  name: 'build',
  description: 'Build a product, or grow one that exists, to the end, unattended: a spec (new, or the existing one extended), then milestone by milestone a frozen contract, the build, a verification by an agent that did not build it which also shows again what stood before, fixes, and a page of evidence',
  whenToUse: 'A new product, or a change of several features to a product that already has a spec (lane L), after the owner has answered what only they can answer and has asked for it to run to the end without them.',
  phases: [
    { title: 'Plan', detail: 'the spec and its milestones, each with the claims that make it done' },
    { title: 'Build', detail: 'one milestone at a time: contract, oracle, code' },
    { title: 'Verify', detail: 'each claim shown on the running product by an agent that did not build it' },
    { title: 'Close', detail: 'evidence page, progress line, commit' },
  ],
}

// args: { request: string, answers?: string, maxMilestones?: number }
// `request` is the owner's words. `answers` is what they said to the questions asked before this run (or the
// conservative answers taken for them, marked as such). The run asks nobody anything: what is open is decided
// conservatively and written down.
const request = args && typeof args.request === 'string' ? args.request.trim() : ''
const answers = args && typeof args.answers === 'string' ? args.answers.trim() : ''
const maxMilestones = args && Number.isInteger(args.maxMilestones) ? args.maxMilestones : 6
if (request === '') return { error: 'give args: { request: "<what to build, in the owner\'s words>", answers?: "<what the owner answered>" }' }

const TOOLS = 'The command `sz-eyes` is on your PATH (the sz plugin\'s). Load the skills you need with the Skill tool: `sz:work` (how work is sized, contracted and closed), `sz:verify` (how a product is launched, looked at and operated, and what counts as evidence), `sz:taste` (how a screen is put together, for anything a person looks at in a product made here), `sz:backend` (what a product stands on: where it runs for people, what holds its accounts and its data, and what that must prove), `sz:ship` (what a product needs before it can be put where people reach it), `sz:game` (when the product is a game or moves by itself: how it is built to be asked what it is doing, and proven with its time held).'
const GROUND = 'You are working in the project\'s folder. Read `.sz/map.md` first (if there is none, load `sz:onboard` and write it), then `.sz/spec.md`, `.sz/owner.md` (what the owner has said they want of this product: it comes before your own taste) and the last lines of `.sz/progress.md` if they exist. Follow the project\'s own rules as the map lists them. Other work of the owner\'s runs on this machine. Never use their simulator, browser profile or dev-server ports: a headless browser, the eyes\' own simulator, and for anything you launch a port taken from the machine (`PORT=$(sz-eyes port)`), never a number you chose. Before you look at what you launched, make sure it is yours that answers (your process is alive and the page is this product). End every server you start, by the process id you kept (`pid=$!` ... `kill $pid`): never by its port and never by its name, because what holds a port you wanted is somebody else\'s.'

const CLAIM = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'a short lowercase word with digits and dashes, unique in the milestone' },
    says: { type: 'string', description: 'what will be true of the running product, as the owner would say it and could see it, with the figure where there is one' },
    kind: { type: 'string', enum: ['flow', 'test', 'look', 'command', 'owner'] },
    ref: { type: 'string', description: 'how it is shown: the flow or test file that will exist, the screen and state to look at, the command' },
  },
  required: ['id', 'says', 'kind', 'ref'],
}
const PLAN = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['new', 'continue', 'extend'], description: 'new: there was no spec. continue: an earlier run stopped before finishing what the spec has. extend: the request asks for more than the spec had, and the spec was amended' },
    summary: { type: 'string', description: 'two or three sentences: what the product is, for whom, and the shape you chose (when extending: what is added or changed)' },
    decided: { type: 'array', items: { type: 'string' }, description: 'what the request and the answers left open and how you decided it' },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'a short lowercase word with digits and dashes' },
          title: { type: 'string' },
          builds: { type: 'string', description: 'what is built in it, in two or three sentences' },
          claims: { type: 'array', items: CLAIM },
          notDoing: { type: 'array', items: { type: 'string' } },
          risks: { type: 'array', items: { type: 'string' } },
          supersedes: {
            type: 'array',
            description: 'standing claims of earlier, closed contracts (as `sz-eyes standing` lists them) that will stop being true because what was asked has changed. Empty for a new product, and for a milestone that only adds.',
            items: { type: 'object', properties: { contract: { type: 'string' }, claim: { type: 'string' }, why: { type: 'string', description: 'what the owner asked that changes it, in their language' } }, required: ['contract', 'claim', 'why'] },
          },
          state: { type: 'string', enum: ['todo', 'built', 'closed'], description: 'todo unless this run continues an earlier one: built = its code and frozen contract exist and it has not been verified to the end; closed = its contract is closed' },
          contractId: { type: 'string', description: 'for a milestone that is built or closed: the id of its contract' },
          launch: { type: 'string', description: 'for a milestone that is built: the exact command that starts the product and where it is seen' },
          disputes: { type: 'array', description: 'for a milestone that is built: frozen checks an earlier run found to be wrong about how they check', items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } }, required: ['file', 'problem'] } },
        },
        required: ['id', 'title', 'builds', 'claims'],
      },
    },
  },
  required: ['summary', 'milestones'],
}
const BUILT = {
  type: 'object',
  properties: {
    contractId: { type: 'string' },
    summary: { type: 'string', description: 'what was built, in three sentences at most' },
    launch: { type: 'string', description: 'the exact command that starts the product now, and the address or app it is seen at' },
    blocked: { type: 'string', description: 'empty unless the milestone could not be built at all: then what stopped it' },
    disputes: {
      type: 'array',
      description: 'frozen checks you found to be wrong about how they check (not the product being wrong): each with the file and exactly what is wrong. Empty when there are none.',
      items: { type: 'object', properties: { file: { type: 'string' }, problem: { type: 'string' } }, required: ['file', 'problem'] },
    },
  },
  required: ['contractId', 'summary', 'launch'],
}
const VERDICT = {
  type: 'object',
  properties: {
    proven: { type: 'array', items: { type: 'string' }, description: 'claim ids shown true' },
    refuted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['id', 'fact'] } },
    unchecked: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] } },
    broken: { type: 'array', description: 'claims of earlier work that stood before this one and do not hold now', items: { type: 'object', properties: { key: { type: 'string', description: '<contract>/<claim>' }, fact: { type: 'string', description: 'what happened instead, with the figure' } }, required: ['key', 'fact'] } },
    held: { type: 'array', items: { type: 'string' }, description: 'claims of earlier work (<contract>/<claim>) that were shown again in this look and hold' },
    stood: { type: 'number', description: 'how many claims of earlier work hold after this look, counting those shown before' },
    noticed: { type: 'array', items: { type: 'string' }, description: 'what no claim covers and the owner would want to know' },
  },
  required: ['proven', 'refuted', 'unchecked'],
}
const CLOSED = {
  type: 'object',
  properties: {
    report: { type: 'string', description: 'path of the evidence page' },
    closed: { type: 'boolean', description: 'true only if `sz-eyes contract close` was run and said "closed"; false if it refused or was not run' },
    why: { type: 'string', description: 'when not closed: what the command said' },
    commit: { type: 'string' },
    line: { type: 'string', description: 'the line added to .sz/progress.md' },
  },
  required: ['report', 'closed', 'line'],
}

// ------------------------------------------------------------------ Plan
phase('Plan')
const plan = await agent(
  `You are planning a product (or a large change to one) that will then be built milestone by milestone with nobody watching. ${GROUND} ${TOOLS}

The owner's request:
${request}

${answers ? `What the owner answered when asked beforehand:\n${answers}` : 'The owner was not asked anything beforehand. Where the request leaves something open that only they could say (who it is for, how it should feel, accounts, keys, money), take the conservative answer and list it under "decided".'}

If \`.sz/spec.md\` already exists, the product has been worked on before. Read it, the contracts under \`.sz/contracts/\` (\`sz-eyes contract status\`, \`sz-eyes contract show <id>\`), \`.sz/progress.md\`, \`.sz/backlog.md\`, \`git log\` and \`sz-eyes standing\` (what earlier work proved and the product has to keep true). Do not plan again what is done and do not rewrite the spec's history. Then it is one of two cases, or both:
- **Continue** (mode "continue"): an earlier run stopped before finishing what the spec has, and the request asks for that. Return the spec's milestones with their claims as the contracts and the spec have them, each with its "state": "closed" (its contract is closed), "built" (its contract is frozen and its code is committed, and it was not verified to the end: give "contractId", "launch", and under "disputes" any frozen check the earlier run reported as wrong about how it checks) or "todo".
- **Extend** (mode "extend"): the request asks for something the spec does not have, or for something to work differently. Amend \`.sz/spec.md\` so that it describes the product as it will be: change the lines that become false, add the new features to the order they are built in under new milestone names. Return the milestones that are not closed yet plus the new ones (state "todo"), with ids no contract has used. For each new milestone, besides its claims:
  - "supersedes": the standing claims that will stop being true because what was asked has changed, each with the reason. Be exact: a standing claim you do not list stays a promise, and the milestone must keep it true. Prefer a change that keeps old promises (a new choice whose default is the old behaviour) to one that replaces them.
  - If it changes the shape of what is stored, one claim says that what was saved before the change is still there after it, shown by a test that starts from data in the old shape. The product carries over what exists; nobody is asked to delete their data.
Write no product code. Add a line to \`.sz/progress.md\` and commit \`.sz/\` if you amended the spec. If there is no spec yet (mode "new"):

Write \`.sz/spec.md\` in the owner's language: what the product is and for whom, the one thing it must do well, its features in the order they will be built, how it is launched and looked at, and what is deliberately not built. Then cut the work into ${Math.min(maxMilestones, 6)} milestones at most:
- The first milestone is the thinnest slice that runs end to end and can be launched and looked at: one real thing a person can do, saved or computed for real. Not scaffolding alone.
- Every milestone leaves the product working. A later milestone never depends on something a milestone before it left broken.
- A product people use is more than a screen: where it keeps what a person enters, what happens when there is nothing yet, when something fails, the second time someone comes. Put those in the milestones where they belong, not at the end.
- A product that lives is looked after: from the first milestone it writes down what failed (a log the owner can read) and counts the one thing it is for (started, finished), and \`.sz/map.md\` says where. Without that nobody can tell later whether it works for people.
- A product is made to be put where people reach it. Choose what it stands on with \`sz:backend\` and say in the spec which and why, in two lines. From the first milestone: its settings come from the environment (no secret and no address of this machine in the code), \`/healthz\` answers with the commit it was built from, and every flow runs against the address in \`SZ_URL\` when given one and starts a server of its own only when not. If people have accounts in it, one milestone's claims say that one person cannot read or change what another stored, and neither can someone not signed in, shown by a flow with two people.
- For each milestone give 3 to 7 claims. A claim is something true of the running product that can be shown: with the figure, the words on the screen, the state. Each says how it is shown: a flow file or test that will be written before the code (name the file, in the project's own format), a look at a named screen in a named state, or a command. One claim says what the milestone must not break. What only a person can judge is one claim shown by "owner".
- Do not write product code in this step. Add a line to \`.sz/progress.md\` saying the spec is written, and commit \`.sz/\`.

Return the plan.`,
  { label: 'plan', phase: 'Plan', schema: PLAN },
)
if (!plan || !Array.isArray(plan.milestones) || plan.milestones.length === 0) return { error: 'no plan came back' }
const milestones = plan.milestones.slice(0, maxMilestones)
log(`${plan.mode === 'extend' ? 'spec extended' : plan.mode === 'continue' ? 'continuing' : 'spec written'}: ${milestones.length} milestone(s): ${milestones.map((m) => m.title).join(' / ')}`)

// ------------------------------------------------------------------ milestone by milestone
// One at a time: they share one working tree, and each stands on the one before it.
const done = []
let stopped = null
for (let i = 0; i < milestones.length; i++) {
  const m = milestones[i]
  const before = done.map((d) => `- ${d.title}: ${d.refuted.length === 0 ? 'proven' : `left with ${d.refuted.length} claim(s) refuted`}`).join('\n') || '(this is the first)'
  const claims = m.claims.map((c) => `- ${c.id} | ${c.says} | ${c.kind}:${c.ref}`).join('\n')
  const replaces = (m.supersedes || []).map((r) => `- ${r.contract}/${r.claim} | ${r.why}`).join('\n')

  if (m.state === 'closed') {
    done.push({ id: m.id, title: m.title, contractId: m.contractId || m.id, proven: m.claims.map((c) => c.id), refuted: [], unchecked: [], noticed: [], report: null, earlier: true })
    log(`${m.title}: closed in an earlier run`)
    continue
  }
  const built = m.state === 'built' && m.contractId && m.launch ? { contractId: m.contractId, summary: 'built in an earlier run', launch: m.launch, disputes: m.disputes || [] } : await agent(
    `You are building milestone ${i + 1} of ${milestones.length} of a product, with nobody watching. ${GROUND} ${TOOLS}

Milestone "${m.title}" (${m.id}): ${m.builds}
Milestones before it:
${before}

Its claims, agreed before you start (id | what will be true | how it is shown):
${claims}
${m.notDoing && m.notDoing.length > 0 ? `Not done in this milestone: ${m.notDoing.join('; ')}` : ''}
${m.risks && m.risks.length > 0 ? `Risks named when it was planned: ${m.risks.join('; ')}` : ''}
${replaces ? `Promises of earlier work that this milestone replaces, because what was asked has changed (contract/claim | why):\n${replaces}` : ''}

What earlier work proved still stands (\`sz-eyes standing\` lists it), except what is named above as replaced: this milestone keeps all of it true. A flow or test from earlier work that fails after your change means the product is wrong, not the check.

Do this, in order:
1. Record the contract: \`sz-eyes contract new ${m.id} --lane M --request "<the milestone in a sentence, in the owner's language>" --target <web|ios|...> --claim "<id>|<says>|<kind>:<ref>" ...\` with exactly the claims above, plus \`--not\` and \`--risk\` for the lines above${replaces ? ', and `--supersedes "<contract>/<claim>|<why>"` for each promise it replaces' : ''}.
2. Write the oracle first: every flow or test file a claim points at, in the project's own format, before the code it checks. They must fail now for the right reason.${replaces ? ' The flow or test a replaced promise was proven by is rewritten now to say the new truth (or removed if nothing of it remains), and frozen with this contract; every other flow and test of earlier work stays exactly as it is.' : ''}
3. Run each of those files once before freezing, to see that it runs and fails for the right reason (the product is not there yet), not for a mistake in the file. Then freeze: \`sz-eyes contract freeze ${m.id} --frozen <each of those files>\`. From here you edit neither the contract nor those files. If you later find that a frozen file is itself wrong about how it checks (a quoting error, a selector that names nothing), do not work around it and do not stop: finish the build, and list it under "disputes" with the file and exactly what is wrong; someone who did not build this will settle it. If a claim is wrong about what was asked, build what you can and say so in "blocked".
4. Build the milestone. For anything a person looks at, load \`sz:taste\` first. If it changes the shape of what is stored, it carries over what is already there (on start, or by a command the map names): data written by the version before must still open. Run the project's checks (type check, tests, the flows of earlier milestones) as you go and leave them passing.
5. Make sure the product starts with one command and say exactly which, and where it is seen. If this milestone changed how it is launched, correct \`.sz/map.md\`.
6. Commit the work on the current branch with a message that says what the milestone built.

Do not judge your own claims and do not record verdicts: someone who did not build this will operate it. Do not leave a server running.`,
    { label: `build:${m.id}`, phase: 'Build', schema: BUILT },
  )
  if (!built || (built.blocked && built.blocked.trim() !== '')) {
    stopped = `milestone "${m.title}" could not be built: ${built ? built.blocked : 'the builder did not answer'}`
    log(stopped)
    break
  }

  // A frozen check the builder says is itself wrong goes to someone who neither built nor judges: the arbiter
  // corrects how it checks, never what it checks, and writes the correction into the contract. (The first real
  // run stopped here for good: a check its builder had written with a quoting error could be fixed by nobody.)
  for (const dispute of built.disputes || []) {
    await agent(
      `Settle a dispute about a frozen check, met while building contract \`${built.contractId}\` in the project in the current folder. The file: \`${dispute.file}\`. It was frozen by that contract or by an earlier one that is closed: the contracts under \`.sz/contracts/\` say which, and a correction is recorded on the contract that froze it. What the builder says is wrong with it: ${dispute.problem}. The product is launched like this: ${built.launch}. Decide which it is (the check, the product, the claim, or a claim that what the owner asked later has replaced), act as your instructions say for that case, and return what you decided.`,
      { label: `arbiter:${m.id}`, phase: 'Build', agentType: 'sz:arbiter', schema: { type: 'object', properties: { which: { type: 'string', enum: ['check', 'product', 'claim', 'replaced'] }, changed: { type: 'string' }, now: { type: 'string' } }, required: ['which', 'now'] } },
    )
  }

  const claimIds = new Set(m.claims.map((c) => c.id))
  const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${built.contractId} --note "<what was run and what it showed>"\``
  // again: null for the first look, or what was shown false and has been worked on since.
  const verify = (again) =>
    agent(
      `Verify contract \`${built.contractId}\` of the project in the current folder. The product is launched like this: ${built.launch}. ${
        again
          ? `This is a second look, after a fix. ${again.claims.length > 0 ? `These claims of the contract were shown false before: ${again.claims.join(', ')}. Check each from the start, on the product as it is now, and record it with \`sz-eyes contract claim\`. ` : ''}${again.standing.length > 0 ? `These promises of earlier work were found broken: ${again.standing.join(', ')}. Show each again and record it with ${record}. ` : ''}A fix can break a neighbour: run once more every flow, test and command of this contract's other claims and of what stood before (\`sz-eyes standing\`), and report whatever fails now (a claim of this contract under "refuted", recorded with \`sz-eyes contract claim\`; a promise of earlier work under "broken", recorded as above). Claims you did not look at again keep their verdict: leave them out. Before the fix, this was noticed outside the claims: ${again.noticed.length > 0 ? again.noticed.map((n) => `[${n}]`).join(' ') : '(nothing)'}. Under "noticed" return each of those that is still so on the product as it is now (drop one the fix has ended) and whatever you notice that is new.`
          : `Give every claim a verdict and record each with \`sz-eyes contract claim\`. Then show again what stood before this work (\`sz-eyes standing\`) and record each with ${record}.`
      } I am telling you nothing about whether any claim is true. Record what you notice that no claim covers with \`sz-eyes contract notice\`, stop any server you start, and return the verdicts: under "broken" every promise of earlier work that does not hold now, under "held" every one you showed again that holds.`,
      { label: `verify:${m.id}${again ? ':again' : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT },
    )
  let verdict = await verify(null)
  for (let round = 1; round <= 2 && verdict && verdict.refuted.length + (verdict.broken || []).length > 0; round++) {
    const wrong = verdict.refuted.map((r) => `- ${r.id}: ${r.fact}`).join('\n') || '(none)'
    const broke = (verdict.broken || []).map((b) => `- ${b.key}: ${b.fact}`).join('\n')
    await agent(
      `You are fixing a product so that claims shown false on it become true. ${GROUND} ${TOOLS}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
Someone who did not build it operated the product and found these claims false:
${wrong}
${broke ? `And these were true before this work and are not now (each is a promise of earlier work: \`sz-eyes standing\` shows how it is checked):\n${broke}` : ''}

Find the cause of each in the product and fix it there. Do not edit the contract, the flows or the tests it names, or those of earlier work, and do not record verdicts. Check that what was already true still is (run the project's checks). Commit the fix. If a claim cannot be made true without changing what was asked, change nothing for it and say why.`,
      { label: `fix:${m.id}:${round}`, phase: 'Build', schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
    )
    const again = await verify({ claims: verdict.refuted.map((r) => r.id), standing: (verdict.broken || []).map((b) => b.key), noticed: verdict.noticed || [] })
    if (!again) break
    // A claim keeps its earlier verdict unless this look gave it a new one: what was shown false and was not
    // looked at again is still false, and a promise found broken is mended only when it was shown to hold.
    const proven = new Set(again.proven.filter((id) => claimIds.has(id)))
    const refuted = new Set(again.refuted.map((r) => r.id))
    const unchecked = new Set(again.unchecked.map((u) => u.id))
    const looked = (id) => proven.has(id) || refuted.has(id) || unchecked.has(id)
    const held = new Set(again.held || [])
    const brokenNow = new Set((again.broken || []).map((b) => b.key))
    verdict = {
      proven: [...verdict.proven.filter((id) => !looked(id)), ...proven],
      refuted: [...verdict.refuted.filter((r) => !looked(r.id)), ...again.refuted],
      unchecked: [...verdict.unchecked.filter((u) => !looked(u.id)), ...again.unchecked],
      broken: [...(verdict.broken || []).filter((b) => !held.has(b.key) && !brokenNow.has(b.key)), ...(again.broken || [])],
      stood: again.stood === undefined ? verdict.stood : again.stood,
      // The second look was handed what the first noticed and returns what of it is still so, plus what is new.
      noticed: again.noticed === undefined ? verdict.noticed || [] : again.noticed,
    }
  }
  if (!verdict) {
    stopped = `milestone "${m.title}" was built and could not be verified (the verifier did not answer)`
    log(stopped)
    done.push({ id: m.id, title: m.title, contractId: built.contractId, proven: [], refuted: [], unchecked: m.claims.map((c) => ({ id: c.id, why: 'the verifier did not answer' })), noticed: [], report: null })
    break
  }

  const closed = await agent(
    `Close milestone "${m.title}" of the project in the current folder. ${TOOLS}
1. \`sz-eyes evidence ${built.contractId}\` writes the evidence page; note its path.
2. ${verdict.refuted.length + (verdict.broken || []).length === 0 ? `\`sz-eyes contract close ${built.contractId}\` (it also writes what the verifier noticed and what could not be checked to \`.sz/backlog.md\`).` : 'Leave the contract open: it has claims shown false, or broke what stood before it.'}
3. If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), correct that line.
4. Read \`sz-eyes backlog\`. For each open line that this milestone has ended (the thing it names is built or fixed now, and a claim proven here or a commit of this milestone shows it), run \`sz-eyes backlog done "<some words of the line>" --by "${built.contractId}/<claim>, or the commit"\`. Tick only what is shown to be ended; a line that is half done stays open.
5. Add one line to \`.sz/progress.md\` in the owner's language: the date, the milestone, how many claims are proven, refuted and unchecked, how many promises of earlier work were shown again and whether any broke or was replaced, anything the verifier noticed that the owner should know, and what comes next. The figures are these, as the verifier returned them: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before this milestone, ${verdict.stood} hold`}, ${(verdict.broken || []).length} broken, ${(m.supersedes || []).length} replaced. Use them in the line and in the commit message; do not count again from \`sz-eyes standing\`, which after closing also counts this milestone's own claims.
6. Commit \`.sz/\` (the contract, the evidence, the standing record, the backlog, the progress line).
Change no product code.`,
    { label: `close:${m.id}`, phase: 'Close', schema: CLOSED },
  )
  const broken = verdict.broken || []
  done.push({ id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: verdict.unchecked, broken, stood: verdict.stood === undefined ? null : verdict.stood, replaced: m.supersedes || [], noticed: verdict.noticed || [], report: closed ? closed.report : null })
  log(`${m.title}: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before, ${verdict.stood} hold and ${broken.length} broke`}`)

  // Nothing is built on a milestone that is known to be broken: the owner is told where it stands instead. The
  // contract's own word decides, not what the agents reported: a contract that would not close is not done.
  if (verdict.refuted.length + broken.length === 0 && !(closed && closed.closed === true)) {
    stopped = `milestone "${m.title}" was verified and its contract did not close: ${closed ? closed.why || 'sz-eyes contract close refused' : 'the closer did not answer'}`
    log(stopped)
    break
  }
  if (verdict.refuted.length + broken.length > 0) {
    stopped = `milestone "${m.title}" still has ${verdict.refuted.length} claim(s) shown false and ${broken.length} promise(s) of earlier work broken after two fixes: ${[...verdict.refuted.map((r) => `${r.id} (${r.fact})`), ...broken.map((b) => `${b.key} (${b.fact})`)].join('; ')}`
    log(stopped)
    break
  }
}

return {
  mode: plan.mode || null,
  summary: plan.summary,
  decided: plan.decided || [],
  spec: '.sz/spec.md',
  milestones: done,
  notBuilt: milestones.slice(done.length).map((m) => m.title),
  stopped,
}
