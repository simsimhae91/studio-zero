#!/bin/zsh
# A trial of one agent: whoever rules at the end of a run, handed the request the workflow really gives it, on a
# clone of the owner's project as the run of 2026-11-26 left it (one claim shown false). Ends itself after 40 minutes.
P=/Volumes/DEV-SSD/sz-scratch/worktape-rule-20261126
OUT=<the session's scratch folder>
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S start' >> $OUT/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 2400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/outside-contract --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $OUT/request.txt)" < /dev/null > $OUT/run.jsonl 2>> $OUT/run.err
date "+%Y-%m-%d %H:%M:%S end (exit $?)" >> $OUT/clock.txt
cat $OUT/clock.txt
