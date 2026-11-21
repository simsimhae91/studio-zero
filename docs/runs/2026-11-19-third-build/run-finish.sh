#!/bin/zsh
# The continuing run of 2026-11-19 was stopped on the owner's word in the native milestone's third look. This
# takes that milestone up where the contract left it (every claim with a verdict, keeps shown false and mended
# since), with the plugin as changed by what that run showed (4875185: a plan's claims fit the contract, a flow
# on a simulator is a whole share, a fixer searches earlier checks, a copy's stacks are stopped by their ids, an
# arbiter commits what it corrects).
P=$HOME/.studio-zero/specimens/2026-11-19/diet-c
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S finish start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 14400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-day2 --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/finish-request.txt)" < /dev/null > $P/finish.jsonl 2>> $P/finish.err
date "+%Y-%m-%d %H:%M:%S finish end (exit $?)" >> $P/clock.txt
