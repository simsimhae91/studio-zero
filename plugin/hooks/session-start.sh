#!/bin/sh
# What a session is told when it starts in a project the harness knows: that there is a map and a progress log,
# and what open contracts still owe. A project with no .sz folder is told nothing.
[ -d .sz ] || exit 0
if [ -f .sz/map.md ]; then
  echo "This project has a Studio Zero map at .sz/map.md$( [ -f .sz/progress.md ] && echo ' and a progress log at .sz/progress.md (its last lines are where work stands)' ). Read them before working. Use the sz-work skill for any request to build, change or fix something."
else
  echo "This project has a .sz folder and no map yet: use the sz-onboard skill before working in it."
fi
if [ -f .sz/progress.md ]; then echo; echo "Last lines of .sz/progress.md:"; tail -n 8 .sz/progress.md; fi
"${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" contract status 2>/dev/null | head -n 30 || true
