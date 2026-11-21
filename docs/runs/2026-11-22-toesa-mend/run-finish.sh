#!/bin/zsh
# The milestone mend of the specimen (퇴사점검) had been left open on one claim (server) after two fixes. Taken up at
# the fix, with the plugin as it stood on the branch phone-again at 61c29b3 (a frozen copy): a claim handed over
# again comes with what was found before and its fixer is told to mend the kind. The request says who writes it.
P=$HOME/.studio-zero/specimens/2026-11-21/toesa-check
cd $P
export CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0
date '+%Y-%m-%d %H:%M:%S finish start' >> $P/clock.txt
caffeinate -i -s perl -e 'alarm shift; exec @ARGV' 28800 claude -p --plugin-dir /Users/hosoo/project/conclave/.claude/worktrees/measure-toesa --model opus --effort xhigh --permission-mode auto \
  --allowedTools Bash Read Write Edit Glob Grep Agent Skill Workflow WebSearch WebFetch \
  --settings '{"sandbox":{"enabled":true,"autoAllowBashIfSandboxed":true}}' --output-format stream-json --verbose \
  "$(cat $P/finish-request.txt)" < /dev/null > $P/finish.jsonl 2>> $P/finish.err
date "+%Y-%m-%d %H:%M:%S finish end (exit $?)" >> $P/clock.txt
