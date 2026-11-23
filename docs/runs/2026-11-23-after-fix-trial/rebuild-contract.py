#!/usr/bin/env python3
"""Rebuild the contract of the confirming run (arm c, 2026-11-23) as it stood when its third look ended.

No snapshot was kept then. The snapshot of the first look's end is taken, and every verdict the verifiers of the
second and third looks recorded (their own `sz-eyes contract claim` commands, read from their transcripts) is put
on it in the order they ran. What the first ruling set aside is taken from the contract as the run left it.
Nothing of the fourth look is used. Prints what it did; writes the contract to the path given.
"""
import json, os, re, shlex, sys
W = '/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare'
D = os.path.expanduser('~/.claude/projects/-Volumes-DEV-SSD-sz-scratch-noindex-drawing-compare-arm-c/0ce2cd00-c86e-47ae-9fe3-6cf1d2d5d2d3/subagents/workflows/wf_43f83111-ac1')
LOOKS = {2: ['aa29a7c2489250920', 'a612e5642174dba81', 'a95a841d6604060e8'], 3: ['a4f4f729d3ee3c486', 'ad8a70fba55a5607a', 'a5ef41b0b0ad6a9b4']}

def records(aid):
    out = []
    for l in open(f'{D}/agent-{aid}.jsonl', encoding='utf8'):
        r = json.loads(l)
        if r.get('type') != 'assistant': continue
        for x in r['message'].get('content', []):
            if x.get('type') == 'tool_use' and x.get('name') == 'Bash' and 'contract claim' in x['input'].get('command', ''):
                text = x['input']['command'].replace('\\\n', ' ')
                try: toks = shlex.split(text, posix=True)
                except ValueError as e:
                    print('  could not read one command of', aid, ':', e, file=sys.stderr); continue
                for i in range(len(toks) - 4):
                    if toks[i:i + 3] == ['contract', 'claim', 'first-pass'] or (toks[i].endswith('sz-eyes') and toks[i + 1:i + 4] == ['contract', 'claim', 'first-pass']):
                        j = i + 3 if toks[i] == 'contract' else i + 4
                        rec = {'id': toks[j], 'at': r.get('timestamp')}
                        k = j + 1
                        while k < len(toks) - 1 and toks[k] in ('--status', '--evidence', '--note'):
                            rec[toks[k][2:]] = toks[k + 1].rstrip(';'); k += 2
                        if 'status' in rec: out.append(rec)
    # the two patterns above can match one command twice (sz-eyes contract ... and contract ...): keep one
    seen, uniq = set(), []
    for rec in out:
        key = (rec['id'], rec['at'], rec.get('note', '')[:40])
        if key not in seen: seen.add(key); uniq.append(rec)
    return uniq

contract = json.load(open(f'{W}/snap-c/first-pass.json', encoding='utf8'))
final = json.load(open(f'{W}/arm-c/.sz/contracts/first-pass.json', encoding='utf8'))
by = {c['id']: c for c in contract['claims']}
used = []
for look, agents in LOOKS.items():
    recs = sorted((rec for aid in agents for rec in records(aid)), key=lambda r: r['at'])
    for rec in recs:
        c = by[rec['id']]
        c['status'] = rec['status']; c['note'] = rec.get('note', ''); c['at'] = rec['at']
        if 'evidence' in rec:
            ev = c.get('evidence') or []
            ev = [ev] if isinstance(ev, str) else list(ev)
            if rec['evidence'] not in ev: ev.append(rec['evidence'])
            c['evidence'] = ev
        used.append((look, rec['id'], rec['status'], rec.get('evidence', '')))
    print(f'look {look}: {len(recs)} verdicts recorded:', ' '.join(f"{r['id']}={r['status']}" for r in recs))
# what the first ruling set aside, as the contract kept it (keys a claim has in the end and not in the snapshot)
for c in final['claims']:
    extra = {k: v for k, v in c.items() if k not in by[c['id']]}
    if extra: by[c['id']].update(extra); print('carried from the end state for', c['id'], ':', list(extra.keys()))
for k in final:
    if k not in contract: contract[k] = final[k]; print('carried top-level key', k)
print('status now:', ' '.join(f"{c['id']}={c['status']}" for c in contract['claims']))
if len(sys.argv) > 1:
    json.dump(contract, open(sys.argv[1], 'w', encoding='utf8'), ensure_ascii=False, indent=2)
