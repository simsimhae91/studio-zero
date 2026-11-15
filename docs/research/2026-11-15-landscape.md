# 밖의 사례: 2026-11-15 조사 기록

네 갈래를 Opus 서브에이전트가 1차 자료로 읽고 보고한 것을 줄인 기록. 수치는 대부분 저자 자신의 한 번 실행이거나 이해 당사자의 발표다. 다시 볼 때는 날짜부터 본다. 다음 갱신 때 이 파일 옆에 새 날짜의 파일을 둔다.

## 1. 오래 도는 하네스: 무엇이 실제로 됐나

증거 강한 순서.

1. **에이전트가 못 고치는 기계 검증 기준.** 큰 성공에는 전부 있었다: GCC torture(C 컴파일러, 약 $20k, 2주, 16 에이전트), Bun의 TS 테스트(Zig→Rust 포팅, 11일, 약 $165k, 99.8%), W3C 테스트(sparqlite). 부작용: 테스트에 과적합(Lattner의 비평).
2. **깨끗한 맥락의 별도 검증자.** Anthropic "Harness design for long-running application development"(2026-03-24): 혼자 20분 $9에 핵심 기능이 깨짐, 계획자+생성자+평가자는 6시간 $200. "Out of the box, Claude is a poor QA agent." Factory Missions: 검증이 실행 시간의 37%, 문제 81건 발견. Cognition: 코드 쓰는 에이전트는 하나, 리뷰어는 깨끗한 맥락.
3. **파일에 남는 상태.** 기능 목록(`passes`만 바꿀 수 있음), 진행 기록, 명세, git(Anthropic 2025-11-26, OpenAI harness engineering, Codex long-horizon). 무차별 메모는 해롭다(Anthropic 2026-11-06).
4. **모델이 좋아지면 부품을 뺀다.** Opus 4.6에서 스프린트와 스프린트별 QA를 뺐고 계획자와 마지막 평가 1회는 남겼다. 한꺼번에 빼면 실패, 하나씩 빼야 한다.
5. **짧은 요청을 명세로 넓히는 계획자.** 없으면 생성자가 범위를 줄인다.

절차의 값: 풀 하네스는 혼자의 20배, Factory mission은 보통 세션의 12배 토큰. "지금 모델이 혼자 안정적으로 못 하는 일일 때 값을 한다."

모든 자료가 꼽는 실패: 만든 쪽의 자기 채점, 일찍 끝났다고 선언, 스텁과 가짜 수정, 공유 가변 상태(락, `git stash`), 거대한 지시 파일, 병목 역할, 흐린 명세.

2026 하반기에 새로 나온 것: 모델이 일마다 하네스를 짜는 Claude Code dynamic workflows(5~6월), 세션 간 기억의 측정(11월), 하룻밤 무인 실행(7월), Huntley "Delete your skill packs, put the whole system under test"(10월).

갈리는 곳: 병렬 작성자(오라클이 있을 때만 됨), 심판을 둘지(Cursor는 뺐고 나머지는 핵심으로 봄), 사람의 리뷰 범위.

주요 출처: anthropic.com/engineering (effective-harnesses-for-long-running-agents, harness-design-long-running-apps, building-c-compiler), cursor.com/blog (scaling-agents, self-driving-codebases), OpenAI "Harness engineering", factory.com/news/missions-architecture, bun.com/blog/bun-in-rust, ghuntley.com/ralph.

## 2. Claude Code 플랫폼과 그 위의 프레임워크

**플랫폼(CLI v2.1.325).** 플러그인은 스킬, 서브에이전트, 훅(33개 이벤트), MCP, 백그라운드 모니터, 워크플로, `bin/`의 CLI, 모드(UI 확장)를 실을 수 있다. 배포는 git 마켓플레이스 또는 Anthropic 디렉터리. **유료 판매 통로는 없다.** dynamic workflows(`agent()`, `pipeline()`, `parallel()`, 재개 가능), agent view(터미널이 닫혀도 사는 백그라운드 세션, worktree), `/goal`(Stop 훅 루프, 대화 기록만 보고 판정), 클라우드 Projects(저장소의 스킬과 `.mcp.json`은 안 읽음), Agent SDK(`resume`, `fork`), 샌드박스(Bash만), Chrome 제어(GA), computer use(macOS, 대화형만, `-p`에서는 안 됨).

정책: Agent SDK로 만든 제품이 claude.ai 로그인을 사용자에게 제공하는 것은 허용되지 않는다. 구독은 2026-04-04부터 제3자 하네스를 덮지 않는다.

**프레임워크.** superpowers(별 31.7만, MIT, 수익은 지원 계약과 후원), mattpocock/skills(32.4만), spec-kit(15만, "통제하고 있다는 착각"이라는 비판), gstack(14만), BMAD(5.5만, 작은 앱에 기업식 의례), ruflo(8.1만, 실패한 테스트를 통과로 보고), OpenSpec(7.5만), compound-engineering(2.6만). 수익 모델은 대부분 강의, 멤버십, 컨설팅.

**오케스트레이터 앱.** Conductor는 Meta에 인수(11-04), 클라우드 종료. Vibe Kanban의 회사는 4월 폐업. Crystal은 중단, Terragon은 종료. Orca(MIT, 별 12.5만), Claude Squad는 살아 있다. Anthropic이 이 범주를 가져가는 중이다.

**사용자가 못 풀었다고 말하는 것.** (1) 사람의 이해와 검토가 병목. (2) 표류, 속일 수 있는 검증("They did pass, though"). (3) 성숙한 코드베이스에서 병렬 에이전트의 설계 충돌. (4) 토큰 비용. (5) 여러 저장소. (6) 접근 권한 분리. (7) 취향. (8) 일에 비해 무거운 절차. (9) 도구를 믿고 고를 평가가 없음. (10) 플러그인이 클라우드로 안 따라감.

**소유자와 만나는 면.** Plannotator(backnotprop/plannotator, Apache-2.0, 별 1.1만, 로컬 브라우저): 계획·마크다운·HTML·diff에 메모해 에이전트에게 보냄, 받은편지함. 수익은 호스팅되는 팀용 Workspaces(대기 목록).

## 3. 브라우저 밖 검증: 대상별로 되는 것

| 대상 | 쓸 것 | 비고 |
|---|---|---|
| iOS 시뮬레이터 | `xcrun simctl`(화면, 영상, 푸시 주입), Maestro(YAML, `maestro mcp`), agent-device(Expo/RN, 접근성 트리와 로그), MobileBuildMCP(빌드, `snapshot_ui`), mobile-mcp | 카메라, BLE, NFC, ARKit, 백그라운드는 안 됨. HealthKit은 샘플 데이터까지 |
| Android | Android CLI 1.0(`android screen capture --annotate`, `android input tap`), adb, Maestro | arm64 에뮬레이터 이미지 |
| macOS 앱 | 자기 앱은 XCUITest, 임시 확인은 Peekaboo(접근성), Electron은 Playwright `_electron` | 화면 기록 권한이 무인 실행을 막는다. Tart VM 안에서(동시 2대까지) |
| Windows 앱 | GitHub `windows-latest` 러너에서 빌드하고 `winapp ui`/FlaUI로 조작, 화면은 아티팩트로. 로컬은 UTM의 Windows 11 ARM + Windows-MCP | Tauri는 cargo-xwin으로 교차 빌드 가능(NSIS) |
| 웹 게임 | Playwright + 상태 훅(`window.render_game_to_text()`, `advanceTime(ms)`), `page.clock` | 픽셀로 단정하지 않는다 |
| Godot | GUT 헤드리스(로직), 창을 띄워 godot-mcp-runtime으로 입력과 화면 | `--headless`는 그리지 않는다 |
| Unity | PlayMode 테스트(batchmode), Unity CLI의 MCP(베타) | 에디터가 떠 있어야 함 |

비전 모델의 한계: 미묘한 CSS 변화를 최고 모델이 40.7%만 잡음(DiffSpot, 2026-05). 버그 없는 기준 화면을 같이 주면 정밀도가 크게 오른다. 그래서 판정은 접근성 트리와 노출된 상태로, 화면은 전/후 쌍으로 소유자에게.

자동으로 못 하는 것: 재미와 게임 감각, 소리, 반사 신경이 필요한 플레이, 하드웨어 기능, 미묘한 시각 회귀.

## 4. 돈

**하네스나 그 주변을 파는 것.** ShipFast 누적 $127만, 최근 30일 $897(TrustMRR). 본인이 밝힌 월 매출은 2024년 약 $126K, 2026년 $2K. Claude Code 스킬 키트 한 곳은 누적 $295. Superpowers는 무료. Anthropic은 출시 며칠 안에 같은 기능을 넣었다. 인프런의 Claude Code 강의 수강생 1.3만 명(매출 비공개). 버는 사람은 청중이 있는 사람.

**공장.** RevenueCat 2026: 새 앱의 17%가 2년 안에 월 $1K, 4.6%가 $10K. 게임은 9%가 $10K. 앱스토어 제출은 전년 대비 84% 늘고 다운로드는 2% 늘었다. 사례: 앱 40개를 만들어 20개를 남긴 개발자가 월 $50에서 $1,600으로(1년 4개월, ASO). 크롬 확장 38개 포트폴리오는 MRR $31. Steam 출시작의 40%는 등록비 $100를 못 번다.

**앱인토스.** 미니앱 1만 개 이상(2025-07에 약 100개), 전체 MAU 400만, 파트너의 67%가 1인, 63%에서 수익 발생(금액 무관. 2천 개일 때는 74%). 출시부터 첫 수익까지 평균 3일. 광고 수수료 2026-04-01부터 15%. 인앱결제는 토스 5% + 마켓 15~30%. 정산에는 사업자 등록(수익 5천 원까지 유예). 게임은 출시 전 등급 분류. 심사 3~5영업일, 라이트 모드만. 2026-07에 심사 강화, 전 앱 재심사. 사례(대부분 토스의 글): 게임사 월 2.1억 원, 1인 개발자 앱 5개로 한 달 2,500만 원, 비개발자 7주에 21개 출시(첫 수익 700원). 중앙값은 공개되지 않았다.

**제작 대행.** 크몽의 바닥은 33만 원(3일). 실제 계약 사례는 2인 팀의 CRM 1,400만 원(고객이 고른 이유는 속도가 아니라 기획). 고객 불만: 범위가 흐려 재작업 2~3배, AI가 만든 코드의 보안 구멍(노출된 키, RLS 없음). 고치는 일만으로 연 $120K를 번 프리랜서(자기 보고).

**남는 엣지에 대한 말.** Walling: "AI writes the code. It does not write your distribution." Cohen: 좁게 정의한 고객. Levels: 남는 것은 배포, 브랜드, 자기 데이터. Willison: "proven to work"한 코드를 내는 것.

조사가 얇은 곳: 토스의 수익 분포, 강의와 뉴스레터의 매출, 대행의 마진, 카카오와 네이버의 조건.
