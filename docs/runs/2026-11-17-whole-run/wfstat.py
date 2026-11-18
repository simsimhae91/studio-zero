"""Per-agent figures of one workflow run: label, model, effort, wall-clock, turns, output tokens, tool calls.

Usage: python3 wfstat.py <workflow dir> [<workflow dir> ...]
Times are printed in local time (KST, UTC+9).
"""
import json
import sys
import glob
import os
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))


def when(stamp):
    return datetime.fromisoformat(stamp.replace('Z', '+00:00')).astimezone(KST)


def agent(path):
    meta = {}
    try:
        meta = json.load(open(path.replace('.jsonl', '.meta.json')))
    except Exception:
        pass
    first = last = None
    usage = {}
    models = {}
    efforts = {}
    advisors = {}
    tools = {}
    gaps = []
    previous = None
    for line in open(path):
        try:
            row = json.loads(line)
        except Exception:
            continue
        stamp = row.get('timestamp')
        if stamp:
            at = when(stamp)
            first = first or at
            if previous is not None:
                gaps.append((at - previous).total_seconds())
            previous = at
            last = at
        if row.get('type') != 'assistant':
            continue
        message = row.get('message', {})
        models[message.get('model')] = models.get(message.get('model'), 0) + 1
        if row.get('effort'):
            efforts[row['effort']] = efforts.get(row['effort'], 0) + 1
        if row.get('advisorModel'):
            advisors[row['advisorModel']] = advisors.get(row['advisorModel'], 0) + 1
        if message.get('id') and message.get('usage'):
            usage[message['id']] = message['usage']
        for block in message.get('content') or []:
            if isinstance(block, dict) and block.get('type') == 'tool_use':
                tools[block.get('name')] = tools.get(block.get('name'), 0) + 1
    out = sum(u.get('output_tokens', 0) for u in usage.values())
    think = sum((u.get('output_tokens_details') or {}).get('thinking_tokens', 0) for u in usage.values())
    fresh = sum(u.get('input_tokens', 0) + u.get('cache_creation_input_tokens', 0) for u in usage.values())
    read = sum(u.get('cache_read_input_tokens', 0) for u in usage.values())
    return {
        'id': os.path.basename(path)[6:-6],
        'label': meta.get('description', '?'),
        'phase': meta.get('workflowPhase', ''),
        'picked': meta.get('pickedEffortModel', ''),
        'models': models,
        'efforts': efforts,
        'advisors': advisors,
        'first': first,
        'last': last,
        'turns': len(usage),
        'out': out,
        'think': think,
        'fresh': fresh,
        'read': read,
        'tools': tools,
        'longest_gap': max(gaps) if gaps else 0,
    }


for folder in sys.argv[1:]:
    rows = sorted((agent(p) for p in glob.glob(os.path.join(folder, 'agent-*.jsonl'))), key=lambda r: r['first'] or datetime.now(KST))
    print('==', folder.rstrip('/').split('/')[-1], 'in', folder.split('/projects/')[-1].split('/')[0])
    for r in rows:
        if not r['first']:
            continue
        minutes = (r['last'] - r['first']).total_seconds() / 60
        model = ','.join(f'{k}' for k in r['models']) or r['picked']
        effort = ','.join(r['efforts']) or '-'
        advisor = ','.join(r['advisors']) or '-'
        calls = sum(r['tools'].values())
        top = ' '.join(f'{k}:{v}' for k, v in sorted(r['tools'].items(), key=lambda kv: -kv[1])[:6])
        print(f"{r['label']:<22} {model:<18} eff={effort:<6} adv={advisor:<16} {r['first']:%H:%M:%S}-{r['last']:%H:%M:%S} {minutes:6.1f}m turns={r['turns']:<4} out={r['out']:<7} think={r['think']:<6} fresh_in={r['fresh']:<8} cache_read={r['read']:<10} calls={calls:<4} gap={r['longest_gap']:.0f}s  {top}")
    print()
