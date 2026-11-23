#!/bin/zsh
# The ruling after the first fix of the confirming run (ee1bd80), handed that run's own prompt with the text of cac9641: may it correct how a frozen flow presses, and does it change nothing the flow expects?
T=/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test
cd $T/rule-copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S rule start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/after-fix-test --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/request-rule.txt)" < /dev/null > $T/rule.jsonl 2>> $T/rule.err
date "+%Y-%m-%d %H:%M:%S rule end (exit $?)" >> $T/clock.txt
