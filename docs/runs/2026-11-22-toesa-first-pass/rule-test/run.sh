#!/bin/zsh
# A test of one rule of the harness, not a stage of a product: one verifier (sz:verifier, the plugin at 6392988) is
# handed the prompt the first verifier of the first pass was given on 2026-11-22, with the lines changed since, on
# a copy of the specimen as it stood built and unverified (e7e8e59). That verifier had found four faults by breaking
# its claims, recorded them as noticed, and recorded the claims proven. Does this one refute?
X=$1
R=$HOME/.studio-zero/specimens/2026-11-22/rule-test
cd $HOME/.studio-zero/specimens/2026-11-22/toesa-rule-test-$X || exit 1
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date "+%Y-%m-%d %H:%M:%S $X start" >> $R/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 5400 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-toesa --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $R/request-$X.txt)" < /dev/null > $R/$X.jsonl 2>> $R/$X.err
date "+%Y-%m-%d %H:%M:%S $X end (exit $?)" >> $R/clock.txt
