#!/bin/zsh
# The run of 2026-11-18 was cut sixteen minutes into its first verification (the Mac was closed and carried away,
# 11:52; every agent ended on an API error). This continues it from the built state (ca13f04), with the same
# frozen copy of the plugin (17e4bce), so that everything after "built" is measured in one stretch.
P=$HOME/.studio-zero/specimens/2026-11-18/diet-b
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%H:%M:%S continue start' >> $P/clock.txt
perl -e 'alarm shift; exec @ARGV' 21600 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-faster --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/continue-request.txt)" < /dev/null > $P/continue.jsonl 2>> $P/continue.err
date "+%H:%M:%S continue end (exit $?)" >> $P/clock.txt
cat $P/clock.txt
