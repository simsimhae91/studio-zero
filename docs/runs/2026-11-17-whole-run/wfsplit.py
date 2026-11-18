"""Where each agent of a workflow run spent its time: the model thinking and writing, or commands running.

Usage: python3 wfsplit.py [--top N] <workflow dir> [<workflow dir> ...]

For every agent: wall-clock minutes, minutes waiting on tools (from a tool call to its result), minutes of model
turns (from a result to the next thing the model said), and the command time by kind. Times are local (KST).
"""
import glob
import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
KINDS = [
    ('stack', r'supabase (start|stop|status|db reset|migration)|stack:stop|npm run stack|scripts/up\.sh|docker (ps|exec|stop|rm|logs)'),
    ('ios build', r'xcodebuild|ios-build\.sh|pod install|expo prebuild|expo run:ios'),
    ('ios drive', r'sz-eyes ios|maestro|simctl|e2e/ios'),
    ('web build', r'expo export|build-web|build:web|npm run build'),
    ('install', r'npm (install|ci)\b|pnpm install|npx expo install'),
    ('flows', r'e2e/flows|flows/[a-z0-9-]+\.(flow|sh)|sz-eyes web (flow|do)\b'),
    ('look', r'sz-eyes web (look|sweep|leaks)|sz-eyes design|sz-eyes image'),
    ('tests', r'npm test|npm run test|vitest|node --test|typecheck|tsc\b'),
    ('contract', r'sz-eyes (contract|standing|feedback|backlog|port|sandbox|refs|arm|secret)'),
    ('git', r'\bgit (add|commit|status|log|diff|show|worktree|archive|clone)'),
    ('wait', r'\bsleep \d|until .*; do|while .*; do'),
]


def when(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(KST)


def kind_of(name, command):
    if name != 'Bash':
        return name.lower() if name in ('Read', 'Write', 'Edit', 'Skill', 'Agent') else 'other tool'
    for kind, pattern in KINDS:
        if re.search(pattern, command):
            return kind
    return 'other command'


def agent(path):
    label = '?'
    try:
        label = json.load(open(path.replace('.jsonl', '.meta.json'))).get('description', '?')
    except Exception:
        pass
    calls = {}
    by_kind = defaultdict(float)
    slow = []
    first = last = previous = None
    tool_s = model_s = 0.0
    for line in open(path, errors='replace'):
        try:
            row = json.loads(line)
        except Exception:
            continue
        stamp = row.get('timestamp')
        if not stamp:
            continue
        at = when(stamp)
        first = first or at
        content = (row.get('message') or {}).get('content')
        blocks = content if isinstance(content, list) else []
        results = [b for b in blocks if isinstance(b, dict) and b.get('type') == 'tool_result']
        if previous is not None:
            gap = (at - previous).total_seconds()
            if row.get('type') == 'user' and results:
                tool_s += gap
            else:
                model_s += gap
        if row.get('type') == 'assistant':
            for b in blocks:
                if isinstance(b, dict) and b.get('type') == 'tool_use':
                    command = (b.get('input') or {}).get('command') or (b.get('input') or {}).get('file_path') or (b.get('input') or {}).get('skill') or ''
                    calls[b.get('id')] = (at, b.get('name', ''), str(command))
        for b in results:
            started = calls.pop(b.get('tool_use_id'), None)
            if started:
                seconds = (at - started[0]).total_seconds()
                kind = kind_of(started[1], started[2])
                by_kind[kind] += seconds
                slow.append((seconds, kind, re.sub(r'\s+', ' ', started[2])[:150]))
        previous = at
        last = at
    return {'label': label, 'first': first, 'last': last, 'tool': tool_s, 'model': model_s, 'kinds': dict(by_kind), 'slow': sorted(slow, reverse=True)}


args = sys.argv[1:]
top = 0
if args and args[0] == '--top':
    top = int(args[1])
    args = args[2:]
for folder in args:
    rows = sorted((agent(p) for p in glob.glob(os.path.join(folder, 'agent-*.jsonl'))), key=lambda r: r['first'] or datetime.now(KST))
    print('==', folder.rstrip('/').split('/')[-1], 'in', folder.split('/projects/')[-1].split('/')[0])
    total = defaultdict(float)
    for r in rows:
        if not r['first']:
            continue
        wall = (r['last'] - r['first']).total_seconds() / 60
        kinds = ' '.join(f"{k}:{v / 60:.1f}" for k, v in sorted(r['kinds'].items(), key=lambda kv: -kv[1]) if v >= 30)
        print(f"{r['label']:<24} {r['first']:%H:%M}-{r['last']:%H:%M} wall={wall:6.1f}m model={r['model'] / 60:6.1f}m tools={r['tool'] / 60:6.1f}m | {kinds}")
        for k, v in r['kinds'].items():
            total[k] += v
        total['(model)'] += r['model']
        for seconds, kind, command in r['slow'][:top]:
            print(f"      {seconds / 60:5.1f}m {kind:<13} {command}")
    print('   all agents, minutes:', ' '.join(f"{k}:{v / 60:.0f}" for k, v in sorted(total.items(), key=lambda kv: -kv[1]) if v >= 60))
    print()
