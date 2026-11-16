export const meta = {
  name: 'build',
  description: 'Build a product, or grow one that exists, to the end, unattended: a spec (new, or the existing one extended), then for each milestone a frozen contract, the build, a verification by an agent that did not build it which also shows again what stood before, fixes, and a page of evidence. Milestones follow one another unless the plan puts some side by side: those are built at the same time in folders of their own, brought together, and everything that stands is shown again on the product as joined',
  whenToUse: 'A new product, or a change of several features to a product that already has a spec (lane L), after the owner has answered what only they can answer and has asked for it to run to the end without them.',
  phases: [
    { title: 'Plan', detail: 'the spec and its milestones, each with the claims that make it done' },
    { title: 'Build', detail: 'a milestone, or several side by side in folders of their own: contract, oracle, code' },
    { title: 'Verify', detail: 'each claim shown on the running product by an agent that did not build it; what was built side by side is shown again once joined' },
    { title: 'Close', detail: 'evidence page, progress line, commit' },
  ],
}

// args: { request: string, answers?: string, maxMilestones?: number, side?: 1|2|3, effort?: string | object }
// `request` is the owner's words. `answers` is what they said to the questions asked before this run (or the
// conservative answers taken for them, marked as such). The run asks nobody anything: what is open is decided
// conservatively and written down.
const request = args && typeof args.request === 'string' ? args.request.trim() : ''
const answers = args && typeof args.answers === 'string' ? args.answers.trim() : ''
const maxMilestones = args && Number.isInteger(args.maxMilestones) ? args.maxMilestones : 6
if (request === '') return { error: 'give args: { request: "<what to build, in the owner\'s words>", answers?: "<what the owner answered>" }' }

const TOOLS = 'The command `sz-eyes` is on your PATH (the sz plugin\'s). Load the skills you need with the Skill tool: `sz:work` (how work is sized, contracted and closed), `sz:verify` (how a product is launched, looked at and operated, and what counts as evidence), `sz:taste` (how a screen is put together, for anything a person looks at in a product made here), `sz:backend` (what a product stands on: where it runs for people, what holds its accounts and its data, and what that must prove), `sz:ship` (what a product needs before it can be put where people reach it), `sz:game` (when the product is a game or moves by itself: how it is built to be asked what it is doing, and proven with its time held), `sz:trial` (whether a person would pay: stand-ins for the people it is for use it the whole way), `sz:worth` (the case for the service: who it is for, what they use instead, and the rows of the whole job that say how deep it has to be).'
// Whether the session runs its commands inside a sandbox is found out once, when the work is planned, and every
// agent after that is told so from its first line. (In the first run under a sandbox each agent found it out
// for itself, by having a browser refused: sixteen lost tries among ten agents.)
const IN_SANDBOX = ' This session runs its commands inside a sandbox, where nothing that opens a browser, a desktop app, a simulator or Docker can start. Run those outside it from the first try (`dangerouslyDisableSandbox: true` on the Bash call): every `sz-eyes web`, `sz-eyes electron`, `sz-eyes ios` and `sz-eyes docker` command, and the project\'s own flows and tests that open a browser. Everything else stays inside. If such a call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
const MAYBE_SANDBOX = ' If `sz-eyes` says the session\'s command sandbox stopped it, run every command that opens a browser, a desktop app, a simulator or Docker outside the sandbox from the first try (`dangerouslyDisableSandbox: true` on the Bash call; the `sz:verify` skill says which). If that call is refused, do not judge the product by reading its code instead: say in what you return that the sandbox stopped the look.'
let SAND = MAYBE_SANDBOX
const GROUND = 'You are working in the project\'s folder. Read `.sz/map.md` first (if there is none, load `sz:onboard` and write it), then `.sz/spec.md`, `.sz/owner.md` (what the owner has said they want of this product: it comes before your own taste) and the last lines of `.sz/progress.md` if they exist. Follow the project\'s own rules as the map lists them. Other work of the owner\'s runs on this machine. Never use their simulator, browser profile or dev-server ports: a headless browser, the eyes\' own simulator, and for anything you launch a port taken from the machine (`PORT=$(sz-eyes port)`), never a number you chose. Before you look at what you launched, make sure it is yours that answers (your process is alive and the page is this product). End every server you start, by the process id you kept (`pid=$!` ... `kill $pid`): never by its port and never by its name, because what holds a port you wanted is somebody else\'s.'

// How hard each kind of agent thinks. Most of a milestone's time is its builder thinking: on the same milestone
// a builder at the highest setting took 21 to 23 minutes and one at "high" 11, for the same verdicts, whichever
// model it was (three runs, 2026-11-16, docs/runs/2026-11-16-speed). The owner chose, that day: the plan and the
// verification think as hard as the session (a wrong plan costs everything after it, and verification is the
// last door); building and fixing at "high"; closing, staging and joining, which are mechanical, at "low".
// args.effort overrides: one word for the builders, or { plan, build, verify, close, join } each a word
// ("session" for as hard as the session).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const DEFAULT_EFFORT = { build: 'high', close: 'low', join: 'low' }
const effort = (stage) => {
  const said = args && args.effort
  const word = typeof said === 'string' ? (stage === 'build' ? said : undefined) : said && typeof said === 'object' ? said[stage] : undefined
  if (word === 'session') return {}
  const chosen = EFFORTS.includes(word) ? word : DEFAULT_EFFORT[stage]
  return chosen ? { effort: chosen } : {}
}

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
    sandboxed: { type: 'boolean', description: 'what `sz-eyes sandbox` said when run as an ordinary command: true when it said "sandboxed"' },
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
          after: { type: 'array', items: { type: 'string' }, description: 'ids of the milestones that must be closed before this one starts. Leave it out for a line (each after the one before it). Two milestones with the same "after" are built side by side.' },
          alone: { type: 'boolean', description: 'true when nothing may be built beside it: it changes the shape of what is stored, or accounts and who may do what, or what every other milestone stands on' },
          touches: { type: 'array', items: { type: 'string' }, description: 'for a milestone built beside others: the screens, routes, stored tables and files it will change' },
          where: { type: 'string', description: 'only for a milestone that is built: the folder under .sz/trees/ it was built in, when an earlier run built it beside others and stopped before bringing them together' },
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
    sandbox: { type: 'string', description: 'empty unless the session\'s command sandbox stopped you from looking at the product and the call outside it was refused: then the exact refusal' },
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
    corrections: { type: 'array', items: { type: 'string' }, description: 'only when told not to edit .sz/map.md and .sz/spec.md here: each line of them this milestone made false, and what it should say now' },
  },
  required: ['report', 'closed', 'line'],
}

// ------------------------------------------------------------------ Plan
phase('Plan')
const plan = await agent(
  `You are planning a product (or a large change to one) that will then be built milestone by milestone with nobody watching. ${GROUND}${SAND} ${TOOLS}

The owner's request:
${request}

${answers ? `What the owner answered when asked beforehand:\n${answers}` : 'The owner was not asked anything beforehand. Where the request leaves something open that only they could say (who it is for, how it should feel, accounts, keys, money), take the conservative answer and list it under "decided". Wherever you write this down (the spec, the progress line), say that they were not asked: never that they did not answer.'}

If \`.sz/spec.md\` already exists, the product has been worked on before. Read it, the contracts under \`.sz/contracts/\` (\`sz-eyes contract status\`, \`sz-eyes contract show <id>\`), \`.sz/progress.md\`, \`.sz/backlog.md\`, \`git log\` and \`sz-eyes standing\` (what earlier work proved and the product has to keep true). Do not plan again what is done and do not rewrite the spec's history. Then it is one of two cases, or both:
- **Continue** (mode "continue"): an earlier run stopped before finishing what the spec has, and the request asks for that. Return the spec's milestones with their claims as the contracts and the spec have them, each with its "state": "closed" (its contract is closed), "built" (its contract is frozen and its code is committed, and it was not verified to the end: give "contractId", "launch", and under "disputes" any frozen check the earlier run reported as wrong about how it checks) or "todo". The order of the milestones that are not built yet is decided afresh by the rule under "The order" below: some of them may go side by side now even if the spec lists them in a line (give them "after").
- **Extend** (mode "extend"): the request asks for something the spec does not have, or for something to work differently. Amend \`.sz/spec.md\` so that it describes the product as it will be: change the lines that become false, add the new features to the order they are built in under new milestone names. Return the milestones that are not closed yet plus the new ones (state "todo"), with ids no contract has used. For each new milestone, besides its claims:
  - If \`git worktree list\` shows folders under \`.sz/trees/\`, an earlier run built milestones side by side and stopped before bringing them together: for each such milestone whose contract exists, state "built" (or "closed" if its contract is closed there) and "where": that folder's whole path.
  - "supersedes": the standing claims that will stop being true because what was asked has changed, each with the reason. Be exact: a standing claim you do not list stays a promise, and the milestone must keep it true. Prefer a change that keeps old promises (a new choice whose default is the old behaviour) to one that replaces them.
  - If it changes the shape of what is stored, one claim says that what was saved before the change is still there after it, shown by a test that starts from data in the old shape. The product carries over what exists; nobody is asked to delete their data.
First, whichever mode it is: run \`sz-eyes sandbox\` once, as an ordinary command (do not ask for it to run outside any sandbox), and return under "sandboxed" whether it answered "sandboxed". Everyone who works after you is told what it said.

Write no product code. Add a line to \`.sz/progress.md\` and commit \`.sz/\` if you amended the spec. If there is no spec yet (mode "new"):

Write \`.sz/spec.md\` in the owner's language: what the product is and for whom, the one thing it must do well, its features in the order they will be built, how it is launched and looked at, and what is deliberately not built. Then cut the work into ${Math.min(maxMilestones, 6)} milestones at most:
- If the owner had a case made for this service (\`sz-eyes worth show\` lists one: who it is for, what they use instead, the rows of the whole job), the spec is cut from it: the product is for the person and the moment of its \`who\` line; the first milestone delivers the row of kind \`edge\` whole; the rows of kind \`stake\` (what two or more of the things people already use have in common) are all in a milestone or named in the spec as deliberately not built, with the reason; rows of kind \`more\` wait. Name in each milestone the rows it covers, by their ids. If there is no case, plan without one: making a case is done only when the owner asks for it.
- The first milestone is the thinnest slice that runs end to end and can be launched and looked at: one real thing a person can do, saved or computed for real. Not scaffolding alone.
- Every milestone leaves the product working. A later milestone never depends on something a milestone before it left broken.
- **The order.** A line is the default: each milestone after the one before it, and you leave "after" out. Put milestones side by side (give them the same "after") only when every one of these is true of each of them: it does not change the shape of what is stored and does not touch accounts or who may do what (such a milestone is "alone": true and has nothing beside it); it adds screens, routes and modules of its own, and where it changes a file the others also change, it adds to a list there (a route table, a menu, an export) and does not rewrite the same lines; none of its claims needs what another of the group builds. Say under "touches" what each of them changes. The first milestone always has nothing beside it. Three side by side at most. When in doubt, a line: milestones built side by side are each proven in a folder of their own, and are shown again together only after they are brought into one, which costs a look each time and a repair when the guess was wrong.
- A product people use is more than a screen: where it keeps what a person enters, what happens when there is nothing yet, when something fails, the second time someone comes. Put those in the milestones where they belong, not at the end.
- A product that lives is looked after: from the first milestone it writes down what failed (a log the owner can read) and counts the one thing it is for (started, finished), and \`.sz/map.md\` says where. Without that nobody can tell later whether it works for people.
- A product is made to be put where people reach it. Choose what it stands on with \`sz:backend\` and say in the spec which and why, in two lines. From the first milestone: its settings come from the environment (no secret and no address of this machine in the code), \`/healthz\` answers with the commit it was built from, and every flow runs against the address in \`SZ_URL\` when given one and starts a server of its own only when not. If people have accounts in it, one milestone's claims say that one person cannot read or change what another stored, and neither can someone not signed in, shown by a flow with two people.
- For each milestone give 3 to 7 claims. A claim is something true of the running product that can be shown: with the figure, the words on the screen, the state. Each says how it is shown: a flow file or test that will be written before the code (name the file, in the project's own format), a look at a named screen in a named state, or a command. One claim says what the milestone must not break. What only a person can judge is one claim shown by "owner".
- Do not write product code in this step. Add a line to \`.sz/progress.md\` saying the spec is written, and commit \`.sz/\`.

Return the plan.`,
  { label: 'plan', phase: 'Plan', schema: PLAN, ...effort('plan') },
)
if (!plan || !Array.isArray(plan.milestones) || plan.milestones.length === 0) return { error: 'no plan came back' }
if (plan.sandboxed === true) SAND = IN_SANDBOX
const milestones = plan.milestones.slice(0, maxMilestones)
log(`${plan.mode === 'extend' ? 'spec extended' : plan.mode === 'continue' ? 'continuing' : 'spec written'}: ${milestones.length} milestone(s): ${milestones.map((m) => m.title).join(' / ')}`)

// ------------------------------------------------------------------ one milestone, from its contract to its close
// `where` is null when it is built in the project's own folder, with nothing beside it. When it is built beside
// others it is the folder made for it (a git worktree of the project): everything is done there, and what it
// did is brought into the project's folder afterwards, with the others, and shown again together.
async function milestone(m, n, before, where) {
  let stopped = null
  const here = where ? `the folder \`${where}\`` : 'the current folder'
  const PLACE = where
    ? ` This milestone is built beside others, each in a folder of its own. Yours is \`${where}\`: a git worktree of this project on its own branch, already made, with the product's dependencies in place. Do everything there: start every command with \`cd ${where} &&\`, and read and write only files under it (give their whole path). The project's own folder and the other milestones' folders are not yours while this runs: change nothing in them, and do not merge or switch branches. Do not edit \`.sz/map.md\` or \`.sz/spec.md\`: they are corrected when the milestones are brought together. What you launch is yours alone as well: a port of its own for every server and packager (\`sz-eyes port\`), and, if the product runs on a simulator, a simulator of this milestone's own (\`sz-eyes ios spare --name sz-${m.id}\`), never the one the others use; shut it down when you are done (\`sz-eyes ios rest <its id>\`).`
    : ''
  const claims = m.claims.map((c) => `- ${c.id} | ${c.says} | ${c.kind}:${c.ref}`).join('\n')
  const replaces = (m.supersedes || []).map((r) => `- ${r.contract}/${r.claim} | ${r.why}`).join('\n')

  const built = m.state === 'built' && m.contractId && m.launch ? { contractId: m.contractId, summary: 'built in an earlier run', launch: m.launch, disputes: m.disputes || [] } : await agent(
    `You are building milestone ${n} of ${milestones.length} of a product, with nobody watching. ${GROUND}${SAND} ${TOOLS}${PLACE}

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
5. Make sure the product starts with one command and say exactly which, and where it is seen. ${where ? 'If this milestone changed how it is launched, say so in "summary" (the map is corrected when the milestones are brought together).' : 'If this milestone changed how it is launched, correct \`.sz/map.md\`.'}
6. Commit the work on the current branch with a message that says what the milestone built.

Do not judge your own claims and do not record verdicts: someone who did not build this will operate it. Do not leave a server running.`,
    { label: `build:${m.id}`, phase: 'Build', schema: BUILT, ...effort('build') },
  )
  if (!built || (built.blocked && built.blocked.trim() !== '')) {
    stopped = `milestone "${m.title}" could not be built: ${built ? built.blocked : 'the builder did not answer'}`
    log(stopped)
    return { entry: null, stopped }
  }

  // A frozen check the builder says is itself wrong goes to someone who neither built nor judges: the arbiter
  // corrects how it checks, never what it checks, and writes the correction into the contract. (The first real
  // run stopped here for good: a check its builder had written with a quoting error could be fixed by nobody.)
  for (const dispute of built.disputes || []) {
    await agent(
      `Settle a dispute about a frozen check, met while building contract \`${built.contractId}\` in the project in ${here}.${PLACE} The file: \`${dispute.file}\`. It was frozen by that contract or by an earlier one that is closed: the contracts under \`.sz/contracts/\` say which, and a correction is recorded on the contract that froze it. What the builder says is wrong with it: ${dispute.problem}. The product is launched like this: ${built.launch}. Decide which it is (the check, the product, the claim, or a claim that what the owner asked later has replaced), act as your instructions say for that case, and return what you decided.`,
      { label: `arbiter:${m.id}`, phase: 'Build', agentType: 'sz:arbiter', ...effort('verify'), schema: { type: 'object', properties: { which: { type: 'string', enum: ['check', 'product', 'claim', 'replaced'] }, changed: { type: 'string' }, now: { type: 'string' } }, required: ['which', 'now'] } },
    )
  }

  const claimIds = new Set(m.claims.map((c) => c.id))
  const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${built.contractId} --note "<what was run and what it showed>"\``
  // again: null for the first look, or what was shown false and has been worked on since.
  const verify = (again) =>
    agent(
      `Verify contract \`${built.contractId}\` of the project in ${here}.${PLACE}${SAND} The product is launched like this: ${built.launch}. ${
        again
          ? `This is a second look, after a fix. ${again.claims.length > 0 ? `These claims of the contract were shown false before: ${again.claims.join(', ')}. Check each from the start, on the product as it is now, and record it with \`sz-eyes contract claim\`. ` : ''}${again.standing.length > 0 ? `These promises of earlier work were found broken: ${again.standing.join(', ')}. Show each again and record it with ${record}. ` : ''}A fix can break a neighbour: run once more every flow, test and command of this contract's other claims and of what stood before (\`sz-eyes standing\`), and report whatever fails now (a claim of this contract under "refuted", recorded with \`sz-eyes contract claim\`; a promise of earlier work under "broken", recorded as above). Claims you did not look at again keep their verdict: leave them out. Before the fix, this was noticed outside the claims: ${again.noticed.length > 0 ? again.noticed.map((n) => `[${n}]`).join(' ') : '(nothing)'}. Under "noticed" return each of those that is still so on the product as it is now (drop one the fix has ended) and whatever you notice that is new.`
          : `Give every claim a verdict and record each with \`sz-eyes contract claim\`. Then show again what stood before this work (\`sz-eyes standing\`) and record each with ${record}.`
      } I am telling you nothing about whether any claim is true. Record what you notice that no claim covers with \`sz-eyes contract notice\`, stop any server you start, and return the verdicts: under "broken" every promise of earlier work that does not hold now, under "held" every one you showed again that holds.`,
      { label: `verify:${m.id}${again ? ':again' : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT, ...effort('verify') },
    )
  let verdict = await verify(null)
  for (let round = 1; round <= 2 && verdict && verdict.refuted.length + (verdict.broken || []).length > 0; round++) {
    const wrong = verdict.refuted.map((r) => `- ${r.id}: ${r.fact}`).join('\n') || '(none)'
    const broke = (verdict.broken || []).map((b) => `- ${b.key}: ${b.fact}`).join('\n')
    await agent(
      `You are fixing a product so that claims shown false on it become true. ${GROUND}${SAND} ${TOOLS}${PLACE}

Contract \`${built.contractId}\` (read it: \`sz-eyes contract show ${built.contractId}\`). The product is launched like this: ${built.launch}.
Someone who did not build it operated the product and found these claims false:
${wrong}
${broke ? `And these were true before this work and are not now (each is a promise of earlier work: \`sz-eyes standing\` shows how it is checked):\n${broke}` : ''}

Find the cause of each in the product and fix it there. Do not edit the contract, the flows or the tests it names, or those of earlier work, and do not record verdicts. Check that what was already true still is (run the project's checks). Commit the fix. If a claim cannot be made true without changing what was asked, change nothing for it and say why.`,
      { label: `fix:${m.id}:${round}`, phase: 'Build', ...effort('build'), schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
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
  if (verdict && (verdict.sandbox || '').trim() !== '') {
    stopped = `milestone "${m.title}" was built and could not be looked at: the session's command sandbox stopped the browser and the call outside it was refused (${verdict.sandbox.trim().slice(0, 200)}). Nothing is known to be wrong with the product. The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: m.claims.filter((c) => !verdict.proven.includes(c.id)).map((c) => ({ id: c.id, why: 'the command sandbox stopped the look' })), noticed: verdict.noticed || [], report: null }, stopped }
  }
  if (!verdict) {
    stopped = `milestone "${m.title}" was built and could not be verified (the verifier did not answer)`
    log(stopped)
    return { entry: { id: m.id, title: m.title, contractId: built.contractId, proven: [], refuted: [], unchecked: m.claims.map((c) => ({ id: c.id, why: 'the verifier did not answer' })), noticed: [], report: null }, stopped }
  }

  const closed = await agent(
    `Close milestone "${m.title}" of the project in ${here}. ${TOOLS}${PLACE}
1. \`sz-eyes evidence ${built.contractId}\` writes the evidence page; note its path.
2. ${verdict.refuted.length + (verdict.broken || []).length === 0 ? `\`sz-eyes contract close ${built.contractId}\` (it also writes what the verifier noticed and what could not be checked to \`.sz/backlog.md\`).` : 'Leave the contract open: it has claims shown false, or broke what stood before it.'}
3. ${where ? 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), do not edit them here: return under "corrections" each such line and what it should say now.' : 'If this milestone made a line of \`.sz/map.md\` or \`.sz/spec.md\` false (how it is launched, where it keeps things, what it does), correct that line.'} If the project has a case (\`sz-eyes worth show\`) and the contract is closed, mark each row of the whole job that a claim proven here covers: \`sz-eyes worth row <case> <row> --ours have --by ${built.contractId}/<claim>\`. Only rows a proven claim shows; the rest stay as they are.
4. Read \`sz-eyes backlog\`. For each open line that this milestone has ended (the thing it names is built or fixed now, and a claim proven here or a commit of this milestone shows it), run \`sz-eyes backlog done "<some words of the line>" --by "${built.contractId}/<claim>, or the commit"\`. Tick only what is shown to be ended; a line that is half done stays open.
5. Add one line to \`.sz/progress.md\` in the owner's language: the date, the milestone, how many claims are proven, refuted and unchecked, how many promises of earlier work were shown again and whether any broke or was replaced, anything the verifier noticed that the owner should know, and what comes next. The figures are these, as the verifier returned them: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before this milestone, ${verdict.stood} hold`}, ${(verdict.broken || []).length} broken, ${(m.supersedes || []).length} replaced. Use them in the line and in the commit message; do not count again from \`sz-eyes standing\`, which after closing also counts this milestone's own claims.
6. Commit \`.sz/\` (the contract, the evidence, the standing record, the backlog, the progress line)${where ? ', on this folder\'s own branch' : ''}.
Change no product code.`,
    { label: `close:${m.id}`, phase: 'Close', schema: CLOSED, ...effort('close') },
  )
  const broken = verdict.broken || []
  const entry = { id: m.id, title: m.title, contractId: built.contractId, proven: verdict.proven, refuted: verdict.refuted, unchecked: verdict.unchecked, broken, stood: verdict.stood === undefined ? null : verdict.stood, replaced: m.supersedes || [], noticed: verdict.noticed || [], report: closed ? closed.report : null, corrections: (closed && closed.corrections) || [] }
  log(`${m.title}: ${verdict.proven.length} proven, ${verdict.refuted.length} refuted, ${verdict.unchecked.length} unchecked${verdict.stood === undefined ? '' : `; of what stood before, ${verdict.stood} hold and ${broken.length} broke`}`)

  // Nothing is built on a milestone that is known to be broken: the owner is told where it stands instead. The
  // contract's own word decides, not what the agents reported: a contract that would not close is not done.
  if (verdict.refuted.length + broken.length === 0 && !(closed && closed.closed === true)) {
    stopped = `milestone "${m.title}" was verified and its contract did not close: ${closed ? closed.why || 'sz-eyes contract close refused' : 'the closer did not answer'}`
    log(stopped)
    return { entry, stopped }
  }
  if (verdict.refuted.length + broken.length > 0) {
    stopped = `milestone "${m.title}" still has ${verdict.refuted.length} claim(s) shown false and ${broken.length} promise(s) of earlier work broken after two fixes: ${[...verdict.refuted.map((r) => `${r.id} (${r.fact})`), ...broken.map((b) => `${b.key} (${b.fact})`)].join('; ')}`
    log(stopped)
    return { entry, stopped }
  }
  return { entry, stopped: null }
}


// ------------------------------------------------------------------ the order: a line, or milestones side by side
// Most milestones stand on the one before, so a line is the default and nothing below changes for it. What the
// plan puts side by side is built and proven at the same time, each in a folder of its own, then brought into
// the project's folder; and because two things proven apart are not yet proven together, every claim that
// stands is shown again on the product as joined before anything is built on it.
const beside = typeof parallel === 'function' ? parallel : (thunks) => Promise.all(thunks.map((thunk) => thunk().catch(() => null)))
// Until milestones side by side have been run for real and measured, a line is what happens unless asked:
// args.side = 2 or 3 lets the plan's groups be built together.
let side = Math.max(1, Math.min(3, Number.isFinite(Number(args && args.side)) ? Math.floor(Number(args.side)) : 1))
const ids = new Set(milestones.map((m) => m.id))
const afterOf = (m) => {
  const at = milestones.indexOf(m)
  return Array.isArray(m.after) ? m.after.filter((id) => ids.has(id) && id !== m.id) : at > 0 ? [milestones[at - 1].id] : []
}
const done = []
const closedIds = new Set()
const joins = []
let stopped = null
const beforeText = () => done.map((d) => `- ${d.title}: ${d.earlier ? 'closed in an earlier run' : d.refuted.length === 0 ? 'proven' : `left with ${d.refuted.length} claim(s) refuted`}`).join('\n') || '(this is the first)'
const inOrder = () => done.sort((a, b) => milestones.findIndex((m) => m.id === a.id) - milestones.findIndex((m) => m.id === b.id))

for (const m of milestones) {
  if (m.state !== 'closed' || m.where) continue
  // What was shown of it is in its contract (some of its claims may be the owner's to judge, still open): none of that is repeated here as "proven".
  done.push({ id: m.id, title: m.title, contractId: m.contractId || m.id, earlier: true, verdicts: `closed in an earlier run: sz-eyes contract show ${m.contractId || m.id}`, proven: [], refuted: [], unchecked: [], noticed: [], report: null })
  closedIds.add(m.id)
  log(`${m.title}: closed in an earlier run`)
}

const STAGED = { type: 'object', properties: { folders: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, where: { type: 'string', description: 'the whole path of the folder' } }, required: ['id', 'where'] } }, problem: { type: 'string', description: 'empty unless the folders could not be made ready: then why' } }, required: ['folders'] }
const JOINED = { type: 'object', properties: { merged: { type: 'array', items: { type: 'string' }, description: 'ids brought into the project\'s folder' }, conflicted: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, files: { type: 'array', items: { type: 'string' } } }, required: ['id', 'files'] } } }, required: ['merged', 'conflicted'] }

// Brings what a group built into the project's folder and shows everything that stands again on the result.
// Returns why the run stops here, or null when the product stands joined.
async function bring(group, whereOf) {
  const list = (some) => some.map((m) => `- ${m.id} | ${m.title} | branch sz/${m.id} | folder ${whereOf.get(m.id)}`).join('\n')
  const corrections = group.flatMap((m) => (done.find((d) => d.id === m.id) || {}).corrections || [])
  const join = (some, again) =>
    agent(
      `Bring into the project in the current folder milestones that were built side by side, each in a folder of its own${again ? ' (these could not be brought in before and have since been brought up to date)' : ''}. ${TOOLS} Work in the project's own folder, never inside the milestones' folders. Change no product code and settle no conflict in it yourself. If git refuses to write under \`.git\` because of the session's command sandbox, run that command outside it (\`dangerouslyDisableSandbox: true\` on the Bash call).

The milestones (id | title | branch | folder):
${list(some)}

For each, in this order:
1. \`git merge --no-ff sz/<id> -m "<its title>"\`.
   - \`.sz/backlog.md\` and \`.sz/progress.md\` keep the lines of both sides by themselves.
   - If the merge stops on \`.sz/standing.json\` and nothing else: \`sz-eyes standing mend\`, then \`git add .sz/standing.json\` and \`git commit --no-edit\`.
   - If it stops on anything else: \`git merge --abort\`, leave that milestone's folder and branch as they are, and return it under "conflicted" with the files that conflicted. Go on with the next.
2. When it merged: \`git worktree remove <its folder>\` (with \`--force\` only when what is left there is not in git: installed dependencies, build output, data it stored while being tried) and \`git branch -d sz/<id>\`.
Then, if any merged:
3. ${corrections.length > 0 ? `Correct \`.sz/map.md\` and \`.sz/spec.md\`: each of these is a line a milestone made false and what it should say now. ${corrections.map((c) => `[${c}]`).join(' ')} Commit.` : 'Nothing in the map or the spec was reported as made false.'}
4. If what the product depends on changed (its lock file), put the dependencies in place again as the map says.
Run nothing else and judge nothing.`,
      { label: `join:${some.map((m) => m.id).join('+')}${again ? ':again' : ''}`, phase: 'Verify', schema: JOINED, ...effort('join') },
    )
  let joined = await join(group, false)
  if (!joined) return `milestones ${group.map((m) => `"${m.title}"`).join(', ')} were built side by side and could not be brought together (nobody answered). Each is closed on its own branch (sz/<id>) in its folder under .sz/trees/.`
  let merged = new Set(joined.merged)
  // What does not merge is brought up to date by someone who can build, in that milestone's own folder; nothing
  // about it is taken on trust: once in, it is shown again with everything else.
  const stuck = (joined.conflicted || []).map((c) => ({ m: group.find((g) => g.id === c.id), files: c.files })).filter((c) => c.m)
  for (const { m, files } of stuck) {
    await agent(
      `You are bringing one milestone's work up to date with the product it has to join. ${GROUND}${SAND} ${TOOLS}

Milestone "${m.title}" (contract \`${m.id}\`, closed) was built in the folder \`${whereOf.get(m.id)}\` beside others. The others have been brought into the project's own folder, and this one's branch no longer merges into it: ${files.join(', ') || '(git did not say which files)'}.

Do everything in that folder (start every command with \`cd ${whereOf.get(m.id)} &&\`; read and write only files under it):
1. Merge into it the branch the project's own folder has checked out (\`git worktree list\` shows which).
2. Settle each conflict so that what this milestone promised and what the others built are both true. Read both sides; \`sz-eyes contract show <id>\` says what each milestone promised. If \`.sz/standing.json\` conflicts: \`sz-eyes standing mend\`. Do not change a flow or a test that a contract froze so that it passes: if two milestones cannot both be true, settle nothing for that file and say so.
3. Run the project's whole check command and this milestone's own flows and tests there, and fix the product until they pass.
4. Commit.
Do not merge anything into the project's own folder yourself, and do not record verdicts.`,
      { label: `resolve:${m.id}`, phase: 'Build', ...effort('build'), schema: { type: 'object', properties: { settled: { type: 'string', description: 'what conflicted and how each was settled' }, cannot: { type: 'string', description: 'empty unless two milestones cannot both be true: then which claims, and why' } }, required: ['settled'] } },
    )
  }
  if (stuck.length > 0) {
    const again = await join(stuck.map((c) => c.m), true)
    for (const id of (again && again.merged) || []) merged.add(id)
  }
  const out = group.filter((m) => !merged.has(m.id))
  const lastId = (done.find((d) => d.id === group.filter((m) => merged.has(m.id)).slice(-1)[0]?.id) || {}).contractId || group[0].id
  let gate = null
  if (merged.size > 0) {
    const record = `\`sz-eyes standing record <contract>/<claim> --status holds|broken|unchecked --during ${lastId} --note "<what was run and what it showed>"\``
    const look = (again) =>
      agent(
        `Milestones ${group.filter((m) => merged.has(m.id)).map((m) => `"${m.title}"`).join(', ')} of the project in the current folder were built side by side, each proven in a folder of its own, and have just been brought into this one. Nobody has seen them together. There is no new claim to prove.${SAND} ${
          again
            ? `This is a second look, after a fix. These promises did not hold when the milestones were brought together: ${again.join(', ')}. Show each again, and once more everything else that stands, since a fix can break a neighbour.`
            : `Show again every claim that stands (\`sz-eyes standing\`) on the product as it is now in this folder: run every flow, test and command they are shown by (the project's whole check command in one go where it has one), and look at each screen that more than one of these milestones changed.`
        } The product is launched as \`.sz/map.md\` says. Record each with ${record}. I am telling you nothing about whether they hold. Record what you notice that no claim covers and that being brought together caused with \`sz-eyes contract notice ${lastId}\` only if that contract is still open; otherwise return it under "noticed". Stop any server you start. Return under "broken" every promise that does not hold now, under "held" those you showed again that hold, under "stood" how many hold; leave "proven", "refuted" and "unchecked" empty.`,
        { label: `gate:${group.map((m) => m.id).join('+')}${again ? ':again' : ''}`, phase: 'Verify', agentType: 'sz:verifier', schema: VERDICT, ...effort('verify') },
      )
    gate = await look(null)
    for (let round = 1; round <= 2 && gate && !(gate.sandbox || '').trim() && (gate.broken || []).length > 0; round++) {
      const broke = gate.broken.map((b) => `- ${b.key}: ${b.fact}`).join('\n')
      await agent(
        `You are fixing a product after milestones that were built side by side were brought into one. ${GROUND}${SAND} ${TOOLS}

Each was proven alone. Together, these promises do not hold (each is a standing claim: \`sz-eyes standing\` shows how it is checked):
${broke}

Find the cause in the product (usually two milestones that each changed the same thing their own way) and fix it there so that all of them hold. Do not edit a contract or the flows and tests one names, and do not record verdicts. Run the project's checks. Commit the fix.`,
        { label: `mend:${group.map((m) => m.id).join('+')}:${round}`, phase: 'Build', ...effort('build'), schema: { type: 'object', properties: { fixed: { type: 'array', items: { type: 'string' } }, notFixed: { type: 'array', items: { type: 'string' } } }, required: ['fixed'] } },
      )
      const again = await look(gate.broken.map((b) => b.key))
      if (!again) break
      gate = again
    }
  }
  joins.push({ ids: group.map((m) => m.id), merged: [...merged], notMerged: out.map((m) => m.id), stood: gate && gate.stood !== undefined ? gate.stood : null, broken: (gate && gate.broken) || [], noticed: (gate && gate.noticed) || [] })
  for (const m of group) if (merged.has(m.id)) closedIds.add(m.id)
  if (merged.size > 0 && !gate) return `milestones ${[...merged].join(', ')} were brought together and could not be shown together (the verifier did not answer)`
  if (gate && (gate.sandbox || '').trim() !== '') return `milestones ${[...merged].join(', ')} were brought together and could not be looked at: the session's command sandbox stopped the browser and the call outside it was refused (${gate.sandbox.trim().slice(0, 200)}). The owner chooses one: run sessions in auto mode, approve the unsandboxed command when asked, or turn the sandbox off for this project (/sandbox); then ask to continue.`
  if (gate && (gate.broken || []).length > 0) return `milestones ${[...merged].join(', ')} were each proven alone and, brought together, ${gate.broken.length} promise(s) do not hold after two fixes: ${gate.broken.map((b) => `${b.key} (${b.fact})`).join('; ')}`
  if (out.length > 0) return `milestone(s) ${out.map((m) => `"${m.title}"`).join(', ')} were built and closed on their own branch and could not be brought into the project's folder (the conflict was not settled). They are in ${out.map((m) => whereOf.get(m.id)).join(', ')}.`
  log(`brought together: ${[...merged].join(', ')}${gate && gate.stood !== undefined ? `; ${gate.stood} promise(s) hold on the product as joined` : ''}`)
  return null
}

while (!stopped) {
  const rest = milestones.filter((m) => !done.some((d) => d.id === m.id))
  if (rest.length === 0) break
  let ready = rest.filter((m) => afterOf(m).every((id) => closedIds.has(id)))
  // An order that goes round in a circle, or waits on something that is not in the plan: the rest goes in a line.
  if (ready.length === 0) ready = [rest[0]]
  const first = ready[0]
  // Left by an earlier run in a folder of its own: finished there, then brought in.
  if (first.where) {
    const whereOf = new Map([[first.id, first.where]])
    if (first.state === 'closed') done.push({ id: first.id, title: first.title, contractId: first.contractId || first.id, earlier: true, verdicts: `closed in an earlier run: sz-eyes contract show ${first.contractId || first.id}`, proven: [], refuted: [], unchecked: [], noticed: [], report: null })
    else {
      const r = await milestone(first, milestones.indexOf(first) + 1, beforeText(), first.where)
      if (r.entry) done.push(r.entry)
      if (r.stopped) { stopped = r.stopped; break }
    }
    stopped = await bring([first], whereOf)
    continue
  }
  // With nothing beside it: the first of all, one marked alone, one built in an earlier run, and whatever is
  // ready by itself.
  const group = side === 1 || closedIds.size === 0 || first.alone === true || first.state === 'built' ? [first] : ready.filter((m) => m.alone !== true && m.state !== 'built' && !m.where).slice(0, side)
  if (group.length < 2) {
    const r = await milestone(first, milestones.indexOf(first) + 1, beforeText(), null)
    if (r.entry) done.push(r.entry)
    if (r.stopped) { stopped = r.stopped; break }
    closedIds.add(first.id)
    continue
  }

  log(`side by side: ${group.map((m) => m.title).join(' / ')}`)
  const staged = await agent(
    `Make ready for ${group.length} milestones of the project in the current folder to be built side by side, each in a folder of its own. ${TOOLS} Work in the project's own folder and change no product code. If git refuses to write under \`.git\` because of the session's command sandbox, run that command outside it (\`dangerouslyDisableSandbox: true\` on the Bash call).

The milestone ids: ${group.map((m) => m.id).join(', ')}

1. \`git status --short\`. If anything is uncommitted, commit it: what earlier milestones left is part of the product, and the new folders start from this commit.
2. So that the folders are not taken for part of the product: add the line \`.sz/trees/\` to \`.git/info/exclude\` if it is not there.
3. So that lines both sides add to the same list are both kept later: add to \`.git/info/attributes\` (make it if needed), if not there, the lines \`.sz/backlog.md merge=union\` and \`.sz/progress.md merge=union\`.
4. For each id: \`git worktree add .sz/trees/<id> -b sz/<id>\`. If a folder or a branch of that name is left from an earlier run, make nothing and say so under "problem".
5. In each folder, put the product's dependencies in place as \`.sz/map.md\` says they are installed. Where the project's own folder already has them, copying is quicker than installing (on macOS \`cp -cR node_modules .sz/trees/<id>/node_modules\`). Whatever the map says must exist before the product starts and is not in git (a settings file, a built folder) is copied likewise. Never copy what the product stored (a database, what people entered): each folder starts with its own. For a native app, what a first build downloads and compiles is large and slow to get again (for React Native on iOS, the \`ios/Pods\` folder with its prebuilt archives): copy it too where the project's own folder has it.
6. In each folder run the project's quick check once (the map's check command), to see that it passes there before anything is changed.
Return each id with the whole path of its folder (\`pwd\` inside it).`,
    { label: `stage:${group.map((m) => m.id).join('+')}`, phase: 'Build', schema: STAGED, ...effort('join') },
  )
  const whereOf = new Map(((staged && staged.folders) || []).map((f) => [f.id, f.where]))
  if (!staged || (staged.problem || '').trim() !== '' || group.some((m) => !whereOf.get(m.id))) {
    // Folders of their own could not be made: nothing is lost by building them one after another.
    log(`the milestones are built in a line after all: ${staged ? staged.problem || 'a folder is missing' : 'nobody answered'}`)
    side = 1
    continue
  }
  const before = beforeText()
  const results = await beside(group.map((m) => () => milestone(m, milestones.indexOf(m) + 1, before, whereOf.get(m.id))))
  const good = []
  const bad = []
  group.forEach((m, k) => {
    const r = results[k]
    if (r && r.entry) done.push(r.entry)
    if (r && r.entry && !r.stopped) good.push(m)
    else bad.push(r && r.stopped ? r.stopped : `milestone "${m.title}": nobody answered`)
  })
  inOrder()
  // What came through is brought together and shown again even when another of the group did not: it is closed,
  // and leaving it on a branch would lose it. Then the run stops, saying which did not come through.
  if (good.length > 0) stopped = await bring(good, whereOf)
  if (bad.length > 0) stopped = [stopped, ...bad].filter(Boolean).join(' Also: ')
}
inOrder()

return {
  mode: plan.mode || null,
  summary: plan.summary,
  decided: plan.decided || [],
  spec: '.sz/spec.md',
  milestones: done,
  // What was built side by side: which milestones, which came into the project's folder, and how many promises held on the product as joined.
  joins,
  notBuilt: milestones.filter((m) => !done.some((d) => d.id === m.id)).map((m) => m.title),
  stopped,
}
