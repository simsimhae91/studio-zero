#!/bin/zsh
# The product as it stood when its first pass closed (diet-c at 2226f9a), taken on to the native app once more,
# with the plugin as changed by what the run of 2026-11-19 showed: a plan's claims fit the contract, a flow on a
# simulator is a verifier's whole share, claims are shared by their check, fields get ids, a look at a simulator
# measures the screen, a fixer searches earlier checks, a copy's stacks are stopped by their ids, an arbiter
# commits what it corrects.
P=$HOME/.studio-zero/specimens/2026-11-21/diet-d
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S phone start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 32400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-day2 --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/phone-request.txt)" < /dev/null > $P/phone.jsonl 2>> $P/phone.err
date "+%Y-%m-%d %H:%M:%S phone end (exit $?)" >> $P/clock.txt
