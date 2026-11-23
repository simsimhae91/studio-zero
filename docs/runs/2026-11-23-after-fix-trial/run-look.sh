#!/bin/zsh
# The first verifier of the fourth look of the confirming run (29d2bb2), handed that run's own prompt with the text of cac9641: does it try new cases only where the fix reached?
T=/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test
cd $T/look-copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S look start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/after-fix-test --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/request-look.txt)" < /dev/null > $T/look.jsonl 2>> $T/look.err
date "+%Y-%m-%d %H:%M:%S look end (exit $?)" >> $T/clock.txt
