#!/usr/bin/env python3
"""Each built screen's words set beside its drawing's: how many lines are the same, in the same order.

The way the first run's verifier compared them (2026-11-22, compare-words.json): the lines of words a look reads
off a screen (`texts`), the drawing's without its drawn status bar ("9:41"), matched in order.

  compare_words.py <folder of the drawing's looks> <folder of the built screens' looks> [--json <file>]
"""
import json, os, sys
from difflib import SequenceMatcher

drawn_dir, built_dir = sys.argv[1], sys.argv[2]
keep = sys.argv[sys.argv.index('--json') + 1] if '--json' in sys.argv else None
def words(path):
    d = json.load(open(path))
    t = d['end']['texts'] if 'end' in d else d['texts']
    return [x for x in t if x != '9:41']
rows = {}
for name in sorted(os.listdir(built_dir)):
    if not name.endswith('.json'): continue
    state = name[:-5]
    dp = os.path.join(drawn_dir, name)
    if not os.path.exists(dp): continue
    try: a, b = words(dp), words(os.path.join(built_dir, name))
    except Exception: continue
    same = sum(m.size for m in SequenceMatcher(None, a, b, autojunk=False).get_matching_blocks())
    rows[state] = {'drawn': len(a), 'built': len(b), 'same_in_order': same, 'missing': [x for x in a if x not in b], 'extra': [x for x in b if x not in a]}
like = [s for s, r in rows.items() if r['drawn'] == r['built'] == r['same_in_order']]
D = sum(r['drawn'] for r in rows.values()); B = sum(r['built'] for r in rows.values()); S = sum(r['same_in_order'] for r in rows.values())
for s, r in rows.items():
    print(f"{s:16s} drawn {r['drawn']:3d}  built {r['built']:3d}  same {r['same_in_order']:3d}  missing {len(r['missing']):2d}  extra {len(r['extra']):2d}")
print(f"{len(rows)} screens; word for word like the drawing: {len(like)} ({', '.join(like) or 'none'})")
print(f"lines: drawn {D}, built {B}, same in order {S} ({100 * S / D:.0f}% of the drawing's lines are on the built screens in order); drawn and not built {D - S}, built and not drawn {B - S}")
if keep: json.dump(rows, open(keep, 'w'), ensure_ascii=False, indent=1)
