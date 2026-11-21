#!/bin/zsh
# The design stage of a new specimen (퇴사점검), with the plugin as it stood on local main at da0c820 (a frozen
# copy): everything up to the held driver. The owner had not answered the questions before building: asked "away".
P=$HOME/.studio-zero/specimens/2026-11-21/toesa-check
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S design again start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 10800 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-toesa --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/design2-request.txt)" < /dev/null > $P/design2.jsonl 2>> $P/design2.err
date "+%Y-%m-%d %H:%M:%S design again end (exit $?)" >> $P/clock.txt
cat $P/clock.txt
