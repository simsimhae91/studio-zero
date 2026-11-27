#!/bin/sh
# What a session is told when it starts in a project the harness knows: that there is a map and a progress log,
# what the owner has said they want of this product, what open contracts still owe, what earlier work proved and
# the product has to keep true, and how much is written down as left to do. A project with no .sz folder is
# told that the harness is here and where work in it starts: the owner loaded it to work its way.
# The Korean a session wrote came out in the plugin's own English turned word for word; the sentence names the words.
echo "The Korean you write (to the owner, in files, on a product's screens) is the plain Korean a product team uses at work. Do not write 서다/세우다 (계획이 선다, 기준을 세운다), 짓다 (제품을 짓는다), 열리다 (결과가 열린다, 화면이 열린다) or 판 (첫 판, 새 판). Write 만들다, 구현하다, 정하다, 완성되다, 나오다, 뜨다, 보이다, 버전. The owner's own words are quoted as they said them."
if [ ! -d .sz ]; then
  echo "The sz harness is loaded in this session: the owner chose its way of working. This project has no map yet. Before the first request to build, change or fix something, load the sz:onboard skill and write .sz/map.md (minutes of reading; it changes no product code), then handle the request with the sz:work skill."
  exit 0
fi
echo "Speak to the owner in the language they write in, the short lines while work is under way included."
if [ -f .sz/map.md ]; then
  echo "This project has a Studio Zero map at .sz/map.md$( [ -f .sz/progress.md ] && echo ' and a progress log at .sz/progress.md (its last lines are where work stands)' ). Read them before working. Use the sz:work skill for any request to build, change or fix something, and sz:feedback when the owner reacts to the product or to work shown to them."
else
  echo "This project has a .sz folder and no map yet: use the sz:onboard skill before working in it. (A folder that holds only a case under .sz/worth or an idea under .sz/dive has no product yet: sz:work starts one from it.)"
fi
[ -f .sz/owner.md ] && echo "What the owner has said they want of this product (their words, and what was decided with them) is in .sz/owner.md: read it before building anything they will look at."
if [ -f .sz/progress.md ]; then echo; echo "Last lines of .sz/progress.md:"; tail -n 8 .sz/progress.md; fi
"${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" contract status 2>/dev/null | head -n 30 || true
"${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" standing --summary 2>/dev/null || true
if [ -d .sz/worth ]; then
  echo "The case for this service (who pays for what today, what was dropped, how deep it has to be), one line for each (sz-eyes worth show <id> for the whole):"
  "${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" worth show 2>/dev/null | head -n 8 || true
fi
if [ -d .sz/dive ]; then
  echo "Ideas dug out with the owner (sz:dive), one line for each: one not closed goes on only when the owner asks (/sz:dive); a closed one's idea.md is what a plan starts from, and what it settled is not asked again."
  "${CLAUDE_PLUGIN_ROOT}/bin/sz-eyes" dive show 2>/dev/null | head -n 5 || true
fi
if [ -f .sz/backlog.md ]; then
  left=$(grep -c '^[[:space:]]*- \[ \] ' .sz/backlog.md || true)
  [ "${left:-0}" -gt 0 ] && echo "${left} line(s) are written down as known and not done in .sz/backlog.md (sz-eyes backlog lists them)."
  waits=$(grep -c '^[[:space:]]*- \[ \] 주인이 볼 것' .sz/backlog.md || true)
  [ "${waits:-0}" -gt 0 ] && echo "${waits} of them wait for the owner's own judgement (the lines starting 주인이 볼 것). When the owner says what they think of one, in any words, record it at once: sz-eyes contract judged <contract> <claim> --verdict yes|no --said \"<their words>\"."
fi
exit 0
