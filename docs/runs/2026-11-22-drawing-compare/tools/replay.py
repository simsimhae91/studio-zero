#!/usr/bin/env python3
"""Bring a running product to each state a verifier recorded, and keep the look it ends on.

A verifier's walk (`sz-eyes web do --json`) records its address and its steps. Run again against the product as
its builder left it, the same steps reach the same states, so every build is looked at the same way whenever its
own verifier happened to take its pictures.

  replay.py <folder of recorded walks (<state>.json)> <base address> <out folder> [state...]
"""
import json, os, subprocess, sys
from urllib.parse import urlsplit

recorded, base, out = sys.argv[1], sys.argv[2].rstrip('/'), sys.argv[3]
only = set(sys.argv[4:])
os.makedirs(out, exist_ok=True)
eyes = os.environ.get('SZ_EYES', 'sz-eyes')
done = failed = 0
for name in sorted(os.listdir(recorded)):
    if not name.endswith('.json'): continue
    state = name[:-5]
    if only and state not in only: continue
    walk = json.load(open(os.path.join(recorded, name)))
    if not isinstance(walk, dict) or 'steps' not in walk or 'url' not in walk: continue
    was = urlsplit(walk['url'])
    url = base + (was.path or '/') + ('?' + was.query if was.query else '') + ('#' + was.fragment if was.fragment else '')
    steps = [s['step'] if isinstance(s, dict) else s for s in walk['steps']]
    cmd = [eyes, 'web', 'do', url, '--size', walk.get('size', 'phone'), '--json', '--out', out, '--name', state]
    for s in steps: cmd += ['--step', s]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
    try:
        got = json.loads(r.stdout)
    except Exception:
        failed += 1; print(f'{state}: no record came back (exit {r.returncode}): {r.stderr.strip()[:200]}'); continue
    json.dump(got, open(os.path.join(out, state + '.json'), 'w'), ensure_ascii=False)
    ok = got.get('passed', True)
    done += 1; failed += 0 if ok else 1
    print(f"{state}: {'reached' if ok else 'STOPPED'} ({len(got.get('end', {}).get('texts', []))} lines of words)")
print(f'{done} states walked, {failed} not reached')
