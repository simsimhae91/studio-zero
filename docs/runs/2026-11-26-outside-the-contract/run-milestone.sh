#!/bin/zsh
# A trial of the plugin as it stands in the worktree: the open milestone day-true of the owner's project worktape,
# on a clone of it, one milestone and no further. Ends itself after 90 minutes.
P=/Volumes/DEV-SSD/sz-scratch/worktape-trial-20261126
OUT=<the session's scratch folder>
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S start' >> $OUT/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/outside-contract --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $OUT/request.txt)" < /dev/null > $OUT/run.jsonl 2>> $OUT/run.err
date "+%Y-%m-%d %H:%M:%S end (exit $?)" >> $OUT/clock.txt
cat $OUT/clock.txt
