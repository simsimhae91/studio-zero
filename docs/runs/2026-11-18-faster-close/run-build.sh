#!/bin/zsh
# The same first pass again, from the same approved prototype, with the plugin as changed on 2026-11-18
# (branch faster-close at 17e4bce, a frozen copy of it): measured beside the run of 2026-11-17 (290 minutes).
P=$HOME/.studio-zero/specimens/2026-11-18/diet-b
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%H:%M:%S build start' >> $P/clock.txt
perl -e 'alarm shift; exec @ARGV' 28800 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-faster --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/build-request.txt)" < /dev/null > $P/build.jsonl 2>> $P/build.err
date "+%H:%M:%S build end (exit $?)" >> $P/clock.txt
cat $P/clock.txt
