#!/bin/zsh
# A test of one change of the harness, not a stage of a product: one verifier (sz:verifier, the plugin on branch
# as-drawn-exception at de75b10) is handed the prompt the verifier of the as-drawn claim was given in the run of
# that build, with the one changed instruction, on a copy of the product as its builder left it, the claim worded
# with its exception. Does it tell what another claim requires from what none does?
X=$1
T=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/claim-test
cd $T/copy-$X || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S $X start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 7200 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/as-drawn --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/request-$X.txt)" < /dev/null > $T/$X.jsonl 2>> $T/$X.err
date "+%Y-%m-%d %H:%M:%S $X end (exit $?)" >> $T/clock.txt
