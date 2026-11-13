# Studio Zero 아키텍처

Studio Zero는 생각을 정리하고, 조사하고, 문서를 쓰고, 앱을 만들고, **스스로 검증한 뒤** 결과를 폰으로 보내 승인받는 스튜디오다.
이 문서는 저장소에 실제로 있는 코드를 기준으로 쓴 설계서다. 구현되지 않은 것과 검증되지 않은 것은 §17, §18에 따로 적었다.

- 코드: `packages/protocol` (계약), `packages/design` (디자인 계약·테마·UI 린트·문장 린트), `packages/ax` (AX 키트: 블록 어휘·이벤트 스트림·렌더러·텔레메트리), `packages/daemon` (코어 데몬), `apps/desktop` (Tauri 2 클라이언트)
- 규모: 소스 156개 파일 약 27,100줄
- 테스트: `pnpm test` 192개 (그중 13개는 옵트인)
- 런타임: Node.js 24 (개발은 TypeScript를 그대로 실행, 상시 가동은 `pnpm build`의 esbuild 번들), SQLite(`node:sqlite`), Fastify 5

## 1. 컨테이너 다이어그램 (C4 Level 2)

```mermaid
flowchart LR
  subgraph owner["소유자 (신뢰)"]
    desktop["Tauri 2 클라이언트<br/>데스크톱 · 모바일 같은 코드<br/>RpcClient"]
    cli["sz CLI"]
    phone["Telegram · Slack · ntfy"]
  end

  subgraph host["Mac / Mac mini — 호스트 (신뢰)"]
    subgraph daemon["Core Daemon · 단일 Node 프로세스"]
      server["DaemonServer<br/>127.0.0.1:49200<br/>WebSocket RPC + 이벤트"]
      studio["Studio<br/>애플리케이션 계층"]
      policy["PolicyEngine<br/>규칙 테이블 + 승인"]
      queue["TaskQueue + Harness<br/>Plan→Execute→Verify→Reflect→Evolve<br/>코드 전: 레퍼런스 측정 · 고정표 · 계획 교차 검토<br/>검증: 컴파일 → 스모크 → eval → 인수 검수 → 장부"]
      ide["작업공간 서비스<br/>SandboxFileService · PtyManager"]
      router["ModelRouter<br/>라우팅 테이블"]
      gateway["LlmGateway<br/>127.0.0.1:49201"]
      relay["RelayCore<br/>+ Telegram · Slack · ntfy 어댑터"]
      qa["VisualAuditor + EvalRunner"]
      kirby["KirbyEngine"]
      scratch["ScratchService<br/>+ PromotionWorkflow"]
      know["KnowledgeService<br/>조사 · 문서 · PDF"]
      ax["AX 런타임<br/>블록 검증 · 조타 큐 · 확신도 보정"]
      mcp["McpRegistry<br/>MCP 클라이언트"]
      selfhost["SelfHosting<br/>자기 저장소 = 1호 프로젝트"]
      mac["CaffeinateManager · QuotaTracker"]
      db[("SQLite<br/>~/.studio-zero")]
    end
    vault[("macOS Keychain")]
    bridge["벤더 CLI (두뇌 전용)<br/>claude · codex · cursor-agent · agy"]
    checkout[("이 저장소의 체크아웃")]
  end

  subgraph orb["OrbStack — 컨테이너 (비신뢰)"]
    sandbox["프로젝트 샌드박스<br/>sz-&lt;slug&gt; · /workspace 볼륨"]
    browser["QA 브라우저<br/>Playwright run-server"]
    tmp["일회용 컨테이너<br/>Kirby clone"]
  end

  ext["LLM 프로바이더<br/>(API 키 또는 구독 CLI 경유.<br/>웹 검색·페치는 프로바이더가 실행)"]
  chat["Telegram · Slack · ntfy 서버"]
  tools["MCP 서버<br/>원격: GitHub · Stripe …<br/>이 Mac: Blender · Unity · Aseprite …"]

  desktop & cli -- "ws + 토큰" --> server
  studio --> ide
  ide -- "파일: docker exec / 터미널: 엔진 API의 TTY exec" --> sandbox
  phone <--> chat
  relay -- "HTTPS / WSS (outbound only)" --> chat
  server --> studio
  relay --> studio
  studio --> policy
  studio --> queue
  studio --> scratch
  studio --> know
  scratch --> ax
  queue --> ax
  queue --> router
  queue --> qa
  queue --> mcp
  studio --> kirby
  router -- "MCP stdio → /v1/bridge" --> bridge
  queue -- "docker exec (정책 통과 후)" --> sandbox
  qa -- "Playwright WS" --> browser
  browser -- "레퍼런스 페이지 (공개 https만)" --> refs["소유자가 지정한 레퍼런스"]
  selfhost -- "git bundle (객체만) · feature/ 브랜치" --> checkout
  selfhost -- "docker exec" --> sandbox
  studio --> selfhost
  studio --> mac
  know -- "PDF 인쇄 (스크립트·네트워크 끔)" --> browser
  browser -- "http://sz-slug:port" --> sandbox
  kirby --> tmp
  sandbox -- "샌드박스 토큰" --> gateway
  gateway -- "실제 키" --> ext
  queue & scratch & know -- "API 키 (SDK) 또는 구독 CLI" --> ext
  mcp -- "Keychain 토큰 · 승인된 도구만" --> tools
  daemon -. "security CLI" .-> vault
```

신뢰 경계는 세 개다.

1. **호스트 ↔ 컨테이너.** 샌드박스·QA 브라우저·일회용 컨테이너 안의 모든 것(에이전트가 쓴 코드, 렌더링된 페이지, 남의 저장소)은 비신뢰다. 여기서 나온 데이터는 스키마 검증을 거쳐 "데이터 블록"으로만 모델에 들어간다.
2. **소유자 ↔ 그 외.** 소유자는 전송 계층이 정한다: 토큰으로 인증된 제어 소켓, 허용 목록에 있는 Telegram·Slack 사용자 ID, ntfy의 경우 데몬이 HMAC으로 서명해 보낸 원탭 명령. 메시지 내용으로는 누구도 소유자가 될 수 없다.
3. **데몬 ↔ 바깥 서비스.** 웹 검색 결과, 읽어 온 페이지, 외부 MCP 서버가 말하는 도구 설명과 호출 결과는 전부 비신뢰 데이터다. 바깥으로 나가는 호출(외부 도구)은 소유자가 도구 단위로 허용한 것만 나간다.

## 2. 세 가지 불변식이 강제되는 위치

| 원칙 | 코드에서 강제되는 방식 | 파일 | 검증하는 테스트 |
|---|---|---|---|
| **Policy lives in the server** | 모든 부수효과는 타입이 있는 `Action`(31종)이다. 27개 규칙의 순서 있는 테이블이 `allow / deny / require_approval`을 결정하고, 일치하는 규칙이 없으면 거부한다. 규칙은 모델을 호출하지 않는다. 승인은 액션의 SHA-256 해시에 묶이고 1회용이며 만료된다. 승인 문구도 액션 필드에서 코드가 만든다. | `policy/actions.ts`, `policy/PolicyEngine.ts` | `vault-policy.test.ts` |
| **토큰 예산** | 모델 요청 전에 항상 `llm.request` 규칙(태스크 예산, 프로젝트 24시간 예산)을 평가한다. 데몬 자체 호출, 게이트웨이 경유 호출, CLI 브릿지 호출 모두 같은 규칙을 탄다. | `llm/ClaudeClient.ts`, `llm/LlmGateway.ts` | `vault-policy.test.ts`, `relay-gateway.test.ts` |
| **Untrusted by default** | 비신뢰 텍스트는 `untrusted()`로 감싼다(블록마다 96비트 난수 ID, 내용은 자기 블록을 닫을 수 없음). 시스템 프롬프트는 전부 상수이며 동적 내용을 이어 붙이는 코드 경로가 없다. | `trust/dataBlock.ts`, `harness/prompts.ts` | `vault-policy.test.ts`, `e2e.test.ts` |
| **Keys stay out of the sandbox** | 컨테이너 환경변수는 `OrbStackManager`가 타입 있는 입력으로만 조립한다. 샌드박스에는 프로바이더 키 대신 샌드박스 전용 토큰과 게이트웨이 주소가 들어간다. 게이트웨이가 호스트에서 토큰을 실제 키로 바꾼다. DB에는 토큰의 해시만 있다. 외부 도구 서버의 토큰도 같다: 호출은 데몬이 호스트에서 하고, 토큰은 Keychain에서 그 서버로 가는 요청 헤더로만 나간다. | `sandbox/OrbStackManager.ts`, `llm/LlmGateway.ts`, `vault/KeychainVault.ts`, `mcp/McpRegistry.ts` | `sandbox.test.ts`, `relay-gateway.test.ts`, `mcp.test.ts`, `engine.integration.test.ts` |

데이터 블록은 모델이 주입된 문장을 따를 확률을 낮출 뿐이다. 안전은 정책이 보장한다: 주입에 완전히 조종당한 에이전트도 `agent` 행위자가 가진 권한(샌드박스 안에서의 실행, `/workspace` 쓰기, 소유자가 이미 허용한 외부 도구 호출)만 쓸 수 있다.

## 3. 데이터 흐름

### 3.1 태스크 한 건

```mermaid
sequenceDiagram
  autonumber
  participant O as 소유자 (Desktop/Telegram)
  participant S as Studio + PolicyEngine
  participant H as Harness
  participant E as Engine (모델)
  participant X as 샌드박스
  participant Q as QA 브라우저
  O->>S: tasks.submit (프롬프트)
  S->>S: task.submit 규칙 → 큐에 적재 (SQLite)
  H->>X: 체크포인트, 브랜치 sz/<task>
  H->>Q: (레퍼런스가 있으면) QA 브라우저 컨테이너에서 열어 측정
  H->>E: Plan (Fable 5.2, 구조화 출력) + 고정표 초안
  H->>X: 고정표 검사 → 커밋 (통과 못 하면 여기서 태스크 중단)
  H->>E: 계획 교차 검토 1회 (다른 회사의 모델)
  loop 엔진 턴
    E->>H: tool_use (bash / read / write / edit / find_tools / use_tool)
    H->>S: 정책 평가 (actor = agent)
    H->>X: docker exec
    X-->>E: 결과 (데이터 블록)
    H->>X: 파일을 바꾼 턴이면 체크포인트
    O-->>E: (있으면) 조타 메시지가 도구 결과와 함께 전달
  end
  H->>X: 컴파일 게이트 (타입 검사 또는 테스트)
  H->>E: (실패 시) 컴파일러 출력 그대로 → 다시 실행
  H->>Q: 스모크 게이트: 경로를 열어 예외 · console.error · 5xx 수집
  H->>X: 회귀 명령, 슬롭 린트
  H->>Q: 3개 뷰포트 렌더 · 캡처 · DOM 측정
  Q-->>H: 측정값 + 스크린샷
  H->>E: (실패 시) 셀렉터 · 픽셀 박스 · 수정안 → 다시 실행
  H->>E: 최종 인수 검수 1회 (다른 회사의 모델): 통과 또는 보정 패치 1건 → 패치는 다시 검증
  H->>X: 커밋 → 프로덕션 빌드 측정
  H->>S: 장부에 영수증 기록
  H->>E: Reflect (판정 모델이 트레이스를 읽음)
  H->>S: 교훈·회귀 체크 후보 → 코드가 채택 여부 결정
  S-->>O: 스크린샷 + 점수 + [승인(Merge)] [재수정] [롤백]
```

검증 단계의 주체는 데몬이다. 엔진이 "끝났다"고 말하는 것은 통과 조건이 아니다.

### 3.2 승인

에이전트 행위가 `require_approval`을 받으면 `PolicyEngine.authorize()`가 그 자리에서 기다린다. `approval.requested` 이벤트가 나가고(데스크톱 구독, Telegram 인라인 버튼), 소유자 채널에서 `resolveApproval`이 호출되면 기다리던 호출이 재개된다. 승인 건은 `pending → approved → consumed` 순서로 정확히 한 번만 쓰인다. 다른 액션(해시가 다름)에는 쓸 수 없다. 데몬이 승인과 실행 사이에 재시작해도 같은 액션에 대한 미사용 승인은 다시 쓸 수 있다.

### 3.3 키 경로

| 호출자 | 자격 증명이 있는 곳 | 경로 |
|---|---|---|
| 데몬 자체 (Plan, 비전 감사, Reflect, Kirby, 네이티브 코딩 루프) | Keychain → 데몬 프로세스 메모리 | Anthropic SDK, in-process |
| 샌드박스 안의 코드 (만들어진 앱이 LLM을 부를 때) | 샌드박스 전용 토큰 | `ANTHROPIC_BASE_URL` → LlmGateway → 실제 키로 교체 → 프로바이더 |
| 구독 세션 브릿지 (Claude Code, Codex, Cursor, Antigravity) | 벤더 CLI가 자체 보관 (데몬은 읽지 않음) | CLI는 호스트에서 "두뇌"로만 실행, 도구는 MCP shim → `/v1/bridge` → Toolbox (§4.1) |
| 데몬 자체 호출, API 키가 없을 때 | Claude Code의 로그인 (데몬은 읽지 않음) | 도구를 전부 끈 `claude -p`. 데몬의 도구가 필요하면 같은 MCP shim으로만 준다 (§4.1) |
| 샌드박스 안의 코드가 남의 API를 부를 때 (증권사, 결제, 지도처럼 키가 있어야 하는 것) | Keychain `ext/<프로젝트>/<API>/<변수>` → 게이트웨이의 요청 한 건 | 샌드박스에는 대역(`szs_…`)과 게이트웨이 주소만 있다. `<API>_BASE_URL` → LlmGateway `/ext/<API>` → 대역을 실제 값으로 교체 → 저장된 https 출처 (§3.4) |
| 외부 도구 호출 (GitHub, Stripe 등) | Keychain `mcp/<서버>/token` → 데몬 프로세스 메모리 | 에이전트는 `use_tool`로 요청만 한다. 데몬의 MCP 클라이언트가 등록된 주소로 호출하고, 리다이렉트는 같은 출처 안에서만 따른다. |

### 3.4 만드는 앱이 쓰는 남의 API 키

만드는 제품이 증권사나 결제사의 API를 부르면, 만드는 동안에도 그 키가 필요하다. 키를 샌드박스에 넣으면(환경 변수든 `.env`든) 거기서 일하는 에이전트와 그 에이전트를 조종한 글이 같이 갖게 된다. 그래서 모델 키와 같은 방식으로 한다(`app/ExternalApis.ts`, `llm/LlmGateway.ts`).

```
연결   데스크톱의 소유자가 프로젝트 메뉴 → 외부 API 키에서 이름, https 출처, 변수별 값을 넣는다
       → 값은 Keychain으로, 변수마다 무작위 대역(szs_ + 32자)이 DB로 (external_apis, external_api_vars)
사용   워크스페이스에 .studio-zero/external.env: KIS_BASE_URL=http://host.docker.internal:<게이트웨이>/ext/kis,
       KIS_APP_KEY=szs_…  → 앱 코드는 이 이름을 읽어 제공자가 원하는 자리(헤더, 쿼리, JSON·폼 본문)에 넣는다
교체   게이트웨이가 요청에서 대역을 찾는다 → 전부 그 프로젝트의 그 API 것인지 확인 → 정책(external.call)
       → 실제 값으로 바꿔 저장된 출처로만 보낸다(리다이렉트는 따르지 않는다)
       → 응답에 실제 값이 되돌아와 있으면 지운다(원문, JSON 한 번·두 번 이스케이프, URL 인코딩, HTML 이스케이프)
```

- 대역은 자리표시자이자 호출자의 증명이다: 그 프로젝트의 샌드박스만 받았고, 이 Mac의 루프백 게이트웨이를 거쳐 그 출처 하나에 닿는 데만 쓸 수 있다. 대역이 하나도 없는 요청은 누가 보냈는지 알 수 없으므로 거절한다.
- 연결과 해제는 데스크톱의 소유자만 한다(`external.configure-local-owner-only`). 출처는 공개 호스트 이름의 https만 받는다.
- 배포할 때는 같은 변수 이름에 제공자의 실제 주소와 실제 키를 넣는다. 게이트웨이는 개발 중에만 낀다.
- 막지 못하는 것: 에이전트는 대역으로 그 API를 **부를 수 있다**. 키를 읽지는 못해도 주문·결제 같은 호출은 낼 수 있으므로, 실계좌 주문 권한이 있는 키를 연결하는 것은 그 프로젝트의 에이전트에게 그 권한을 맡기는 것이다. 모의투자나 조회 전용 키를 쓴다.

## 4. 코어 데몬 모듈

조립은 `app/compose.ts` 한 곳에서 한다. 전역 상태와 서비스 로케이터는 없다.

| 모듈 | 파일 | 책임 |
|---|---|---|
| `DaemonServer` | `server/DaemonServer.ts`, `server/handlers.ts` | 루프백 Fastify. WebSocket RPC, 이벤트 재생 후 실시간 전환, 아티팩트, 브릿지 엔드포인트. 토큰(상수 시간 비교) + Host 허용 목록(DNS 리바인딩 차단) + Origin 허용 목록. 느린 구독자는 끊는다. |
| `Studio` | `app/Studio.ts` | 소유자가 할 수 있는 모든 동작. RPC와 메신저 릴레이는 이 클래스의 얇은 어댑터라서 채널이 달라도 동작과 정책 검사가 같다. |
| `PolicyEngine` | `policy/` | §2. 모든 평가를 `policy_decisions`에 기록한다. |
| `OrbStackManager` | `sandbox/OrbStackManager.ts`, `sandbox/scripts.ts` | `docker --context orbstack`. 프로젝트당 컨테이너 1 + 볼륨 1 + 네트워크 1. 비루트, `--cap-drop ALL`, `no-new-privileges`, CPU/메모리/PID 제한, 호스트 마운트 없음. 체크포인트와 롤백, 브랜치, 병합, QA 브라우저, 일회용 컨테이너. 프로젝트별 뮤텍스. |
| `KeychainVault` | `vault/KeychainVault.ts` | `/usr/bin/security`. 비밀은 argv에 나타나지 않는다(`security -i`에 stdin으로, 16진수로). 저장 형식은 `sz1:<base64>`. 쓰기 후 다시 읽어 확인한다. |
| 릴레이 | `relay/RelayCore.ts`, `TelegramRelay.ts`, `SlackRelay.ts`, `NtfyRelay.ts` | 명령 해석과 알림은 채널과 무관한 `RelayCore`에 있고 어댑터는 전송만 한다. Telegram: long polling, 허용된 사용자 ID의 1:1 대화만, 오프셋을 처리 전에 저장(at-most-once: 유료 태스크가 두 번 시작되지 않음), 음성 메모는 받아쓰기 후 같은 경로. Slack: Socket Mode(인바운드 포트 없음). ntfy: 알림과, 데몬이 HMAC으로 서명한 원탭 명령만 받는다. |
| `LlmGateway` | `llm/LlmGateway.ts` | 샌드박스용 리버스 프록시. 엔드포인트 허용 목록, 예산 게이트, 키 교체, 스트림을 건드리지 않는 사용량 계측. |
| `ModelRouter` | `llm/ModelRouter.ts`, `config.ts` | 태스크 종류별 후보 테이블에서 사용 가능한 첫 엔진을 고른다. 모델에게 묻지 않는다. 고려한 후보와 이유가 이벤트로 남는다. 교차 검토를 맡을 구독도 같은 방식으로 고른다(`pairReviewer`, §8.2). |
| 엔진 | `harness/engines/` | `NativeClaudeEngine`(Messages API 수동 루프, API 키 필요), `CliBridgeEngine`(구독 CLI 4종: Claude Code, Codex, Cursor, Antigravity). 전부 같은 `Toolbox`만 쓰고, 같은 조타 큐를 읽는다. §4.1. |
| `SessionBrain` | `llm/SessionBrain.ts` | API 키 없이 데몬 자체의 모델 호출을 Claude 구독으로 보낸다. §4.1. |
| 가둠, ACP | `bridge/jail.ts`, `bridge/acp.ts`, `bridge/cli.ts` | 자기 도구를 끌 수 없는 CLI를 가두는 macOS 샌드박스 프로필, Agent Client Protocol 클라이언트, CLI 공통 환경. §4.1. |
| `Toolbox` | `harness/Toolbox.ts` | 도구 6개: 샌드박스용 `bash`, `read_file`, `write_file`, `edit_file`과 외부 도구용 `find_tools`, `use_tool`. 스키마 검증 → 정책 → 샌드박스 또는 MCP 클라이언트 → 결과를 데이터 블록으로. 파일을 바꾼 턴마다 체크포인트를 남긴다. |
| `WorkspaceProvisioner` | `harness/bootstrap.ts`, `harness/axKit.ts`, `harness/mobileKit.ts` | 샌드박스를 띄우고 프로젝트 고유 테마, 런타임 설명 파일, AX 키트(§12)를 첫 커밋으로 넣는다. 모바일(Expo) 프로젝트에는 모바일 키트(`packages/design/src/mobile`: `MobileShell`, `InteractiveDropzone`, `BottomSheet`, `TactileButton`, 토큰)도 `.studio-zero/mobile-kit`에 넣는다. 이미 있으면 덮어쓰지 않고, 태스크 브랜치를 만든 뒤 한 번 더 확인해서 키트보다 먼저 생긴 프로젝트도 작업 브랜치에서 키트를 받는다. |
| `Harness`, `TaskQueue` | `harness/Harness.ts`, `queue/TaskQueue.ts` | §8. 큐는 SQLite 위에 있고 재시작 후 중단된 태스크를 한 번 다시 넣는다. 프로젝트당 동시 1건. |
| `CompilerGate`, `SmokeTester` | `harness/CompilerGate.ts`, `qa/SmokeTester.ts` | §8. 검증의 앞 두 단계. 모델을 쓰지 않는다. |
| `QaBrowser` | `qa/QaBrowser.ts` | 스모크 게이트와 시각 감사가 함께 쓰는 브라우저 컨테이너 한 개. 쓸 때만 프로젝트 네트워크에 붙고 10분 쉬면 내려간다. |
| `VisualAuditor`, `EvalRunner` | `qa/`, `harness/EvalRunner.ts` | §7. |
| `SandboxFileService` | `sandbox/SandboxFileService.ts` | 소유자용 파일 탐색: 목록, 읽기, 쓰기. 전부 컨테이너 안 `/workspace` 볼륨에서 한다(호스트 마운트 없음). 목록은 한 단계씩 읽어 `git check-ignore`로 거르고 `.git`, `node_modules`, 빌드 산출물은 항상 뺀다. 스크립트 출력은 다른 샌드박스 출력처럼 줄 단위로 다시 검증한다. 워크스페이스 밖을 가리키는 링크는 따라가지 않는다. |
| `PtyManager` | `sandbox/PtyManager.ts` | 대화형 터미널. 컨테이너 엔진 API로 TTY가 붙은 exec를 만들고(`docker exec -it`가 내부에서 하는 세 호출) 그 연결을 원시 스트림으로 올려 제어 소켓과 잇는다. 네이티브 의존성이 없다. 터미널은 연 연결의 것이고 연결이 끊기면 함께 끝난다. 스트림을 닫는 것만으로는 exec된 셸이 끝나지 않으므로, 셸이 시작할 때 남긴 pid로 컨테이너 안에서 끝낸다. 클라이언트가 못 따라오면 셸 읽기를 멈춘다. |
| `ProjectNamer` | `app/ProjectNamer.ts` | 아이디어 한 단락을 2~4단어 제목과 슬러그로 줄인다(작은 모델 한 번). 모델이 없거나 12초 안에 답이 없으면 첫 구절로 이름을 정한다: 시작이 이름 짓기를 기다리지 않는다. |
| `LessonBook`, `ReflectionAgent` | `harness/` | §8. |
| 고정표, `RefKit` | `scratch/AnchorTable.ts`, `qa/RefKit.ts` | §8.1. 코드 전에 받는 것: 고정표의 스키마와 검사, 레퍼런스 페이지 측정. |
| 화면 명세, `MockupRenderer`, `FlowWalker` | `scratch/ScreenSpec.ts`, `qa/MockupRenderer.ts`, `qa/FlowWalker.ts`, `qa/mockupFaces.ts` | §8.4. 설계 태스크가 쓰는 화면 명세의 검사, 시안 페이지를 그림·서체와 함께 완결된 한 장으로 만들기, 그리기, 명세의 핵심 흐름을 페이지에서 직접 눌러 세기. |
| `SandwichReviewer`, `ReviewDesk` | `harness/SandwichReviewer.ts`, `llm/ReviewDesk.ts` | §8.2. 다른 회사의 모델이 계획과 결과를 한 번씩 본다. `ReviewDesk`는 리뷰어 한 명에게 질문 하나를 보내고 스키마로 답을 받는 한 곳이고, 디자인 심사(§7.4)도 같은 곳을 쓴다. |
| `Ledger`, `BuildMeter` | `harness/Ledger.ts`, `harness/BuildMeter.ts` | §8.3. 끝난 태스크마다 영수증 한 장. |
| `TextSlopAuditor` | `harness/TextSlopAuditor.ts`, `packages/design/src/textLint.ts` | §7.5. 화면의 글만 뽑아 글로 읽는다. |
| `SelfHosting` | `harness/SelfHosting.ts` | §19. 이 저장소 자신을 고정된 1호 프로젝트로 다룬다. |
| `CaffeinateManager`, `QuotaTracker` | `util/CaffeinateManager.ts`, `app/QuotaTracker.ts` | §20. Mac을 깨워 두기, 구독별로 본 것. |
| `KirbyEngine` | `kirby/` | §9. |
| `ScratchService`, `PromotionWorkflow` | `scratch/` | §10. |
| `KnowledgeService` | `knowledge/` | §11. `ResearchPipeline`, `DocumentCompiler`, PDF 내보내기. |
| AX 런타임 | `ax/`, `packages/ax` | §12. 블록 어휘와 검증, `SteeringQueue`, `ConfidenceCalibration`. |
| `McpRegistry` | `mcp/McpRegistry.ts` | §13. |

기본 라우팅(`config.ts`, 설정으로 바꿀 수 있음):

| 태스크 | 1순위 | 대안 |
|---|---|---|
| 기획·아이디어 (`ideate`), 계획 수립 | Claude Fable 5.2 | 없음 |
| 빌드 (`build`), 인라인 수정 | Claude Opus 5.5 (네이티브 루프) | Claude Code 브릿지 |
| 멀티파일 리팩토링 (`refactor`) | Codex 브릿지 (기본 비활성) | Claude Code 브릿지 → Opus 5.5 |
| 검증 측 모델 (비전 감사, Reflect), 조사의 검색·읽기 | Claude Opus 5.5 (코드에 고정) | 없음 |
| 작업 노트 대화, 문서 작성 | Claude Fable 5.2 (코드에 고정) | 없음 |

모든 종류에 Claude Code 브릿지가 대안으로 들어 있어서 API 키 없이도 길이 끊기지 않는다. 소유자가 작업을 시작할 때 엔진을 직접 고를 수도 있다(`tasks.submit`의 `engine`). 고른 엔진을 쓸 수 없으면 다른 것으로 바꾸지 않고 실패한다. Cursor와 Antigravity는 라우팅 표에 없고 소유자가 고를 때만 쓰인다.

**모델과 추론 강도 고르기.** 엔진을 고른 작업에는 그 엔진이 돌릴 모델과 추론 강도도 붙일 수 있다(`tasks.submit`, `projects.ignite`, `scratch.promote`의 `model`, `effort`). 클라이언트는 이 선택을 한 곳에 기억하고(`lib/engineChoice.ts`, `views/enginePicker.tsx`) 처음 화면, 프로젝트 입력창, 작업 노트의 빌드 시작이 같이 쓴다. 작업을 시작할 수 있는 세 곳이 모두 같은 선택을 싣는다: 작업 노트에서 올린 프로젝트의 첫 빌드는 그 프로젝트가 받는 가장 큰 작업인데, 전에는 그 길만 선택을 싣지 못해 표의 기본값으로 돌았다. 돌릴 수 없는 선택(엔진 없는 모델, 강도를 받지 않는 엔진의 강도)은 프로젝트를 만들기 전에 거절하므로 노트는 그대로 남는다. 기억해 둔 선택은 데몬이 엔진과 모델 목록을 돌려주기 전까지는 고른 그대로 보내고, 목록이 온 뒤에 거기 없으면 고르지 않은 것으로 친다: 화면에 보이는 것과 보내는 것이 같다. 모델 이름은 엔진마다 뜻이 다르고 강도를 설정으로 받지 않는 엔진도 있어서, 엔진 없이 둘만 고를 수는 없다. 고른 것만 표의 그 엔진 항목을 덮어쓰고, 고르지 않은 것은 표의 값 그대로다. 고를 수 있는 목록(`engines.models`)은 데몬이 정해 두지 않고 그 회사의 CLI에 묻는다. 묻는 것은 작업 밖에서, 모델이 끼지 않는 명령 하나다.

| 엔진 | 목록의 출처 | 모델을 넘기는 방법 | 추론 강도 |
|---|---|---|---|
| Claude API (네이티브 루프) | 코드의 네 모델(가격표가 있는 것) | 요청의 `model` | `output_config.effort`, 다섯 단계 |
| Claude Code | CLI에 목록 명령이 없다. 등급별 최신 모델의 별칭 `fable` · `opus` · `sonnet` · `haiku` | `--model` | `--effort`, 다섯 단계 |
| Codex | `codex debug models` (JSON, 숨김 표시된 내부용 모델 제외) | `--model` | `model_reasoning_effort`, 다섯 단계 |
| Cursor | `cursor-agent models` (`<id> - <이름>`, `auto` 제외) | `--model` | 설정 없음: 모델 이름에 들어 있다 |
| Antigravity | `agy models` (`<id><탭><이름>`) | ACP `session/set_model` | 설정 없음: 모델 이름에 들어 있다 |

강도는 `low` · `medium` · `high` · `xhigh` · `max` 다섯 단계이고 받는 엔진에서는 같은 뜻이다. 받지 않는 엔진에 강도를 붙인 요청은 버리지 않고 거절한다(제출할 때 한 번, 라우팅할 때 한 번). Codex에는 고른 단계를 그대로 넘긴다: 전에는 `max`를 `xhigh`로 바꿔 보냈는데 CLI가 `max`를 받는다. 작업에는 실제로 돈 강도가 남고(`tasks.effort`), 강도를 설정으로 받지 않는 엔진이면 비어 있다.

목록은 10분간 기억하고, 읽지 못했으면 비어 있다가 1분 뒤 다시 묻는다. 목록은 메뉴이지 관문이 아니다: 그 모델을 돌릴 수 있는지는 그 회사가 정하고, 없는 모델이면 그 차례가 실패한다(다른 모델로 바꿔 돌리지 않는다). 데몬이 직접 막는 것은 모양뿐이다. 모델 이름은 CLI의 인자 하나가 되므로 닫힌 문자 집합이고 `-`로 시작할 수 없다(`ModelId`). 계획·검증·교차 검토에 쓰는 모델과 강도는 이 선택과 무관하게 그대로다: 고르는 것은 누가 만드느냐이고, 만든 것을 보는 쪽은 만드는 쪽의 선택을 따라가지 않는다.

### 4.1 구독으로 쓰기

API 키는 선택 사항이다. 금고에 Anthropic 키가 없으면 데몬은 구독 모드로 돈다(`system.status`의 `brain: session`).

**데몬 자체의 생각** (계획, 판정, 비전 감사, 작업 노트, 조사, 문서)은 `SessionBrain`이 Claude Code CLI를 헤드리스로 돌려서 한다.

- 내장 도구는 전부 끈다(`--tools ""`). 사용자 설정·훅·플러그인은 읽지 않고(`--setting-sources project`, 빈 스크래치 폴더), MCP는 데몬이 준 것만 쓴다(`--strict-mcp-config`).
- 구조화 출력은 `--json-schema`, 이미지는 stream-json 입력으로 보낸다. 프롬프트는 stdin으로만 간다.
- 도구 루프(작업 노트의 `present`·`record_decision`, 조사의 `report_findings`)는 요청 하나짜리 브릿지 세션으로 MCP shim에 연결된다. 검증은 API 루프와 같은 코드가 한다.
- 조사에는 웹 검색(`WebSearch`)만 준다. 검색은 프로바이더 쪽에서 돌고 이 Mac은 페이지를 받아 오지 않는다. 그래서 구독 모드에서는 원문 인용 대조(§11)를 할 수 없고, 출처 URL이 실제 검색 결과에 있었는지만 검증한다.
- 토큰은 예산에 계상하고 금액은 0으로 적는다.

**코딩 엔진**으로서의 구독 CLI는 네 가지고, 원칙은 하나다: CLI는 두뇌이고 손은 데몬의 Toolbox뿐이다.

| CLI | 자기 도구를 무력화하는 방법 | 데몬 도구를 주는 방법 |
|---|---|---|
| Claude Code | `--tools ""` (도구 목록이 빈다) | `--mcp-config` |
| Codex | `--sandbox read-only` + 기능 플래그로 셸·파일 도구 끔. 빈 도구 목록보다 약하다. | `-c mcp_servers.studio…`, studio 도구만 사전 승인 |
| Cursor (`cursor-agent`) | 끌 수 없음 → **호스트 가둠** | 스크래치 폴더의 `.cursor/mcp.json` + `mcp enable` |
| Antigravity (`agy`) | 끌 수 없음 → **호스트 가둠** | ACP `session/new`의 `mcpServers` (세션 한정, 사용자 설정은 건드리지 않음) |

**호스트 가둠** (`bridge/jail.ts`, macOS `sandbox-exec`). 도구를 끌 수 없는 CLI는 다음 프로필 안에서 실행한다.

- 읽기: 홈 디렉터리 전체, 다른 볼륨, 임시 폴더가 보이지 않는다. 예외는 CLI 자신의 상태 폴더, 스크래치 폴더, Node와 MCP shim, 그리고 Keychain 파일(두 CLI 모두 로그인을 Keychain에 둔다). 사용자가 그 CLI에 저장해 둔 MCP 서버 설정(`~/.cursor/mcp.json`, `~/.gemini/config/mcp_config.json`)은 다른 서비스의 토큰이 들어 있을 수 있어 따로 가린다.
- 쓰기: 스크래치 폴더와 CLI 자신의 상태 폴더만.
- 실행: CLI 자신의 바이너리, Node(shim용), `/usr/bin/security`(로그인 읽기)만. 셸이 뜰 수 없으므로 에이전트가 터미널 도구로 시키는 명령은 시작 전에 실패한다.

실제 실행으로 확인한 것: 가둔 Cursor 에이전트에게 키체인 읽기, `~/.zshrc` 읽기, `ls ~`를 시키면 셋 다 실패한다(셸 spawn EPERM, 읽기 거부). 남는 위험은 §16에 적었다.

## 5. 프로토콜

`packages/protocol/src/rpc.ts`의 테이블 하나가 서버 검증, 클라이언트 타입, 이 문서의 근거다. 메서드 79개, 이벤트 42종.

- 연결: `ws://127.0.0.1:49200/v1/ws`. 첫 프레임은 `{t:"hello", protocol, token, client}`. 5초 안에 오지 않거나 토큰이 틀리면 닫는다.
- 프레임: 클라이언트 `hello | req | sub | unsub | terminal.data`, 서버 `ready | res | err | evt | sub_closed | terminal.output | terminal.exit`.
- 터미널은 RPC와 프레임을 나눠 쓴다. 열기·크기 변경·종료는 메서드(`terminal.spawn` · `terminal.resize` · `terminal.kill`)이고, 키 입력과 출력은 응답이 없는 프레임으로 같은 소켓을 오간다. 터미널 id는 연 연결에만 유효하다: 같은 토큰을 가진 다른 연결도 그 터미널에 쓰거나 끌 수 없다.
- 요청과 응답 모두 zod로 검증한다. 핸들러 버그는 깨진 프레임이 아니라 `internal` 오류가 된다.
- 이벤트는 추가 전용이고 `seq`가 단조 증가한다. `sub`에 `sinceSeq`를 주면 그 이후를 재생한 뒤 실시간으로 넘어간다(누락·중복 없음). 터널이 끊겨도 클라이언트는 마지막 `seq`로 다시 구독한다.
- 오류 코드: `unauthorized · invalid_params · unknown_method · not_found · conflict · policy_denied · approval_denied · unavailable · internal`
- 종료 코드: `4401` 인증 실패, `4406` 프로토콜 불일치, `4400` 잘못된 프레임, `4408` hello 타임아웃. 클라이언트는 44xx에서 재접속하지 않는다.
- `vault.set`은 있고 `vault.get`은 없다. 비밀은 데몬에서 클라이언트로 나가지 않는다.

`RpcClient`(`packages/protocol/src/client.ts`)는 플랫폼 `WebSocket`만 쓰므로 Tauri 웹뷰(데스크톱, iOS, Android)와 Node에서 같은 클래스가 돈다.

## 6. 데이터베이스

`~/.studio-zero/studio-zero.db`, WAL, `STRICT` 테이블 30개(`db/schema.ts`). 마이그레이션은 전진 전용이다(현재 9단계).

| 영역 | 테이블 |
|---|---|
| 프로젝트 | `projects`, `sandboxes`(게이트웨이 토큰은 해시만) |
| 실행 | `tasks`(세션과 트랙 포함), `sessions`(프로젝트 안의 이름 붙은 작업 흐름), `events`(추가 전용 트레이스), `usage_ledger` |
| 정책 | `approvals`, `policy_decisions`(허용 포함 전부) |
| 복구 | `checkpoints` |
| 품질 | `audits`, `artifacts`, `evals`, `eval_runs`, `ledger_entries`(태스크당 영수증 한 줄) |
| 학습 | `lessons`(근거 이벤트 seq 포함) |
| Kirby | `kirby_ingests`, `kirby_proposals` |
| 작업 노트 | `scratchpads`, `scratch_entries`, `scratch_spec`, `decisions`(채택한 것과 기각한 대안, 그 이유) |
| AX | `ax_outcomes`(추천과 실제 선택의 일치 여부, 확신도별) |
| 지식 작업 | `knowledge_jobs`(문서, 사실 시트, 린트 결과) |
| 외부 도구 | `mcp_servers`, `mcp_grants`(프로젝트·서버·도구 단위 허용) |
| 외부 API | `external_apis`(프로젝트·이름·출처), `external_api_vars`(변수 이름과 대역. 값은 Keychain) |
| 기타 | `credentials`(Keychain 항목 이름만), `relay_chats`, `kv` |

비밀 값은 이 DB에 저장하지 않는다.

## 7. Anti-Slop 디자인 시스템과 Visual QA

### 7.1 디자인 계약

`packages/design/src/contract.ts`의 객체 하나를 세 곳이 쓴다: 테마 생성기, 소스 린터, 렌더 감사. 숫자를 한 곳에서 바꾸면 셋이 같이 바뀐다.

| 항목 | 값 |
|---|---|
| 간격 | 4px 배수 |
| 글자 크기 | 12 · 14 · 16 · 18 · 20 · 24 · 30 · 36 · 48 · 60 · 72 · 96 · 120 · 160px (한 화면에 최대 6종) |
| 디스플레이 글자 | 60px 초과는 디스플레이 글자다: 단계에 맞지 않아도 되고(유동 크기) 160px까지. 본문 크기의 3~7배 안에 있어야 한다. 줄 높이 0.9~1.0 |
| 본문 | 최소 16px, 줄 높이 1.45–1.8, 한 줄 80자 이하 |
| 모서리 | 고정된 집합이 아니라 범위: 32px까지, 그리고 완전한 알약. 한 화면에 최대 3종 |
| 모션 | 조작에 답하는 120 · 200 · 320ms, 화면당 한 번의 등장 600–810ms, 페이지 전환 700–1100ms |
| 대비 | 본문 7:1 (WCAG AAA), 큰 글자 4.5:1, 비텍스트 3:1 |
| 터치 영역 | 44×44px |
| 서체 | 본문 Geist, Pretendard (한글). 제목은 시드가 고르는 네 가지 짝 중 하나: 본문과 같은 서체, Fraunces + Noto Serif KR, Instrument Serif + Gowun Batang, Bricolage Grotesque + Pretendard |

처음의 계약은 글자 60px, 모서리 0·4·8·12px, 모션 120·200·320ms, 서체 한 벌로 묶여 있었고, 기준으로 삼은 사이트 여덟 곳이 전부 거기서 탈락했다. 가장 잘 만든 것을 떨어뜨리는 계약은 디자인이 아니라 정돈을 재고 있는 것이다. 그래서 값을 고정하던 항목은 범위와 비례로 바꿨고(`isOnTypeScale`, `isDisplayInProportion`, `isAllowedRadius`, `isAllowedDuration`), 큰 헤드라인이나 깊은 곡률이나 세리프 제목은 그 자체로는 결함이 아니다.

계약은 규율(스케일, 리듬, 대비, 절제)만 고정하고 생김새는 고정하지 않는다. 팔레트, 모서리 스타일(sharp · soft · round), 제목 서체는 프로젝트 이름에서 만든 시드로 정하므로 프로젝트마다 다르다.

### 7.2 테마 (Tailwind v4)

`createTheme(seed)` → `renderThemeCss()`가 프로젝트의 `.studio-zero/theme.css`를 만든다.

- 색은 OKLCH로 정의하고, 텍스트 토큰은 **풀어서** 구한다: 가장 불리한 배경에 대해 목표 대비(+0.25 여유)를 만족하는 명도를 이분 탐색한다. 채도는 sRGB 색역 안으로 줄인다.
- `--color-*: initial` 등으로 Tailwind 기본 색·글자 크기·모서리·그림자 스케일을 제거한다. `bg-indigo-500`이나 `rounded-3xl`은 컴파일되지 않는다.
- 남는 유틸리티: `bg-bg · bg-surface · bg-sunken · text-fg · text-fg-muted · text-accent · bg-accent · text-on-accent · border-border · border-control-border · danger · success · warning`, `text-xs…10xl`, `rounded-sm/md/lg/xl`, `shadow-sm/md`, `font-sans/display/mono`, `--duration-fast/base/slow/entrance/page`.
- **브랜드색은 채움이다.** 강조색 하나가 종이 위의 작은 글자색이자 버튼 색이면, 대비 때문에 어떤 색상이든 어둡고 탁해진다(실제 프로젝트 셋이 전부 "흰 바탕에 어두운 녹색"으로 나왔다). 그래서 `brand`는 채움 전용이고 밝기를 고를 수 있다: 그 위 글자(`on-brand`)는 거의 검정과 거의 흰색 가운데 AAA가 되는 쪽으로 풀고, 어느 쪽도 안 되는 중간 밝기면 브랜드를 가장 적게 옮긴다. `brand-soft`는 그 색의 옅은 면이고, 글자 토큰은 그 위에서도 AAA다. 중립색은 브랜드와 다른 색상으로 기울 수 있다(차가운 브랜드 아래 따뜻한 종이).
- **씨앗은 주제에서 나온다.** `.studio-zero/theme.json`이 씨앗과 그 출처 한 문장을 담는다. 새 프로젝트의 것은 이름 해시로 만든 자리표시이고 스스로 그렇게 적는다. 엔진은 `set_theme` 도구로 색상·채도·밝기·중립색의 기울기·모서리·제목 서체를 주제에서 골라 바꾼다. 스타일시트는 데몬이 씨앗에서 다시 만들고, 손으로 고치지 않는다. 범위 안의 어떤 선택도 대비가 풀려 나오므로 엔진이 틀릴 수 있는 것은 선택 자체뿐이다 (`harness/themeSeed.ts`).
- 기본 레이어: 터치 기기에서 컨트롤 최소 44px, `:focus-visible`, `prefers-reduced-motion`, 한글 `word-break: keep-all`.

### 7.3 슬롭 린트 (정적)

`lintSources()`: 소스에서 14개 패턴을 찾는다. 파란색–보라색 그라디언트, Tailwind 기본 팔레트 클래스, 하드코딩 색, 임의 값(`p-[13px]`), 아이콘 자리의 이모지, 자간 넓힌 대문자 라벨, 링크 뒤 화살표, 큰 그림자, 기본 서체, `!important`, 채움 문구, 과한 모서리, 블록마다 등장 애니메이션, 그라디언트 남발. 예외는 `// sz-allow <rule>` 주석으로 남긴다.

### 7.4 Visual QA 워크플로우

```
dev 서버 기동(샌드박스) → QA 브라우저 컨테이너를 프로젝트 네트워크에 연결
 → 뷰포트별(iPhone 15 Pro · iPad Pro 11 · Desktop 1440) × 경로별:
     라이트 렌더 → 화면 단위 PNG 캡처(기기 픽셀 비율 그대로) → DOM 측정(collector) → 결정론적 검사(22개 규칙) → 글만 뽑아 카피 린트(§7.5)
     다크 렌더 → 색 관련 검사만
     비전 리뷰(스크린샷 + 요소 목록 + 이미 측정된 결함 + 첫 화면 여부) → 루브릭 7축 + 슬롭 지수 + 화면 유형 + 발견 사항 + 재설계 패치
 → 점수와 등급 계산 → AuditReport 저장 → 실패 시 셀렉터·픽셀 박스·수정안·재설계 계획을 엔진에 전달
```

모바일(Expo) 프로젝트는 폰과 태블릿 크기에서만 감사한다(`auditViewports`). 데스크톱 폭에서 심사하면 데스크톱 레이아웃을 요구하게 되고, 그 요구를 가장 싸게 채우는 것이 감사가 막으려는 웹 랜딩 페이지다.

- **측정이 먼저다.** 대비, 터치 영역, 가로 넘침, viewport 메타 누락, 글자 크기·간격·모서리의 스케일 이탈, 서체 미로딩은 브라우저가 계산한 값으로 산술 검사한다(`qa/checks.ts`). 반복 가능하고 토큰을 쓰지 않는다.
- **비전 모델은 측정할 수 없는 것만 본다.** 위계, 여백 리듬, 타이포 체계, 색 절제, 마이크로카피와 톤, 독창성. 이미 측정된 결함 목록을 받고 반복하지 말라는 지시를 받는다. 프롬프트 템플릿은 `qa/vision.ts`의 `VISION_SYSTEM_PROMPT` 상수이고 출력은 구조화 출력 스키마다. 좌표는 모델이 추정하지 않는다: 모델은 요소 ID를 지목하고, 코드가 그 ID를 셀렉터와 박스로 바꾼다.
- **리뷰어는 순서대로 묻는다** (`qa/QaVisionBridge.ts`). Keychain에 API 키가 있으면 그것을 먼저, 그다음은 소유자의 구독을 `audit.reviewers` 순서대로 묻는다(기본: Codex → Claude → Antigravity → Cursor). 각 구독은 자기 CLI로, 그 CLI의 잠금 상태 그대로 간다: Claude는 도구를 전부 끄고 스크린샷을 stdin의 이미지 블록으로, Codex는 읽기 전용 샌드박스에서 `--image`와 `--output-schema`로, Antigravity와 Cursor는 호스트 격리(jail) 안에서 ACP 프롬프트의 이미지 블록으로 받는다. 어떤 리뷰어도 도구로 파일을 가져오지 않는다. 스키마는 CLI가 강제할 수 있으면 강제하고, 어느 경우든 여기서 다시 검증한다. 앞 리뷰어가 실패하거나 사용 한도에 걸렸을 때만 다음 리뷰어에게 간다. Claude 경로의 모델은 코드에 고정된 `claude-fable-5-2`이고, 다른 벤더는 그 CLI의 기본 모델이다. 보고서는 누가 심사했는지(`vision.via`, `vision.model`) 적는다. 리뷰 호출은 `judge` 범위라서 태스크 장부에는 기록되지만 프로젝트 일일 예산으로만 막힌다. 예전에는 엔진이 태스크 예산을 다 쓰면 리뷰가 `budget.task`로 거부됐고, 감사는 측정값만으로 100점 통과했다.
- **슬롭 냄새 검사.** 리뷰어는 다섯 가지를 먼저 본다: 기능 없는 범용 클립아트(`vision/stock-clipart`), 폰 화면의 웹 랜딩 레이아웃(`vision/web-layout-on-mobile`), 글과 선뿐인 첫 화면(`vision/no-living-visual`), 촉감과 어포던스, 타이포 대비. 앞의 셋은 모델이 뭐라고 적든 코드가 블로커로 올린다(`toScreenReview`). 셋째는 첫 화면(감사의 첫 경로)에서만 블로커다: 설정 화면은 글만 있어도 되지만 첫 화면은 안 된다. 거기에는 실물이 하나는 있어야 한다: 제품의 데이터로 움직이는 캔버스, 실제 제품 화면, 조작되는 뷰파인더, 손에 반응하는 요소. 일러스트와 로고는 세지 않는다. 정돈만 재면 화면이 밋밋할수록 점수가 올랐고, 이것이 그 구멍을 막는 규칙이다. 모바일 앱의 폰 화면을 리뷰어가 `mobile-app`이 아닌 유형으로 분류하면 발견 사항이 없어도 블로커가 생기고, 함정에 걸린 화면의 슬롭 지수는 60 아래로 내려가지 않으며, 블로커마다 재설계 패치가 붙는다(없으면 코드가 쓴다).
- **점수** = 측정 점수 × 0.4 + 판단 점수 × 0.6. (처음에는 0.6 대 0.4였다. 정돈만으로 재면 빈 목업이 가장 잘 만든 사이트보다 높게 나와서 뒤집었다. 측정이 가진 것은 거부권이다: 블로커는 판단이 어떻든 감사를 떨어뜨린다.) 판단 점수 = (루브릭 평균 × 10 + (100 − 슬롭 지수)) ÷ 2. 측정 점수 = 100 − (블로커 14, 메이저 5, 마이너 1.5; 규칙당 상한 20). 같은 규칙·경로·요소가 여러 뷰포트에서 나오면 결함 1건이다. **통과 = 블로커 0건, 카피 습관 0건(§7.5), 점수 ≥ 85, 슬롭 지수 ≤ 30.** 등급은 S(95 이상, 슬롭 10 이하, 메이저 0), A, B가 통과이고 C, D는 미달, 슬롭 지수 60 이상은 F다. 리뷰어의 취향은 점수를 움직일 수 있어도 결함을 뒤집지 못한다.
- **감사는 자기 자신에 대해 거짓말하지 않는다.** 리뷰어가 캡처한 화면을 전부 보지 못했으면(꺼짐, 물어볼 모델 없음, 실패, 일부만 심사) 보고서는 `visionReviewed: false`와 이유를 담고, 점수는 50을 넘지 못하며, 등급이 없고, 통과하지 못한다(`gradeAudit`). 측정에 문제가 없는데 리뷰만 못 받은 감사는 하네스에서 `unverified`로 다룬다: 엔진이 고칠 것이 없으므로 수정 라운드로 돌려보내지 않는다. 그 이유가 사용 한도(모든 리뷰어의 구독 한도, 또는 프로젝트 일일 예산)면 태스크는 끝나지 않고 `suspended`가 된다: 작업은 브랜치에 커밋되고, 태스크는 큐 자리와 엔진을 내려놓으며, 프로젝트는 다른 작업을 받을 수 있다. `ReviewResumer`가 10분마다 리뷰어들에게 한 단어짜리 질문을 순서대로 던져서, 하나라도 답하면 태스크를 다시 큐에 넣는다. 재개된 태스크는 계획과 구현을 건너뛰고 같은 브랜치에서 검증부터 이어 간다(리뷰어가 이번에는 반려하면 그때 엔진을 연다). 소유자는 `tasks.resume`으로 바로 재시도하거나 취소할 수 있다. 한도가 아닌 이유(꺼짐, 물어볼 리뷰어 없음, 로그인 문제)면 기다려도 달라지지 않으므로 태스크는 끝나고, 요약과 감사 화면에 "디자인 미보증"으로 남는다.
- **한 번에 다시 디자인.** `audits.redesign`은 감사의 비평·재설계 계획·발견 사항을 데이터 블록으로 담은 `build` 태스크를 감사받은 브랜치에서 시작한다. 전체 검증 트랙이라 결과는 같은 리뷰어에게 다시 간다.
- 감사 대상 경로와 dev 서버 명령은 워크스페이스의 `.studio-zero/project.json`에 있다. 에이전트가 고칠 수 있는 파일이라 비신뢰 입력으로 다룬다(스키마 검증, 포트는 공개된 프리뷰 포트로 제한).
- QA 브라우저는 필요할 때 뜨고 10분 쉬면 내려간다.

### 7.5 글에서 나는 AI 티: 카피 린트

스크린샷을 보는 리뷰어는 화면을 그림으로 읽고, 잘 짠 글자는 생성된 문장도 그럴듯하게 보이게 한다. 그래서 글은 렌더링에서 떼어 글로 읽는다. 감사는 DOM에서 화면의 글만 꺼내 읽는 순서로 놓고(`auditCopy`), 코드와 터미널 출력(모노 서체)은 뺀다.

`lintInterfaceText()`(`packages/design/src/textLint.ts`)가 한국어 문구의 다섯 가지 습관을 찾는다(`KOREAN_TEXT_SLOP_PATTERNS`). 각 항목은 무엇을 읽는지가 정해져 있다.

| 규칙 | 잡는 것 | 읽는 곳 |
|---|---|---|
| `copy/feature-list-dumping` | "…토론하고 …고칩니다"처럼 기능을 한 문장에 이어 붙인 것 | 본문 문장 |
| `copy/passive-explanation-tone` | "…로 이루어집니다", "확인하실 수 있습니다" 같은 설명 문구, 그리고 한 덩어리 안에서 "…니다"로 끝나는 문장이 셋 이상 이어지는 것 | 본문 문장 |
| `copy/empty-slogan-title` | "새로운 경험", "더 나은 미래", "스마트한 관리" 같은 구호. 숫자가 든 제목은 건드리지 않는다 | 제목 |
| `copy/generic-cta` | 라벨 전체가 "시작하기", "더 알아보기"인 버튼 | 컨트롤 라벨 |
| `copy/uniform-card-grid` | 같은 크기의 상자 셋 이상이 한 줄에 나란한 것 (사소: 보고만 한다) | 레이아웃 |

- 걸린 문구는 발견 사항으로 엔진에 돌아간다: 인용한 문구, 그 요소의 셀렉터, 고쳐 쓰는 방법. 같은 문구가 여러 뷰포트에서 나오면 한 건이다.
- 카피 습관(사소 제외)은 소스 슬롭 린트처럼 0건이어야 통과한다. 점수에 섞여 평균에 묻히지 않는다(`scoreAudit`).
- 보고서의 `copy`에 화면의 글 전체와 카피 슬롭 점수가 남는다. 인수 검수(§8.2)의 리뷰어는 이 글 덩어리를 그림 없이 따로 받는다.
- 브리프의 정규식을 그대로 쓰지 않았다(§18): 원문대로면 "알림을 관리합니다" 한 줄도, "친구하고 봅니다"도 걸린다.

## 8. 하네스 루프와 자기 개선

`Harness.run()` (`harness/Harness.ts`). 일은 엔진 하나가 하고, 끝났는지는 실행 결과가 정한다. 모델이 다른 모델의 작업을 두고 토론하는 단계는 없다. 다른 회사의 모델은 `full` 빌드를 시작과 끝에 한 번씩만 본다(§8.2).

| 단계 | 하는 일 |
|---|---|
| **Plan** | 라우팅 → 워크스페이스 체크포인트 → 태스크 브랜치 → 활성 교훈 로드 → 레퍼런스 측정 → Fable 5.2가 계획(구조화 출력) 작성 → 고정표 검사와 커밋 → 계획 교차 검토 1회(§8.1, §8.2). 계획이 제안한 감사 경로는 단순 앱 경로만 남긴다. |
| **Execute** | 엔진이 Toolbox로 작업한다. 매 턴 전에 예산 규칙, 매 응답 후 사용량 기록. 예산을 다 쓰면 소유자에게 증액 승인을 묻는다(최대 2회, 에이전트는 스스로 올릴 수 없음). |
| **Verify** | 데몬이 직접 확인한다. 싸고 이견이 없는 것부터, 실패한 단계에서 그 회차를 끝낸다. 실패 내용은 데이터 블록으로 엔진에 돌아가고, 엔진은 최대 `verifyRounds`(기본 3)번 고칠 수 있다. 전부 통과하면 최종 인수 검수 1회(§8.2), 그 뒤 커밋과 빌드 측정, 장부 기록(§8.3). |
| **Reflect** | 판정 모델이 번호 붙은 트레이스를 읽고 원인, 교훈, 회귀 체크를 제안한다. |
| **Evolve** | 코드가 채택을 결정하고 `project_rules.md`, `system_heuristics.json`을 다시 쓴다. |

**검증의 세 단계.**

| 단계 | 하는 일 | 엔진에 돌아가는 것 |
|---|---|---|
| 1. 컴파일 게이트 (`CompilerGate`) | 샌드박스에서 타입 검사를 돌린다. `package.json`에 `typecheck` 스크립트가 있으면 그것, 없고 `tsconfig.json`과 설치된 `tsc`가 있으면 `tsc --noEmit`, 둘 다 없으면 `test` 스크립트. 아무것도 없으면 건너뛴다. 워크스페이스에서 읽는 것은 "있다/없다"뿐이고 명령줄은 데몬 코드에 적혀 있다. | `<compiler_error exit_code="2" command="…">` 안에 컴파일러 출력 그대로(데이터 블록으로 감싼다) + "Fix this compilation error immediately." |
| 2. 스모크 게이트 (`SmokeTester`) | dev 서버를 띄우고 QA 브라우저로 각 경로를 연다. 잡지 못한 예외, `console.error`, 5xx 응답, 열리지 않는 페이지를 모은다. 없는 파비콘 같은 리소스 404는 세지 않는다. 깨끗하면 바로 통과. | 브라우저가 보고한 내용 그대로 |
| 3. eval (`EvalRunner`) | 회귀 명령 → 슬롭 린트 → 시각 감사 (§7.4) | 셀렉터, 픽셀 박스, 수정안 |

**예산이 세는 것.** 태스크 예산(기본 200만 토큰)과 프로젝트 일일 예산은 입력과 출력 토큰을 더하되, 프롬프트 캐시에서 다시 읽은 입력은 10분의 1로 센다(`budgetTokens`, 제공자가 매기는 값과 같은 비율). 에이전트 세션은 턴마다 자기 문맥 전체를 다시 읽는다: 실제로 돌린 첫 `full` 빌드에서 Claude Code 구독 세션 하나가 입력 822만 토큰을 보고했고, 그대로 세면 평범한 빌드 한 번이 예산의 네 배였다. 사용 기록(`usage_ledger`)에는 제공자가 보고한 숫자가 그대로 남고 캐시분이 따로 적힌다.

- 증액은 **쓴 만큼에서부터** 센다: 새 한도 = max(이전 한도, 쓴 양) + 승인한 양. 구독 CLI 엔진은 세션 하나를 요청 한 건으로 돌리므로, 멈춰 세울 때는 이미 한도를 한참 넘어 있을 수 있다. 이전 한도에 더하던 처음 구현에서는 승인을 두 번 받아도 한도가 쓴 양에 못 미쳐서 태스크가 반드시 실패했다.
- 승인 문구에 지금까지 쓴 양이 들어간다.
- 구독 CLI 엔진의 한 차례 안에서는 예산을 중간에 확인하지 못한다. 확인은 차례 사이에만 있다 (§17).

게이트 결과는 `gate.result` 이벤트로 남는다. 브라우저를 쓰는 검사의 스위치는 프로젝트의 시각 감사 eval이다: 소유자가 그것을 끄면 스모크 게이트도 브라우저를 띄우지 않는다. 브라우저 컨테이너가 뜨지 않는 것은 작업물의 결함이 아니므로 스모크는 경고를 남기고 건너뛴다.

**두 가지 트랙** (`tasks.submit`의 `track`, 기본 `full`).

| | `fast` (Draft 0) | `full` |
|---|---|---|
| 계획 호출 | 없음. 첫 턴에 기본값 지침(`DRAFT_BRIEF`)이 들어간다: 묻지 말 것, 스택·상태·예시 데이터의 기본값, 화면 하나를 끝까지. 주제에서 꺼낸 아이디어 하나와 첫 화면의 실물은 초안에서도 요구한다. | 있음 |
| 고정표, 레퍼런스, 교차 검토 2회 | 없음 | `build`에 있음 (고정표는 디자인 게이트가 켜져 있을 때) |
| 검증 | 컴파일 → 스모크 → 회귀 명령 | 컴파일 → 스모크 → 회귀 명령 → 슬롭 린트 → 시각 감사 |
| 회고 | 없음 | 있음 |
| 장부 | 있음 | 있음 |

`fast`는 모델이 판정하는 부분(계획 호출, 고정표, 교차 검토, 비전 리뷰, 회고)을 뺀 같은 루프다. 실행으로 확인하는 게이트는 그대로 남는다.

### 8.1 만들기 전에 받는 것: 고정표와 레퍼런스

구조는 결과물을 바꾸지 못했다. 한 세션, 빌더 주도, 멀티 에이전트 룸을 견줬을 때 셋 다 기준에 못 미쳤고 구조가 무거울수록 시간과 토큰만 더 들었다. 결과를 바꾼 것은 빌더가 만들기 전에 받는 것과, 만든 뒤 같은 도구로 재서 견주는 것이었다. 그래서 하네스는 엔진을 늘리지 않고 엔진이 받는 것을 늘렸다.

**고정표** (`scratch/AnchorTable.ts`, 워크스페이스의 `.studio-zero/anchor-table.json`). 디자인 태스크(디자인 게이트가 켜진 프로젝트의 `full` 트랙 `build`)는 유효한 고정표가 커밋되어 있어야 코드를 쓰기 시작한다.

| 칸 | 내용 |
|---|---|
| `idea` | 우리 주제에서 나온 한 문장. 보고 난 사람이 기억할 것 |
| `directions` | 구조가 서로 다른 방향 두 개 |
| `firstScreen` | 가장 큰 것, 첫 화면에서 바로 할 수 있는 실제 행동, 볼거리와 그 출처 |
| `anchors` | 레퍼런스에서 본 것 → 통하는 원리 → 우리 주제와 데이터에서 나온 값. 세 줄 이상, 세 범주 이상 |
| `retainedPrinciples` · `discardedDefaults` · `strictlyExcluded` | 지킬 원리 3~5개, 버릴 기본값, 레퍼런스에서 절대 가져오지 않을 것 |

- 누가 쓰는가: 이전 태스크가 남긴 표가 유효하면 그대로 쓴다. 없으면 계획 모델이 계획과 함께 쓴다(구조화 출력). 계획 모델이 없거나 그 초안이 검사에 걸리면 엔진이 코드 전 회차에서 표만 쓴다(`ANCHOR_BRIEF`, 고칠 기회 2번).
- 검사(`checkAnchorTable`)는 판정이 필요 없는 것만 본다: 칸이 채워졌는지, 두 방향이 정말 둘인지, 볼거리가 일러스트가 아닌지, 레퍼런스의 수치(`132px`, `810ms`)를 우리 값으로 그대로 옮기지 않았는지. 레퍼런스에서는 원리만 가져오고 값은 버린다: 크기와 비율과 색과 시간까지 따라 하면 다른 제품에서도 같은 냄새가 난다.
- 통과하지 못하면 태스크는 실행 단계에 들어가지 못하고 끝난다("blocked before any code"). 통과하면 `docs: anchor table`로 먼저 커밋되고, 엔진은 표를 데이터 블록으로 받는다.
- 엔진은 만들면서 표를 고칠 수 있다. 검증의 첫 단계가 표를 다시 읽고, 깨졌으면 그 회차는 거기서 실패한다.

**레퍼런스** (`qa/RefKit.ts`). 소유자는 `full` 빌드에 주소를 세 개까지 붙일 수 있다(`tasks.submit`의 `references`). 남의 페이지이므로 이 Mac에서 열지 않는다.

- 열리는 곳은 QA 브라우저 컨테이너뿐이다. 공개 호스트 이름의 https 주소만 받는다(IP, `localhost`, 한 단어짜리 이름, `.local`·`.internal` 등은 제출 때 거부). 페이지가 보내는 하위 요청도 공개 호스트로 가는 것만 컨테이너를 나가고, 응답한 서버의 주소가 사설 대역이면 버린다. 그래서 레퍼런스 페이지가 데몬이나 샌드박스나 집 안 네트워크를 향하게 만들 수 없다.
- **한 장이 아니라 프레임으로 본다** (`qa/filmstrip.ts`). 첫 화면이 돌아가는 제품 시연이거나 조립되는 등장이거나 루프인 페이지는 정지 화면 한 장으로 재면 "제목 위의 그림"으로 읽힌다. 그래서 페이지를 처음부터 다시 틀어 0.3·1·2·3.5·5.5초에 찍고, 최대 세 화면 아래까지 내려가며 찍는다. 프레임은 같은 브라우저의 빈 페이지에서 캡션 달린 한 장으로 합쳐 계획 모델이 순서대로 읽고, 함께 잰 것(프레임 사이에 첫 화면이 바뀐 비율, 등장 뒤에도 움직이는지, 돌고 있는 애니메이션과 시간, 비디오·캔버스의 크기와 위치, 페이지 깊이)은 요약에 붙는다.
- 돌아오는 것은 첫 화면 캡처와 측정값이다: 글자 크기와 서체, 가장 큰 글자의 줄 높이와 본문 대비 배수, 곡률, 색, 모션 시간, 첫 화면의 구성. 측정값은 `PageDigest` 스키마를 통과한 것만 쓰고, 프롬프트에는 `browser-page` 데이터 블록으로 들어간다. 계획 모델은 캡처도 본다. 엔진은 측정값만 받는다.
- 정책: `reference.capture`. 에이전트는 스튜디오의 브라우저가 어디를 열지 정할 수 없다.

### 8.2 샌드위치: 시작과 끝에 한 번씩

매 턴 서로 따지는 토론은 두지 않는다. 다른 회사의 모델은 태스크를 정확히 두 번 본다(`harness/SandwichReviewer.ts`).

| | 언제 | 받는 것 | 돌려주는 것 |
|---|---|---|---|
| 위: 계획 교차 검토 | 고정표가 커밋된 뒤, 코드 전 | 요청, 계획, 고정표 | 세 가지 지적: 흔한 기본값에 갇힌 곳, 놓친 엣지 케이스와 보안 문제, 밋밋해질 위험 (종류마다 4개까지) |
| 아래: 최종 인수 검수 | 데몬의 검사를 전부 통과한 뒤 | 요청, 계획, 고정표, 측정한 증거(게이트 결과, 감사 판정), 화면의 글만 뽑은 덩어리, 첫 화면 캡처 | 통과, 또는 보정 패치 1건 |

- 그 사이에는 엔진 혼자 일하고 컴파일러 출력만 돌려받는다.
- 지적과 패치는 다른 모델이 비신뢰 입력을 읽고 쓴 글이라 엔진에게 `engine-output` 데이터 블록으로 간다. 패치를 받은 엔진의 결과는 여느 변경처럼 다시 검증된다. 재검수는 없다: 사용 한도로 멈췄다가 이어 간 태스크도 인수 검수를 두 번 받지 않는다.
- **상호보완 짝꿍** (`ModelRouter.pairReviewer`, `REVIEW_PAIRS`). 검토받는 쪽과 같은 회사의 모델은 고르지 않는다: 같은 계열의 두 번째 의견은 첫 번째 의견의 반복이다. Claude가 한 일은 Codex → Antigravity → Cursor, Codex가 한 일은 Claude → Antigravity → Cursor, Cursor·Antigravity가 한 일은 Claude → Codex 순서로 쓸 수 있는 첫 구독이 본다. 계획은 Claude가 쓰므로 위쪽 검토는 계획의 작성자 기준으로, 아래쪽은 엔진 기준으로 짝을 짓는다. 소유자가 태스크마다 직접 고를 수 있고(`tasks.submit`의 `reviewer`), 고른 구독을 쓸 수 없으면 다른 것으로 바꾸지 않는다.
- 검토를 받을 수 없으면(다른 회사 구독이 없음, 사용 한도, 깨진 답) `review.completed` 이벤트에 이유를 남기고 넘어간다. 태스크의 통과 여부는 데몬 자신의 게이트가 정하고 이 검토에 달려 있지 않다.
- 호출은 `judge` 범위라 프로젝트 일일 예산으로만 막힌다. 끄려면 `review.sandwich: false`.

### 8.3 장부

끝난 태스크마다 영수증 한 장을 남긴다(`harness/Ledger.ts`, 테이블 `ledger_entries`). 숫자는 전부 데몬이 돌린 검사와 자기 사용량 기록에서 나온다. 엔진이 자기 일에 대해 한 말은 들어가지 않는다.

| 묶음 | 내용 | 출처 |
|---|---|---|
| 코드 | 컴파일러 에러 수(첫 회차와 마지막), 통과까지의 검증 회차, 회귀 체크 통과·실패 목록, 프로덕션 빌드 시간과 번들 크기 | 컴파일 게이트, eval, `BuildMeter` |
| 디자인 | 등급과 점수, 슬롭 지수, 첫 화면 볼거리, AAA 대비 통과율, 터치 타깃 적합도, 카피 습관 수 | 그 태스크의 마지막 감사 |
| 비용 | 모델 호출 수, 입력·출력 토큰, 금액, 걸린 시간 | `usage_ledger` |
| 검수 | 누가 계획을 보고 누가 인수했는지, 판정(`pass` · `patch` · `patched`) | `SandwichReviewer`, 그리고 패치 전후의 작업 트리 |
| 조작 | 화면 명세의 핵심 흐름을 실행 중인 앱에서 걸은 결과: 완주한 작업 수, 누름, 스크롤, 가장 작은 컨트롤, 누름에 답한 컨트롤 수 (§8.4). 화면 명세가 없는 프로젝트는 비어 있다 | `SmokeTester.walk` |
| 직전 대비 | 달라진 지표만: "타입 에러 3→0, 디자인 등급 B→S, 텍스트 슬롭 4건→0건 클린, 핵심 흐름 누름 5번→3번" | 같은 프로젝트의 앞 영수증 (`ledgerDelta`) |

- 실패한 태스크도 영수증을 남긴다. 취소된 것과 문서만 쓰는 기획 태스크는 남기지 않는다.
- **인수 판정은 세 가지다.** `pass`는 그대로 통과, `patch`는 보정 패치가 나갔지만 반영된 것이 확인되지 않은 것, `patched`는 패치가 반영되고 다시 전부 통과한 것이다. 전에는 패치를 받은 태스크가 끝까지 `patch`로 남아서, 지적을 고쳐 깨끗하게 끝낸 작업과 고치지 못한 작업을 장부에서 가를 수 없었다. `patched`도 다른 숫자처럼 데몬이 본 것이다: 패치를 보내기 직전과 엔진이 답한 직후의 작업 트리(`workspaceTree`, 체크포인트가 담는 것과 같은 범위의 git 트리 id)가 다르고, 그 뒤 검증이 다시 전부 통과했을 때만 적는다. 엔진은 지적이 틀렸다고 보면 고치지 않고 이유를 적을 수 있고(§8.2), 그렇게 아무것도 바꾸지 않은 태스크는 통과하더라도 `patch`로 남는다. 패치 뒤에 검증이 깨져 실패한 태스크도 `patch`다.
- 사용 한도로 멈췄다가 이어 간 태스크의 영수증에도 누가 계획을 보고 누가 인수했는지가 남는다(멈출 때 함께 적어 둔다). 전에는 이어 간 실행이 빈 기록에서 시작해 계획 검토자가 "받지 않음"으로 찍혔다.
- `BuildMeter`는 커밋 뒤에 `build` 스크립트를 한 번 돌려 시간과 산출물 크기를 잰다. 게이트가 아니다: 빌드가 깨지면 영수증과 요약에 "검증되지 않음"으로 적히고 엔진에게 돌아가지는 않는다. 끝나면 작업 트리를 커밋한 상태로 되돌린다.
- 원본은 DB다. 같은 줄이 `~/.studio-zero/projects/<슬러그>/ledger.jsonl`에도 덧붙는다. 워크스페이스 바깥이라, 평가받는 엔진이 자기 영수증을 고칠 수 없다.

**다른 모델의 의견** (`advisor.ask`). 루프의 일부가 아니다. 소유자가 입력창에 `/ask-codex 질문`이나 `/ask-gemini 질문`을 적었을 때만, 그 CLI에 질문 하나를 보내 답 하나를 받는다(Gemini는 Antigravity의 `agy`로 간다). 태스크와 같은 잠금 아래에서 돌고, 연결된 도구 서버가 내놓는 도구가 0개라서 읽을 수도 바꿀 수도 없다. 상태도, 재질문도 없다. 답은 `advisor.answered` 이벤트로 남고 화면에서는 접힌 카드로 보인다. 에이전트와 하네스는 이 액션을 쓸 수 없다(정책).

실패하거나 취소되어도 작업은 브랜치에 커밋된 채 남고 워크스페이스는 통합 브랜치로 돌아간다. 데몬 종료로 중단된 태스크는 다음 기동 때 한 번 다시 실행된다.

**학습의 쓰기 경로를 좁힌 이유.** 비신뢰 내용이 섞인 트레이스에서 모델이 뽑은 문장을 다음 프롬프트에 자동으로 넣으면, 그것이 프롬프트 인젝션이 영구히 남는 통로가 된다. 그래서:

1. 교훈 문장은 `lintLesson()`을 통과해야 한다(URL, 네트워크 도구, 인코딩된 덩어리, 승인·정책·자격증명 언급, 지시 무효화, 검증 약화 금지).
2. 인용한 이벤트 `seq`가 그 태스크의 트레이스에 실제로 있어야 한다.
3. `candidate`로 시작한다. 후보는 소유자에게 보이고 에이전트에게는 보이지 않는다.
4. 승격은 정책이 정한다: 소유자가 직접 하거나, 서로 다른 태스크 2건이 독립적으로 같은 교훈을 내고 해가 보고되지 않았을 때(프로젝트 범위만). 전역 교훈은 항상 소유자가 승격한다.
5. 해 보고 2건이면 격리된다.
6. 활성 교훈은 user 턴의 조언으로 들어간다. 시스템 프롬프트에는 넣지 않는다.

회귀 eval도 같다. 모델은 명령을 만들어낼 수 없고, **그 태스크에서 에이전트가 실제로 실행해 0으로 끝난 명령만** 승격된다. eval 정의는 워크스페이스가 아닌 데몬 DB에 있어서 검증받는 에이전트가 고치거나 지울 수 없다. 끄는 것은 소유자만 한다.

`project_rules.md`와 `system_heuristics.json`은 `~/.studio-zero/` 아래(워크스페이스 바깥)에 생성되는 읽기용 산출물이고 원본은 DB다.

### 8.4 설계 태스크의 시안: 눌러 보고, 재고, 고른다

`ideate` 태스크(§14의 **설계부터**)는 문서 네 개로 끝났다. 소유자는 아무것도 보지 못한 채 구현을 승인했고, 그 글이 화면에서 무엇이 되는지는 한 시간 뒤에야 알았다. 그래서 방향마다 첫 화면을 한 장씩 그리게 했다. 그렇게 나온 실제 시안 여섯 장(가사분담 기록, 랜덤 다이어트 매치)을 놓고 보니 문제가 넷이었다.

| 실제로 본 것 | 원인 |
|---|---|
| 조작한 **뒤**의 한 순간만 얼어 있다("5초 동안 되돌릴 수 있다"는 토스트가 떠 있는 화면). 누르기 전이 없고, 누를 수도 없다. 어떻게 쓰는 물건인지는 설명 한 줄로만 안다 | 지침이 "스크립트 없음"에서 멈췄다. 가만히 있는 시안은 디자인한 것이 아니다 |
| 사진이 주인인 방향("맞사진")의 사진 자리에 빗금 상자와 "상대가 올린 비빔밥 사진이 이 칸을 채운다"는 문장이 있다 | 지침이 "그림 파일은 넣지 않는다. 자리와 설명만 둔다"였다 |
| 제목 서체로 고른 Fraunces · Instrument Serif가 한 번도 뜨지 않았다. 컨테이너에서도 소유자의 앱에서도 시스템 세리프로 떨어진다 | 시안은 네트워크 없이 열리고, 서체 파일을 주는 곳이 없었다 |
| 토스트가 목록을 덮고, 글자가 잘리고, 다이얼이 줄을 가린다 | 빌드는 22개 규칙으로 재고 리뷰어에게 보이는데, 시안은 "파일이 400바이트 이상인가"만 확인했다 |

구조(누가 몇 번 검토하느냐)를 바꿔서는 결과가 달라지지 않았고, 만들기 전에 받는 것과 만든 뒤 재서 견주는 것이 결과를 바꿨다(§8.1). 시안 단계에는 둘 다 없었다. 그래서 넷을 같이 고쳤다.

```
ideate 태스크 (IDEATION_BRIEF, 다섯 패스)
  4. docs/screens.json      화면 명세: 기능만. 생김새는 없다 (아래)
  5. docs/mockups/a.html, b.html (세 번째 방향이 정말 다르면 c.html)
     같은 핵심 장면, 같은 데이터, 서로 다른 콘셉트 · 조작 · 구성 · 겉모습
     열리는 상태 = 사람이 하기 전. 핵심 흐름을 CSS 상태만으로 끝까지 조작할 수 있다
     그림은 generate_image로 docs/mockups/assets/에, 페이지에서는 assets/<이름>.jpg로
        │
검증    문서가 있는가 → 화면 명세가 성립하는가              (빚: 못 채우면 태스크 실패)
        시안 측정: 그리기 + 핵심 흐름 걷기 + 감사           (권고: 두 번까지 고치게 하고, 그 뒤에는 결과와 함께 보여 준다)
        │
        mockups.rendered 이벤트 → 결정 카드에 시안, 센 숫자, 눌러 본 장면
```

**화면 명세** (`scratch/ScreenSpec.ts`, 워크스페이스의 `docs/screens.json`). 화면기획서의 기능 쪽만 가져온 문서다: 화면 목록, 화면마다 진입 경로와 요소별 동작·규칙, 평소가 아닐 때의 상태, 예외, 그리고 측정 이벤트. 생김새는 한 줄도 없다. 그래서 겉모습이 전혀 다른 세 시안이 같은 명세를 따르고, 구현도 같은 명세를 따른다.

| 칸 | 내용 |
|---|---|
| `coreMoment` | 제품이 존재하는 이유인 한 가지를 사람이 하고 있는 순간, 한 문장 |
| `screens[]` | `id`(`H-01`), `name`, `purpose`, `entry`(다른 화면의 id 또는 바깥: 앱 실행, 알림, 공유 링크), `elements[]`(이름, 동작·규칙, 넘어가는 화면), `states[]`(기록 없음, 실패, 오프라인, 한도), `exceptions[]`, `later` |
| `tasks[]` | 핵심 흐름을 사람이 해내는 일 1~5개로: `id`, `goal`, `outcome`(끝난 뒤 화면에서 참인 것), `screen` |
| `events[]` | 제품이 기록할 것: 이름, 언제, 무엇을 재는가 |

- 검사(`checkScreenSpec`)는 고정표와 같은 종류다. 판정이 필요 없는 것만 본다: 칸이 채워졌는지, 화면 id가 겹치지 않고 서로 가리키는 곳이 실제로 있는지, 바깥에서 들어오는 화면이 하나는 있는지, 규칙이 라벨 한 단어가 아닌지, 핵심 흐름이 일어나는 화면이 다른 상태를 적었는지(제품의 이유가 일어나는 화면일수록 빈 상태와 실패가 빠진다). 어긋난 곳은 고칠 수 있는 문장으로 엔진에 돌아간다.
- 명세는 문서처럼 빚이다. 성립하지 않으면 시안은 재지 않고, `verifyRounds` 안에 고치지 못하면 태스크가 실패한다.
- 클라이언트는 결정 카드에서 명세를 화면기획서처럼 읽게 보여 준다(`panels/ScreenSpecView.tsx`): 핵심 흐름, 화면별 `# / 요소 / 동작·규칙 / 다음` 표, 상태, 예외, 측정 이벤트.

**동작하는 시안.** 스크립트는 여전히 없다. 시안은 에이전트가 쓴 페이지이고 소유자의 앱 안에서 보이기 때문이다(아래 "봉인"). 상태는 CSS 상태로 만든다: 체크된 라디오·체크박스와 `:has()`, 버튼 구실을 하는 `<label for>`, `<details>`, `:focus-within`, 입력란의 `:placeholder-shown`. 실제 Chrome에서 스크립트를 끈 채 이 방식의 페이지를 누르고 입력해서 상태가 바뀌는 것을 확인했다. 페이지는 흐름이 어디인지를 속성 둘로 말한다.

| 속성 | 뜻 |
|---|---|
| `data-step="T:k"` | 작업 `T`의 `k`번째로 사람이 누르는 컨트롤 (입력란이면 `data-sample`에 칠 값) |
| `data-done="T"` | 작업 `T`의 결과가 참일 때만 화면에 있는 것 |

**핵심 흐름 걷기** (`qa/FlowWalker.ts`). UX를 사람 눈으로만 견주던 것을 세게 만든 부분이다. 리뷰어는 그림을 보고 "잘 읽힌다"고는 할 수 있어도, 한 방향에서는 네 번 누르고 다른 방향에서는 한 번 누른다는 것, 그 버튼이 토스트 밑에 깔려 있다는 것, 눌러도 손에 답이 없다는 것은 말하지 못한다. 그래서 QA 브라우저가 페이지를 직접 조작한다.

```
작업마다:  data-done="T"가 이미 보이면 멈춤(already-done: 끝난 뒤의 모습으로 열렸다)
          k = 1, 2, … : 보이는 data-step="T:k"를 찾는다 → 화면 밖이면 스크롤(센다)
                        → 가운데에 다른 요소가 얹혀 있으면 멈춤(covered)
                        → 쉴 때의 모습을 읽고, 누른 채 140ms 뒤의 모습을 읽는다(다르면 "답했다")
                        → 뗀다(입력란이면 data-sample을 친다) → 그 누름이 일으킨 전환·애니메이션의 길이를 읽고 끝나기를 기다린다 → 한 장 찍는다
          표시된 단계가 끝나면 data-done="T"가 보이는가(아니면 outcome-not-shown)
```

- 돌아오는 것은 전부 센 것이다(`FlowTaskWalk`): 누른 횟수, 친 글자 수, 스크롤 횟수, 가장 작은 컨트롤의 짧은 변, 누른 동안 모습이 달라진 컨트롤 수, 누름이 일으킨 가장 긴 움직임(ms), 그리고 끝까지 못 갔으면 어디서 왜 멈췄는지. 모델은 끼지 않는다.
- 같은 명세의 같은 작업을 세 시안이 각자의 방식으로 해내므로, 숫자가 방향끼리 견줘진다. 결정 카드의 시안마다 한 줄로 나온다: "핵심 흐름 누름 2번 · 스크롤 없음 · 가장 작은 버튼 56px · 눌렀을 때 답함 2/2".
- 걷는 동안 찍은 화면(처음, 그리고 누를 때마다)은 한 장으로 붙여 보관하고, 카드의 **브라우저가 눌러 본 장면**에서 본다.
- 끝까지 걷지 못한 페이지, 엄지에 작은 컨트롤(폰에서 44px 미만), 눌러도 그대로인 컨트롤은 문장으로 엔진에 돌아간다(`walkProblems`).
- 속성 둘이 계약의 전부라서, 같은 걷기가 스크립트 없는 시안과 실행 중인 앱을 똑같이 읽는다.

**시안도 빌드처럼 감사한다** (`VisualAuditor.auditPages`). 같은 계약으로 같은 측정(대비, 터치 영역, 넘침, 잘린 글자, 글자 크기와 간격의 스케일), 같은 카피 린트(§7.5), 같은 리뷰어다. 페이지마다 첫 화면으로 심사하고(글과 선뿐이면 블로커) 라이트와 다크를 둘 다 본다. 측정은 그 템플릿이 심사받는 모든 크기에서 하고, 리뷰어에게는 페이지마다 한 번, 제품을 처음 만나는 크기(폰 프로젝트는 폰, 나머지는 데스크톱)에서만 묻는다. 리뷰어는 시안이라는 말을 듣는다: 기준은 같고, 고칠 것을 컴포넌트 이름이 아니라 그 페이지의 마크업과 CSS로 말하며, 그림 자리에 문장을 적어 둔 것과 화면에 독자에게 쓴 메모가 있는 것은 미완성으로 지적한다. 보고서는 여느 감사처럼 저장되어 감사 탭에 뜬다(경로 자리에 시안 파일).

**재는 것과 보여 주는 것이 같은 페이지다** (`MockupRenderer.page`, `mockups.page`). 그림은 페이지가 `assets/<이름>`으로 가리키고, 스튜디오가 `docs/mockups/assets/`에서 읽어 페이지 안에 데이터로 넣는다(평범한 파일 이름의 그림만, 한 장 900KB · 한 페이지 2.4MB까지). 테마가 이름을 부른 라틴 서체(Geist, Fraunces, Instrument Serif, Bricolage Grotesque)는 데몬이 가진 파일을 `@font-face`로 넣는다(`qa/mockupFaces.ts`). 클라이언트는 워크스페이스의 파일이 아니라 이렇게 채운 페이지를 받아 봉인해 띄운다. 컨테이너에서 잰 것과 소유자가 보는 것이 한 글자도 다르지 않다. 한글 짝(Noto Serif KR 등)은 수 MB라 넣지 않고 시스템 서체로 떨어진다.

**빚과 권고.** 문서와 화면 명세는 빚이다. 시안에서 측정이 찾은 것은 권고다: 엔진에게 두 번까지 고치게 하고(`MOCKUP_CORRECTIONS`), 그래도 남으면 태스크를 실패시키지 않고 시안을 측정 결과와 함께 내놓는다(요약에 "Not verified: the mock-ups were reworked 2 times…"). 빌드에서 측정이 거부권을 갖는 것은 통과한 것이 `main`에 합쳐지기 때문이다. 시안은 아무 데도 합쳐지지 않고, 고르는 사람은 소유자다. 측정이 할 일은 그 선택에 숫자를 붙이는 것이지 설계를 버리는 것이 아니다. 같은 이유로 리뷰어가 사용 한도에 걸려도 설계 태스크는 기다리지 않는다: 잰 것만으로 내놓고 "측정만 됨"이라고 적는다.

**구현으로 이어지기.** 승인한 설계는 세 군데로 따라간다.

- 계획: 구현 요청이 시안 경로를 부르면 계획 모델은 화면 명세와 그 시안의 이름·한 줄 설명을 데이터로 받는다(`#approvedDesign`). 전에는 요청문과 파일 목록만 받아서, 계획과 고정표가 승인받지 않은 다른 방향을 적을 수 있었다.
- 엔진: `docs/screens.json`이 저장소에 있으면 그것이 화면 계획이다. 화면마다 요소의 규칙, 상태, 예외를 그대로 만들고, 핵심 흐름의 `data-step` · `data-done` 표시를 구현에도 남긴다(React Native는 `dataSet`). 카메라나 로그인처럼 테스트 브라우저에 없는 것은 픽스처 뒤에 둔다.
- 검증: 스모크 게이트가 통과하면 같은 걷기를 실행 중인 앱에서 한다(`SmokeTester.walk`, `walkApp`). 스크립트가 도는 앱이므로 누른 뒤 다음 단계나 결과가 나타나기를 2.5초까지 기다린다. 결과는 영수증의 `flow`(작업 몇 개 중 몇 개 완주, 누름, 스크롤, 가장 작은 컨트롤, 누름 응답)에 남고 직전 영수증과 견줘지며("핵심 흐름 누름 5번→3번"), 인수 검수자에게 화면 명세와 함께 증거로 간다. 인수 지침에서 "걸을 수 없는 흐름은 미충족"이다.
- 이 걷기는 빌드에서 게이트가 아니다. 새 계측이고, 카메라나 로그인을 거치는 흐름은 헤드리스 브라우저로 끝까지 누를 수 없다. 멈춘 걷기를 엔진에게 고치라고 돌려보내면 엔진은 검사를 통과시키는 우회를 만든다. 그래서 멈춘 곳은 적고(영수증, 작업 흐름의 알림), 판단은 인수 검수자와 소유자가 한다. 실제 빌드 몇 건에서 숫자가 믿을 만한 것이 확인되면 게이트로 올릴 수 있다.

- **보는 곳은 프리뷰 탭이고, 거기서 눌러 본다.** 시안은 그림이 아니라 페이지 그 자체로, 앱과 같은 틀(폰·태블릿·데스크톱, 라이트·다크)에 뜬다. 상태가 CSS 상태라서 스크립트 없이도 소유자가 직접 조작할 수 있다. 보여 주기 전에 봉인한다: 페이지의 어떤 것보다 먼저 파싱되는 정책(스크립트 없음, 요청 없음)을 문서 맨 앞에 두고, 스크립트를 돌리지 않는 프레임에 넣는다. 프레임은 앱과 같은 출처라서, 페이지 쪽에서 아무것도 실행하지 않아도 "포인터 아래에 무엇이 있나"를 물을 수 있다. 카드의 그림도 같은 페이지를 폰 폭으로 줄인 것이다.
- **모든 시안은 같은 장면을 그린다.** 처음 지침은 "무엇을 앞에 두느냐로 다르게"였고, 실제로 나온 것은 한 앱의 서로 다른 화면 셋이었다(오늘 라운드, 기록판, 체중). 이제 세 시안 모두 제품이 존재하는 이유인 그 한 가지를 사람이 하고 있는 순간을 같은 데이터로 그리고, 다른 것은 콘셉트·조작 방식·구성·겉모습이다. 방향마다 `set_theme`로 자기 팔레트와 모양을 받고, 쓴 씨앗을 페이지의 `theme-seed` 메타에 남긴다. 승인된 시안으로 빌드할 때 엔진은 그 씨앗으로 프로젝트의 테마를 맞춘다.
- **전부 새로 그리기.** 카드에서 방향을 적거나 비워 둔 채 보내면, 같은 경로(설계 브랜치 위의 `ideate`)로 시안을 처음부터 다시 그린다. 수정이든 다시 그리기든 엔진은 처음 그릴 때의 규칙 전체(`MOCKUP_RULES`)를 다시 받는다.
- **수정 요청.** 프리뷰에서 요소를 고르고(또는 고르지 않고) 바꿀 것을 적으면 메모가 쌓이고, 보내면 설계 태스크의 브랜치 위에서 도는 `ideate` 태스크가 된다. 요소는 놓인 자리(태그, 순서, 단계마다 식별자 하나)로만 가리키고, 페이지에 적힌 글은 소유자의 요청에 들어가지 않는다. 이미 설계가 있는 곳에서 시작한 설계 태스크는 전체 지침 대신 수정 지침을 받고, 끝나면 시안을 다시 그린다.
- **구현은 설계의 브랜치에서 시작한다.** 설계 태스크는 합쳐지지 않으므로 문서와 시안은 그 브랜치에만 있다. 처음 구현에서는 승인한 빌드가 `main`에서 시작해 그 파일들 없이 돌았다.
- 시안은 에이전트가 쓴 페이지다. 그래서 스튜디오가 쓰지 않은 다른 페이지와 똑같이 다룬다: 컨테이너 안에서만 열고, 실행도 호출도 못 하게 하고, 그림과 센 숫자만 꺼낸다. 걷기가 페이지에서 읽는 값(위치, 크기, 계산된 스타일)은 스키마 검증을 거친 숫자와 불리언이고, 페이지의 글은 걷기 결과에 들어오지 않는다. 제목과 설명은 모델의 말이라 카드에 글로만 보인다.
- 카드에서 안을 하나 고르고 승인하면 빌드 요청에 그 시안의 **파일 경로만** 들어간다(`buildRequest`). 요청은 소유자의 말로 제출되므로 모델이 쓴 제목이나 설명은 거기에 넣지 않고, 데몬이 그리는 세 경로가 아니면 경로도 넣지 않는다.
- 첫 파일(A안)은 문서가 추천하는 방향이라 처음부터 골라져 있다. 고르지 않고 승인해도 전과 같이 동작한다.
- 그리지 못해도(브라우저 컨테이너가 안 뜸) 태스크는 성공이다. 문서는 그대로이고, 그림이 없다는 경고가 남는다.

### 8.5 그림: 구독의 이미지 도구

제품이 겉모습이 있는 것(음식, 장소, 파는 물건, 게임의 세계)을 다룰 때 그것의 그림은 서체와 같은 재료다. Codex CLI에는 이미지 생성 도구가 있고(0.153.4에서 `image_generation`), 엔진은 `generate_image` 하나로 그것을 쓴다 (`qa/ImageDesk.ts`).

- 그리는 것은 호스트의 Codex CLI이고, 다른 내장 도구를 전부 끄고 도구 서버 없이 띄운다: 그리는 것밖에 못 한다. 엔진의 묘사는 데이터로 들어간다. 파일은 모델이 말한 경로가 아니라 CLI가 그 스레드의 생성물을 두는 자리에서 가져온다.
- PNG인지 확인하고, 긴 변 1600px 이하의 JPEG나 PNG로 줄여(macOS의 `sips`) 워크스페이스에 쓴다. `.studio-zero/images.json`에 무엇을 왜 청했는지 한 줄 남는다. 호출은 태스크에 계량된다.
- 정책: `image.generate`는 태스크당 허용량(`images.perTask`, 기본 8)까지다. 다 쓰면 그리기 전에 거절한다.
- 지침: 그림은 제품의 주제 그 자체일 때 재료다. 첫 화면의 실물(데이터, 도구)을 대신하지 않고, 빈 자리를 메우지 않고, 범용 장면이 아니다. 생성기가 없으면 그림 없이 설계한다. 리뷰어의 `vision/stock-clipart` 블로커는 그대로다.
- 시안에도 그림이 들어간다(§8.4). 방향이 주제의 생김새에 기대면 그 그림을 `docs/mockups/assets/`에 만들어 쓰고, 방향마다 두 장까지다. 그림 자리에 설명 문장을 적어 두는 것은 금지다: 그림을 만들 수 없으면 그림 없이도 서는 구성으로 그린다.

## 9. Kirby 파이프라인

```
ingest      허용 호스트의 https URL만. 일회용 컨테이너(볼륨·자격증명 없음, 읽기 전용 루트)에서
            얕은 clone(훅·서브모듈·https 외 프로토콜 차단) → 파일을 텍스트로만 읽어 호스트로 전달
            → 호스트가 출력을 다시 검증(경로 정규화, 크기 한도)
analyze     TypeScript 컴파일러 API로 JS/TS 구문 트리 파싱 → RepoProfile:
            모듈 그래프(경로 별칭 해석), 순환 수, any·억제 주석 수, 복잡도, 12개 프랙티스의 존재 여부와 파일:줄 근거
fit-gap     소스에 근거와 함께 있고 타깃에 없는 프랙티스 = 갭. 고정된 우선순위. 결정론적이며 모델을 쓰지 않는다.
propose     상위 갭마다 설계 모델이 제안 카드(근거, 계획된 변경, 위험도, 예상 효과)와 구현 브리프를 쓴다.
materialize 소유자가 시작. 일반 태스크로 `kirby/<id>` 브랜치에 구현하고 회귀 eval을 통과해야 한다.
measure     같은 분석을 브랜치와 통합 브랜치(임시 worktree)에 돌려 실제 diff와 실측 변화를 카드에 붙인다.
merge       소유자 승인. 일반 병합과 같은 경로(사전 체크포인트, 필요 시 재검증, 실패 시 자동 복원).
```

- 남의 코드는 어디서도 실행되지 않고(설치, import, 훅 모두 없음) 프로젝트 워크스페이스에 들어오지 않는다. 넘어오는 것은 프랙티스에 대한 설명이다.
- 카드의 **예상 효과**는 모델의 추정으로 표시되고, **실측**(`any` 수, 순환, 테스트 파일, 슬롭 린트, 프랙티스 채택 여부)이 그 옆에 붙는다. 런타임 성능 수치는 측정하지 않는다.
- 코드를 복사하지 말라고 지시한다(라이선스, 맥락 차이). 카드에는 소스 저장소와 커밋이 기록된다.

## 10. 작업 노트와 승격 (2단계 수명주기)

생각을 정리하는 데 컨테이너와 저장소는 필요 없다. 그래서 수명주기를 둘로 나눴다.

**1단계: 작업 노트** (`scratch/ScratchService.ts`). `scratch.create`는 DB에 행 하나를 만들고 바로 돌아온다. 샌드박스도, 저장소도, 프로젝트도 없다. 에이전트의 한 차례는 도구 세 개로만 바깥에 영향을 준다.

| 도구 | 하는 일 |
|---|---|
| `present` | A2UI 블록(§12)을 노트에 올린다. 질문은 `choice`·`form` 블록이고 소유자의 답을 기다린다. |
| `record_decision` | 결정 하나를 `decisions`에 남긴다: 무엇을 골랐는지, 왜, **무엇을 왜 기각했는지**, 확신도. |
| `update_spec` | 기획 명세의 한 항목(문제, 사용자, 범위 포함·제외, 요구사항, 성공 기준, 미해결 질문)을 쓴다. |

소유자가 고르는 네 가지 기법(`scratch.move`)은 같은 루프에 주는 지시다: 여덟 갈래(Crazy Eights), 가상 사용자 5명, 반대 검토(레드팀), 명세로 모으기.

`decision_log.md`와 `spec.md`는 모델이 쓰는 파일이 아니다. `scratch/compile.ts`가 테이블에서 매번 다시 만든다. 그래서 기각된 대안이 대화가 길어져도 사라지지 않는다.

**상태 기계.** `exploring → ready → promoted`, 그리고 어디서든 `archived`. `promoted`는 프로젝트가 된 노트뿐이다: 기획서를 발행해도 노트는 `ready`로 남아서, 문서를 읽고 나서 그대로 빌드로 넘어갈 수 있다(처음에는 발행이 노트를 닫아서 그 길이 막혔다). `ready`는 데몬이 계산한다(`readiness()`): 명세의 문제·사용자·범위(포함)·요구사항이 채워져 있고, 기록된 결정이 1건 이상이고, 답하지 않은 질문이 없을 때. 에이전트가 "준비됐다"고 말하는 것은 조건이 아니다.

**2단계: 승격** (`scratch/PromotionWorkflow.ts`). 소유자만 할 수 있다(`scratch.promote` 규칙).

```
[1. 기획서로 읽어 보기]
  명세와 결정 기록을 DocumentCompiler(§11)에 브리프로 넘긴다 → 결과가 노트에 블록으로 돌아온다
  → 노트는 ready 그대로. 다른 종류로 다시 발행할 수도, 아래의 빌드를 시작할 수도 있다

[2. 이 기획으로 프로젝트 만들기]
  준비 상태 재확인 → 정책 → 프로젝트 생성 + 샌드박스 프로비저닝(완료까지 대기)
  → docs/spec.md, docs/decision_log.md, 그리고 발행한 기획서가 있으면 docs/plan.md를 워크스페이스에 쓰고 커밋
  → 첫 build 태스크 제출: 문서 전문이 요청 본문에 들어간다(<plan>, <spec>, <decision_log>)
  → 노트는 promoted, projectId가 연결된다
```

순서는 읽고 나서 만드는 쪽이다. 기획서는 명세를 사람이 읽을 글로 푼 것이라, 그것을 보고 고칠 곳을 고친 뒤에 빌드로 가는 것이 맞다. 화면도 그 순서로 놓고, 기획서가 아직 없으면 1번이, 있으면 2번이 주 버튼이 된다. 발행한 기획서는 빌드가 그대로 받는다: 읽고 승인한 글과 만드는 쪽이 받은 글이 다르면 읽은 의미가 없다. 기획서 없이 바로 2번을 눌러도 된다.

빌더는 대화에 없었어도 무엇이 결정됐고 무엇이 왜 기각됐는지를 전부 받는다. 프롬프트는 기각된 대안을 다시 꺼내지 말라고 지시한다.

## 11. 지식 작업: 조사와 문서

코드가 아닌 일은 `KnowledgeService`가 백그라운드 작업으로 돌린다. 샌드박스를 쓰지 않고(아무것도 실행하지 않으므로), 비용은 스튜디오 자체 예산 범위(`prj_studio`, 일일 한도)에 계상한다.

**조사** (`knowledge/ResearchPipeline.ts`). 프롬프트 하나에 맡기지 않고 데몬이 단계를 돈다.

```
plan     질문을 겹치지 않는 하위 질문 3개(brief) 또는 6개(deep) 이하로 나눈다 (구조화 출력)
gather   하위 질문마다 모델이 프로바이더의 서버 도구(web_search, web_fetch)로 찾고 읽는다.
         결과는 산문이 아니라 report_findings 도구로 넘기는 주장 목록이다: 주장 + 출처 URL + 원문 인용
verify   코드가 검증한다 (verifyFindings):
           · 출처는 이 실행에서 실제로 검색되거나 읽힌 URL일 때만 센다
           · 인용은 읽어 온 페이지 본문에 그 문장이 있을 때만 "확인됨"
           · 확신도는 모델이 아니라 근거로 정한다: 독립 도메인 2곳 이상 high, 1곳 medium,
             출처끼리 어긋나면 speculative, 확인된 출처가 없으면 버리고 "버린 주장"에 남긴다
compile  남은 사실에 번호 붙은 출처를 달아 문서 컴파일러로 넘긴다
```

크롤링은 프로바이더 쪽에서 일어난다. 이 Mac은 남의 페이지를 받아 오거나 실행하지 않는다. 사실 시트는 작성 모델에 데이터 블록으로 들어간다.

**문서** (`knowledge/DocumentCompiler.ts`, `packages/design/src/textLint.ts`). 작성 모델이 초안을 쓰면 결정론적 린터가 판정한다.

| 규칙 | 잡는 것 |
|---|---|
| `text/cliche` | "혁신적인", "패러다임", "급변하는 시대", seamless, leverage 같은 빈 수식어 |
| `text/throat-clearing` | 문서 자신이나 시대를 설명하는 서두 |
| `text/no-bluf`, `text/long-bluf` | 첫 섹션이 결론이 아니거나 너무 긴 것 |
| `text/structure` | 문서 종류(brief, report, PRD, RFC)에 필요한 섹션 누락 |
| `text/vague-quantity`, `text/no-numbers` | "많은", "상당한"처럼 수치 없는 양 |
| `text/hedge-stack` | 한 문장에 겹친 유보 표현 |
| `text/unsourced-figure`, `text/bad-citation`, `text/no-citations` | 출처 없는 수치, 없는 번호를 가리키는 인용 |
| `text/empty-list` | 설명 없이 덕목만 늘어놓은 목록 |
| `text/emoji`, `text/exclamation`, `text/mermaid-syntax` | 이모지, 느낌표, 다이어그램 종류가 없는 Mermaid |

위반은 줄 번호와 함께 작성 모델에 돌아가고 최대 3회 고친다. 끝까지 남은 위반은 문서와 함께 반환된다. 통과 여부는 린터가 정한다.

**PDF.** Markdown을 HTML로 바꿔 인쇄용 스타일을 입히고, 시각 감사와 같은 QA 브라우저 컨테이너에서 스크립트와 네트워크를 끈 채 인쇄한다. 문서가 웹에서 온 문장을 인용하고 있어도 배치만 된다.

**이동 중 심부름.** Telegram이나 Slack에서 `/research 이번 주 AI 인프라 투자 소식`(또는 "조사해줘"로 읽히는 문장)을 보내면 brief 깊이의 조사가 시작되고, 끝나면 `knowledge.state` 이벤트를 받은 릴레이가 브리핑을 그 채널로 보낸다.

## 12. AX: 에이전트와 일하는 방식

**A2UI.** 에이전트는 마크업을 보내지 않는다. `packages/ax/src/blocks.ts`의 타입 있는 블록 8종 가운데 고르고 채운다: `text`, `choice`, `comparison`, `form`(슬라이더·토글 포함), `diagram`(Mermaid), `decision`, `sources`, `checklist`. 데몬이 스키마로 검증하고, 클라이언트는 이미 가진 컴포넌트로 그린다. 링크는 http(s)만 통과한다. 에이전트가 고르는 것은 위젯의 종류와 내용이고, 위젯의 코드는 쓰지 못한다.

**확신도.** 선택지, 비교, 결정에는 `high / medium / speculative`가 붙고 화면에 그대로 보인다.

- `medium` 이하의 결정을 에이전트가 스스로 기록하려 하면 데몬이 거부한다(도구 오류). 그 수준의 분기는 소유자에게 물어야 한다.
- 소유자의 답이 추천과 같았는지를 `ax_outcomes`에 남긴다. 최근 20건(8건 이상일 때) 가운데 25%를 넘게 뒤집히면 `high`도 `medium`으로 취급한다(`ax/Calibration.ts`). 다시 맞히면 돌아온다.

**멈추지 않는 조타.** `tasks.steer`는 메시지를 큐에 넣고 바로 돌아온다(`ax/Steering.ts`). 네이티브 엔진은 도구 턴이 끝날 때마다 큐를 비워 메시지를 도구 결과와 같은 턴에 넣고, 엔진이 끝났다고 판단한 순간에도 한 번 더 확인한다. 벤더 CLI 브릿지는 라운드 경계에서 읽는다. `steer.queued`, `steer.delivered` 이벤트로 전달 여부가 보인다.

**시점 이동.** 태스크 시작 전과, 파일을 바꾼 턴마다 체크포인트가 생긴다(실측 약 45ms). 되돌리기는 지금 상태를 먼저 저장하고 돌아간다. 갈라 시작하기(`checkpoints.fork`)는 지금 작업을 건드리지 않고 그 시점에서 `fork/<id>` 브랜치를 만들며, `tasks.submit`의 `baseBranch`로 거기서 다음 태스크를 잇는다.

**만들어진 앱을 위한 AX 키트.** 스튜디오가 자기 화면에 쓰는 것과 같은 코드를 프로비저닝 때 모든 프로젝트의 `.studio-zero/ax/`에 넣는다(`react`와 `zod`만 필요).

| 부분 | 내용 |
|---|---|
| 스트림 | 서버용 `encodeEvent`, 클라이언트용 `readEvents`·`streamAgent`. 이벤트는 `text`, `block`, `activity`, `done`, `error`. 블록은 렌더러에 닿기 전에 스키마 검증을 거치고, 어긋난 이벤트는 세고 버린다. |
| 훅 | `useAgentStream`: 스트리밍 텍스트, 블록, 에이전트가 지금 하는 일, `stop`, 그리고 응답을 끊지 않는 `steer` |
| 렌더러 | `Block`, `Markdown`, `Flow`. 프로젝트의 테마 토큰만 쓴다. Markdown은 React 요소로만 만들어지고 HTML을 넣는 경로가 없다. |
| 텔레메트리 | `createTelemetry`: 첫 출력까지 걸린 시간, 실패 코드, 보인 블록 종류, 추천을 따랐는지와 그때의 확신도. 사람이 쓰거나 읽은 내용은 이벤트에 없다. |

코딩 엔진의 시스템 프롬프트는 제품에 AI 기능이 들어갈 때 채팅 말풍선 대신 이 키트를 쓰라고 지시한다.

## 13. 외부 도구: MCP 레지스트리

데몬이 MCP 클라이언트다(`mcp/McpRegistry.ts`, 스트리밍 HTTP). 에이전트는 서버에 직접 닿지 않는다.

- **레지스트리.** 코드에 든 카탈로그(GitHub, Stripe는 토큰 방식, Notion과 Figma는 OAuth라서 아직 사용 불가로 표시)와 소유자가 추가한 서버. 추가·삭제·허용 취소는 데스크톱의 소유자만 한다(`mcp.configure-local-owner-only`).
- **두 가지 연결.** 원격 서버는 주소로 붙는다(https만, 이 Mac의 서버만 http://localhost 허용). **로컬 서버는 이 Mac에서 실행되는 프로그램**이고 stdio로 말한다: Blender, Unity, Aseprite 같은 데스크톱 도구의 MCP 서버가 이 형태다. 소유자가 실행 명령을 적으면 데몬이 그 프로그램의 절대 경로를 그때 확정해 저장하고, 필요할 때 띄워 2분 쉬면 내린다. 토큰이 필요하면 환경 변수 이름을 지정하고 값은 Keychain에 둔다. 프로그램에는 데몬의 환경 변수를 넘기지 않는다.
- **필요할 때 찾기.** 도구 목록을 프롬프트에 미리 싣지 않는다. 엔진에는 고정된 도구 두 개가 있다: `find_tools(query)`는 서버별 사용 가능 여부와 맞는 도구의 입력 스키마를 돌려주고, `use_tool(server, tool, arguments)`가 호출한다. 도구 정의가 바뀌지 않으므로 프롬프트 캐시가 깨지지 않는다.
- **정책.** `mcp.call` 액션은 프로젝트, 서버, 목적지(원격 호스트 또는 `local:<프로그램>`), 도구 이름을 담는다. 로컬 서버의 도구는 샌드박스 밖 이 Mac에서 직접 동작하므로(예: Blender 안에서 Python 실행) 승인 문구가 그 사실을 말한다. 그 프로젝트에서 그 도구를 처음 쓸 때 소유자 승인을 기다리고, 승인은 `mcp_grants`의 행으로 남아 다음부터는 묻지 않는다. 다른 도구는 다시 묻는다. 승인을 요청하기 전에 서버가 쓸 수 있는 상태인지와 그 도구가 실제로 있는지를 먼저 확인하므로, 소유자가 없는 도구를 승인하게 되는 일은 없다.
- **자격 증명.** 토큰은 Keychain의 `mcp/<서버>/token`에 있고 데몬이 요청 헤더에 넣는다. 샌드박스, 모델, 이벤트 어디에도 나타나지 않는다.
- **결과.** 서버가 말하는 도구 설명과 호출 결과는 `external-tool` 데이터 블록으로 들어간다. 지금은 텍스트만 전달하고 이미지 결과(뷰포트 캡처 등)는 생략 표시로 바뀐다.

## 14. 클라이언트 (Tauri 2)

`apps/desktop`. Vite + React 19 + Tailwind 4, 셸은 Tauri 2(Rust). 데몬과는 `RpcClient` 하나로 말하고, 로컬에서는 Rust 쪽 명령이 Keychain에서 클라이언트 토큰을 읽어 준다.

프로젝트는 **작업대**다: 왼쪽에 에이전트와의 대화, 오른쪽에 만들어지는 것.

- 레일: 프로젝트와 작업 노트 목록. 맨 위에는 스튜디오 자신의 저장소인 Studio Zero Core가 별 표시와 함께 고정된다(§19, 이름 변경과 삭제 메뉴가 없다). 레일 머리에는 Mac 잠자기 방지 세 단계 토글이 있다(§20). 레일과 작업대는 같은 테마의 한 단계 차이 색을 쓴다. 프로젝트 행에는 샌드박스 상태 점(실행 중이면 초록, 태스크가 쓰는 중이면 깜박임), 종류 아이콘, 이름, 그리고 메뉴(이름 변경, 샌드박스 재기동, 프로젝트 삭제)가 있다. 삭제는 무엇이 사라지는지 적힌 확인 창을 거친다.
- 처음 화면: 빈 종이 한 장과 시작 방식. 기본은 **바로 만들기**다: 아이디어를 적으면 `projects.ignite`가 이름과 슬러그를 짓고(§4 `ProjectNamer`), 스택을 고르고, 질문 없이 첫 `fast` 태스크를 시작한다. **설계부터**는 PRD·데이터 모델·API 명세를 먼저 쓰는 `ideate` 태스크이고, 끝나면 결정 카드가 나온다: 구조가 다른 첫 화면 시안 두세 장(§8.4)이 나란히 놓이고, 하나를 골라 승인하면 그 안으로 구현을 시작한다. 시안은 크게 볼 수 있고, 문서 링크는 그 아래에 있다. 생각 정리·조사·문서는 그대로 고를 수 있다.
- 실패한 태스크의 작업물은 그 태스크의 브랜치에 커밋되어 남는다. 카드의 **이 작업물에서 이어가기**가 다음 태스크의 시작점을 그 브랜치로 잡는다(`tasks.submit`의 `baseBranch`).
- 왼쪽 창: 세션 탭(프로젝트 안의 이름 붙은 작업 흐름. 세션마다 스크롤 위치와 쓰던 글이 남는다), 태스크 흐름, 아래에 붙은 입력창. 입력창은 레이아웃의 일부라서 위 내용을 가리지 않는다.
- 태스크 흐름은 **단계 목록**이다(`lib/steps.ts`, `ActionStepper`): "프로젝트 스캐폴드 (Expo / TypeScript)", "의존성 설치 (skia, image-picker)", "파일 3개 작성", "검증 2회차 통과"처럼 한 줄에 한 일. 문구는 실제로 실행된 도구 호출과 게이트 결과에서 코드가 만든다. 에이전트가 작업 도중에 한 말은 그 단계의 메모로 접히고, 한 회차의 마지막 말만 따로 보인다. 명령 전체와 실패 출력은 단계를 펼치면 나온다.
- 오른쪽 창: 프리뷰(모바일 프로젝트는 iPhone 15 Pro 틀 안에 실제 포인트 크기로, 웹은 창 크기로. 모바일·태블릿·데스크톱 전환), 파일(트리 + 줄 번호와 구문 색이 있는 뷰어, 편집 가능), 터미널(샌드박스 안의 실제 셸), 시점(체크포인트 되돌리기와 갈라 시작하기), 그리고 감사·장부·제안·학습. 장부 탭은 디자인 점수와 슬롭 지수가 작업마다 어떻게 움직였는지를 그래프로, 작업별 영수증(코드·디자인·비용·직전 대비)을 그 아래에 보여 준다(§8.3). 한 번 연 탭은 살려 두므로 터미널의 셸이 탭을 옮겨도 유지된다. 프리뷰는 보여 줄 것이 있고 작업이 진행 중이 아닐 때 스스로 켜지고, 태스크가 끝나면 새로 고친다.
- 입력창 위: 작업 종류, 검증 범위, 엔진. `검증까지`로 만드는 작업에는 검수 구독(기본 "자동 짝꿍")과 레퍼런스 주소 칸이 더 붙는다.
- 단계 목록에는 코드 전후의 일도 한 줄씩 나온다: 레퍼런스 측정, 고정표 확정(펼치면 두 방향과 첫 화면 볼거리), 계획 교차 검토(펼치면 지적), 최종 인수 검수, 프로덕션 빌드. 받지 못한 교차 검토는 빠지지 않고 "받지 못함"으로 나온다.
- Core 프로젝트에서 끝난 작업에는 "합치기" 대신 넘겨받기 카드가 나온다: 이 Mac의 저장소에 생긴 `feature/` 브랜치 이름, 바뀐 파일 수, 살펴볼 `git diff` 명령, 그리고 머지 버튼.
- 창 맨 아래 상태 줄: 구독별 연결 여부와 한도 도달 여부. 누르면 최근 5시간·7일 동안 스튜디오가 그 구독으로 쓴 토큰과 호출 수, 한도가 풀리는 시각까지 남은 시간이 나온다(§20).
- 좁은 창에서는 두 창 가운데 하나만 보이고 프로젝트 바에서 전환한다.
- 설정의 "화면": 테마 프리셋 4종(같은 테마 생성기의 시드라서 대비 기준이 그대로다)과 코드 서체. 이 기기에만 저장된다.

이 화면도 스튜디오가 만드는 앱과 같은 검사를 받는다: `apps/desktop/scripts/audit.ts`가 31개 화면 × 3개 뷰포트 × 라이트·다크를 실제 Chrome으로 그려 데몬의 DOM 검사를 돌린다(현재 블로커 0, 주요 0). 카피 린트(§7.5)도 같이 돌지만 이 화면의 문구에는 아직 통과 조건이 아니다: 문구 14곳이 걸리고, 고쳐 쓰지 않았다(§17).

데스크톱 셸(Tauri)은 메뉴 막대에 항목 하나를 둔다: 잠자기 방지 세 단계와 창 열기. 셸은 데몬과 직접 말하지 않는다. 고른 값은 웹뷰로 이벤트로 가고, 웹뷰가 인증된 소켓으로 `power.set`을 부르며, 체크 표시는 데몬이 답한 값으로만 움직인다.

## 15. 배포

### Phase 1 — MacBook 단독

```bash
pnpm install
pnpm daemon                                   # 127.0.0.1:49200 (제어), 49201 (게이트웨이). 상시 가동은 pnpm build && pnpm start
pnpm sz vault set provider/anthropic/api-key  # 숨김 입력으로 키를 받아 Keychain에 저장
pnpm sz project create ledger "Ledger"
pnpm sz task ledger build "미결제 청구서 화면을 만들어줘"
```

첫 기동 때 클라이언트 토큰을 만들어 Keychain(`studio-zero` 서비스, `daemon/client-token`)에 둔다. 같은 Mac의 클라이언트는 거기서 읽는다.

데스크톱 앱: `pnpm --filter @studio-zero/desktop tauri build` (Rust 필요). 데몬 없이 화면만 보려면 `pnpm --filter @studio-zero/desktop dev` 후 `http://127.0.0.1:1420/?demo`.

### Phase 2 — Mac mini 상시 가동

1. **LaunchAgent로 등록**: `deploy/install-launch-agent.sh`(의존성 설치 → 번들 빌드 → 등록 → 시작). 시스템 LaunchDaemon이 아닌 이유는 로그인 Keychain과 OrbStack이 로그인한 사용자 세션에만 있기 때문이다. 로그인할 때 시작되고(`RunAtLoad`) 죽으면 다시 뜬다(`KeepAlive`). 등록한 뒤에는 `pnpm daemon`을 따로 켜지 않는다(같은 포트를 쓴다).
   - 코드를 바꾼 뒤: `pnpm build && pnpm daemon:restart`. 빌드는 번들을 통째로 바꾸므로 재시작하지 않으면 실행 중인 데몬이 나중에 불러올 조각을 찾지 못한다. 빌드가 끝나면 이 안내가 출력된다.
   - 로그: `~/Library/Logs/studio-zero/daemon.log`. 해제: `launchctl bootout gui/$(id -u)/zero.studio.daemon && rm ~/Library/LaunchAgents/zero.studio.daemon.plist`.
   - plist에는 설치할 때의 `node` 절대 경로가 들어간다. nvm으로 Node 버전을 바꾸거나 지우면 스크립트를 다시 실행한다.
2. **전원이 돌아왔을 때 스스로 올라오게 하려면** 자동 로그인이 필요하고, 자동 로그인은 FileVault와 함께 쓸 수 없다. 둘 중 하나를 고른다: 자동 로그인(디스크 암호화 포기) 또는 FileVault(정전 뒤 누군가 잠금을 풀 때까지 대기). 계획된 재부팅은 `sudo fdesetup authrestart`로 넘길 수 있다.
3. 잠자기 방지(`sudo pmset -a sleep 0 disksleep 0`), OrbStack 로그인 시 시작.
4. **원격 접속은 Tailscale Serve**(tailnet 전용 HTTPS, 포트 개방 없음):
   ```bash
   tailscale serve --bg 49200        # 문법은 `tailscale serve --help`로 확인
   ```
   그리고 `~/.studio-zero/config.json`에 `"listen": {"allowedHosts": ["macmini.<tailnet>.ts.net"]}`. 클라이언트는 `SZ_URL=wss://macmini.<tailnet>.ts.net/v1/ws`와 `sz token`으로 옮긴 토큰을 쓴다.
5. **메신저는 인바운드 연결이 필요 없다.** Telegram은 long polling, Slack은 Socket Mode다. `sz vault set relay/telegram/bot-token`(Slack은 `relay/slack/app-token`, `relay/slack/bot-token`), 설정에 `telegram.enabled`·`slack.enabled`와 각자의 `allowedUserIds`.
6. tailnet에 들어올 수 없는 기기가 있을 때만 Cloudflare Tunnel(`deploy/cloudflared/config.example.yml`)을 쓰고 Cloudflare Access를 앞에 둔다. **Tailscale Funnel은 권하지 않는다**: 제어 소켓이 인터넷 전체에 노출되고 방어선이 토큰 하나가 된다.

데몬은 공용 인터페이스에 바인딩하지 않는다. 원격 접속은 항상 같은 루프백 리스너 앞에 터널을 두는 형태다.

## 16. 위협과 대응

| 위협 | 대응 |
|---|---|
| 웹 페이지, 빌드 로그, 남의 저장소에 심어진 프롬프트 인젝션 | 데이터 블록 + 상수 시스템 프롬프트. 뚫려도 `agent` 권한뿐. 병합·롤백·외부 코드 도입은 승인 필요. |
| 인젝션이 교훈으로 저장되어 다음 세션에 재주입 | §8의 쓰기 경로(린트, 근거 seq, 후보 상태, 독립 확인 2회) |
| 에이전트가 자기 검증을 무력화 | eval 정의는 DB에 있음. 끄기는 소유자만. 교훈 린트가 검증 약화 문구를 거부. |
| 샌드박스 코드가 프로바이더 키를 탈취 | 키가 샌드박스에 없음. 샌드박스 토큰은 게이트웨이에서 그 프로젝트의 예산 안에서만 유효. |
| 샌드박스에서 호스트의 제어 포트로 접근 | 모든 경로에 토큰. 브릿지 엔드포인트는 루프백 + 태스크 전용 토큰. |
| 로컬 웹 페이지가 `ws://localhost:49200`에 접속 (DNS 리바인딩 포함) | Origin 허용 목록, Host 허용 목록, 토큰 |
| Telegram 사칭, 그룹방 | 숫자 사용자 ID 허용 목록 + 1:1 대화만. 자격증명 관리는 Telegram에서 불가(`vault.local-owner-only`). |
| 악성 저장소 (Kirby) | 호스트 허용 목록, 일회용 컨테이너, 실행 없음, 출력 재검증 |
| 승인 재사용 | 액션 해시 바인딩, 1회 소비, 만료 |
| 조종당한 에이전트가 만드는 앱의 외부 API 키를 읽어 감 | 키가 샌드박스에 없다. 있는 것은 대역이고, 게이트웨이를 거쳐 저장된 출처 하나에만 쓸 수 있다. 응답에 되돌아온 키는 지운다 (§3.4) |
| 대역으로 그 API를 마음대로 호출 (주문, 결제) | 막지 않는다. 키를 연결한 프로젝트의 에이전트는 그 키의 권한으로 호출할 수 있다. 연결 화면이 그렇게 적고, 조회 전용이나 모의 키를 쓰라고 한다 (§3.4) |
| 에이전트가 쓴 시안 페이지가 호스트에서 실행되거나 밖으로 호출 | 시안은 QA 브라우저 컨테이너에서 스크립트와 네트워크를 끄고 그린다. 호스트로 오는 것은 PNG와 짧은 문자열 둘이고, 그 문자열은 글로만 보이며 빌드 요청에 들어가지 않는다 (§8.4) |
| 레퍼런스로 지정된 페이지가 악의적이거나, 그 주소가 이 Mac 안쪽을 가리킴 | QA 브라우저 컨테이너에서만 연다. 공개 호스트 이름의 https만 받고, 하위 요청도 공개 호스트만 나가며, 사설 주소가 응답하면 버린다. 돌아오는 것은 스키마 검증을 거친 측정값이고 데이터 블록으로만 들어간다. 주소는 소유자가 적은 것만 쓰고 에이전트는 고를 수 없다 (§8.1) |
| 교차 검토 모델의 답에 심어진 지시 | 지적과 보정 패치는 `engine-output` 데이터 블록으로 엔진에 간다. 따르더라도 엔진은 `agent` 권한뿐이고 결과는 다시 검증된다 |
| 스튜디오가 자기 코드를 고치다가 자기를 망가뜨림 | Core 태스크는 샌드박스 안에서만 돈다. 저장소에는 새 `feature/` 브랜치만 생기고, 데몬이 돌아가는 파일은 소유자가 데스크톱에서 머지할 때만 바뀐다(빨리 감기만, 깨끗한 체크아웃에서만). 실행 중인 데몬은 번들에서 돌므로 머지 뒤에도 `pnpm build && pnpm daemon:restart` 전까지는 그대로다 (§19) |
| 엔진이 자기 영수증을 고침 | 장부의 원본은 데몬 DB, 사본은 워크스페이스 바깥 (§8.3) |
| 데몬이 죽은 뒤에도 Mac이 계속 깨어 있음 | `caffeinate`를 `-w <데몬 pid>`로 띄운다: 데몬이 어떻게 끝나든 같이 끝난다 (§20) |
| 환경 변수로 모델 요청의 목적지나 자격 증명이 바뀜 | SDK 클라이언트의 주소를 코드에 고정하고 환경의 토큰을 받지 않는다. 키는 Keychain의 것만 쓴다. |
| 잘못 붙여 넣은 API 키가 작업 도중에야 드러남 | 저장할 때 공백을 거르고 제공자에게 토큰을 쓰지 않는 요청으로 물어본다. 거부된 키는 저장하지 않는다. |
| 폭주하는 비용 | 태스크 예산, 프로젝트 일일 예산, 턴 상한, 검증 라운드 상한. 증액은 소유자 승인. |
| 조종당한 에이전트가 외부 서비스에 쓰기 (이슈 생성, 결제, 삭제) | 외부 호출은 `use_tool` 하나뿐이고, 프로젝트·서버·도구 단위로 소유자가 한 번 승인해야 한다. 승인 문구에 목적지 호스트가 들어간다. |
| 외부 도구 결과나 도구 설명에 심어진 인젝션 | `external-tool` 데이터 블록. 뚫려도 이미 허용된 도구만 쓸 수 있다. |
| 외부 도구 토큰 유출 | Keychain → 요청 헤더. 샌드박스·모델·이벤트에 없음. 리다이렉트는 같은 출처만. |
| 모델이 출처를 지어내거나 인용을 꾸밈 | 이 실행에서 실제로 받은 URL만 출처로 인정, 인용은 받아 온 본문과 대조, 확신도는 코드가 계산 (§11) |
| 에이전트가 낮은 확신의 결정을 혼자 내림 | `record_decision`은 `high`만 받는다. 보정 기록이 나쁘면 `high`도 묻게 된다 (§12) |
| 구독 CLI가 호스트의 파일을 읽어 샌드박스로 넘김 | Claude Code는 도구 목록이 빈다. Codex는 읽기 전용 샌드박스 + 도구 기능 끔. Cursor와 Antigravity는 호스트 가둠(§4.1): 홈이 보이지 않고 셸이 뜨지 않는다. |
| 가둔 CLI에 남는 것 | (1) CLI 자신의 로그인은 그 CLI가 읽을 수 있어야 하므로 가릴 수 없다. 조종당한 에이전트가 그 로그인 하나를 샌드박스로 옮길 가능성은 남는다. (2) CLI 프로세스는 `/usr/bin/security`를 실행할 수 있다. 셸 없이 명령을 직접 실행하는 CLI라면 `security`로 읽히는 Keychain 항목(이 데몬의 금고 포함)에 닿을 수 있다. 확인한 두 CLI의 터미널 도구는 셸을 거치므로 막힌다. 이 때문에 두 엔진은 자동 라우팅에 넣지 않았다. |
| 로컬 MCP 서버의 도구가 이 Mac에서 임의 동작 (예: Blender에서 코드 실행) | 로컬 서버는 데스크톱의 소유자만 추가. 도구마다 프로젝트에서 처음 쓸 때 승인, 문구에 "샌드박스 밖" 명시. 승인 뒤의 그 도구 호출은 다시 묻지 않으므로, 임의 코드 실행 도구를 승인하는 것은 그 프로젝트의 에이전트에게 이 Mac을 맡기는 것과 같다. |
| 만들어진 앱에서 모델 출력이 마크업으로 실행됨 | AX 키트: 스키마 밖 블록은 버림, 링크는 http(s)만, Markdown은 요소로만 렌더 |

남는 위험: `security` CLI로 만든 Keychain 항목은 같은 로그인 세션의 다른 프로세스가 `security`로 읽을 수 있다(디스크 탈취와 다른 사용자는 막고, 같은 세션의 악성코드는 못 막는다). 앱별 ACL은 코드 서명된 헬퍼가 필요하다.

## 17. 검증 현황

`pnpm typecheck`와 `pnpm test`가 통과한다: 192개 가운데 179개 통과, 13개는 옵트인이라 기본 실행에서 건너뛴다(실제 Keychain 1개, 실제 컨테이너 엔진 6개, 실제 구독 CLI 6개). 헤드리스 Chrome이 필요한 테스트는 Chrome이 없으면 건너뛴다. 옵트인 `SZ_TEST_ENGINE=1`은 이 Mac의 OrbStack에서 9개 하위 테스트가 모두 통과했다.

| 검증됨 | 방법 |
|---|---|
| 정책 규칙 테이블, 예산과 증액 승인, 승인 수명주기, 데이터 블록 | 단위 테스트 |
| 체크포인트·롤백·병합·충돌 중단, 턴 단위 체크포인트, 포크와 포크에서 이어가기 | 실제 git (작업 트리가 정확히 복원되는지 포함) |
| 제어 소켓 인증, Origin/Host 차단, RPC, 이벤트 재생 | 실제 WebSocket |
| 세션 브릿지 도구 경로 | MCP shim을 실제 자식 프로세스로 실행 |
| 게이트웨이 키 교체·계측·예산 | 가짜 업스트림 HTTP 서버 |
| Telegram, Slack, ntfy 흐름 | 가짜 서버 (Bot API, Socket Mode, ntfy) |
| 테마의 AAA 대비 | 24개 색상 × 3개 채도 × 라이트/다크 수치 검사 + 실제 Chrome 렌더 측정 |
| DOM 수집기와 검사 | 실제 헤드리스 Chrome |
| 하네스 전체 루프 (감사 실패 → 좌표 피드백 → 수정 → 통과 → 회고 → 병합 → 롤백) | 실제 Chrome + 스크립트된 모델 |
| 실행 중 조타가 다음 턴에 도구 결과와 함께 전달되는 것 | 스크립트된 모델 |
| 작업 노트 → 승격: 낮은 확신 결정의 거부, 결정 기록 컴파일, 명세·결정 기록이 저장소와 첫 요청에 그대로 들어가는 것 | 스크립트된 모델 + 컨테이너 에뮬레이터 |
| 확신도 보정 (강등과 회복) | 단위 테스트 |
| 조사: 실제로 받은 URL만 출처로 인정, 인용 대조, 근거 기반 확신도, 버린 주장 기록 | 프로바이더 응답 형태의 픽스처 |
| 문서: 린트에 걸린 초안이 줄 번호와 함께 되돌아가 고쳐지는 루프, 인용 번호 검사 | 스크립트된 모델 |
| PDF 내보내기 (스크립트·네트워크 끔) | 실제 Chrome |
| AX 키트: 바이트가 어디서 잘려도 같은 이벤트, 스키마 밖 블록과 `javascript:` 링크 거부, 텔레메트리 배치 | 단위 테스트 |
| AX 키트가 프로젝트에 들어가는 형태 그대로 번들되는 것 (외부 의존은 react, zod뿐) | esbuild |
| MCP: 발견, 도구별 1회 승인과 기억, 거부·없는 도구·OAuth 서버 처리, 토큰이 이벤트에 없음 | **공식 MCP SDK 클라이언트가 같은 SDK의 실제 서버와 HTTP로 통신** |
| 로컬 MCP 서버: 프로그램 기동, "샌드박스 밖" 승인 문구, 토큰이 지정한 환경 변수로만 전달, 프로세스 재사용, 데몬 종료 시 정리 | 같은 SDK의 실제 stdio 서버를 자식 프로세스로 실행 |
| **구독 모드 (실제 Claude 구독, `SZ_TEST_SESSION=1`)**: 계획 구조화 출력(Fable 5.2, Opus 5.5), MCP shim을 통한 데몬 도구 호출 + 웹 검색 결과 수집, 작업 노트 실제 한 턴(결정·질문 블록 생성) | 이 Mac의 Claude Code 로그인으로 실제 호출 |
| **구독 CLI 엔진 4종 (실제)**: Claude Code, Codex, Cursor, Antigravity가 각각 데몬의 `write_file`로 샌드박스 워크스페이스에 파일을 쓰는 것 | 각 CLI의 실제 로그인으로 한 파일짜리 작업 실행 |
| 호스트 가둠: 홈 디렉터리 읽기·쓰기 거부, 셸 기동 거부, 스크래치 쓰기 허용 | 실제 `sandbox-exec`. 가둔 Cursor 에이전트에게 키체인·홈 파일 접근을 직접 시켜 실패하는 것도 확인. |
| ACP 클라이언트 | 가짜 에이전트 프로세스 + 실제 `agy acp` |
| Kirby 전체 파이프라인 | 스크립트된 모델 + 로컬 저장소 픽스처 |
| 실제 컨테이너 엔진: 격리 설정(uid 1000, 권한 0, no-new-privileges), 샌드박스→게이트웨이 키 교체, 제어 소켓 차단, dev 서버와 프리뷰 URL, 볼륨 체크포인트·롤백, 재생성, QA 브라우저 컨테이너로 시각 감사, Kirby 실제 clone | OrbStack 2.2.5 (`SZ_TEST_ENGINE=1`) |
| 클라이언트 화면 | 31개 화면 × 3개 뷰포트 × 라이트·다크를 Chrome으로 렌더해 DOM 검사: 블로커 0, 주요 0. 슬롭 린트 0건. |
| 단계 목록: 도구 호출이 스캐폴드·설치·파일 작성·검사로 묶이는 것, 도중의 말이 메모로 접히는 것, 검증 회차, 레퍼런스·고정표·교차 검토·빌드·장부가 단계와 메모로 나오는 것 | 단위 테스트 (`apps/desktop/test/steps.test.ts`) |
| 컴파일 게이트: 오류 출력이 `<compiler_error>`로 엔진에 돌아가 고쳐지는 루프, 수정 횟수 상한, 명령이 워크스페이스의 글에서 만들어지지 않는 것 | 스크립트된 모델 + 컨테이너 에뮬레이터 |
| 스모크 게이트: 잡지 못한 예외, `console.error`, 5xx는 잡고 리소스 404는 세지 않는 것 | 실제 헤드리스 Chrome |
| `fast` 트랙: 계획·회고 호출이 없고 디자인 게이트가 돌지 않는 것 | 스크립트된 모델 (구조화 호출 0회 확인) |
| 파일 탐색: `.gitignore`와 고정 제외 목록, 단계별 목록, 바이너리·초과 크기 표시, 워크스페이스 밖 링크 거부, `.git` 쓰기 거부 | 실제 git + 컨테이너 에뮬레이터 |
| 대화형 터미널: 소유권(다른 연결은 쓰지도 끄지도 못함), 잘린 다바이트 문자, 느린 클라이언트에서 읽기 멈춤, 연결이 끊기면 정리 | 가짜 TTY + 실제 WebSocket |
| 엔진 API의 TTY exec (생성 → 업그레이드 → 크기 변경 → 종료 코드) | 같은 응답을 하는 가짜 엔진 (루프백 TCP) |
| **실제 컨테이너 엔진의 작업공간 (`SZ_TEST_ENGINE=1`)**: 엔진 소켓으로 연 실제 TTY(`/dev/pts/0`, uid 1000, `stty size`가 크기 변경을 따름, Ctrl+C가 130으로 끝냄, ANSI 통과), 종료 시 셸과 백그라운드 작업 정리, 연결이 끊기면 셸이 남지 않는 것, 실제 볼륨의 파일 목록·읽기·쓰기, 실제 `npm run typecheck` | OrbStack 2.2.5 |
| 프로젝트 이름 짓기와 점화, 세션, 다른 모델의 의견(도구 0개인 것까지) | 스크립트된 모델, 가짜 CLI |
| Tauri 앱 | 빌드, 실행, 데몬에 `desktop/0.1.0`으로 접속하는 것까지 |
| LaunchAgent: 등록, launchd 아래에서 기동, OrbStack 접근, Keychain에서 클라이언트 토큰 읽기, 벤더 CLI 탐지, `kickstart -k` 재시작 때 정상 종료(종료 코드 0)와 클라이언트 재접속 | 이 MacBook에서 실제 등록 상태로 확인 |
| `security` CLI 플래그와 종료 코드 44 | 실제 CLI (읽기 전용) |
| 완화한 디자인 계약: 기준 사이트의 값(120~160px 헤드라인, 줄 높이 0.9~1.0, 5·15·22·28·30px 곡률, 600~810ms 등장, 700~1100ms 전환, 제목 서체)을 받아들이고, 비례를 벗어난 것(본문의 10배, 32px을 넘는 알약 아닌 곡률)은 거부 | 단위 테스트 (`design.test.ts`, `refkit-copy.test.ts`) |
| 카피 린트: 다섯 습관을 각각 문구와 함께 잡고, 구체적인 문구는 건드리지 않는 것. 화면에서 읽는 순서로 글을 뽑고 요소 위치를 붙이는 것, 카피 습관만으로 감사가 떨어지는 것 | 단위 테스트 |
| 글과 선뿐인 첫 화면이 첫 화면에서만 블로커가 되는 것 | 단위 테스트 |
| 고정표 게이트: 유효한 표 없이는 실행 단계에 들어가지 못하는 것, 계획 모델의 표가 코드보다 먼저 커밋되는 것, 다음 태스크가 표를 다시 쓰는 것 | 스크립트된 모델 + 실제 git (`anchor-sandwich-ledger.test.ts`) |
| 샌드위치: 교차 검토가 정확히 두 번, 보정 패치가 한 번 더 구현되고 다시 검증되는 것, 지적과 패치가 데이터 블록으로 가는 것, 검토를 받지 못해도 태스크가 서는 것, 짝꿍이 같은 회사를 고르지 않는 것 | 스크립트된 모델, 가짜 리뷰어 |
| 장부: 컴파일러 에러 수·검증 회차·빌드·등급·비용이 영수증에 들어가고 직전 대비가 계산되는 것, `ledger.jsonl`이 워크스페이스 밖에 쓰이는 것 | 스크립트된 모델 + 단위 테스트 |
| 잠자기 방지: `system`에서 `caffeinate -i -s -w <pid>`, `display`에서 `caffeinate -d -i -s -w <pid>`가 실제로 뜨고 `off`에서 사라지는 것, macOS가 보고하는 어서션(`pmset -g assertions`)에서 `display`가 `system`의 것을 전부 포함하는 것 | **실제 `caffeinate`와 `ps`** (샌드박스 밖에서 실행) |
| 잠자기 방지: 모드가 재시작 뒤 복원되는 것, 밖에서 끝난 프로세스가 상태에 반영되는 것, 에이전트가 바꿀 수 없는 것 | 가짜 프로세스 + 실제 WebSocket |
| 구독 현황: 한도 거부만 상태를 바꾸는 것, 벤더 문구에서 풀리는 시각을 읽는 것, 재시작 뒤에도 기억하는 것 | 단위 테스트 |
| 레퍼런스 주소 규칙: 공개 https만, 사설 주소와 한 단어 이름 거부, 에이전트 거부 | 단위 테스트 |
| **레퍼런스 캡처 (실제, `SZ_TEST_ENGINE=1`)**: 공개 페이지(example.com)가 QA 브라우저 컨테이너에서 열려 측정값과 PNG로 돌아오는 것 | OrbStack 2.2.5, 실제 네트워크 (`phase3.integration.test.ts`) |
| Self-hosting: 고정된 1호 프로젝트, 번들로 들어가고 `feature/` 브랜치로 나오는 것, 체크아웃의 작업 트리와 `main`이 건드려지지 않는 것, 머지 거부 조건(커밋 안 된 변경, 다른 브랜치, `main`이 앞서 나감), 데스크톱 소유자만 머지 | **실제 git** + 컨테이너 에뮬레이터 (`selfhost.test.ts`) |
| **Self-hosting (실제, `SZ_TEST_ENGINE=1`)**: 이 저장소가 실제 샌드박스에 번들로 들어가 `pnpm install --frozen-lockfile`과 타입 검사를 통과하고, 그 안에서 만든 커밋이 체크아웃(복제본)에 `feature/` 브랜치로 나와 머지되는 것 | OrbStack 2.2.5, 28초 |
| **시안 그리기와 재기 (실제, `SZ_TEST_ENGINE=1`)**: 실제 샌드박스에 쓴 시안 두 장이 QA 브라우저 컨테이너에서 스크립트와 네트워크가 꺼진 채 1440×900 PNG로 그려지는 것. 샌드박스의 그림 파일이 페이지 안에 데이터로 들어가고 Geist가 실리는 것, 컨테이너의 브라우저가 동작하는 시안의 핵심 흐름을 끝까지 누르고(누름 1번씩 두 작업) 세 장짜리 필름을 남기는 것, 얼어 있는 시안은 `already-done`으로 멈추는 것, 두 페이지가 세 크기에서 감사되는 것(리뷰어는 끔) | OrbStack 2.2.5, 11초 (`phase3.integration.test.ts`) |
| 시안을 봉인해 띄우기와 요소 고르기: 정책이 문서 맨 앞에 오는 것, 자리로만 만든 선택자, 수정 요청문에 페이지의 글이 안 들어가는 것 / 실제 Chrome에서 요소를 찍어 메모가 붙는 것(실제 크기, 0.63배 폰 틀) | 단위 테스트 / 빌드한 클라이언트를 Chrome으로 조작 |
| 팔레트: 색상 18 × 채도 3 × 밝기 7 × 두 모드에서 브랜드 위 글자와 옅은 면 위 글자가 AAA인 것, 밝은 브랜드가 밝게 남는 것, `set_theme`가 씨앗과 스타일시트를 쓰고 범위 밖 입력을 거절하는 것 | 단위 테스트 (`design.test.ts`, `theme-seed.test.ts`) |
| 프레임 캡처: 움직이는 페이지와 정지한 페이지를 가르는 것, 루프·캔버스·깊이를 재는 것, 캡션 달린 한 장으로 합치는 것 | **실제 Chrome** (`filmstrip.test.ts`) |
| 그림: 허용량, 경로 검사, 저장·기록·계량, 생성기가 없을 때의 안내 | 가짜 생성기 + 컨테이너 에뮬레이터 (`images.test.ts`) |
| **그림 (실제, `SZ_TEST_ENGINE=1 SZ_TEST_SESSION=1`)**: Codex CLI가 그리고 `sips`가 줄인 JPEG가 실제 샌드박스에 들어가고 기록과 계량이 남는 것 | OrbStack 2.2.5 + Codex 구독, 31초 |
| 데스크톱 셸의 메뉴 막대 항목 | `cargo check`, `cargo test` (컴파일과 단위 테스트까지) |
| 예산: 캐시에서 다시 읽은 입력이 태스크와 일일 예산에 10분의 1로 들어가고 기록에는 원래 숫자가 남는 것, 한도를 한참 넘긴 태스크가 승인 한 번으로 다시 도는 것, 승인 문구의 사용량 | 단위 테스트 + 스크립트된 모델 (`budget.test.ts`) |
| 외부 API 게이트웨이: 대역이 헤더·쿼리·JSON·폼 본문에서 실제 값으로 바뀌는 것, 다른 프로젝트나 다른 API의 대역을 거절하는 것, 저장된 출처로만 가고 리다이렉트를 따르지 않는 것, 되돌아온 키를 여러 이스케이프 형태로 지우는 것, 연결은 데스크톱 소유자만 | 실제 HTTP (가짜 제공자 서버), 가짜 Keychain (`external-apis.test.ts`) |
| 기획서 → 빌드: 발행이 노트를 닫지 않는 것, 발행한 기획서가 `docs/plan.md`와 빌드 요청에 들어가는 것 | 스크립트된 모델 + 실제 git |
| 시안 그리기: 페이지의 스크립트가 돌지 않고(제목을 바꾸지 못함), 이미지·스타일시트·비콘 요청이 하나도 나가지 않고, PNG가 정해진 크기로 저장되는 것. 폰 프로젝트는 폰 크기 | **실제 Chrome** + 로컬 HTTP 서버로 요청 수 확인 (`mockups.test.ts`) |
| 설계 태스크: 시안 둘이 없으면 문서 검사에서 떨어지는 것, 통과하면 `mockups.rendered`가 완료 전에 나가는 것, 그리지 못해도 성공하고 경고가 남는 것. 빌드 요청에 모델이 쓴 제목이 들어가지 않고 정해진 경로만 들어가는 것 | 스크립트된 모델 + 실제 git, 단위 테스트 |
| 화면 명세: 성립하는 명세와 어긋난 곳마다의 문장(겹친 id, 없는 화면을 가리키는 진입·이동, 바깥에서 들어올 화면 없음, 라벨뿐인 규칙, 핵심 흐름 화면의 상태 누락, 이벤트 없음). 성립하지 않으면 시안을 재지 않고 엔진에 돌려보내며, 고치지 못하면 태스크가 실패하는 것 | 단위 테스트, 스크립트된 모델 + 실제 git (`measured-mockups.test.ts`, `mockups.test.ts`) |
| 핵심 흐름 걷기: 스크립트를 끈 페이지를 누르고 입력해서 CSS 상태가 바뀌는 것, 누름·입력·스크롤·가장 작은 컨트롤·누름 응답·움직임 길이가 세어지는 것, 네 가지 멈춤(끝난 뒤의 모습으로 열림, 누를 곳 없음, 가려짐, 결과가 안 나타남)과 각각이 엔진에게 가는 문장 | **실제 Chrome** (`measured-mockups.test.ts`) |
| 시안 감사: 스크립트가 돌지 않고 요청이 하나도 나가지 않는 것, 페이지마다 첫 화면으로 라이트·다크에서 재는 것, 리뷰어에게 페이지당 한 번 폰 크기에서만 묻고 시안이라고 말하는 것, 흐린 글자의 대비 결함이 그 파일의 것으로 잡히는 것, 서체가 페이지에 실려 `font-not-loaded`가 나지 않는 것 | **실제 Chrome** + 스크립트된 리뷰어 + 로컬 HTTP 서버로 요청 수 확인 |
| 시안 측정 전체: 그리기 · 걷기 · 필름(세 장을 한 장으로, 크기 확인) · 페이지별 결함 수(같은 결함이 두 크기에서 나와도 한 건). 측정이 찾은 것은 두 번까지 고치게 하고 그 뒤에는 결과와 함께 내놓는 것, 두 번째에 깨끗해지면 한 번만 고치는 것 | **실제 Chrome** + 스크립트된 감사, 스크립트된 모델 + 실제 git |
| 설계를 따르는 빌드: 계획 모델이 화면 명세와 승인한 시안의 이름·설명을 데이터로 받는 것, 스모크 뒤에 명세의 작업으로 앱을 걷는 것, 멈춘 걷기가 빌드를 실패시키지 않고 알림·인수 검수의 증거·영수증의 `flow`로 가는 것, 영수증 사이의 "핵심 흐름 완주 1/2→2/2", "누름 5번→3번" | 스크립트된 모델·리뷰어 + 실제 git (`anchor-sandwich-ledger.test.ts`) |
| 실행 중인 앱 걷기: 스크립트가 도는 페이지에서 누른 뒤 300ms 늦게 나타나는 결과를 기다려 두 작업을 완주하는 것(폰과 데스크톱), 403으로 거절하는 서버와 열리지 않는 주소는 걷지 않는 것 | **실제 Chrome** + 로컬 HTTP 서버 (`measured-mockups.test.ts`) |
| 시안에 그림과 서체 넣기: `assets/` 아래 평범한 이름의 그림만 읽고, 폴더를 벗어나는 경로·다른 주소·없는 파일은 쓰인 그대로 두는 것. 서체는 페이지가 이름을 부른 것만, `<head>` 뒤(없으면 doctype 뒤)에 넣는 것 | 단위 테스트 |

실측 (MacBook, OrbStack):

| 항목 | 값 |
|---|---|
| 샌드박스 생성 | 약 0.5초 (이미지 빌드가 필요한 첫 회 7.7초) |
| 체크포인트 / 롤백 | 약 45ms / 약 70ms |
| 데몬 상주 메모리 | 번들 실행 101MB (TypeScript 직접 실행 130MB) |
| 쉬는 샌드박스 | 844KiB |
| Tauri 앱 | 메인 프로세스 102MB + WebKit 콘텐츠 약 78MB |

| 검증되지 않음 | 이유 |
|---|---|
| Draft 0가 실제로 걸리는 시간 | 실제 모델로 `fast` 태스크를 끝까지 돌려 본 적이 없다. 계획 호출과 디자인 게이트, 회고를 뺀 만큼 짧아지지만, 스캐폴드와 의존성 설치가 있는 첫 태스크가 몇 초 안에 끝난다고 볼 근거는 없다. |
| Tauri 창 안의 터미널 복사·붙여넣기, 터미널 안의 링크 열기 | 브라우저(Chrome)에서 그린 화면만 감사했다. WebKit 웹뷰에서의 클립보드와 새 창 동작은 확인하지 않았다. |
| Codex·Antigravity에 실제로 묻기 | `advisor.ask`는 가짜 CLI로만 확인했다. 실제 호출은 구독 할당량을 쓴다. |
| 실제 모델로 끝까지 도는 빌드 태스크 (계획 → 구현 → 회귀·시각 감사 → 수정 → 회고) | 소유자가 실제로 한 번 돌렸다(Claude Code 구독): 설계 태스크 완료, 이어진 `full` 빌드에서 계획 3.5분, 고정표 커밋, Codex의 계획 교차 검토 51초, 구현 한 차례 27분(테스트 35개 통과)까지 갔다. 검증 1회차에서 엔진이 고쳐 쓴 고정표가 걸렸고(원칙 8개), 수정 차례는 위의 예산 버그에 막혔다. 스모크·시각 감사·인수 검수·회고는 실제 모델로 아직 지나가지 않았다. |
| API 키 경로의 실제 호출 | 유효한 키로 호출한 적 없음. 소유자의 첫 시도는 키가 거부되어(401) 끝났다. |
| 벤더 CLI의 다른 버전 | 플래그와 출력 형태는 이 Mac에 설치된 버전(Claude Code 2.1.322, codex-cli 0.153.4, cursor-agent 2026.11.11, agy 1.5.6)에서 확인한 것이다. |
| Telegram·Slack·ntfy 실서버, 음성 받아쓰기 | 가짜 서버로만 확인 |
| GitHub·Stripe의 실제 MCP 서버 | 주소는 각 사 문서로 확인했으나 토큰이 없어 호출하지 않음 |
| Keychain 쓰기·읽기 왕복 | 옵트인 테스트로 제공(`SZ_TEST_REAL_KEYCHAIN=1`). 데몬 기동 때 클라이언트 토큰 항목이 실제로 만들어지는 것은 확인. |
| iOS·Android 빌드 | Rust 타깃(rustup)과 Xcode·Android SDK 설정이 필요. 클라이언트 코드는 폰 폭에서 감사를 통과했다. |
| 로그아웃·재로그인, 재부팅 뒤 자동 기동 | LaunchAgent가 `RunAtLoad`로 등록된 것까지만 확인. 실제로 로그아웃하거나 재부팅해 보지는 않았다. |
| Tailscale, Cloudflare | 문법만 확인 |
| 고정표·교차 검토·인수 검수가 결과물을 실제로 낫게 하는지 | 장치는 스크립트된 모델로 확인했다. 실제 모델로 같은 요청을 장치가 있을 때와 없을 때 만들어 견준 적은 없다. 근거는 이 저장소 밖에서 한 비교(구조 셋을 견준 이틀)이고, 장부(§8.3)가 그것을 여기서 잴 도구다. |
| 실제 구독으로 하는 교차 검토 | `ReviewDesk`의 벤더 경로는 디자인 심사에서 실제로 확인된 것과 같은 코드지만, 계획 교차 검토와 인수 검수의 프롬프트로 Codex·Claude에 실제로 물어본 적은 없다. |
| 카피 린트의 정밀도 | 예시 문구와 이 클라이언트의 화면에서만 봤다. 실제 생성물에서 얼마나 잘못 잡고 얼마나 놓치는지는 재지 않았다. 이 클라이언트 자신의 문구 14곳이 걸린 채로 있다. |
| 새 점수 가중치(측정 0.4, 판단 0.6)에서의 통과율 | 실제 리뷰어의 점수로 태스크를 돌려 본 적이 없다. 기준이 올라간 만큼 수정 회차가 늘 수 있다. |
| 메뉴 막대 항목의 실제 동작 | 컴파일과 단위 테스트까지. 앱을 띄워 눌러 보지 않았다. |
| Core 프로젝트의 실제 태스크 (실제 모델이 이 저장소를 고치고 `pnpm test`까지 통과) | 실제 샌드박스에서 설치와 타입 검사, 내보내기와 머지까지 확인했다. 그 안에서 `pnpm test` 전체를 돌리거나 실제 엔진으로 태스크를 끝까지 돌리지는 않았다. |
| 구독의 남은 한도 | 읽지 않는다 (§20). |
| Tauri 웹뷰(WebKit)에서의 요소 고르기 | Chrome에서 실제 크기와 축소된 폰 틀 양쪽으로 확인했다. 앱이 쓰는 WKWebView에서는 눌러 보지 않았다. |
| 주제에서 고른 팔레트의 실제 결과 | 도구와 지침, 대비 수학까지 확인했다. 실제 모델이 주제에 맞는 색을 고르는지, 프로젝트끼리 실제로 달라 보이는지는 설계 태스크를 돌려 봐야 안다. |
| 컨테이너 브라우저에서의 프레임 캡처, 비디오 재생 | 로컬 Chrome으로 실제 페이지(novadeck.dev)를 찍어 확인했다. QA 브라우저 컨테이너의 Chromium은 H.264가 없어 mp4 비디오가 "재생 중 아님"으로 잡힐 수 있다. |
| 만든 앱의 움직임을 프레임으로 심사 | 레퍼런스만 프레임으로 본다. 시각 감사는 아직 정지 화면이다. |
| 구독 CLI 엔진의 한 차례 도중 예산 초과 | 막지 못한다. CLI는 끝나야 사용량을 알려 주고, 데몬은 그 차례가 끝난 뒤에야 한도를 본다. 실제 빌드에서 구현 한 차례가 27분, 입력 822만 토큰(캐시 포함)이었다. |
| 실제 빌드의 캐시 비율 | 그 실행은 캐시분을 따로 적기 전이라 822만 가운데 얼마가 다시 읽은 것인지 기록이 없다. 10분의 1 가중으로 평범한 빌드가 기본 예산 안에 드는지는 다음 실행의 기록으로 확인해야 한다. |
| 실제 제공자에 대한 외부 API 게이트웨이 | 가짜 제공자 서버로만 확인했다. 서명이 요청 본문 전체에 걸리는 API(HMAC)는 대역 교체 뒤 서명이 맞지 않으므로 이 방식으로는 안 된다. |
| 실제 모델이 그린 시안 | 그리는 쪽, 걷는 쪽, 재는 쪽은 실제 Chrome과 실제 컨테이너에서 확인했다. 실제 모델이 새 지침대로 CSS 상태만으로 조작되는 페이지를 `data-step` · `data-done`과 함께 써내는지, 그림을 만들어 쓰는지, 측정 결과를 받고 실제로 고쳐 오는지는 설계 태스크를 실제로 돌려 봐야 안다. 지침을 바꾸기 전의 실제 시안 여섯 장은 전부 조작 뒤의 한 순간으로 얼어 있었다. |
| 실제 빌드에서의 흐름 걷기 | 걷기 자체는 스크립트가 도는 페이지에서 실제 Chrome으로 확인했다. 실제 엔진이 `data-step` · `data-done`을 구현에 남기는지, React Native Web에서 `dataSet`이 그 속성으로 나오는지, 실제 앱의 흐름이 2.5초 기다림 안에 따라오는지는 설계에서 이어진 빌드를 실제로 돌려 봐야 안다. 그래서 게이트가 아니라 계측이다. |
| 시안 리뷰의 실제 비용 | 설계 태스크 한 번에 리뷰어 호출이 측정 한 회차당 시안 수만큼(2~3번), 고치는 회차까지 최대 세 회차라 많으면 9번 나간다. 실제 구독에서 얼마나 걸리고 한도를 얼마나 쓰는지는 재지 않았다. |

## 18. 브리프와 다르게 한 결정, 그리고 만들지 않은 것

| 브리프 | 실제 | 이유 |
|---|---|---|
| Launchd Daemon | LaunchAgent | Keychain과 OrbStack이 사용자 세션에 있음 (§15) |
| Keychain에 AES-256으로 저장 | Keychain 자체 암호화에 맡김 | 자체 키를 같은 Keychain에 둔 2중 암호화는 보호를 더하지 않음 |
| Tauri 클라이언트 30–50MB | 메인 102MB + WebKit 78MB | 실측. Electron보다는 가볍지만 목표에는 못 미친다. WebKit 프로세스는 시스템 것이라 줄일 여지가 작다. |
| 에이전트가 런타임에 위젯을 동적 생성 | 타입 있는 블록 8종에서 고르고 채움 | 에이전트가 쓴 UI 코드를 클라이언트가 실행하면 "untrusted by default"가 깨진다 (§12) |
| 확실한 작업은 즉시 자율 실행 | `high`만, 그리고 보정 기록이 좋을 때만 | 확신도는 모델의 자기 평가라서 실제 기록으로 깎는다 |
| 승격 버튼의 이모지 | 글자만 | 디자인 계약이 아이콘 자리의 이모지를 금지한다 (§7.3) |
| 심층 크롤링 | 프로바이더의 웹 검색·페치 도구 | 이 Mac이 임의의 페이지를 받아 오거나 실행하지 않게 함 |
| Cursor, Augment, Antigravity 세션 브릿지 | Claude Code, Codex, Cursor, Antigravity. Augment는 없음. | `cursor-agent`와 `agy`에는 내장 도구를 끄는 플래그가 없어 호스트 가둠 안에서 돌린다(§4.1). 남는 위험이 있어 자동 라우팅에는 넣지 않고 소유자가 고를 때만 쓴다. Augment CLI는 이 Mac에 없어 확인할 수 없었다. |
| 구독 모드의 조사 | 웹 검색만, 페이지 페치 없음 | CLI의 페치 도구는 이 Mac에서 임의의 주소를 받아 오므로 켜지 않았다. 인용 대조가 빠진다 (§4.1). |
| 실패율 0에 수렴 | 주장하지 않음 | 학습은 게이트를 거친다 (§8) |
| 교훈을 `project_rules.md`에 자율 기록 | 후보 → 승격 | 자동 기록은 인젝션 영구화 통로 |
| Kirby: 예상 성능 개선치 | 추정과 실측을 분리 표시, 정적 지표만 | 런타임 성능을 근거 없이 수치화하지 않음 |
| Kirby: 자동 병합 | 소유자 승인 후 병합 | 브리프의 "유저 승인 후"와 같음. 승인 없는 병합 경로는 없음. |
| PostgreSQL (nod) | SQLite | 단일 노드, 상주 메모리 절감 |
| 터미널에 `node-pty` | 컨테이너 엔진 API의 TTY exec | 셸은 컨테이너 안에 있어야 하고, 엔진이 이미 TTY를 만들어 준다. 네이티브 모듈이 없어 번들이 그대로 돈다. |
| 탭과 버튼의 이모지, `indigo-600` 같은 기본 팔레트 클래스 | 아이콘 세트, 그리고 테마 시드(아연색 중립 + 인디고 강조) | 이 화면도 자기 디자인 계약으로 검사받는다: 이모지 아이콘과 기본 팔레트 클래스는 린트와 감사에서 주요 결함이다 (§7.3) |
| 테마 프리셋의 원본 팔레트 그대로 | 같은 생성기의 시드 | 글자 토큰을 대비 기준에 맞춰 풀기 때문에 색을 그대로 옮기지 않는다. 이름은 닮은 방향을 가리킨다. |
| 프리뷰 30초 이내 | 주장하지 않음 | 줄인 것은 모델 왕복 횟수다. 걸리는 시간은 재지 않았다 (§17) |
| Phase 3: 고정표를 "코드 전에 반드시" | 디자인 태스크(디자인 게이트가 켜진 프로젝트의 `full` 빌드)에 반드시. 초안(`fast`)에는 없음 | 초안은 계획 호출도 없는 트랙이다. 대신 주제에서 꺼낸 아이디어와 첫 화면의 실물은 초안 지침에도 넣었다 (§8.1) |
| Phase 3: `contract.ts`의 `maxTitleFontSize`·`borderRadius`·`motionDuration`·`fontFamily` | 디스플레이 범위와 본문 대비 비례, 곡률 상한, 등장·전환 범위, 시드가 고르는 제목 서체 네 짝 | 값을 다른 값으로 바꾸면 또 하나의 고정표가 된다. 범위와 비례로 바꿨다 (§7.1) |
| Phase 3: 첫 화면 볼거리를 강제 | 리뷰어가 판정하고 코드가 블로커로 고정 | DOM만으로는 "실제 데이터 목록"과 "글뿐인 화면"을 가르지 못한다. 측정으로 블로커를 내면 대시보드가 전부 떨어진다 (§7.4) |
| Phase 3: 한국어 정규식 다섯 개 그대로 | 뜻은 같고 식은 좁혔다. 설명조 연속은 한 덩어리 안의 문장 셋 이상 | 원문대로면 "알림을 관리합니다" 한 줄도 걸린다 (§7.5) |
| Phase 3: 글 독립 검토 파이프라인 | 결정론적 린트 + 인수 검수 리뷰어에게 글만 뽑은 덩어리를 따로 줌 | 모델 호출을 하나 더 두면 "시작과 끝 한 번씩"이 깨진다 (§8.2) |
| Phase 3: 정량 점수 비중 철폐 | 측정 0.6 → 0.4, 판단 0.4 → 0.6. 블로커의 거부권은 그대로 | 접근성과 깨진 레이아웃은 여전히 재야 한다 (§7.4) |
| Phase 3: `.studio-zero/ledger.jsonl` | `~/.studio-zero/projects/<슬러그>/ledger.jsonl` | 워크스페이스 안에 두면 평가받는 엔진이 고칠 수 있다 (§8.3) |
| Phase 3: 번들 크기와 빌드 시간 | 재되, 게이트는 아님 | 빌드 실패를 수정 회차로 돌려보내는 것은 다른 일이다. 실패는 "검증되지 않음"으로 적힌다 (§8.3) |
| Phase 3: 지원 엔진 "OpenAI o1/o3-mini", "Augment agy" | Codex CLI의 기본 모델, Antigravity의 `agy` | 벤더 CLI는 모델을 스스로 고른다. `agy`는 Antigravity의 CLI이고 Augment CLI는 여전히 없다 |
| Phase 3: 구독 잔여 한도와 RPM/TPM 실시간 표시 | 연결 여부, 스튜디오가 그 구독으로 쓴 양, 한도 거부와 풀리는 시각 | 네 CLI 가운데 헤드리스로 잔여 한도를 내놓는 것이 없고, 계정에 직접 물으려면 CLI의 로그인을 읽어야 한다. 데몬은 그것을 읽지 않는다 (§4.1, §20) |
| Phase 3: ☕ 🌙 💡 토글 | 같은 세 단계, 아이콘 세트 | 이 화면도 자기 디자인 계약으로 검사받는다 |
| Phase 3: 자기 저장소의 "로컬 루트 경로를 워크스페이스로 매핑" | 샌드박스에 복제하고 git 번들로만 오간다 | 경로를 그대로 물리면 에이전트가 데몬이 돌아가는 폴더에서 호스트 셸을 갖게 된다 (§19) |
| Phase 3: "PR을 확인하고 머지" | 이 Mac의 저장소에 `feature/` 브랜치, 데스크톱에서 빨리 감기 머지 | GitHub에 푸시하고 PR을 여는 경로는 만들지 않았다. 바깥으로 나가는 쓰기이고, 브랜치가 생긴 뒤에는 소유자가 직접 하면 된다 |
| 3자 토론 제거 | 제거할 것이 없었음 | 하네스에는 처음부터 엔진 하나와 결정론적 검증뿐이었다. 작업 노트의 "반대 검토"는 소유자가 고를 때만 도는 기법이라 그대로 뒀다. 대신 검증 앞에 컴파일·스모크 게이트를 넣고, 모델이 판정하는 부분을 뺀 `fast` 트랙을 더했다. |

만들지 않은 것:

- **데이터 분석.** 지식 작업 가운데 조사와 문서만 있다. 데이터 파일을 받아 샌드박스에서 분석하는 작업 종류는 없다.
- **게임용 프로젝트 템플릿.** Blender, Unity, Aseprite 같은 도구는 로컬 MCP 서버로 연결할 수 있지만, 프로젝트 템플릿은 웹과 Expo뿐이다. Unity 프로젝트처럼 호스트의 에디터 안에 사는 작업물은 샌드박스·시각 감사 흐름에 들어오지 않는다.
- **MCP 결과의 이미지.** 뷰포트 캡처 같은 이미지 결과는 모델에 전달되지 않는다.
- **다른 도구의 MCP 설정 가져오기.** Claude Code, Cursor 등에 이미 등록한 서버를 읽어 오는 기능은 없다. 설정에서 명령을 직접 적는다.
- **OAuth로 로그인하는 MCP 서버.** Notion과 Figma는 카탈로그에 "사용 불가"로만 나온다. 토큰 방식 서버와 소유자가 추가한 서버만 쓸 수 있다.
- **스킬 레지스트리.** 재사용 지식은 교훈(§8)뿐이다. 이름 붙은 스킬을 찾아 불러오는 구조는 없다.
- **PDF 안의 Mermaid 렌더링.** PDF는 스크립트를 끄고 인쇄하므로 다이어그램이 소스로 나온다. 클라이언트의 `Flow`도 순서도만 그리고 나머지 종류는 소스로 보여 준다.
- **모바일 앱 빌드.** 같은 클라이언트 코드가 폰 폭에서 동작하지만 iOS·Android 패키지는 만들지 않았다.
- **세션별 동시 실행.** 세션은 태스크를 묶는 이름이다. 워크스페이스가 작업 트리 하나라서 프로젝트당 태스크는 여전히 한 번에 하나만 돈다.
- **파일 뷰어의 검색, 탭 여러 개, 저장 시 포맷.** 뷰어는 한 번에 파일 하나를 열고, 편집은 통째로 저장한다.
- **원격 프리뷰 프록시.** 프리뷰는 호스트 루프백에 공개된다. 원격에서는 해당 포트를 `tailscale serve`로 직접 열어야 한다.
- **WebKit 렌더링 감사.** Chromium 기기 에뮬레이션만 쓰므로 iOS Safari 고유 버그는 잡지 못한다. Expo 앱은 웹 타깃으로 감사한다.
- **JS/TS 외 언어의 Kirby 분석.**

## 19. Self-hosting: 스튜디오가 자기를 고친다

Studio Zero의 1호 프로젝트는 Studio Zero다(`harness/SelfHosting.ts`). 데몬이 자기 저장소의 체크아웃에서 돌고 있으면 기동할 때 `Studio Zero Core` 프로젝트(`prj_core`, 템플릿 `studio-core`)를 만들어 목록 맨 위에 고정한다. 소유자가 만들 수도, 지우거나 이름을 바꿀 수도 없다.

가장 쉬운 방법은 에이전트에게 저장소 폴더를 그대로 주는 것이다. 그러면 모델이 이 Mac에서, 데몬이 돌아가는 폴더에서 셸을 갖게 되고 샌드박스가 막으려던 것이 전부 열린다. 그래서 Core도 다른 프로젝트와 같은 샌드박스이고, 저장소는 git 객체로만 드나든다.

```
in     체크아웃의 기준 브랜치(기본 main)를 번들로 묶어 Core 샌드박스에 넣는다. 태스크마다 시작 전에 한다.
       커밋된 것만 간다. 잠금 파일이 바뀌었으면 의존성을 다시 설치한다.
work   컨테이너 안에서 같은 하네스가 돈다. 시스템 프롬프트는 제품 디자인 지침이 아니라 이 코드베이스의
       규칙이고(CORE_SYSTEM_PROMPT), 게이트는 타입 검사 → pnpm test → pnpm build → 슬롭 린트다.
out    통과한 태스크의 브랜치를 컨테이너에서 번들로 묶어 체크아웃에 feature/<요청>-<태스크 id>로 넣는다.
       ref와 객체가 생길 뿐이다. 작업 트리의 파일도, 기준 브랜치도 바뀌지 않고, 아무것도 실행되지 않는다.
merge  소유자가 데스크톱에서 누른다. 빨리 감기만, 체크아웃이 깨끗하고 기준 브랜치에 있을 때만.
       아니면 이유를 말하고 거부하며 브랜치는 남는다.
```

- 정책: 내보내기는 `selfhost.export`(하네스만, Core 프로젝트만, 새 `feature/` 이름만), 머지는 `selfhost.merge`(데스크톱의 소유자만). 샌드박스 안에서의 `git.merge`는 Core에서 거부한다: 그 안의 `main`은 어디로도 이어지지 않는다.
- `selfhost.status`는 아무것도 바꾸지 않는 점검이다: 저장소 경로, 기준 브랜치와 그 커밋, 커밋 안 된 변경이 있는지, 머지를 기다리는 브랜치.
- 프리뷰는 클라이언트의 예시 데이터 화면(`/?demo`)이다. 바꾼 UI를 머지 전에 볼 수 있다.
- 머지해도 실행 중인 데몬은 번들(`packages/daemon/dist`)에서 돌므로 그대로다. `pnpm build && pnpm daemon:restart`가 새 코드를 올리고, 그때 DB 마이그레이션도 돈다.
- 끄려면 `selfHosting.enabled: false`, 다른 체크아웃을 쓰려면 `selfHosting.repoPath`.

## 20. 이 Mac: 잠자기 방지와 구독 현황

**잠자기 방지** (`util/CaffeinateManager.ts`, `power.get` · `power.set`). `caffeinate` 프로세스를 하나만 쥔다.

| 모드 | 명령 | 쓰는 때 |
|---|---|---|
| `off` | 없음 | 시스템 설정대로 잠든다 |
| `system` | `caffeinate -i -s -w <pid>` | 화면은 꺼져도 Mac은 깨어 있다: 밤새 도는 조사와 빌드 |
| `display` | `caffeinate -d -i -s -w <pid>` | 화면까지 켜 둔다: 지켜볼 때, 시연할 때 |

`display`는 `system`이 쥐는 것을 전부 쥐고 화면을 더한다. 처음에는 `-d` 하나였는데, 그것은 화면의 유휴 어서션일 뿐이고 시스템 잠자기를 막는 어서션(`-s`: 전원에 꽂힌 Mac이 덮개를 닫아도 도는 것)은 들어 있지 않았다. 더 센 모드로 읽히는 쪽이 약한 모드가 막던 경우를 놓쳤던 것이다.

모드를 바꾸면 앞의 프로세스를 끝내고 새로 띄운다. `-w`는 데몬의 pid라서 데몬이 어떻게 죽든 Mac이 영영 깨어 있지는 않는다. 고른 모드는 DB에 남아 재시작 뒤 복원되고, `caffeinate`가 밖에서 끝나면 상태가 `off`로 돌아가며 `power.changed`가 나간다. 에이전트는 바꿀 수 없다(`power.owner-only`). macOS가 아니면 `supported: false`이고 토글이 보이지 않는다.

**구독 현황** (`app/QuotaTracker.ts`, `quota.get`). 데몬은 벤더의 로그인을 읽지 않으므로 계정의 남은 한도를 알 수 없다. 아는 것은 자기 쪽에서 본 것뿐이고, 그것을 보여 준다.

- CLI가 설치되어 답하는지.
- 스튜디오가 그 구독으로 쓴 토큰과 호출 수: 최근 5시간과 7일(`usage_ledger`).
- 한도 거부: 엔진과 `SessionBrain`이 호출마다 결과를 알리고, 벤더가 사용 한도로 거부하면 `limited`가 된다. 거부 문구에 풀리는 때가 있으면("try again in 3h 12m", "resets at 5pm") 읽어서 남은 시간을 센다. 다음 호출이 성공하면 풀린다. 상태가 바뀌면 `quota.changed`.

같은 구독을 다른 도구로도 쓰고 있으면 실제 한도는 이 숫자보다 가까이 있을 수 있다. 화면도 그렇게 적는다.
