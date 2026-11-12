# Studio Zero

생각을 정리하고, 조사하고, 문서를 쓰고, 앱을 만들고, 스스로 검증한 뒤 결과를 폰으로 보내 승인받는 스튜디오. 코어 데몬과 Tauri 클라이언트.

설계 전체는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 있다. 구현된 것과 아닌 것, 검증된 것과 아닌 것도 거기에 적혀 있다.

## 구성

| 패키지 | 내용 |
|---|---|
| `packages/protocol` | RPC 메서드·이벤트·프레임의 zod 계약, `RpcClient` |
| `packages/design` | 디자인 계약, OKLCH 테마 생성기(Tailwind v4), UI 슬롭 린터, 문장 린터, 한국어 카피 린터 |
| `packages/ax` | AX 키트: 에이전트가 고르는 블록 어휘, 이벤트 스트림, React 렌더러와 훅, 텔레메트리. 만들어지는 모든 프로젝트에도 들어간다. |
| `packages/daemon` | 코어 데몬과 `sz` CLI |
| `apps/desktop` | Tauri 2 클라이언트 (데스크톱, 같은 코드로 모바일 폭까지) |
| `deploy/` | LaunchAgent, Cloudflare Tunnel 예시, 설정 예시 |

## 시작

필요한 것: macOS, Node.js 24.3 이상, pnpm, [OrbStack](https://orbstack.dev) (다른 Docker 호환 엔진을 쓰려면 설정의 `runtime.dockerContext`를 바꾼다).

```bash
pnpm install
pnpm daemon                                    # 제어 127.0.0.1:49200, 게이트웨이 127.0.0.1:49201

# 다른 터미널에서
pnpm sz status
pnpm sz project create ledger "Ledger"
pnpm sz task ledger build "미결제 청구서 화면을 만들어줘"
```

데스크톱 앱에서는 처음 화면에 아이디어를 적고 **바로 만들기**를 누르면 된다. 이름과 스택은 스튜디오가 정하고, 질문 없이 초안부터 만든다. 프로젝트 화면은 왼쪽이 에이전트와의 대화, 오른쪽이 프리뷰·파일·터미널·시점·감사·장부다.

**검증까지** 만드는 작업은 코드를 쓰기 전에 고정표(`.studio-zero/anchor-table.json`: 주제에서 꺼낸 아이디어, 두 방향, 첫 화면의 볼거리, 레퍼런스에서 가져올 원리와 우리 값)를 먼저 커밋하고, 다른 회사의 모델에게 계획을 한 번, 결과를 한 번 보인다. 입력창 위에서 검수 구독을 고르고 레퍼런스 주소를 붙일 수 있다. 끝난 작업은 장부 탭에 영수증으로 남는다: 타입 에러, 디자인 등급, 텍스트 슬롭, 토큰, 직전 작업 대비.

**설계부터**로 시작하면 문서와 함께 첫 화면 시안이 두세 장 나온다. 구조가 서로 다른 방향이고, 프리뷰 탭에서 폰·태블릿·데스크톱 크기로 실제 페이지를 본다. 고칠 곳은 요소를 골라 적어 보내고, 마음에 들면 하나를 골라 승인한다. 색과 모양은 프로젝트 이름이 아니라 주제에서 정하고, Codex가 연결돼 있으면 제품에 쓸 그림을 만들어 쓴다.

만드는 앱이 남의 API 키를 써야 하면(증권사, 결제, 지도) 프로젝트 메뉴 → **외부 API 키**에서 연결한다. 키는 Keychain에 남고 샌드박스에는 대역만 들어간다. 에이전트는 키를 읽지 못하지만 그 API를 부를 수는 있으니, 조회 전용이나 모의 키를 쓴다.

목록 맨 위의 **Studio Zero Core**는 이 저장소 자신이다. 거기에 일을 시키면 샌드박스 안의 복제본에서 고치고 테스트한 뒤, 이 체크아웃에 `feature/` 브랜치로만 내놓는다. 읽어 보고 앱에서 머지한다.

**모델은 둘 중 하나면 된다.** Claude Code에 로그인되어 있으면(`claude`를 한 번 실행) API 키 없이 구독으로 돈다. 계획·검증·작업 노트 같은 스튜디오 자체의 생각도 그 구독으로 한다. API 키를 쓰려면 `pnpm sz vault set provider/anthropic/api-key`(숨김 입력, macOS Keychain에 저장). Codex, Cursor, Antigravity CLI가 로그인되어 있으면 작업을 시작할 때 엔진으로 고를 수 있다. 엔진을 고르면 그 옆에서 모델과 추론 강도(effort)도 고른다: 모델 목록은 그 CLI가 지금 로그인으로 쓸 수 있다고 답한 것이고, 고르지 않으면 엔진이 평소 쓰는 모델과 작업 종류에 맞는 강도로 돈다. Cursor와 Antigravity는 강도가 모델 이름에 들어 있어서(`…-high`) 모델만 고른다. 처음 화면에서도 고를 수 있고(프로젝트의 첫 작업이 대개 가장 크다), 고른 것은 앱이 기억해서 프로젝트의 입력창에도 그대로 나온다. `pnpm sz status`가 지금 어느 쪽으로 도는지 보여 준다.

Blender, Unity, Aseprite 같은 이 Mac의 도구는 앱의 설정 → 외부 도구 → MCP 서버 추가에서 실행 명령으로 연결한다.

상태는 `~/.studio-zero/`(`SZ_HOME`으로 변경)에 있다. 설정 파일은 `~/.studio-zero/config.json`이고 `deploy/config.example.json`이 예시다. 없으면 기본값으로 동작한다.

데스크톱 앱:

```bash
pnpm --filter @studio-zero/desktop dev            # http://127.0.0.1:1420/?demo 는 데몬 없이 예시 데이터로 열린다
pnpm --filter @studio-zero/desktop tauri build    # Rust 필요. 결과: apps/desktop/src-tauri/target/release/bundle/macos
```

로그인할 때 데몬이 저절로 뜨게 하려면:

```bash
deploy/install-launch-agent.sh      # 빌드하고 LaunchAgent로 등록한다. 이후에는 pnpm daemon 을 따로 켜지 않는다.
pnpm build && pnpm daemon:restart   # 코드를 바꾼 뒤
tail -f ~/Library/Logs/studio-zero/daemon.log
```

Mac mini 상시 가동과 원격 접속은 문서 §15를 본다.

## 개발

```bash
pnpm typecheck
pnpm test              # 192개. 13개는 옵트인이고, Chrome이 필요한 테스트는 없으면 건너뛴다.
pnpm design:build      # packages/design/theme.css 재생성

SZ_TEST_REAL_KEYCHAIN=1 pnpm test   # 임시 키체인으로 실제 Keychain 왕복 검증 (옵트인)
SZ_TEST_ENGINE=1 pnpm test          # 실제 OrbStack에서 샌드박스·게이트웨이·시각 감사, 터미널·파일·컴파일 게이트, 레퍼런스 캡처, 자기 저장소 샌드박스 검증 (옵트인)
SZ_TEST_SESSION=1 node --test packages/daemon/test/session.integration.test.ts   # 실제 구독 CLI로 검증 (할당량을 조금 쓴다)

node apps/desktop/scripts/audit.ts  # 클라이언트 화면을 데몬의 시각 검사에 통과시킨다 (먼저 클라이언트를 빌드)
```

개발에는 빌드 단계가 없다. Node 24가 TypeScript를 그대로 실행한다. 상시 가동용으로는 `pnpm build && pnpm start`가 번들을 만들어 실행한다(상주 메모리 약 25MB 절감).
