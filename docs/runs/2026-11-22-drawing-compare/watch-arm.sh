#!/bin/zsh
# Keeps what a run's evidence folder held at two moments, because later looks write over it: when the builder
# returned (what it built, and in arm b the pictures it set beside the drawing), and when the first look ended
# (what the verifiers found before any fix). Reads the workflow's journal; changes nothing in the run's folder.
arm=$1
W=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare
P=$W/arm-$arm
S=$W/snap-$arm
mkdir -p $S
say() { echo "$(date '+%H:%M:%S') $*" | tee -a $S/watch.log }
jf() { ls ~/.claude/projects/-Volumes-DEV-SSD-sz-scratch-noindex-drawing-compare-arm-$arm/*/subagents/workflows/wf_*/journal.jsonl 2>/dev/null | head -1 }
took_built=0; took_look=0
while :; do
  J=$(jf)
  if [ -n "$J" ]; then
    if [ $took_built = 0 ] && python3 -c "
import json,sys
ok=False; ids={}
for l in open('$J'):
    try: o=json.loads(l)
    except: continue
    if o.get('type')=='started': ids[o.get('agentId')]=o.get('label','')
    if o.get('type')=='result' and ids.get(o.get('agentId'),'').startswith('build:'): ok=True
sys.exit(0 if ok else 1)"; then
      git -C $P log --oneline -1 > $S/built-head.txt
      rsync -a $P/.sz/evidence/ $S/at-built/ 2>/dev/null
      say "builder returned: head $(cat $S/built-head.txt | cut -c1-60), evidence kept ($(du -sh $S/at-built 2>/dev/null | cut -f1))"
      took_built=1
    fi
    if [ $took_look = 0 ] && grep -qE '"type":"started".*"label":"(fix:[a-z]|rule:|close:)' "$J" && ! grep -qE '"label":"fix:design' "$J"; then
      git -C $P log --oneline -1 > $S/look-head.txt
      rsync -a $P/.sz/evidence/ $S/first-look/ 2>/dev/null
      cp $P/.sz/contracts/*.json $S/ 2>/dev/null
      say "first look ended: head $(cat $S/look-head.txt | cut -c1-60), evidence kept ($(du -sh $S/first-look 2>/dev/null | cut -f1))"
      took_look=1
    fi
  fi
  grep -q "build end" $P/clock.txt && { say "run ended: $(tail -1 $P/clock.txt)"; break }
  [ $took_built = 1 ] && [ $took_look = 1 ] && { say "both kept"; break }
  sleep 20
done
