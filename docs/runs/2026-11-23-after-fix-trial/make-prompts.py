#!/usr/bin/env python3
"""The three prompts of the trial, each made from the prompt the confirming run (arm c, 2026-11-23) really gave,
with the text that commit cac9641 adds, taken from build.js itself so that no word is retyped."""
import json, os, re, sys
T = '/Volumes/DEV-SSD/sz-scratch.noindex/after-fix-test'
D = os.path.expanduser('~/.claude/projects/-Volumes-DEV-SSD-sz-scratch-noindex-drawing-compare-arm-c/0ce2cd00-c86e-47ae-9fe3-6cf1d2d5d2d3/subagents/workflows/wf_43f83111-ac1')
src = open('/Users/hosoo/project/conclave/.claude/worktrees/after-fix-test/plugin/workflows/build.js', encoding='utf8').read()

def given(aid):
    for l in open(f'{D}/agent-{aid}.jsonl', encoding='utf8'):
        r = json.loads(l)
        if r.get('type') == 'user':
            c = r['message']['content']
            text = c if isinstance(c, str) else ''.join(x.get('text', '') for x in c if x.get('type') == 'text')
            head = 'The computed task text follows:\n'
            body = text[text.index(head) + len(head):]
            return '\n'.join(line[2:] if line.startswith('  ') else line for line in body.split('\n'))

def between(a, b, text=src):
    i = text.index(a); j = text.index(b, i)
    return text[i:j + len(b)]

def plain(js):  # a piece of a template literal as the script prints it
    return js.replace('\\`', '`').replace("\\'", "'").replace('${built.contractId}', 'first-pass')

def once(text, a, b):
    assert text.count(a) == 1, (text.count(a), a[:80])
    return text.replace(a, b)

# 1. the ruling after the first fix
rule = given('a23938cf41a98ca54')
rule = once(rule, 'What the one who was fixing them said could not be made true without changing what was asked:', 'What the one who was fixing them said it could not make true, or was not its to touch (each line begins with the claim it is about):')
third = plain(between('- **A frozen flow or test stops for a reason that is not its claim\'s.**', 'Return what you decided for each.'))
rule = once(rule, 'Change no product code, no flow, no test and no claim. Return what you decided for each.', third)
open(f'{T}/prompt-rule.txt', 'w', encoding='utf8').write(rule)

# 2. the first verifier of the fourth look (nothing of its share had been shown false)
look = given('a45f318ff8f48d732')
scope = plain(between('New cases are tried at this look only where the fix reached: ', 'is still that claim shown false. '))
scope = once(scope, "${again.claims.length > 0 ? 'on the claims named above as shown false before, and on any other claim of yours' : 'on any claim of yours'}", 'on any claim of yours')
assert '${' not in scope, scope
look = once(look, 'recorded as above). Claims you did not look at again', 'recorded as above). ' + scope + 'Claims you did not look at again')
drawn = plain(between('const AS_DRAWN = `', 'because whoever mends them is handed the whole list.`'))[len('const AS_DRAWN = `'):-1]
assert '${' not in drawn
look = once(look, "(never remove a copy's folder yourself).", "(never remove a copy's folder yourself)." + drawn)
open(f'{T}/prompt-look.txt', 'w', encoding='utf8').write(look)

# 3. the first fixer, handed the as-drawn claim alone
fix = given('a6d6cbe742cddfdb9')
a = fix.index('found these claims false:\n') + len('found these claims false:\n'); b = fix.index('Find the cause of each in the product')
ids = [c['id'] for c in json.load(open('/Volumes/DEV-SSD/sz-scratch.noindex/drawing-compare/snap-c/first-pass.json', encoding='utf8'))['claims']]
parts = re.split(r'(?m)^(?=- (?:%s): )' % '|'.join(map(re.escape, ids)), fix[a:b])
mine = [p for p in parts if p.startswith('- as-drawn: ')]
assert len(mine) == 1, [p[:30] for p in parts]
print('the fixer was handed', len([p for p in parts if p.startswith('- ')]), 'claims in the run; the trial hands it as-drawn alone,', len(mine[0]), 'characters')
fix = fix[:a] + mine[0].rstrip('\n') + '\n\n\n\n' + fix[b:]
stale = plain(between(' Where it does (its source, or the drawing the product is held to, asks for the new form)', 'it is not yours to edit.'))
fix = once(fix, 'keep what it reads as it was unless the claim you were handed says otherwise.', 'keep what it reads as it was unless the claim you were handed says otherwise.' + stale)
assert fix.rstrip().endswith('one claim a line.'), fix[-80:]
fix = fix.rstrip() + ' Do not leave a server running.'
open(f'{T}/prompt-fix.txt', 'w', encoding='utf8').write(fix)
for n in ('rule', 'look', 'fix'):
    t = open(f'{T}/prompt-{n}.txt', encoding='utf8').read(); print(n, len(t), 'characters;', 'ends:', t[-110:].replace('\n', ' '))
