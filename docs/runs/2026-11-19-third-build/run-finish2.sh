#!/bin/zsh
# The finishing run of 2026-11-21 was stopped as its third look began: the plugin it ran on (4875185) shared a
# look after a fix among three verifiers with a simulator each, which this Mac does not hold (91 minutes where one
# verifier had taken 37). This takes the native milestone up again at the fix, on the plugin as mended (24eca21:
# simulators are booted, and simulator work shared, within what the Mac holds; a written flow costs its run).
P=$HOME/.studio-zero/specimens/2026-11-19/diet-c
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S finish2 start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 14400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-day2 --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/finish2-request.txt)" < /dev/null > $P/finish2.jsonl 2>> $P/finish2.err
date "+%Y-%m-%d %H:%M:%S finish2 end (exit $?)" >> $P/clock.txt
