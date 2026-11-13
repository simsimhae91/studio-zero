## 결론
- 프로젝트마다 Supabase 한 벌이 맞습니다. 단, 기본 엔진이 아니라 CLI의 실험적 `stack` 모드(지연 기동)로 띄워야 5~10개가 현실적입니다.
- 공유 인스턴스에 스키마만 나누는 안은 버립니다. self-hosted Supabase는 프로젝트 하나를 흉내 내는 구조라 사용자·키·스토리지가 섞입니다 (https://supabase.com/docs/guides/self-hosting).
- 무게는 Supabase 자체 측정으로 유휴 프로젝트당 290 MiB, 기본 엔진은 2.6 GiB입니다 (https://supabase.com/blog/local-supabase-project-per-agent-with-or-without-docker). 10개면 약 2.8 GiB 대 26 GiB입니다.

## 선택지
| 이름 | 덮는 것 | 라이선스·자가 호스팅 | 로컬 기동과 무게 | 한계 |
|---|---|---|---|---|
| Supabase CLI `stack` 모드 | Postgres, Auth(google·kakao 내장), Storage, Realtime, Functions, Studio, Mailpit (https://supabase.com/docs/guides/local-development/cli/config) | Apache-2.0 (https://github.com/supabase/supabase). 개발용이라 외부 노출 금지 | `supabase start`. Postgres만 즉시 뜨고 나머지 서비스(총 13개)는 첫 요청 때 뜨며 60초 유휴 시 정지. 유휴 290 MiB, 캐시 시작 5.2초, 첫 시작 18초, 내려받기 550 MB | Public Alpha, CLI v2.119.0 이상. `db`·`migration` 명령은 `--stack` 미지원 (https://supabase.com/docs/guides/local-development/running-multiple-local-projects) |
| Supabase 기본 엔진 | 위와 같음 | 같음 | 약 12개 컨테이너, 유휴 2.6 GiB, 시작 37초, 내려받기 1.9 GB (같은 블로그) | 기본 포트로는 한 머신에 프로젝트 하나 |
| Supabase docker-compose | 운영 배포용 | 커뮤니티 지원 | 서비스 11개, 최소 4 GB RAM·2코어 (https://supabase.com/docs/guides/self-hosting/docker) | Branching, 관리형 백업, Management API 없음 |
| PocketBase | SQLite, 인증(kakao 포함), 파일, realtime, 관리 UI | MIT | 바이너리 하나, 컨테이너 0~1개. 메모리 공식 수치 없음 | 1.0 이전, 개인 프로젝트, 수직 확장만 (https://pocketbase.io/faq/). GitHub 저장소 아카이브·이전 (https://github.com/pocketbase/pocketbase) |
| Appwrite 2.x | Auth, DB, Storage, Functions, Realtime, Messaging | BSD-3 (https://github.com/appwrite/appwrite) | 16개 컨테이너(분리형 33개) (https://appwrite.io/blog/post/appwrite-2-self-hosted). 최소 4 GB RAM + 2 GB swap (https://appwrite.io/docs/advanced/self-hosting/installation) | 한 인스턴스가 여러 프로젝트를 품지만 무겁고 SQL이 아님 |
| Nhost | Postgres, Hasura GraphQL, Auth, Storage, Functions | MIT (https://github.com/nhost/nhost) | `nhost up`, Docker 필요 (https://docs.nhost.io/platform/cli/local-development) | Kakao 지원 미확인 |
| Convex | 반응형 DB·함수, Convex Auth(베타) (https://labs.convex.dev/auth) | FSL, 2년 뒤 Apache-2.0 (https://docs.convex.dev/self-hosting) | compose는 backend+dashboard 2개, SQLite 기본 (https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md). `npx convex dev` 로컬 배포는 계정 없이 서브프로세스 (https://docs.convex.dev/cli/local-deployments) | SQL 아님, 로컬 배포 베타 |
| Firebase Emulator Suite | Auth, Firestore, RTDB, Storage, Functions, Hosting (https://firebase.google.com/docs/emulator-suite) | 운영용 아님. 운영은 Google 클라우드 | Node 16+, JDK 11+ 프로세스 (https://firebase.google.com/docs/emulator-suite/install_and_configure) | 벤더 종속 |
| Directus | 기존 SQL 위 REST·GraphQL·Studio | v12부터 MSCL(소스 공개형). 매출 $5M·50인 미만 무료 (https://github.com/directus/directus) | Docker | CMS 성격 |
| Postgres + Drizzle/Prisma + Better Auth | DB·ORM·인증(Kakao provider) (https://www.better-auth.com/docs/authentication/kakao) | 오픈소스 | Postgres 컨테이너 하나를 공유하고 DB만 프로젝트별로 | 스토리지·실시간·관리 UI를 직접 조립 |

## 프로토타입에 어떻게 붙이나
- **설정**: `supabase/config.toml`에 `[experimental] stack = true`를 넣고 고정 포트 키를 지웁니다. 포트는 20000~32767에서 자동 배정되어 재시작해도 유지됩니다. URL과 키는 `supabase start --output-format json`으로 읽습니다 (https://supabase.com/docs/guides/local-development/running-multiple-local-projects).
- **스택 식별**: 프로젝트 루트 + git 브랜치 + `--stack` 이름입니다(같은 문서). 브랜치를 바꾸면 다른 DB가 되므로 빌더가 `--stack` 이름을 고정해야 합니다.
- **런타임**: OrbStack의 Docker 런타임을 씁니다. native 런타임은 Apple silicon에서 되지만 환경당 프로젝트 하나 용도이고, 여러 개면 Docker가 권장됩니다 (https://supabase.com/docs/guides/local-development/docker-and-native-runtimes).
- **환경변수와 라이브러리**:
  - Vite: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `@supabase/supabase-js` (https://supabase.com/docs/guides/getting-started/quickstarts/reactjs)
  - Next.js: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `@supabase/ssr` (https://supabase.com/docs/guides/getting-started/quickstarts/nextjs)
  - Expo: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `expo-sqlite`의 localStorage, `react-native-url-polyfill`, `detectSessionInUrl: false` (https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native)
- **시드**: `supabase/seed.sql`이 마이그레이션 뒤, 첫 `start`와 `db reset` 때 실행됩니다 (https://supabase.com/docs/guides/local-development/seeding-your-database).
- **비밀값**: 소셜 로그인 secret은 `config.toml`의 `secret = "env(...)"`로 Auth 서비스에만 들어갑니다 (https://supabase.com/docs/guides/local-development/managing-config). 프로젝트 컨테이너에는 URL과 publishable key만 주면 됩니다.
- **접근 주소(추론, 미검증)**: 브라우저는 `127.0.0.1:<포트>`, 컨테이너 안 서버 코드는 `host.docker.internal:<포트>`로 접근해야 하므로 URL 두 개를 주입해야 할 것입니다.

## 키 없이 되는 것과 안 되는 것
- **되는 것**: DB, Storage, Realtime(채팅), Functions 전부입니다. 이메일 가입은 Mailpit이 확인 메일을 잡습니다 (https://supabase.com/docs/guides/local-development/cli/getting-started). 익명 로그인은 `auth.enable_anonymous_sign_ins`, 전화 OTP는 `[auth.sms.test_otp]` 고정 코드로 됩니다 (https://supabase.com/docs/guides/local-development/cli/config).
- **안 되는 것**: 실제 Google·Kakao 로그인은 소유자가 `client_id`와 secret을 발급해야 합니다.
- **Kakao 발급 절차**: Kakao Developers에서 앱 생성 → REST API 키(=client_id) → Client Secret 활성화 → Redirect URI에 `http://localhost:<포트>/auth/v1/callback` 등록 → 동의항목 설정 (https://supabase.com/docs/guides/auth/social-login/auth-kakao).
- **콜백 포트**: stack 모드는 프로젝트마다 포트가 다릅니다. `SUPABASE_API_PORT`로 고정하거나 게이트웨이의 단일 콜백으로 묶는 설계가 필요합니다.
- **대역**: Auth v2.196.0부터 Custom OAuth/OIDC provider를 admin API `/auth/v1/admin/custom-providers`로 등록하고 `custom:이름`으로 호출할 수 있습니다 (https://supabase.com/docs/guides/self-hosting/self-hosted-custom-oauth-providers). 호스트 게이트웨이의 가짜 OIDC 발급자를 여기에 물리는 안이 유력합니다.
- **참고**: Firebase 에뮬레이터는 가짜 ID 토큰 JSON을 그대로 받습니다 (https://firebase.google.com/docs/emulator-suite/connect_auth).

## 한국 사정
- Kakao가 내장인 것은 Supabase, PocketBase (https://raw.githubusercontent.com/pocketbase/pocketbase/master/tools/auth/kakao.go), Appwrite (https://appwrite.io/blog/post/announcing-new-oauth2-providers), Better Auth입니다.
- Firebase는 OIDC로 붙여야 하고 Identity Platform 업그레이드가 필요합니다 (https://firebase.google.com/docs/auth/web/openid-connect).
- Kakao의 `account_email`은 비즈 앱만 받을 수 있습니다. 아니면 Supabase에서 "Allow users without an email"을 켭니다 (Supabase Kakao 문서).

## 추천과 이유
1. **기본 팔은 Supabase `stack` 모드, 프로젝트당 한 벌입니다.** 소유자 제안과 같고, DB·인증·스토리지·채팅이 한 클라이언트 라이브러리로 끝나며 Kakao·Google이 내장입니다. 유휴 비용은 지연 기동으로 해결됩니다.
2. **안 쓰는 프로젝트는 `supabase stop`으로 내립니다.** Studio·analytics는 `--exclude`로 뺍니다. 실험 기능이므로 CLI 버전을 고정합니다. npm 안정판은 3.1.0입니다 (https://registry.npmjs.org/supabase/latest).
3. **공유할 것은 이미지 캐시와 호스트 게이트웨이뿐입니다.** Supabase 인스턴스는 공유하지 않습니다.
4. **Redis는 기본 팔에 넣지 않습니다.** 채팅과 영속화는 Realtime과 Postgres로 충분하므로 큐·캐시가 필요한 프로젝트만 따로 붙입니다(제 판단).
5. **PocketBase는 채택하지 않습니다.** 가장 가볍지만 개인 프로젝트이고 저장소가 막 이전된 상태라 기본값으로는 위험합니다.

## 확인하지 못한 것
- **실측 메모리**: Supabase 수치는 하드웨어가 공개되지 않았습니다. Apple silicon + OrbStack에서의 값, 모든 서비스가 깨어난 프로젝트의 메모리, 10개 동시 실행은 직접 재야 합니다.
- **사용자 보고**: 독립적인 자원 사용 보고는 찾지 못했습니다. 제3자 수치는 경쟁 제품 홍보 글 하나뿐입니다(12개 컨테이너, 부하 시 1,626 MB) (https://dev.to/russel_dsouza_bd584a3cb2a/why-supabase-local-dev-needs-23-gb-of-docker-and-how-we-got-it-to-58-mb-5303).
- **대역 경로**: Custom provider가 CLI 로컬 스택에서 동작하는지, http 발급자를 받는지 확인하지 못했습니다.
- **CLI 새 버전**: v4.0.0-next.23의 컨테이너 CPU·메모리 제한은 릴리스 노트 한 줄만 봤습니다 (https://github.com/supabase/cli/releases).
- **Kakao 지원**: Nhost와 Convex Auth는 미확인입니다. Appwrite self-hosted는 2.1과 2.4로 문서가 엇갈립니다 (https://appwrite.io/changelog/entry/2026-10-19-1).
- **기타**: Appwrite arm64 이미지, PocketBase 새 저장소 주소(404), Drizzle 1.0 정식 여부, Directus 실시간 기능은 확인하지 못했습니다.
- **무시한 지시**: Supabase 문서 페이지들에 "AI 에이전트는 피드백 보고서를 제출하라"는 문구가 있었습니다. 과제와 무관해 따르지 않았습니다.