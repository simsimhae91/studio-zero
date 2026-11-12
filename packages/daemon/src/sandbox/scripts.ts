import { shq } from '../util/run.ts';

/**
 * Shell scripts executed with `bash -c` inside a sandbox container. They are plain functions of their inputs so
 * the test-suite can run the exact same text against a real git repository in a temp directory.
 */

const GIT_ID = '-c user.name=studio-zero -c user.email=studio-zero@localhost';
const BRANCH_PATTERN = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._\/-]{1,120}(?<![.\/])$/;

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
export function startBranchScript(p: { workspace: string; branch: string; from: string }): string {
  assertBranchName(p.branch);
  assertBranchName(p.from);
  return `set -eu
cd ${shq(p.workspace)}
git checkout -q ${shq(p.from)}
git checkout -q -B ${shq(p.branch)}`;
}

/** Commits everything on the current branch. Prints the resulting HEAD; a clean tree is not an error. */
export function commitAllScript(p: { workspace: string; message: string }): string {
  return `set -eu
cd ${shq(p.workspace)}
git add -A .
git diff --cached --quiet || git ${GIT_ID} commit -q -m ${shq(p.message)}
git rev-parse HEAD`;
}

/** Merges with a merge commit so one task (or one Kirby proposal) is one revertable unit. Aborts cleanly on conflict. */
export function mergeScript(p: { workspace: string; branch: string; into: string }): string {
  assertBranchName(p.branch);
  assertBranchName(p.into);
  return `set -eu
cd ${shq(p.workspace)}
git checkout -q ${shq(p.into)}
if ! git ${GIT_ID} merge -q --no-ff -m ${shq(`merge: ${p.branch}`)} ${shq(p.branch)}; then
  git merge --abort || true
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
