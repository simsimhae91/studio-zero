#!/bin/sh
# What a session is told when it starts in a project the harness knows: that there is a map and a progress log,
# what the owner has said they want of this product, what open contracts still owe, what earlier work proved and
# the product has to keep true, and how much is written down as left to do. A project with no .sz folder is
# told nothing.
[ -d .sz ] || exit 0
if [ -f .sz/map.md ]; then
  echo "This project has a Studio Zero map at .sz/map.md$( [ -f .sz/progress.md ] && echo ' and a progress log at .sz/progress.md (its last lines are where work stands)' ). Read them before working. Use the sz:work skill for any request to build, change or fix something, and sz:feedback when the owner reacts to the product or to work shown to them."
else
  echo "This project has a .sz folder and no map yet: use the sz:onboard skill before working in it."
fi
[ -f .sz/owner.md ] && echo "What the owner has said they want of this product (their words, and what was decided with them) is in .sz/owner.md: read it before building anything they will look at."
if [ -f .sz/progress.md ]; then echo; echo "Last lines of .sz/progress.md:"; tail -n 8 .sz/progress.md; fi
"${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" contract status 2>/dev/null | head -n 30 || true
"${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" standing --summary 2>/dev/null || true
if [ -f .sz/backlog.md ]; then
  left=$(grep -c '^[[:space:]]*- \[ \] ' .sz/backlog.md || true)
  [ "${left:-0}" -gt 0 ] && echo "${left} line(s) are written down as known and not done in .sz/backlog.md (sz-eyes backlog lists them)."
fi
exit 0
