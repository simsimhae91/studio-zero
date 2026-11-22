#!/usr/bin/env python3
"""화면마다 휴대폰 크기 그림을 찍고 잰다(sz-eyes web do). 상태는 이 브라우저의 저장 칸에 넣어 만든다.

쓰는 법 (샌드박스 밖에서):
  python3 scripts/pictures.py <주소> <폴더> [--only ID,ID] [--limits]
  --limits: 모든 칸을 스펙의 가장 긴 값으로 채운 상태로 찍는다.
  --screens: 계획의 모든 화면과 상태를 영역마다 화면 순서대로 (.sz/evidence/first/screens/에 둘 그림).
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

# --screens: 계획(frame 7절, .sz/plan/screens/*.md '상태')의 모든 화면과 상태를 영역마다 화면 순서대로.
# 그림 이름은 <순서>-<영역 번호>-<영역>-<상태>.png (주인이 한 폴더에서 넘겨 본다)
SCREENS_MODE = '--screens' in sys.argv
# 1350이 열린 평일 10시와 닫힌 밤 21시: 페이지의 시계를 그 시각으로 둔다
def clock(ms):
    return (f"read:clk=(()=>{{const R=window.__RD||(window.__RD=Date);const F={ms};window.Date=class extends R{{constructor(...a){{if(a.length)super(...a);else super(F)}}static now(){{return F}}}};return 1}})()")
OPEN_10 = "Date.UTC(2026,10,23,1,0)"   # 2026-11-23(월) 10:00 KST
NIGHT_21 = "Date.UTC(2026,10,23,12,0)"  # 2026-11-23(월) 21:00 KST
def ask_at(ms):
    return [clock(ms), "read:go=(location.hash='#HP-01',1)", "wait:무료로 물어볼 곳", "run:400"]
ALL6 = {f"1-na:{i}": True for i in range(6)}
S1_HALFWAY = store(check(data=WAGE_S1, done=False, doneOn=None, reasons=[], hire=None))
SHORT_HIRE = check(data=WAGE_S1, done=False, doneOn=None, hire="2026-07-01")
WAGE_SHORT = check(data={"1-na": {"payday": {"day": 10, "nextMonth": True}, "wage": {"2026-07": {"status": "late", "receivedOn": "2026-09-17"}}}}, done=False, doneOn=None)
RECORD = check(reasons=["3-2"], data={"3-2": {"records": ["문자·카톡", "메일"], "size": "5plus"}}, done=False, doneOn=None)
CARE_CHECK = check(reasons=["7"], data={"7": {"days": 45, "requested": True, "refused": False, "record": False}})
EMPTY_REQ = {"name": "", "birth": None, "phone": "", "company": "", "address": "", "separation": None, "requestedOn": None, "savedOn": None}
HALF_REQ = {"name": NAME, "birth": "1995-03-08", "phone": "", "company": "", "address": "", "separation": None, "requestedOn": None, "savedOn": None}
DONE_ALL = store(S1, sentOn=d(-1), proofs=ALL6, statement={"f": ["디자인 팀에서 웹 화면을 그렸습니다.", STMT2, "대표님께 월급날을 지켜 달라고 말씀드렸습니다.", "11월 14일에 그만뒀습니다.", "통장 내역으로 늦게 들어온 날이 보입니다."], "savedOn": d(-1)})
DONE_ALL["request"]["savedOn"] = d(-1)
CORR = {"to": COMPANY + ' 인사팀', "from": NAME, "separation": None, "codeFrom": None, "hoLabel": None, "codeTo": None, "replyBy": "2026-11-28",
        "text": '10월 15일 팀장님이 다음 달부터 마케팅2팀이 없어진다며 다른 자리가 없으니 그만두는 게 좋겠다고 하셨습니다. 그 말은 카톡으로도 받았습니다.', "savedOn": None}
LONG800 = ('2026년 7월분 월급은 8월 10일에 받아야 했는데 9월 17일에 받았습니다. ' * 30)[:800]
LONG600 = ('10월 15일 팀장님이 다음 달부터 팀이 없어진다며 그만두는 게 좋겠다고 하셨습니다. ' * 20)[:600]
AREAS = {"점검": 1, "서류": 2, "기준": 3, "묻기": 4, "지우기": 5}
# (영역, 상태 이름, 저장 상태, 주소, 기다릴 글, 그 뒤의 걸음)
SCREENS = [
    ("점검", "ST-01", None, "ST-01", "3분 점검 시작", []),
    ("점검", "CK-01 비어 있음", None, "CK-01", "회사가 지금", []),
    ("점검", "CK-01 고름", S1_NEW, "CK-01", "회사가 지금", []),
    ("점검", "CK-01 코드 23", store(check(data=WAGE_S1, done=False, doneOn=None, code="23")), "CK-01", "회사가 이미 회사 사정으로 올렸어요", []),
    ("점검", "CK-02 넘음", S1_NEW, "CK-02", "기준 180일을 넘어요", []),
    ("점검", "CK-02 모자람", store(SHORT_HIRE), "CK-02", "63일 모자라요", []),
    ("점검", "CK-02 다른 회사와 합산", store(check(data=WAGE_S1, done=False, doneOn=None, hire="2026-07-01", otherOn=True, otherDays=70)), "CK-02", "다른 회사", []),
    ("점검", "CK-03 비어 있음", S1_HALFWAY, "CK-03", "왜 그만두게", []),
    ("점검", "CK-03 고름", S1_NEW, "CK-03", "골랐어요", []),
    ("점검", "CK-03 여기에 없어요", store(check(reasons=[], none=True, done=False, doneOn=None)), "CK-03", "13호", []),
    ("점검", "CK-04 임금체불", S1_NEW, "CK-04", "월급이 늦거나", []),
    ("점검", "CK-04 달 시트", S1_NEW, "CK-04~month:2026-09", "못 받은 몫", []),
    ("점검", "CK-04 모자람", store(WAGE_SHORT), "CK-04", "22일 모자라요", []),
    ("점검", "CK-04 통근", store(COMMUTE), "CK-04", "통근 시간", []),
    ("점검", "CK-04 권고사직", store(ADVICE), "CK-04", "까닭을 골라요", []),
    ("점검", "CK-04 간호", store(CARE), "CK-04", "간호한 기간", []),
    ("점검", "CK-04 숫자 없는 호", store(RECORD), "CK-04", "있었던 일의 기록", []),
    ("점검", "CK-04 가장 큰 값", store(LIMIT_CHECK), "CK-04", "4/4", []),
    ("점검", "RS-01 맞아 보여요", store(S1), "RS-01", "요건에 맞아 보여요", []),
    ("점검", "RS-01 더 확인이 필요해요", store(CARE_CHECK), "RS-01", "더 확인이 필요해요", []),
    ("점검", "RS-01 못 미쳐요", store(NONE), "RS-01", "못 미쳐요", []),
    ("점검", "RS-01 180일 모자람", store(check(data=WAGE_S1, hire="2026-07-01")), "RS-01", "63일 모자라요", []),
    ("점검", "RS-01 여러 호", store(MULTI), "RS-01", "가장 좋은 것부터", []),
    ("점검", "RS-02 목이 있는 호", store(S1), "RS-01~ho:1:나", "원문 보기", []),
    ("점검", "RS-02 한 호", store(MULTI), "RS-01~ho:3의2:", "원문 보기", []),
    ("점검", "RS-02 법 조문", S1_NEW, "CK-02~art:law40", "제40조", []),
    ("점검", "NX-01 요청 전", store(S1), "NX-01", "이 순서로", []),
    ("점검", "NX-01 요청함", store(S1, sentOn=d(0)), "NX-01", "남았어요", []),
    ("점검", "NX-01 10일 지남", store(S1, sentOn=d(-11)), "NX-01", "10일이 지났어요", []),
    ("점검", "NX-01 회사가 안 고침", store(S1, sentOn=d(0), notFixed=True), "NX-01", "별지 제20호서식 내려받기", []),
    ("점검", "HM-01 요청 전", store(S1), "HM-01", "다음 한 걸음", []),
    ("점검", "HM-01 남은 날", store(S1, sentOn=d(-5), proofs={"1-na:0": True, "1-na:1": True, "1-na:2": True, "1-na:5": True}), "HM-01", "남았어요", []),
    ("점검", "HM-01 기한 지남", store(S1, sentOn=d(-11)), "HM-01", "10일이 지났어요", []),
    ("점검", "HM-01 못 미쳐요였던 경우", store(NONE), "HM-01", "사람에게 물어보기", []),
    ("서류", "DC-01 점검 전", None, "DC-01", "점검하면 내 사유에", []),
    ("서류", "DC-01 진행 중", S1_SENT, "DC-01", "내 서류", []),
    ("서류", "DC-01 다 챙김", DONE_ALL, "DC-01", "6/6", []),
    ("서류", "DC-02 비어 있음", None, "DC-02", "이직사업장", []),
    ("서류", "DC-02 채우는 중", store(S1, request=HALF_REQ), "DC-02", "이직사업장", []),
    ("서류", "DC-02 다 채움", S1_SENT, "DC-02", "6/6", []),
    ("서류", "DC-03 미리보기", S1_SENT, "DC-03/request", "이렇게 보내져요", []),
    ("서류", "DC-03 내보내기 시트", S1_SENT, "DC-03/request~export", "어떻게 보낼까요", []),
    ("서류", "DC-03 복사됨", S1_SENT, "DC-03/request~export", "어떻게 보낼까요", ["tap:글로 복사", "wait:글을 복사했어요"]),
    ("서류", "DC-03 진술서 미리보기", DONE_ALL, "DC-03/statement", "퇴직 경위 진술서", []),
    ("서류", "DC-04 0개", store(S1), "DC-04", "0/6", []),
    ("서류", "DC-04 진행 중", S1_SENT, "DC-04", "4/6", []),
    ("서류", "DC-04 다 챙김", store(S1, proofs=ALL6), "DC-04", "6/6", []),
    ("서류", "DC-04 점검 전", None, "DC-04", "점검하면 내 사유에 맞는 목록이 나와요", []),
    ("서류", "DC-05 비어 있음", store(S1, statement={"f": ["", "", "", "", ""], "savedOn": None}), "DC-05", "채워 둔 것", []),
    ("서류", "DC-05 쓰는 중", S1_SENT, "DC-05", "채워 둔 것", []),
    ("서류", "DC-05 길이 한도", store(S1, statement={"f": [LONG800, STMT2, "", "", ""], "savedOn": None}), "DC-05", "800/800", []),
    ("서류", "DC-05 점검 전", None, "DC-05", "퇴직 경위 진술서", []),
    ("서류", "DC-06 비어 있음", None, "DC-06", "정정 요청", []),
    ("서류", "DC-06 다 채움", store(ADVICE, correction=CORR), "DC-06", "정정 요청", []),
    ("서류", "DC-06 600자 한도", store(ADVICE, correction={**CORR, "text": LONG600}), "DC-06", "600/600", []),
    ("기준", "CR-01 점검 전", None, "CR-01", "정당한 이직 사유 14개", []),
    ("기준", "CR-01 내 호 표시", S1_SENT, "CR-01", "내 점검", []),
    ("묻기", "HP-01 평일 9~18시", S1_SENT, "CR-01", "정당한 이직 사유 14개", ask_at(OPEN_10)),
    ("묻기", "HP-01 운영 시간 밖", S1_SENT, "CR-01", "정당한 이직 사유 14개", ask_at(NIGHT_21)),
    ("묻기", "HP-01 점검 전", None, "CR-01", "정당한 이직 사유 14개", ask_at(OPEN_10)),
    ("지우기", "PV-01 확인", S1_SENT, "HM-01~erase", "모두 지울까요", []),
    ("지우기", "PV-01 지워짐", S1_SENT, "HM-01~erase", "모두 지울까요", ["tap:모두 지우기", "wait:모두 지웠어요"]),
]
if SCREENS_MODE:
    PLAN = []
    for i, (area, nm, st, h, wait, after) in enumerate(SCREENS):
        PLAN.append((f"{i + 1:02d}-{AREAS[area]}-{area}", nm.replace(' ', '-').replace('~', '-').replace('/', '-'), st, h, wait, after))

# 말을 품은 가장 안쪽 요소를 찾고, 그 덩이(.card, .row, .hero, .field)가 굴러가는 칸(.body나 시트) 안에 다 보이는지 본다.
# 둘째 값이 참이면 보이지 않을 때 그 덩이를 칸 안으로 굴린다.
IN_VIEW_JS = (
    "(w,fix)=>{const all=[...document.querySelectorAll('body *')].filter(e=>e.getClientRects().length&&(e.innerText||'').includes(w));"
    "const el=all.find(e=>![...e.children].some(c=>(c.innerText||'').includes(w)));if(!el)return 'none';"
    "const box=el.closest('.card,.row,.hero,.field')||el;"
    "let sc=box.parentElement;while(sc&&sc!==document.body){const o=getComputedStyle(sc).overflowY;if((o==='auto'||o==='scroll')&&sc.scrollHeight>sc.clientHeight)break;sc=sc.parentElement;}"
    "const lim=sc&&sc!==document.body?sc.getBoundingClientRect():{top:0,bottom:innerHeight};"
    "const r=box.getBoundingClientRect(),q=el.getBoundingClientRect();const room=lim.bottom-lim.top;"
    "const boxIn=r.top>=lim.top-1&&r.bottom<=lim.bottom+1,wordIn=q.top>=lim.top-1&&q.bottom<=lim.bottom+1;"
    "if(fix&&!(boxIn||(r.height>room&&wordIn))){box.scrollIntoView({block:r.height>room?'start':'center'});}"
    "return (boxIn||(r.height>room&&wordIn))?'seen':'hidden'}"
)

os.makedirs(OUT, exist_ok=True)
if SCREENS_MODE and not ONLY:
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
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
    # 그 상태를 정하는 말(마지막 wait)이 그림 안에 보여야 한다: 아래로 밀려 있으면 그 덩이를 화면 안으로 굴린다
    word = ([t[5:] for t in taps if t.startswith("wait:")] or [wait])[-1]
    steps += [f"read:inview=({IN_VIEW_JS})({json.dumps(word, ensure_ascii=False)}, true)", "run:400",
              f"expect:({IN_VIEW_JS})({json.dumps(word, ensure_ascii=False)}, false) === 'seen'"]
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
    end = j.get("end") or {}
    shot = end.get("screenshot")
    if shot and os.path.exists(shot):
        shutil.copy(shot, os.path.join(OUT, f"{order}-{name}.png" if SCREENS_MODE else f"{order}-{name}-phone.png"))
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
