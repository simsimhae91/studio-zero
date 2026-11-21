#!/bin/zsh
# The same first pass a third time, from the same approved prototype, with the plugin as it stood on the night of
# 2026-11-18 (branch held-clock at a53ce0c, a frozen copy): beside 2026-11-17 (290 minutes) and 2026-11-18 (211).
P=$HOME/.studio-zero/specimens/2026-11-19/diet-c
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S build start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 21600 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-day2 --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/build-request.txt)" < /dev/null > $P/build.jsonl 2>> $P/build.err
date "+%Y-%m-%d %H:%M:%S build end (exit $?)" >> $P/clock.txt
cat $P/clock.txt
