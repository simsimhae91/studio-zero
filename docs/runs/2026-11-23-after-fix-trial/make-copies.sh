#!/bin/bash
# Three copies of the product of the confirming run (arm c), each at the commit one agent of that run began from,
# with the contract and the evidence as they stood then. Nothing in arm-c is changed.
set -eu
W=/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare
T=/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test
mk() {
  git clone -q "$W/arm-c" "$T/$1"
  cd "$T/$1"
  git checkout -q -b "$3" "$2"
  git remote remove origin
  rsync -a "$W/arm-c/node_modules/" node_modules/
  if [ -f "$W/arm-c/.dev.vars" ]; then cp "$W/arm-c/.dev.vars" .dev.vars; fi
}
# the ruling: after the first fix (ee1bd80), verdicts and evidence of the first look
mk rule-copy ee1bd80 after-first-fix
cp "$W/snap-c/first-pass.json" .sz/contracts/first-pass.json
rsync -a "$W/snap-c/first-look/first-pass/" .sz/evidence/first-pass/
# the fixer: at the first look's end (ec688f5), the same verdicts and evidence
mk fix-copy ec688f5 after-first-look
cp "$W/snap-c/first-pass.json" .sz/contracts/first-pass.json
rsync -a "$W/snap-c/first-look/first-pass/" .sz/evidence/first-pass/
# the look: after the third fix (29d2bb2), the contract rebuilt to the third look's end, and of the evidence
# what git holds at that commit plus the files the rebuilt contract names (nothing the fourth look wrote)
mk look-copy 29d2bb2 after-third-fix
python3 "$T/rebuild-contract.py" .sz/contracts/first-pass.json > "$T/rebuild-contract.out" 2>&1
python3 - <<'PY'
import json, os, shutil
W='/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/arm-c/.sz/evidence/first-pass'
c=json.load(open('.sz/contracts/first-pass.json',encoding='utf8'))
n=m=0
for cl in c['claims']:
    ev=cl.get('evidence') or []
    for e in ([ev] if isinstance(ev,str) else ev):
        dst=os.path.join('.sz/evidence/first-pass',e)
        if os.path.exists(dst): continue
        src=os.path.join(W,e)
        if os.path.isfile(src):
            os.makedirs(os.path.dirname(dst),exist_ok=True); shutil.copy2(src,dst); n+=1
        else: m+=1
print('evidence files the contract names, copied in:',n,'; named and not found:',m)
PY
for d in rule-copy fix-copy look-copy; do cd "$T/$d"; echo "$d: $(git log --oneline -1 | cut -c1-70) | $(git status --short | wc -l | tr -d ' ') changed or new | evidence $(find .sz/evidence -type f | wc -l | tr -d ' ') files"; done
