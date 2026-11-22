#!/bin/zsh
# The second half of the test: the ruling (sz:arbiter, the plugin on branch frozen-against-source at 7ee7d49) is
# handed the prompt the run gave its first ruling, with the two wage claims, what the test's fixer said cannot be
# made true, and the one new option. Does it set them aside for the owner, or find the product wrong?
T=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/fix-test
cd $T/copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S rule start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/frozen-source --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/request-rule.txt)" < /dev/null > $T/rule.jsonl 2>> $T/rule.err
date "+%Y-%m-%d %H:%M:%S rule end (exit $?)" >> $T/clock.txt
