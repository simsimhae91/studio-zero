#!/bin/zsh
# What comes after the closed first pass of the specimen (퇴사점검): the wrong answers its verifiers had recorded as
# noticed, mended as a milestone. The plugin as it stood on the branch phone-again at 51bfa6c (a frozen copy with
# its dependencies installed): a claim a verifier breaks is refuted, though its check passes. One milestone more,
# then it ends; asked "away".
P=$HOME/.studio-zero/specimens/2026-11-21/toesa-check
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S continue start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 28800 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-toesa --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/continue-request.txt)" < /dev/null > $P/continue.jsonl 2>> $P/continue.err
date "+%Y-%m-%d %H:%M:%S continue end (exit $?)" >> $P/clock.txt
