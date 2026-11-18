"""Copies the diet run's logs with client ids, e-mail addresses and tokens masked.

Usage: python3 pack_logs.py <profile project dir> <specimen dir> <out compact dir> <out raw dir>
"""
import glob, gzip, json, os, re, shutil, sys

root, proj, compact, raw = sys.argv[1:5]
MASKS = [
    (re.compile(r'[A-Za-z0-9._%+-]+@(?:gmail|kakao|naver|daum|hanmail|icloud|outlook)\.[a-z.]*[a-z]'), '<email>'),
    (re.compile(r'[0-9]{8,}-[a-z0-9]{20,}\.apps\.googleusercontent\.com'), '<google-client-id>'),
    (re.compile(r'(client_id\\?"?\s*[=:]\s*\\?"?)[0-9a-f]{32}\b'), r'\1<kakao-client-id>'),
    (re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'), '<jwt>'),
]

BLOB = re.compile(r'[A-Za-z0-9+/]{3000,}={0,2}')

def clean(text):
    # Pictures an agent looked at are in the log whole (base64): the pictures themselves are in the specimen's
    # evidence folders, so here each is a note of its size.
    text = BLOB.sub(lambda m: f'<base64 {len(m.group(0))} chars>', text)
    for pattern, put in MASKS:
        text = pattern.sub(put, text)
    return text

NAMES = {'b65311d2': 'design', '9a7a8b27': 'build', '0a51f61c': 'native'}
os.makedirs(os.path.join(compact, 'journals'), exist_ok=True)
os.makedirs(raw, exist_ok=True)
total = 0
for session in sorted(glob.glob(os.path.join(root, '*/'))):
    sid = os.path.basename(session.rstrip('/'))
    name = NAMES.get(sid[:8])
    if not name:
        continue
    for journal in glob.glob(os.path.join(session, 'subagents/workflows/*/journal.jsonl')):
        open(os.path.join(compact, 'journals', f'{name}.jsonl'), 'w').write(clean(open(journal, errors='replace').read()))
    out = os.path.join(raw, name)
    os.makedirs(out, exist_ok=True)
    main = os.path.join(root, sid + '.jsonl')
    files = [(main, 'session.jsonl')] if os.path.exists(main) else []
    for agent in sorted(glob.glob(os.path.join(session, 'subagents/workflows/*/agent-*.jsonl'))):
        label = 'agent'
        try:
            label = json.load(open(agent.replace('.jsonl', '.meta.json'))).get('description', 'agent')
        except Exception:
            pass
        first = ''
        for line in open(agent, errors='replace'):
            try:
                first = json.loads(line).get('timestamp', '')
            except Exception:
                first = ''
            if first:
                break
        stamp = re.sub(r'[^0-9]', '', first)[8:14] or '000000'
        files.append((agent, f"{stamp}-{re.sub(r'[^A-Za-z0-9._-]+', '-', label)}.jsonl"))
    for src, dest in files:
        data = clean(open(src, errors='replace').read()).encode()
        with gzip.open(os.path.join(out, dest + '.gz'), 'wb', compresslevel=9) as gz:
            gz.write(data)
        total += os.path.getsize(os.path.join(out, dest + '.gz'))
for stream in ('design', 'build', 'native'):
    src = os.path.join(proj, stream + '.jsonl')
    if os.path.exists(src):
        with gzip.open(os.path.join(raw, stream, 'headless-stream.jsonl.gz'), 'wb', compresslevel=9) as gz:
            gz.write(clean(open(src, errors='replace').read()).encode())
        total += os.path.getsize(os.path.join(raw, stream, 'headless-stream.jsonl.gz'))
for name in ('clock.txt', 'request.md', 'design-request.txt', 'build-request.txt', 'native-request.txt'):
    if os.path.exists(os.path.join(proj, name)):
        open(os.path.join(compact, name), 'w').write(clean(open(os.path.join(proj, name), errors='replace').read()))
print('raw gz total MB', round(total / 1e6, 1))
