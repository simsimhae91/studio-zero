import { shq } from '../util/run.ts';

/**
 * Shell scripts executed with `bash -c` inside a sandbox container. They are plain functions of their inputs so
 * the test-suite can run the exact same text against a real git repository in a temp directory.
 */

const GIT_ID = '-c user.name=studio-zero -c user.email=studio-zero@localhost';
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,120}(?<![.\/])$/;

/** The branch a project's finished work is on: what a task starts from and what a merge or a landing moves. */
export const INTEGRATION_BRANCH = 'main';

export function assertBranchName(branch: string): void {
  if (!BRANCH_PATTERN.test(branch) || branch.endsWith('.lock')) throw new Error(`invalid branch name: ${JSON.stringify(branch)}`);
}

export function initWorkspaceScript(workspace: string): string {
  return `set -eu
cd ${shq(workspace)}
if [ ! -d .git ]; then
  git init -q -b main
  git ${GIT_ID} commit -q --allow-empty -m 'chore: initialize workspace'
fi`;
}

/**
 * Captures the complete working tree — tracked, modified and untracked files — as a commit under a hidden ref,
 * without touching HEAD, the current branch or the user's index. Ignored files (node_modules, build output) are
 * left out, which is what keeps this sub-second on real projects.
 *
 * Prints `<commit> <head|none> <branch|DETACHED>`.
 */
export function checkpointScript(p: { workspace: string; id: string; label: string }): string {
  return `set -eu
cd ${shq(p.workspace)}
gitdir=$(git rev-parse --git-dir)
head=$(git rev-parse -q --verify HEAD || true)
export GIT_INDEX_FILE="$gitdir/sz-index.$$"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
# Start from a copy of the real index: its stat cache lets "git add" skip re-hashing unchanged files.
if [ -f "$gitdir/index" ]; then cp "$gitdir/index" "$GIT_INDEX_FILE"; fi
git add -A .
tree=$(git write-tree)
if [ -n "$head" ]; then
  commit=$(git ${GIT_ID} commit-tree "$tree" -p "$head" -m ${shq(p.label)})
else
  commit=$(git ${GIT_ID} commit-tree "$tree" -m ${shq(p.label)})
fi
git update-ref ${shq(`refs/sz/checkpoints/${p.id}`)} "$commit"
branch=$(git symbolic-ref -q --short HEAD || echo DETACHED)
printf '%s %s %s\\n' "$commit" "\${head:-none}" "$branch"`;
}

/**
 * The working tree's content as one git tree id: tracked, modified and untracked files, ignored ones left out,
 * exactly what a checkpoint would capture. Nothing is written but loose objects: no ref, no commit, and the
 * user's index is not touched. Two calls print the same id when, and only when, no file differs between them.
 */
export function treeScript(p: { workspace: string }): string {
  return `set -eu
cd ${shq(p.workspace)}
gitdir=$(git rev-parse --git-dir)
export GIT_INDEX_FILE="$gitdir/sz-index.$$"
trap 'rm -f "$GIT_INDEX_FILE"' EXIT
if [ -f "$gitdir/index" ]; then cp "$gitdir/index" "$GIT_INDEX_FILE"; fi
git add -A .
git write-tree`;
}

/**
 * Restores the working tree to a checkpoint exactly: the branch pointer goes back to where it was, files changed
 * since are reverted, files created since are removed, and what was uncommitted at checkpoint time is
 * uncommitted again. Ignored files are not touched.
 */
export function rollbackScript(p: { workspace: string; id: string; headSha: string; branch: string }): string {
  if (p.branch !== 'DETACHED') assertBranchName(p.branch);
  if (p.headSha !== 'none' && !/^[0-9a-f]{40,64}$/.test(p.headSha)) throw new Error('invalid head sha');
  const restoreHead =
    p.headSha === 'none'
      ? ':'
      : p.branch === 'DETACHED'
        ? `git checkout -q -f --detach ${p.headSha}`
        : `git checkout -q -f -B ${shq(p.branch)} ${p.headSha}`;
  return `set -eu
cd ${shq(p.workspace)}
commit=$(git rev-parse -q --verify ${shq(`refs/sz/checkpoints/${p.id}^{commit}`)})
${restoreHead}
git read-tree --reset -u "$commit"
git clean -fdq
${p.headSha === 'none' ? ':' : 'git reset -q'}`;
}

/** Starts a task branch from the integration branch, carrying any uncommitted work along. */
export function startBranchScript(p: { workspace: string; branch: string; from: string; keep?: boolean }): string {
  assertBranchName(p.branch);
  assertBranchName(p.from);
  // With `keep`, a branch of that name that holds work `from` does not is gone back to as it is: what a task
  // committed before it was stopped. Otherwise the branch starts from `from`, replacing whatever it held. The
  // last line printed says which.
  return `set -eu
cd ${shq(p.workspace)}
if [ ${p.keep ? 1 : 0} = 1 ] && git rev-parse -q --verify ${shq(`refs/heads/${p.branch}`)} >/dev/null && [ -n "$(git rev-list -n 1 ${shq(`${p.from}..${p.branch}`)})" ]; then
  git checkout -q ${shq(p.branch)}
  echo kept
else
  git checkout -q ${shq(p.from)}
  git checkout -q -B ${shq(p.branch)}
  echo started
fi`;
}

/** Commits everything on the current branch. Prints the resulting HEAD; a clean tree is not an error. */
export function commitAllScript(p: { workspace: string; message: string; only?: readonly string[] }): string {
  // `only` names what the caller wrote. A path nothing matches (never written, never tracked) is passed over.
  const stage = p.only ? p.only.map((path) => `git add -A -- ${shq(path)} 2>/dev/null || true`).join('\n') : 'git add -A .';
  return `set -eu
cd ${shq(p.workspace)}
${stage}
git diff --cached --quiet || git ${GIT_ID} commit -q -m ${shq(p.message)}
git rev-parse HEAD`;
}

/**
 * Merges with a merge commit so one task (or one Kirby proposal) is one revertable unit. On a conflict nothing
 * is merged and the workspace is put back on the branch it was on: the owner was looking at that branch's
 * product, and is not left looking at the integration branch because a merge was tried.
 */
export function mergeScript(p: { workspace: string; branch: string; into: string }): string {
  assertBranchName(p.branch);
  assertBranchName(p.into);
  return `set -eu
cd ${shq(p.workspace)}
was=$(git symbolic-ref --quiet --short HEAD || git rev-parse HEAD)
git checkout -q ${shq(p.into)}
if ! git ${GIT_ID} merge -q --no-ff -m ${shq(`merge: ${p.branch}`)} ${shq(p.branch)}; then
  git merge --abort || true
  git checkout -q "$was" || true
  echo 'merge conflict' >&2
  exit 3
fi
git rev-parse HEAD`;
}

export function diffScript(p: { workspace: string; base: string; branch: string }): string {
  assertBranchName(p.base);
  assertBranchName(p.branch);
  const range = shq(`${p.base}...${p.branch}`);
  return `set -eu
cd ${shq(p.workspace)}
git diff --shortstat ${range}
echo '---sz-diff---'
git diff --no-color ${range}`;
}

/** Runs a long-lived process (dev server) in its own session so the whole process group can be stopped later. */
export function startProcessScript(p: { name: string; command: string; workspace: string }): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(p.name)) throw new Error('invalid process name');
  return `mkdir -p /tmp/sz
echo $$ > /tmp/sz/${p.name}.pid
cd ${shq(p.workspace)}
exec bash -c ${shq(p.command)} > /tmp/sz/${p.name}.log 2>&1`;
}

export function stopProcessScript(name: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error('invalid process name');
  return `pidfile=/tmp/sz/${name}.pid
[ -f "$pidfile" ] || exit 0
pid=$(cat "$pidfile")
kill -TERM -- "-$pid" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.3; done
kill -KILL -- "-$pid" 2>/dev/null || true
rm -f "$pidfile"`;
}

/**
 * The command an interactive terminal starts with: it records its own pid, like `startProcessScript`, and then
 * becomes a login shell. Run on a pseudo-terminal, that shell is a session leader, so `stopTerminalScript` can
 * end it and everything it started.
 */
export function terminalShellScript(name: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error('invalid process name');
  return `mkdir -p /tmp/sz
echo $$ > /tmp/sz/${name}.pid
if command -v bash >/dev/null 2>&1; then exec bash -l; fi
exec sh -l`;
}

/** Hangs up a terminal's shell (which passes the hangup on to its jobs), then kills whatever is left of its process group. */
export function stopTerminalScript(name: string): string {
  if (!/^[a-z][a-z0-9-]{0,30}$/.test(name)) throw new Error('invalid process name');
  return `pidfile=/tmp/sz/${name}.pid
[ -f "$pidfile" ] || exit 0
pid=$(cat "$pidfile")
kill -HUP "$pid" 2>/dev/null || true
for _ in 1 2 3 4 5; do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
kill -KILL -- "-$pid" 2>/dev/null || true
kill -KILL "$pid" 2>/dev/null || true
rm -f "$pidfile"`;
}

/** Polls a URL from inside the container until it answers with a non-5xx status. Exit 0 = ready. */
export function waitHttpScript(p: { url: string; timeoutSec: number }): string {
  return `for _ in $(seq 1 ${Math.max(1, Math.floor(p.timeoutSec * 2))}); do
  code=$(curl -s -o /dev/null -m 3 -w '%{http_code}' ${shq(p.url)} || true)
  case "$code" in 2*|3*|4*) exit 0;; esac
  sleep 0.5
done
exit 1`;
}

// ------------------------------------------------------------------ slots

/**
 * In a slot: the project's integration branch as the slot last saw it (when it was taken, and again each time it
 * tried to land). What a slot's task changed is measured from here, and a task told that the project has moved
 * puts its work on top of this.
 */
export const SLOT_SEEN_REF = 'refs/sz/main';

/**
 * Brings a slot's workspace to the project's as it stands: a clone of it the first time, then every branch the
 * project has, the integration branch checked out, and nothing left of whoever was here before (untracked files
 * go; what git ignores, installed dependencies and the backend's address among it, stays). Prints the commit.
 * `main` is where the slot sees the project's workspace, which it can only read.
 */
export function syncSlotScript(p: { workspace: string; main: string; into: string }): string {
  assertBranchName(p.into);
  return `set -eu
cd ${shq(p.workspace)}
if [ ! -d .git ]; then
  git clone -q --no-hardlinks ${shq(p.main)} .
fi
git rebase --abort >/dev/null 2>&1 || true
git merge --abort >/dev/null 2>&1 || true
git checkout -q -f --detach
git fetch -q --no-tags --force ${shq(p.main)} '+refs/heads/*:refs/heads/*'
git checkout -q -f ${shq(p.into)}
git reset -q --hard
git clean -fdq
git update-ref ${SLOT_SEEN_REF} HEAD
git rev-parse HEAD`;
}

/**
 * Puts a slot's installed dependencies where its lockfile says, and prints what it did: `none` (the project
 * installs nothing), `kept` (the lockfile is the one they were installed for), `copied` (the project's own
 * workspace has them installed for the same lockfile: copied from there, which on the sandbox's filesystem
 * shares the blocks and takes seconds) or `installed`. The lockfile is known by its git blob id, kept in the
 * slot's own `.git`.
 */
export function slotDepsScript(p: { workspace: string; main: string }): string {
  // `workspace` and `main` are the product's folder in the slot and in the project's workspace: where the
  // lockfile is. The marker is kept in the repository's own .git, wherever below it the product is.
  return `set -eu
cd ${shq(p.workspace)}
lock=''
for f in pnpm-lock.yaml package-lock.json yarn.lock bun.lockb; do if [ -f "$f" ]; then lock="$f"; break; fi; done
if [ -z "$lock" ]; then echo none; exit 0; fi
marker="$(git rev-parse --absolute-git-dir)/sz-deps"
want=$(git hash-object "$lock")
have=$(cat "$marker" 2>/dev/null || true)
if [ "$want" = "$have" ] && [ -d node_modules ]; then echo kept; exit 0; fi
rm -rf node_modules
if [ -d ${shq(`${p.main}/node_modules`)} ] && [ -f ${shq(p.main)}/"$lock" ] && [ "$(git hash-object ${shq(p.main)}/"$lock")" = "$want" ]; then
  cp -a --reflink=auto ${shq(`${p.main}/node_modules`)} node_modules 2>/dev/null || cp -a ${shq(`${p.main}/node_modules`)} node_modules
  did=copied
else
  mkdir -p /tmp/sz
  case "$lock" in
    pnpm-lock.yaml) cmd='pnpm install --frozen-lockfile --prefer-offline' ;;
    package-lock.json) cmd='npm ci' ;;
    yarn.lock) cmd='yarn install --frozen-lockfile' ;;
    *) cmd='bun install --frozen-lockfile' ;;
  esac
  if ! $cmd >/tmp/sz/slot-install.log 2>&1; then tail -c 2000 /tmp/sz/slot-install.log >&2; exit 4; fi
  did=installed
fi
printf %s "$want" > "$marker"
echo "$did"`;
}

/**
 * In a project's own workspace: installs what the lockfile in `workspace` (the product's folder) says, unless
 * that is what is installed. Prints `none` (nothing to install by), `kept` or `installed`. The lockfile's id is
 * kept inside node_modules, so a workspace that lost its node_modules installs again. For a product that was
 * brought in: one the studio builds installs for itself as it is built.
 */
export function depsScript(p: { workspace: string }): string {
  return `set -eu
cd ${shq(p.workspace)}
lock=''
for f in pnpm-lock.yaml package-lock.json yarn.lock bun.lockb; do if [ -f "$f" ]; then lock="$f"; break; fi; done
if [ -z "$lock" ]; then echo none; exit 0; fi
want=$(git hash-object "$lock")
if [ "$(cat node_modules/.sz-lock 2>/dev/null || true)" = "$want" ]; then echo kept; exit 0; fi
mkdir -p /tmp/sz
case "$lock" in
  pnpm-lock.yaml) cmd='pnpm install --frozen-lockfile --prefer-offline' ;;
  package-lock.json) cmd='npm ci' ;;
  yarn.lock) cmd='yarn install --frozen-lockfile' ;;
  *) cmd='bun install --frozen-lockfile' ;;
esac
if ! $cmd >/tmp/sz/install.log 2>&1; then tail -c 2000 /tmp/sz/install.log >&2; exit 4; fi
mkdir -p node_modules
printf %s "$want" > node_modules/.sz-lock
echo installed`;
}

/**
 * In a slot: puts the checked-out branch on top of the project's integration branch as it is now. Prints
 * `same <commit>` when the branch already stood on it, `moved <commit>` when it had to be moved. When the two
 * changed the same lines nothing is moved, the files that collide are printed, and the exit code is 3.
 */
export function rebaseOntoScript(p: { workspace: string; main: string; into: string }): string {
  assertBranchName(p.into);
  return `set -eu
cd ${shq(p.workspace)}
git fetch -q --no-tags ${shq(p.main)} ${shq(`refs/heads/${p.into}`)}
new=$(git rev-parse FETCH_HEAD)
git update-ref ${SLOT_SEEN_REF} "$new"
if git merge-base --is-ancestor "$new" HEAD; then echo "same $new"; exit 0; fi
if git ${GIT_ID} rebase -q "$new" >/dev/null 2>&1; then echo "moved $new"; exit 0; fi
git diff --name-only --diff-filter=U
git rebase --abort >/dev/null 2>&1 || true
exit 3`;
}

/**
 * In a slot: what `branch` holds beyond `base`, as a git bundle in base64 on stdout. A slot cannot write to the
 * project's workspace, so this is how its commits leave it. Exit code 7 when the branch holds nothing more.
 */
export function bundleOutScript(p: { workspace: string; base: string; branch: string }): string {
  assertBranchName(p.branch);
  return `set -eu
cd ${shq(p.workspace)}
mkdir -p /tmp/sz
[ -n "$(git rev-list -n 1 ${shq(`${p.base}..${p.branch}`)})" ] || exit 7
git bundle create -q /tmp/sz/slot-out.bundle ${shq(`${p.base}..${p.branch}`)}
base64 < /tmp/sz/slot-out.bundle
rm -f /tmp/sz/slot-out.bundle
git rev-parse ${shq(p.branch)} >&2`;
}

/**
 * In the project's own workspace: takes a bundle on stdin into `branch`. With `land`, the integration branch is
 * then moved forward to `land.commit`, and only if it still is where the slot saw it (`land.old`): where the
 * project's checkout stands on that branch its working files follow (a fast-forward, which refuses to write
 * over a file changed and not committed: exit 8), and where it stands on another branch (a heavy task at work)
 * only the ref moves and the checkout is not touched. Exit 6: the integration branch had moved.
 */
export function bundleInScript(p: { workspace: string; branch: string; land?: { into: string; commit: string; old: string } }): string {
  assertBranchName(p.branch);
  const fetch = `set -eu
cd ${shq(p.workspace)}
mkdir -p /tmp/sz
cat > /tmp/sz/slot-in.bundle
git -c fetch.fsckObjects=true fetch -q --no-tags --force /tmp/sz/slot-in.bundle ${shq(`refs/heads/${p.branch}:refs/heads/${p.branch}`)}
rm -f /tmp/sz/slot-in.bundle`;
  if (!p.land) return `${fetch}
git rev-parse ${shq(`refs/heads/${p.branch}`)}`;
  assertBranchName(p.land.into);
  if (!/^[0-9a-f]{40}$/.test(p.land.commit) || !/^[0-9a-f]{40}$/.test(p.land.old)) throw new Error('a landing names two full commit ids');
  return `${fetch}
[ "$(git rev-parse ${shq(`refs/heads/${p.branch}`)})" = ${p.land.commit} ] || exit 5
if [ "$(git symbolic-ref --quiet --short HEAD || true)" = ${shq(p.land.into)} ]; then
  [ "$(git rev-parse HEAD)" = ${p.land.old} ] || exit 6
  git merge -q --ff-only ${p.land.commit} >/dev/null 2>&1 || exit 8
else
  git update-ref ${shq(`refs/heads/${p.land.into}`)} ${p.land.commit} ${p.land.old} 2>/dev/null || exit 6
fi
git rev-parse ${shq(`refs/heads/${p.land.into}`)}`;
}

// ------------------------------------------------------------------ what a change reaches

/**
 * A node program, run in a workspace, that says what a set of changed files reaches. It reads
 * `{ changed: string[], screens: string[] }` on stdin and prints, as JSON:
 *
 *   affected     the changed files and every file that imports one of them, however far up
 *   named        of those, the files that carry a screen's id as a quoted string, with the ids
 *   screenFiles  how many files of the whole workspace name a screen
 *   loose        changed files that are not source and that nothing imports (a config, a stylesheet nobody
 *                imports, the lockfile): what they reach cannot be read off imports
 *
 * Imports are read with a pattern, not a parser: `import … from`, `export … from`, a bare `import '…'`,
 * `require('…')` and `import('…')`, relative or through a one-star `paths` entry of tsconfig.json. A router's
 * layout file (`_layout.*`, `layout.*`) is taken to be imported by every file under its directory, since the
 * router wraps them in it without their saying so. Where the pattern is wrong it is wrong towards more: a
 * file thought affected that is not costs a walk, never a miss.
 */
const REACH_PROGRAM = String.raw`
const fs = require('fs'), path = require('path').posix, cp = require('child_process');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/;
const listed = cp.execSync('git ls-files -co --exclude-standard', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
const all = new Set(listed);
const sources = listed.filter((f) => SOURCE.test(f));
let aliases = [];
try {
  const text = fs.readFileSync('tsconfig.json', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  const options = JSON.parse(text).compilerOptions || {};
  for (const [from, to] of Object.entries(options.paths || {})) {
    if (!from.endsWith('/*')) continue;
    for (const target of to) if (target.endsWith('/*')) aliases.push([from.slice(0, -1), path.join(options.baseUrl || '.', target.slice(0, -1))]);
  }
} catch {}
const ENDINGS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.web.ts', '.web.tsx', '.native.ts', '.native.tsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const resolve = (spec, from) => {
  const tries = [];
  if (spec.startsWith('.')) tries.push(path.join(path.dirname(from), spec));
  else for (const [prefix, target] of aliases) if (spec.startsWith(prefix)) tries.push(path.join(target, spec.slice(prefix.length)));
  for (const base of tries) for (const ending of ENDINGS) {
    const file = path.normalize(base + ending).replace(/^\.\//, '');
    if (all.has(file)) return file;
  }
  return null;
};
const IMPORT = /(?:import|export)\s[^'"()]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const importers = new Map();
const add = (file, by) => { if (file === by) return; const set = importers.get(file) || new Set(); set.add(by); importers.set(file, set); };
const names = new Map();
const ids = input.screens.filter((id) => /^[\w.-]{1,40}$/.test(id));
for (const file of sources) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const m of text.matchAll(IMPORT)) { const to = resolve(m[1] || m[2] || m[3], file); if (to) add(to, file); }
  const found = ids.filter((id) => text.includes("'" + id + "'") || text.includes('"' + id + '"') || text.includes(String.fromCharCode(96) + id + String.fromCharCode(96)));
  if (found.length > 0) names.set(file, found);
}
for (const layout of sources.filter((f) => /(^|\/)_?layout\.(tsx?|jsx?)$/.test(f))) {
  const dir = path.dirname(layout) === '.' ? '' : path.dirname(layout) + '/';
  for (const file of sources) if (file !== layout && file.startsWith(dir)) add(layout, file);
}
const affected = new Set();
const queue = input.changed.filter((f) => all.has(f));
while (queue.length > 0) {
  const file = queue.pop();
  if (affected.has(file)) continue;
  affected.add(file);
  for (const by of importers.get(file) || []) queue.push(by);
}
const loose = input.changed.filter((f) => !SOURCE.test(f) && !(importers.get(f) || new Set()).size);
const named = {};
for (const file of affected) if (names.has(file)) named[file] = names.get(file);
process.stdout.write(JSON.stringify({ affected: [...affected].sort(), named, screenFiles: names.size, loose }));
`;

/** Runs `REACH_PROGRAM` in a workspace. Feed it `JSON.stringify({ changed, screens })` on stdin. */
export function reachScript(p: { workspace: string }): string {
  return `set -eu\ncd ${shq(p.workspace)}\nnode -e ${shq(REACH_PROGRAM)}`;
}

/**
 * The files a workspace's working tree changes since it left `base`, tracked or new, one a line, each as a path
 * from the repository's root (`workspace` is that root). Since it left: measured from where the work and `base`
 * part, so that what `base` has gained meanwhile is not counted as the work's own.
 */
export function changedFilesScript(p: { workspace: string; base: string }): string {
  return `set -eu\ncd ${shq(p.workspace)}\nfrom=$(git merge-base HEAD ${shq(p.base)} 2>/dev/null || git rev-parse ${shq(p.base)})\n{ git diff --name-only "$from"; git ls-files -o --exclude-standard; } | sort -u`;
}

/**
 * A path from a repository's root as a path from its product's folder (`root`, '' for the root itself): a file
 * of the product loses the folder's name, and one outside it is reached by going up (`../docs/a.md`).
 */
export function fromProduct(root: string, file: string): string {
  if (root === '') return file;
  if (file === root) return '.';
  if (file.startsWith(`${root}/`)) return file.slice(root.length + 1);
  return `${root.split('/').map(() => '..').join('/')}/${file}`;
}
