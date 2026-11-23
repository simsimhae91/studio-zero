#!/bin/zsh
# The ruling after the trial's own fixer (fix-copy at its commit 0303139): handed the as-drawn claim and the three lines that fixer put under notFixed, does it correct how the two frozen flows read, and nothing they expect?
T=/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test
cd $T/fix-copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S rule2 start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/after-fix-test --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/request-rule2.txt)" < /dev/null > $T/rule2.jsonl 2>> $T/rule2.err
date "+%Y-%m-%d %H:%M:%S rule2 end (exit $?)" >> $T/clock.txt
