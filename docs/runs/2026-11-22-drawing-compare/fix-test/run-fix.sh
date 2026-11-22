#!/bin/zsh
# A test of one change of the harness, not a stage of a product: a fixer (the plugin on branch
# frozen-against-source at 7ee7d49, Opus at effort high as the workflow runs its fixers) is handed the prompt the
# first fixer of the run was given on 2026-11-22 15:29, cut to the two claims about the wage rule and with the one
# new instruction, on a copy of the product as it stood then (e75715a, with the first look's verdicts and
# evidence). Does it say that the claim's figure and its frozen test ask for what the source refuses?
T=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/fix-test
cd $T/copy || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S fix start" >> $T/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/frozen-source --model opus --effort high --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Skill WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $T/prompt-fix.txt)" < /dev/null > $T/fix.jsonl 2>> $T/fix.err
date "+%Y-%m-%d %H:%M:%S fix end (exit $?)" >> $T/clock.txt
