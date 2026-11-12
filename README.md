# Studio Zero

생각을 정리하고, 조사하고, 문서를 쓰고, 앱을 만들고, 스스로 검증한 뒤 결과를 폰으로 보내 승인받는 스튜디오. 코어 데몬과 Tauri 클라이언트.

설계 전체는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)에 있다. 구현된 것과 아닌 것, 검증된 것과 아닌 것도 거기에 적혀 있다.

## 구성

| 패키지 | 내용 |
|---|---|
| `packages/protocol` | RPC 메서드·이벤트·프레임의 zod 계약, `RpcClient` |
| `packages/design` | 디자인 계약, OKLCH 테마 생성기(Tailwind v4), UI 슬롭 린터, 문장 린터 |
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
pnpm sz vault set provider/anthropic/api-key   # 키는 숨김 입력으로 받아 macOS Keychain에 저장
pnpm sz status
pnpm sz project create ledger "Ledger"
pnpm sz task ledger build "미결제 청구서 화면을 만들어줘"
```

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
pnpm test              # 62개. 2개는 옵트인이고, Chrome이 필요한 테스트는 없으면 건너뛴다.
pnpm design:build      # packages/design/theme.css 재생성

SZ_TEST_REAL_KEYCHAIN=1 pnpm test   # 임시 키체인으로 실제 Keychain 왕복 검증 (옵트인)
SZ_TEST_ENGINE=1 pnpm test          # 실제 OrbStack에서 샌드박스·게이트웨이·시각 감사 검증 (옵트인)

node apps/desktop/scripts/audit.ts  # 클라이언트 화면을 데몬의 시각 검사에 통과시킨다 (먼저 클라이언트를 빌드)
```

개발에는 빌드 단계가 없다. Node 24가 TypeScript를 그대로 실행한다. 상시 가동용으로는 `pnpm build && pnpm start`가 번들을 만들어 실행한다(상주 메모리 약 25MB 절감).
