#!/bin/zsh
# The first pass of 퇴사점검 built once more from the commit it started from (06e90ad), with the plugin as it stands
# on branch phone-again at 710dce3 (everything changed on 2026-11-22), to see whether a first pass now closes.
# One headless session on Opus, session effort xhigh, nobody at the Mac, as the runs before it.
P=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/arm-c
PLUGIN=/Users/hosoo/project/conclave/.claude/worktrees/measure-c
cd $P || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S build start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 28800 claude -p --plugin-dir $PLUGIN --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/measure-request.txt)" < /dev/null > $P/build.jsonl 2>> $P/build.err
date "+%Y-%m-%d %H:%M:%S build end (exit $?)" >> $P/clock.txt
