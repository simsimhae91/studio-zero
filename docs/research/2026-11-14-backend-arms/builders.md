## 결론
- 상용 빌더는 모두 비슷한 방식으로 백엔드를 붙입니다. 호스팅된 Postgres(대부분 Supabase 계열), 플랫폼이 가진 공용 OAuth 클라이언트, 서버 쪽에만 두는 비밀 저장소입니다. 사고는 대부분 RLS 누락, 키 노출, 프리뷰 iframe에서 깨지는 OAuth, 개발 DB와 운영 DB를 나누지 않은 데서 났습니다.
- 가입부터 저장, 재시작 후 데이터 유지까지를 사람 손 없이 검증하는 빌더는 없었습니다. 로컬 빌더가 앞설 수 있는 지점이 바로 여기입니다.

## 선택지
| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬에서 띄우는 법과 무게 | 한계 |
|---|---|---|---|---|
| Lovable Cloud | DB, 인증, 스토리지, 실시간, 함수, AI. 로그인은 Email, Phone, Google, Apple, Microsoft, SAML, OIDC (https://docs.lovable.dev/features/cloud, https://docs.lovable.dev/features/authentication) | 호스팅 전용. "Supabase의 오픈소스 기반" 위에서 돎 | 로컬 실행 없음 | DB를 지우면 사용자 계정과 파일도 함께 지워짐. 리전 변경 불가. Supabase와 Cloud 사이 자동 이전은 어느 방향도 없음 (https://docs.lovable.dev/integrations/supabase) |
| Bolt Cloud | Postgres, 인증(이메일, Google, 익명), 스토리지, 서버 함수, Stripe (https://support.bolt.new/cloud/bolt-cloud) | Supabase 위에서 돎 (https://supabase.com/blog/bolt-cloud-launch). 내 Supabase로 "claim" 가능(Pro 이상) | 없음 | Google은 내 키가 필수이고 iframe 프리뷰에서 막힘. 기본 인증 메일이 프로젝트 전체 시간당 2통 (https://support.bolt.new/cloud/database/authentication). 버전 롤백이 DB는 되돌리지 않음 (https://support.bolt.new/managing-projects/rollback-backup.md) |
| Replit | PostgreSQL(개발 DB와 운영 DB 분리), App Storage, Replit Auth 또는 Clerk, Stripe 커넥터 (https://docs.replit.com/references/integrations/overview.md) | 독점 | 없음 | 커스텀 OAuth 자격은 운영 환경에서만 쓸 수 있음 (https://docs.replit.com/features/auth-and-identity/sign-in-providers) |
| v0 | Marketplace 통합(Supabase, Neon, Upstash, Blob). 통합을 추가하면 환경변수가 자동으로 들어감 (https://v0.app/docs/databases) | 공급자별로 다름 | 없음 | 인증이나 테스트 기능은 문서에 없음 (https://v0.app/docs/full-stack-apps) |
| Base44 | MongoDB 호환 NoSQL, 행·필드 단위 보안, Google·Microsoft·Facebook·Apple 로그인, Deno 함수, WebSocket (https://docs.base44.com/developers/backend/overview/features) | 독점(Wix) | 없음 | 2025-07: 공개된 app_id만으로 비공개 앱에 가입할 수 있었음. 24시간 안에 수정됨 (https://www.wiz.io/blog/critical-vulnerability-base44) |
| Firebase Studio | Firestore와 Firebase Auth를 자동 설정 (https://firebase.google.com/docs/studio) | Google | 없음 | 2026-06-22부터 새 작업공간 생성 중단, 2027-03-22에 종료. Google AI Studio나 Antigravity로 옮기라고 안내 (https://firebase.google.com/docs/studio/migrating-project) |
| Rork | Rork Cloud(Postgres, 함수, AI 모델), Rork Auth, Supabase·Firebase 연결, RevenueCat (https://docs.rork.com/faq/integrations) | 베타 동안 무료. 내 Supabase로 단방향 이전 (https://docs.rork.com/backend/rork-cloud.md) | 없음 | 개발과 운영 구분이 없음("변경은 즉시 반영"). Rork Auth는 Google과 Apple만 지원 |
| a0.dev | Convex 또는 Supabase, 결제, AI API (https://a0.dev) | 공급자별로 다름 | 없음 | 인증 문서를 찾지 못함 (https://docs.a0.dev/llms.txt) |
| Anything | Neon Postgres(개발과 운영 분리), 이메일·Google·Facebook·X 로그인, Stripe, RevenueCat (https://www.anything.com/docs/apps/databases.md) | 독점 | 없음 | Google은 내 키, 커스텀 도메인, 게시가 모두 있어야 하고 모바일에서는 안 됨 (https://www.anything.com/docs/auth/google.md) |
| Cursor·Claude Code + Supabase MCP | 에이전트가 스키마와 마이그레이션을 다룸 | Supabase OSS(라이선스는 이번에 확인하지 못함) | `supabase start`(Docker에서 서비스마다 컨테이너 하나), 또는 실험 기능인 네이티브 `supabase stack`(Apple silicon, macOS 14 이상) (https://supabase.com/docs/guides/local-development/docker-and-native-runtimes). 로컬 MCP 주소는 `http://localhost:54321/mcp` | 기본 포트로는 머신당 프로젝트 하나 (https://supabase.com/docs/guides/local-development). 프롬프트 인젝션 경고가 있고, 운영 DB에 붙일 때는 `read_only`와 `project_ref`로 범위를 좁히라고 권고 (https://supabase.com/docs/guides/getting-started/mcp) |

## 프로토타입에 어떻게 붙이나
- **환경변수와 비밀**
  - v0와 Bolt는 연결 값을 자동으로 채워 넣습니다(v0 위 링크). Bolt는 DB 연결용 `.env` 값을 채운 뒤 잠가 둡니다.
  - 비밀은 서버 함수만 읽습니다 (https://support.bolt.new/bolt-cloud/database/secrets.md).
  - Rork는 `EXPO_PUBLIC_`으로 시작하는 이름만 앱 안으로 보내고 나머지는 서버에 둡니다 (https://docs.rork.com/features/secrets.md). v0는 브라우저용 변수에 `NEXT_PUBLIC_`을 붙입니다.
- **로컬 Supabase 설정**
  - 소셜 로그인은 `config.toml`의 `[auth.external.kakao]`에 넣고, 비밀은 `secret = "env(SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET)"`처럼 환경변수로 대신합니다.
  - 인증 메일은 Mailpit(54324)이 보내지 않고 받아 둡니다. `enable_confirmations`의 기본값은 false입니다 (https://supabase.com/docs/guides/local-development/cli/config).
- **웹과 Expo의 차이**
  - Google OAuth는 iframe을 막으므로 로그인은 최상위 창에서 열어야 합니다(Bolt 위 링크).
  - Lovable은 네이티브 앱에서 Google 로그인을 브라우저로 열고, 앱의 커스텀 스킴을 Redirect URL에 넣으라고 합니다 (https://docs.lovable.dev/features/google-auth).
  - Rork Auth는 웹에서 세션을 `localStorage`에 둡니다. iOS 시뮬레이터에서는 로그인 창이 브라우저로 열립니다 (https://docs.rork.com/integrations/backend/how-to-set-up-oauth.md).
  - Anything은 Sign in with Apple이 나오기 전까지 모바일 앱에 Google·Facebook 로그인을 넣지 말라고 합니다. Apple App Store 규정 때문입니다 (https://www.anything.com/docs/apps/auth.md).

## 키 없이 되는 것과 안 되는 것
- **빌더가 키 없이 소셜 로그인을 해내는 방법은 공용 OAuth 클라이언트입니다.**
  - Lovable(Google, Apple, Microsoft), Replit, Base44, Rork Auth가 이 방식을 씁니다.
  - 대가는 브랜딩입니다. Replit은 동의 화면에 Replit 브랜드가 뜨고 (https://docs.replit.com/features/auth-and-identity/authentication), Rork는 비밀키를 Rork가 보관합니다.
  - 로컬 빌더는 고정된 공개 도메인이 없으므로 이 방식을 빌릴 수 없습니다.
- **로컬에서 키 없이 되는 것:** 이메일·비밀번호 로그인, Mailpit으로 받는 확인 메일, 익명 로그인(Bolt가 제공), DB, 스토리지, 실시간.
- **소유자가 직접 발급해야 하는 것**
  - Google: Web 유형 OAuth 클라이언트를 만들고 redirect URI를 정확히 일치시켜야 합니다. 외부 사용자가 쓰려면 Google 검증도 받아야 합니다(Anything 위 링크).
  - Apple: Developer Program 회원이어야 하고, Team ID, Services ID, Key ID, 개인키가 필요합니다(Replit 위 링크).
  - 전화 인증: Twilio 같은 SMS 공급자가 필요합니다(Lovable 위 링크).
- **빌더가 스스로 하는 검증**
  - Lovable은 일을 끝냈다고 보고하기 전에 변경을 덮는 프론트엔드 테스트를 돌립니다 (https://docs.lovable.dev/features/testing). 브라우저 테스트는 Cloud에서만, 이미 있는 사용자로만 로그인합니다. 외부 Supabase를 쓰는 앱은 로그인이 필요 없는 페이지까지만 테스트합니다 (https://docs.lovable.dev/features/browser-testing).
  - Replit은 로그인에서 막히면 사람에게 "Begin take over"로 넘깁니다 (https://docs.replit.com/features/agent/app-testing).
  - Anything은 게시한 뒤 시크릿 창에서 직접 확인하라고 안내합니다.

## 한국 사정
- 어느 빌더의 관리형 로그인 목록에도 Kakao와 Naver가 없습니다(위 표의 각 문서).
- Supabase Auth는 `kakao`를 기본 지원합니다. 다만 위 config 문서의 제공자 목록에 Naver는 없습니다.
- Kakao 이메일 동의 항목은 "Biz App"으로 등록해야 열립니다. 그 전에는 "Allow users without an email"을 켜서 이메일 없이 받을 수 있습니다. 로컬 콜백 주소는 `http://localhost:54321/auth/v1/callback`입니다 (https://supabase.com/docs/guides/auth/social-login/auth-kakao).

## 추천과 이유
1. **기본 팔은 로컬 Supabase 스택으로 합니다.** Lovable Cloud, Bolt Cloud, Rork 이전 대상과 같은 기반이라 나중에 호스팅으로 옮기기 쉽고, Kakao와 로컬 MCP를 지원합니다. 프로젝트를 여러 개 띄우려면 Docker 런타임을 쓰고 프로젝트마다 포트를 따로 줘야 합니다.
2. **RLS는 정책이 있는지가 아니라 실제 동작으로 검증합니다.**
   - Lovable 앱 1,645개 중 170개, 엔드포인트 303곳이 노출됐습니다(CVE-2025-48757). 당시 스캐너는 "정책이 있는지만" 봤습니다 (https://mattpalmer.io/posts/statement-on-CVE-2025-48757/).
   - 공개된 바이브코딩 앱 5,600여 개에서 비밀 400건 이상이 나왔고, service role 키가 프론트엔드 번들에 들어 있었습니다 (https://escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding/).
   - 그래서 세 가지를 검사합니다. 사용자 A가 쓴 행을 B가 못 읽는지, 세션 없는 anon이 못 읽는지, 클라이언트 번들에 service_role 키가 없는지.
3. **어느 빌더도 하지 않는 검증을 표준으로 둡니다.** admin API로 테스트 사용자를 만들고, Mailpit에서 확인 메일을 읽고, 브라우저 에이전트로 로그인해 데이터를 쓴 뒤, 컨테이너를 재시작하고 다시 읽습니다.
4. **에이전트가 마이그레이션하기 전에 DB 스냅샷을 뜹니다.** Bolt처럼 코드 롤백으로는 DB가 되돌아오지 않습니다. Replit은 개발 DB와 운영 DB를 나누고, 에이전트에게는 운영 DB의 읽기 전용 복제본만 줍니다(위 개발·운영 문서 https://docs.replit.com/features/data-and-storage/development-and-production). 2025년 운영 DB 삭제 사고가 있었고 (https://www.eweek.com/news/replit-ai-coding-assistant-failure/, 검색 요약만 확인), 이 분리가 그 뒤에 생겼다는 시점은 확인하지 못했습니다(아래 참고).
5. **OAuth 키는 소유자가 발급해 게이트웨이가 쥡니다.** 키가 없으면 이메일·매직링크 로그인을 대역으로 쓰되 대역이라고 표시하고, 로그인 창은 최상위 창에서 엽니다.

## 확인하지 못한 것
- 조사 도중 세션의 웹 검색 한도(200회)가 소진됐습니다. Reddit이나 Discord의 사용자 불만은 직접 읽지 못했고, 불만 부분은 공식 문서, 연구자 공지, Escape, Wiz, 뉴스 요약에 기대고 있습니다.
- Replit 사고 뒤 정확히 무엇을 바꿨는지와 그 시점은 확인하지 못했습니다. 문서로 확인한 것은 현재 개발·운영 DB가 분리돼 있다는 것뿐입니다.
- 로컬 Supabase 스택의 컨테이너 수, 메모리, 시작 시간 수치와 Supabase 라이선스는 확인하지 못했습니다.
- CVE의 CVSS 점수는 9.3과 8.26이 엇갈리고, NVD 페이지가 열리지 않아 확인하지 못했습니다.
- Google AI Studio의 백엔드 기능, a0.dev의 인증, Bolt와 v0의 브라우저 테스트 여부는 확인하지 못했습니다.
- Rork FAQ의 검색 요약(rork.com/faq)은 소셜 로그인에 Expo development build가 필요하다고 했습니다. 현재 Rork Auth 문서는 프리뷰와 실기기에서 된다고 해서 서로 맞지 않습니다.
- Lovable의 범용 OIDC 연결로 Kakao를 붙일 수 있는지는 확인하지 못했습니다.