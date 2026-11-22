#!/usr/bin/env python3
"""The second build walked to each screen in the states its own verifier set (the builder's list of states with
the drawing's example data put in), one walk a screen, each walk's record kept so that words can be compared.
The verifier's file is used as it wrote it up to where its own run begins.
  b-verifier-states.py <product url> <project dir> <the verifier's asdrawn.py> <out dir>"""
import json, os, subprocess, sys
BASE, PROJ, METHOD, OUT = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3], sys.argv[4]
os.makedirs(OUT, exist_ok=True)
src = open(METHOD, encoding='utf8').read().split("# built: one browser")[0]
argv = sys.argv; sys.argv = ['asdrawn.py', BASE, PROJ, os.path.join(OUT, '_unused')]
g = {}; exec(compile(src, 'asdrawn.py', 'exec'), g); sys.argv = argv
bad = 0
for n in g['SCREENS']:
    order, st, h, wait = g['PLAN'][n]
    steps = ["read:c=(localStorage.clear(),1)"]
    if st: steps.append("read:s=(localStorage.setItem('toesa.v1', %s),1)" % json.dumps(json.dumps(st, ensure_ascii=False), ensure_ascii=False))
    steps += ["go:/?p=%s#%s" % (order, h), "wait:" + wait] + ([g['WEEKDAY'], "wait:고객상담센터"] if n == 'HP-01' else []) + ["run:700"]
    cmd = ['sz-eyes', 'web', 'do', BASE + '/', '--size', 'phone', '--out', OUT, '--name', n, '--json']
    for s in steps: cmd += ['--step', s]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try: j = json.loads(r.stdout)
    except Exception: bad += 1; print(n, 'no record', r.stderr[-200:]); continue
    json.dump(j, open(os.path.join(OUT, n + '.json'), 'w'), ensure_ascii=False)
    if not j.get('passed'): bad += 1
    print(n, 'reached' if j.get('passed') else 'STOPPED', len((j.get('end') or {}).get('texts', [])))
print(bad, 'not reached')
