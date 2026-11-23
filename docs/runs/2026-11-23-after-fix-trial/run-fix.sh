#!/bin/zsh
# The first fixer of the confirming run (ec688f5), handed that run's own prompt cut to the as-drawn claim with the text of cac9641: does it mend to the drawing and name the frozen checks that press the old form?
T=/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test
cd $T/fix-copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S fix start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/after-fix-test --model opus --effort high --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/prompt-fix.txt)" < /dev/null > $T/fix.jsonl 2>> $T/fix.err
date "+%Y-%m-%d %H:%M:%S fix end (exit $?)" >> $T/clock.txt
