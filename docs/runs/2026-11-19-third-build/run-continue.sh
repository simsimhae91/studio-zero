#!/bin/zsh
# The build of 2026-11-18/19 stopped with its first pass open (two of twenty claims shown false after two fixes).
# This goes on from there to the native app, with the plugin as changed by what that run showed (f72a44f:
# a stopped milestone taken up at the fix, fixes counted by the claim, the wait on the builder's signal,
# sz-eyes copy --end).
P=$HOME/.studio-zero/specimens/2026-11-19/diet-c
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S continue start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 32400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-day2 --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/continue-request.txt)" < /dev/null > $P/continue.jsonl 2>> $P/continue.err
date "+%Y-%m-%d %H:%M:%S continue end (exit $?)" >> $P/clock.txt
