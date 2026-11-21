#!/bin/zsh
# The first pass of the new specimen (퇴사점검), from the prototype the owner said yes to, with the plugin as it
# stood on local main at 6580274 (a frozen copy with its dependencies installed). The owner had not answered the
# questions before building: asked "away". One milestone, then it ends.
P=$HOME/.studio-zero/specimens/2026-11-21/toesa-check
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S build start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 28800 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-toesa --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/build-request.txt)" < /dev/null > $P/build.jsonl 2>> $P/build.err
date "+%Y-%m-%d %H:%M:%S build end (exit $?)" >> $P/clock.txt
cat $P/clock.txt
