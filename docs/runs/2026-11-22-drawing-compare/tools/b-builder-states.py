#!/usr/bin/env python3
"""화면마다 휴대폰 크기 그림을 찍고 잰다(sz-eyes web do). 상태는 이 브라우저의 저장 칸에 넣어 만든다.

쓰는 법 (샌드박스 밖에서):
  python3 scripts/pictures.py <주소> <폴더> [--only ID,ID] [--limits]
  --limits: 모든 칸을 스펙의 가장 긴 값으로 채운 상태로 찍는다.
그림은 <폴더>/<순서>-<화면>-phone.png, 잰 것은 <폴더>/findings.txt.
"""
import json, os, shutil, subprocess, sys, datetime

BASE = sys.argv[1].rstrip('/')
OUT = os.path.abspath(sys.argv[2])
ONLY = None
LIMITS = '--limits' in sys.argv
if '--only' in sys.argv:
    ONLY = set(sys.argv[sys.argv.index('--only') + 1].split(','))

KST = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None) + datetime.timedelta(hours=9)
TODAY = KST.date()
def d(delta=0):
    return (TODAY + datetime.timedelta(days=delta)).isoformat()

def check(**kw):
    c = {"situation": "reported11", "separation": "2026-11-14", "code": "11", "hire": "2024-08-19", "workKind": "5", "workdays": 5,
         "otherOn": False, "otherDays": None, "reasons": ["1-na"], "none": False, "data": {}, "done": True, "doneOn": d(-1)}
    c.update(kw)
    return c

WAGE_S1 = {"1-na": {"payday": {"day": 10, "nextMonth": True}, "wage": {
    "2026-07": {"status": "late", "receivedOn": "2026-09-17"},
    "2026-09": {"status": "unpaid", "share": "30plus"},
    "2026-10": {"status": "unpaid", "share": "all"}}}}
NAME, COMPANY, ADDR, PHONE = '박서연', '주식회사 오르빛디자인', '서울특별시 마포구 양화로 45 6층', '010-4821-7730'
STMT2 = '2026년 7월분 월급은 8월 10일에 받아야 했는데 9월 17일에 받았습니다. 9월분은 10월 10일에 절반만 들어왔고 나머지는 아직 받지 못했습니다. 10월분은 11월 10일에 들어오지 않았습니다. 대표님은 거래처 대금이 늦어서라고 했습니다.'
if LIMITS:
    NAME = '알렉산드라페트로바김엘리자베스마리아'  # 20자
    NAME = NAME[:20]
    COMPANY = ('주식회사 한빛글로벌로지스틱스 평택제2물류센터 운영본부 남부권역 지원팀')[:40]
    ADDR = ('경기도 평택시 포승읍 평택항만길 123-45, 한빛글로벌로지스틱스 제2물류센터 B동 3층 남측 출입구 옆 사무실 302호 물류운영지원센터')[:80]
    PHONE = '010-0000-0000'
    STMT2 = ('있었던 일을 날짜 순서로 적습니다. ' * 60)[:800]

def store(chk, **kw):
    s = {"v": 1, "check": chk,
         "request": {"name": NAME, "birth": "1995-03-08", "phone": PHONE, "company": COMPANY, "address": ADDR,
                     "separation": None, "requestedOn": None, "savedOn": None},
         "sentOn": None, "notFixed": False, "proofs": {}, "statement": {"f": ["", STMT2, "", "", ""], "savedOn": None},
         "correction": {"to": "", "from": "", "separation": None, "codeFrom": None, "hoLabel": None, "codeTo": None, "replyBy": None, "text": "", "savedOn": None}}
    for k, v in kw.items():
        s[k] = v
    if LIMITS:
        s["statement"]["f"] = [('가' * 800)] * 5
        s["correction"]["text"] = '나' * 600
    return s

S1 = check(data=WAGE_S1)
S1_SENT = store(S1, sentOn=d(-1), proofs={"1-na:0": True, "1-na:1": True, "1-na:2": True, "1-na:5": True})
S1_NEW = store(check(data=WAGE_S1, done=False, doneOn=None))
COMMUTE = check(separation="2026-10-31", situation="notIssued", code="", reasons=["6-gana"],
                data={"6-gana": {"commuteMok": "가", "changedOn": "2026-09-01", "minutes": 600 if LIMITS else 220}})
ADVICE = check(separation="2026-11-07", reasons=["5"], data={"5": {"adviceMok": "다", "records": ["문자·카톡"]}})
CARE = check(reasons=["7"], data={"7": {"days": 365 if LIMITS else 45, "requested": True, "refused": True, "record": False}})
NONE = check(reasons=[], none=True)
MULTI = check(reasons=["1-na", "3-2", "1-ra"], data={**WAGE_S1, "1-ra": {"size": "unknown", "months": ["2026-08", "2026-09"]}, "3-2": {"records": ["문자·카톡"], "size": "unknown"}})
ALL_IDS = ["1-na", "1-da", "5", "6-gana", "6-da", "9", "7", "10", "3-2", "3", "2", "1-ga", "1-ra", "1-ma", "4", "12", "11", "8"]
def window_months():
    return [f"2025-{m:02d}" for m in (11, 12)] + [f"2026-{m:02d}" for m in range(1, 11)]
FULL_WAGE = {"1-na": {"payday": {"day": 10, "nextMonth": True}, "wage": {ym: {"status": "unpaid", "share": "all"} for ym in window_months()}}}
LIMIT_CHECK = check(reasons=ALL_IDS if LIMITS else ["1-na", "1-ra", "3-2"], data={
    **FULL_WAGE,
    "1-da": {"minwage": {ym: {"pay": 99_999_999 if i == 0 else 1_000_000, "weeklyHours": 40} for i, ym in enumerate(window_months())}},
    "1-ga": {"months": window_months()}, "1-ma": {"months": window_months()},
    "1-ra": {"size": "5plus", "months": window_months()},
    "6-gana": {"commuteMok": "라", "changedOn": "2026-09-01", "minutes": 600},
    "6-da": {"commuteMok": "다", "changedOn": "2026-09-01", "minutes": 600},
    "7": {"days": 365, "requested": True, "refused": True, "record": True},
    "9": {"doctorNote": True, "refused": True}, "10": {"childKind": "child", "childBirth": "2020-05-05", "requested": True, "refused": True},
    "5": {"adviceMok": "마", "records": ["문자·카톡", "메일", "녹음", "문서"]},
    **{k: {"records": ["문자·카톡", "메일", "녹음", "문서"], "size": "5plus"} for k in ["3-2", "3", "2", "4", "12", "11", "8"]}})

# (순서, 이름, 저장 상태, 주소, 기다릴 글, 누를 것들)
PLAN = [
    ("01", "ST-01", None, "ST-01", "3분 점검 시작", []),
    ("02", "CK-01", S1_NEW, "CK-01", "회사가 지금", []),
    ("03", "CK-02", S1_NEW, "CK-02", "얼마나 다니셨어요", []),
    ("04", "CK-03", S1_NEW, "CK-03", "왜 그만두게", []),
    ("05", "CK-04", S1_NEW, "CK-04", "월급이 늦거나", []),
    ("05b", "CK-04-month", S1_NEW, "CK-04~month:2026-09", "못 받은 몫", []),
    ("05c", "CK-04-commute", store(COMMUTE), "CK-04", "통근 시간", []),
    ("05d", "CK-04-advice", store(ADVICE), "CK-04", "까닭을 골라요", []),
    ("05e", "CK-04-care", store(CARE), "CK-04", "간호한 기간", []),
    ("05f", "CK-04-limits", store(LIMIT_CHECK), "CK-04", "4/4", []),
    ("06", "RS-01", store(S1), "RS-01", "요건에 맞아 보여요", []),
    ("06b", "RS-01-short", store(NONE), "RS-01", "못 미쳐요", []),
    ("06c", "RS-01-multi", store(LIMIT_CHECK if LIMITS else MULTI), "RS-01", "가장 좋은 것부터", []),
    ("07", "RS-02", store(S1), "RS-01~ho:1:나", "원문 보기", []),
    ("08", "NX-01", store(S1), "NX-01", "이 순서로", []),
    ("08b", "NX-01-sent", store(S1, sentOn=d(0)), "NX-01", "남았어요", []),
    ("08c", "NX-01-over", store(S1, sentOn=d(-11)), "NX-01", "10일이 지났어요", []),
    ("08d", "NX-01-notfixed", store(S1, sentOn=d(0), notFixed=True), "NX-01", "근로복지공단에 피보험자격확인 청구", []),
    ("09", "DC-01", S1_SENT, "DC-01", "내 서류", []),
    ("09b", "DC-01-empty", None, "DC-01", "점검하면 내 사유에", []),
    ("10", "DC-02", S1_SENT, "DC-02", "이직사업장", []),
    ("11", "DC-03", S1_SENT, "DC-03/request", "이렇게 보내져요", []),
    ("11b", "DC-03-export", S1_SENT, "DC-03/request~export", "어떻게 보낼까요", []),
    ("12", "DC-04", S1_SENT, "DC-04", "고용센터에 가져갈 것", []),
    ("13", "DC-05", S1_SENT, "DC-05", "채워 둔 것", []),
    ("14", "DC-06", store(ADVICE, request={"name": NAME, "birth": "1995-03-08", "phone": PHONE, "company": COMPANY, "address": ADDR, "separation": None, "requestedOn": None, "savedOn": None},
                       correction={"to": COMPANY + ' 인사팀' if not LIMITS else COMPANY, "from": NAME, "separation": None, "codeFrom": None, "hoLabel": None, "codeTo": None, "replyBy": "2026-11-28",
                                   "text": '나' * 600 if LIMITS else '10월 15일 팀장님이 다음 달부터 마케팅2팀이 없어진다며 다른 자리가 없으니 그만두는 게 좋겠다고 하셨습니다. 그 말은 카톡으로도 받았습니다.', "savedOn": None}), "DC-06", "정정 요청", []),
    ("15", "HP-01", S1_SENT, "HP-01", "무료로 물어볼 곳", []),
    ("16", "HM-01", store(S1, sentOn=d(-5), proofs={"1-na:0": True, "1-na:1": True, "1-na:2": True, "1-na:5": True}, statement={"f": ["", STMT2, "", "", ""], "savedOn": None}), "HM-01", "남았어요", []),
    ("17", "CR-01", S1_SENT, "CR-01", "정당한 이직 사유 14개", []),
    ("17b", "CR-01-before", None, "CR-01", "정당한 이직 사유 14개", []),
    ("18", "PV-01", S1_SENT, "HM-01~erase", "모두 지울까요", []),
]
if LIMITS:
    PLAN += [(f"20-{i:02d}", f"CK-04-limits-{i + 1:02d}", store(LIMIT_CHECK), f"CK-04/{i}", "4/4", []) for i in range(len(ALL_IDS))]
    PLAN += [("21", "DC-04-limits", store(LIMIT_CHECK), "DC-04", "고용센터에 가져갈 것", []),
             ("22", "DC-03-statement", store(LIMIT_CHECK), "DC-03/statement", "이렇게 보내져요", []),
             ("23", "DC-03-correction", store(LIMIT_CHECK, correction={"to": COMPANY, "from": NAME, "separation": None, "codeFrom": None, "hoLabel": None, "codeTo": None, "replyBy": "2026-11-28", "text": '나' * 600, "savedOn": None}), "DC-03/correction", "이렇게 보내져요", []),
             ("24", "HM-01-limits", store(LIMIT_CHECK), "HM-01", "다음 한 걸음", [])]

os.makedirs(OUT, exist_ok=True)
tmp = os.path.join(OUT, '.runs')
os.makedirs(tmp, exist_ok=True)
lines = []
bad = 0
for order, name, st, h, wait, taps in PLAN:
    if ONLY and name not in ONLY:
        continue
    seed = json.dumps(json.dumps(st, ensure_ascii=False), ensure_ascii=False) if st else None
    steps = ["read:x=(localStorage.clear(),1)"]
    if seed:
        steps.append(f"read:y=(localStorage.setItem('toesa.v1', {seed}),1)")
    steps += [f"go:/?p={order}#{h}", f"wait:{wait}", "run:700"] + taps
    cmd = ["sz-eyes", "web", "do", BASE + "/", "--size", "phone", "--out", tmp, "--name", name, "--json"]
    for s_ in steps:
        cmd += ["--step", s_]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        j = json.loads(r.stdout)
    except Exception:
        lines.append(f"{name}: could not run: {r.stdout[-300:]} {r.stderr[-300:]}")
        bad += 1
        continue
    json.dump(j, open(os.path.join(OUT, name + '.json'), 'w'), ensure_ascii=False)
    end = j.get("end") or {}
    shot = end.get("screenshot")
    if shot and os.path.exists(shot):
        shutil.copy(shot, os.path.join(OUT, f"{order}-{name}-phone.png"))
    found = [f for f in end.get("findings", []) if f.get("severity") not in ("minor", "info")]
    if not j.get("passed"):
        why = [s_ for s_ in j.get("steps", []) if not s_.get("ok")]
        lines.append(f"{name}: STOPPED {why[0]['step'] if why else ''} {why[0].get('why') if why else ''}")
        bad += 1
    if end.get("overflowsSideways"):
        lines.append(f"{name}: scrolls sideways")
        bad += 1
    for f in found:
        lines.append(f"{name}: {f.get('severity')} {f.get('rule', '')} {f.get('message', '')}")
        bad += 1
    if not found and j.get("passed"):
        lines.append(f"{name}: nothing above minor")
shutil.rmtree(tmp, ignore_errors=True)
open(os.path.join(OUT, 'findings.txt'), 'w').write('\n'.join(lines) + '\n')
print('\n'.join(lines))
print(f"{bad} problem(s)")
sys.exit(1 if bad else 0)
