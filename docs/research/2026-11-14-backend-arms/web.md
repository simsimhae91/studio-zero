## 결론
1. 인증·DB 바깥의 백엔드 기능 대부분은 Supabase 로컬 스택이 이미 갖고 있습니다. 파일 저장과 이미지 변환, 메일 캡처, 서버 함수, 예약 작업, 한국어 검색이 여기에 들어갑니다. 그래서 대부분의 arm은 이 스택의 서비스를 켜고 끄는 일이 됩니다. 별도 컨테이너는 오류 추적(GlitchTip)과 속도 제한(Valkey) 정도만 둡니다.
2. LLM은 호스트 게이트웨이(OpenAI 호환)를 AI SDK로 부르게 하고, 키가 없을 때는 mock 스트림으로 대신합니다.
3. MinIO는 아카이브되었으니 쓰지 않습니다. 배포는 Supabase Cloud(서울)와 Vercel(icn1) 조합이 로컬 설정을 가장 많이 그대로 가져갑니다.

## 선택지
| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬 기동과 무게 | 한계 |
|---|---|---|---|---|
| Supabase 로컬 스택 | Storage와 이미지 변환(imgproxy), Mailpit, Edge Functions, Cron, PGroonga | 자가 호스팅 Compose에 imgproxy가 들어 있음 (https://supabase.com/docs/guides/storage/serving/image-transformations) | `supabase start`. Postgres 외 서비스 13개는 `-x`로 뺄 수 있음. 전부 켜면 RAM 7GB 이상 권장 (https://supabase.com/docs/reference/cli/supabase-start) | 기본 포트가 같아서 한 머신에 한 프로젝트만 뜸. 여러 개는 따로 설정해야 함 (https://supabase.com/docs/guides/local-development/cli/getting-started.md). 호스팅에서 이미지 변환은 Pro부터 |
| MinIO | S3 | AGPLv3. 2026-04-25 아카이브, 소스만 배포 (https://github.com/minio/minio) | 직접 빌드해야 함 | 업데이트 없음 |
| RustFS | S3 | Apache 2.0, `rustfs/rustfs:1.0.5` (https://github.com/rustfs/rustfs) | 컨테이너 1개, 포트 9000/9001 | GA 여부 표기 없음, 일부 기능은 Preview |
| Garage | S3 | AGPLv3 (https://github.com/deuxfleurs-org/garage) | RAM 1GB 기준 (https://garagehq.deuxfleurs.fr/) | 공식 이미지 이름 확인 못 함 |
| Cloudflare R2 / Images | 호스팅 저장과 변환 | 상용 서비스 | `wrangler dev`가 로컬 저장소로 흉내 냄 (https://developers.cloudflare.com/r2/api/workers/workers-api-usage/) | R2 무료분은 10GB, Class A 100만, Class B 1,000만, 송신 무료 (https://developers.cloudflare.com/r2/pricing). 변환은 월 5,000건 무료 (https://developers.cloudflare.com/images/pricing/) |
| Mailpit | 메일 캡처 | MIT, arm64 이미지 있음 (https://github.com/axllent/mailpit) | 컨테이너 1개, SMTP 1025 / UI 8025 | 실제로 보내지는 않음 |
| Resend / SES / Postmark | 실제 발송 | 상용 서비스 | 없음 | Resend 무료는 월 3,000통·일 100통 (https://resend.com/pricing.md). SES는 $0.10/1,000통, 샌드박스로 시작 (https://aws.amazon.com/ses/pricing/). Postmark 무료는 월 100통 (https://postmarkapp.com/pricing) |
| PGroonga | 한국어 전문 검색 | Supabase 확장 (https://supabase.com/docs/guides/database/extensions/pgroonga) | 추가 컨테이너 없음 | 기본 토크나이저가 TokenBigram이라 형태소 분석이 아님 (https://pgroonga.github.io/reference/create-index-using-pgroonga.html) |
| Meilisearch | 오타 허용 검색 | CE는 MIT, EE는 BUSL이며 EE 전용 기능은 샤딩뿐 (https://meilisearch.com/docs/resources/self_hosting/enterprise_edition) | 컨테이너 1개, 포트 7700 | DB와 동기화하는 코드가 필요 |
| Typesense | 같음 | GPL-3.0, 빈 서버 메모리 약 30MB (https://github.com/typesense/typesense) | 컨테이너 1개, 포트 8108 | 한국어는 ICU 분할 (https://typesense.org/docs/guide/locale.html) |
| PostHog | 분석, 플래그 | 자가 호스팅은 MIT지만 4vCPU/16GB가 필요하고 공식 지원 대상이 아님 (https://posthog.com/docs/self-host) | 무거움 | Cloud 무료분은 월 100만 이벤트 |
| Plausible CE / Umami | 웹 분석 | Plausible은 AGPLv3, Postgres와 ClickHouse 필요 (https://github.com/plausible/analytics). Umami는 PostgreSQL 12.14 이상 (https://docs.umami.is/docs/install) | Umami 1개와 DB | Umami 라이선스는 공식 문서에서 확인 못 함 |
| Sentry / GlitchTip | 오류 추적 | Sentry 자가 호스팅은 FSL, 4코어·16GB에 스왑 16GB (https://develop.sentry.dev/self-hosted/). GlitchTip은 512MB 권장, all-in-one이면 256MB, Valkey는 선택 (https://glitchtip.com/documentation/install) | GlitchTip 1개와 Postgres | Sentry 무료 플랜은 오류 5k건 (https://sentry.io/pricing/) |
| Unleash | 기능 플래그 | AGPL-3.0, 포트 4242 (https://github.com/Unleash/unleash) | 1개와 Postgres | React Native SDK 확인 못 함 |
| Valkey / Redis 8 + SRH | 속도 제한 | Valkey는 BSD-3 (https://github.com/valkey-io/valkey). Redis 8은 RSALv2, SSPLv1, AGPLv3 중 택일 (https://redis.io/legal/licenses/). SRH가 Upstash REST를 흉내 냄 (https://upstash.com/docs/redis/sdks/ts/developing) | 2개 | 아래 확인 목록 참고 |
| LiteLLM | LLM 게이트웨이 | MIT, `enterprise/` 디렉터리만 별도 라이선스 (https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE) | 1개 | 없음 |

## 프로토타입에 어떻게 붙이나
- **주소.** 컨테이너 안의 서버 코드는 `host.docker.internal`로 호스트에 닿습니다 (https://docs.orbstack.dev/docker/network). 반면 Mac의 브라우저는 `127.0.0.1:54321`을 씁니다. 그래서 서버용 URL과 클라이언트용 URL을 따로 주입해야 합니다. 클라이언트 쪽 변수는 `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_` 접두어를 붙입니다.
- **키.** `sb_publishable_…`는 클라이언트에, `sb_secret_…`는 서버에만 둡니다.
- **CLI v3 변화.** 2026-11-02에 나온 v3는 명령이 기본으로 로컬을 향합니다. `[inbucket]` 설정은 `[local_smtp]`로 이름을 바꾸지 않으면 시작이 실패합니다 (https://supabase.com/changelog/supabase-cli-v3).
- **저장소.** `getPublicUrl`과 `createSignedUrl`에 `transform` 옵션을 넘기면 변환된 이미지를 받습니다. 엔드포인트는 `/storage/v1/render/image/public/…`입니다 (https://supabase.com/docs/guides/storage/serving/image-transformations).
- **메일.** Auth 메일은 Mailpit으로 갑니다. 앱이 보내는 메일도 SMTP 1025로 보내게 하고, 검증은 Mailpit REST API로 받은편지함을 읽어서 합니다.
- **검색.** `create extension pgroonga with schema extensions;`로 켜고 `&@~` 연산자로 찾습니다.
- **서버 함수.** Next.js는 route handler를 씁니다. Vite와 Expo는 Edge Functions(`/functions/v1/*`)를 공용으로 씁니다. 비밀값은 `supabase/functions/.env`에 두고 `Deno.env.get`으로 읽습니다 (https://supabase.com/docs/guides/functions/secrets). 호스팅 Free 플랜은 벽시계 150초, CPU 2초 제한이 있습니다 (https://supabase.com/docs/guides/functions/limits). Hono는 Node, Deno, Workers, Vercel에서 돕니다 (https://hono.dev/docs/).
- **예약 작업.** Supabase Cron(pg_cron)은 최소 1초 간격으로 돌고 HTTP 호출도 할 수 있습니다 (https://supabase.com/docs/guides/cron).
- **LLM.** 서버에서 `createOpenAICompatible({baseURL, apiKey})`로 프로바이더를 만들고 `streamText`로 스트리밍합니다 (https://ai-sdk.dev/providers/openai-compatible-providers). 클라이언트는 `@ai-sdk/react`의 `useChat`을 씁니다. Expo는 SDK 52 이상, `expo/fetch`, structuredClone과 TextEncoder 스트림 폴리필이 필요하고, API route를 돌릴 서버가 따로 있어야 합니다 (https://ai-sdk.dev/docs/getting-started/expo).
- **주입할 환경변수.** `SUPABASE_URL`, 공개키·비밀키, `SMTP_HOST/PORT`, `LLM_BASE_URL`, `LLM_API_KEY`(게이트웨이가 발급하는 프로젝트별 토큰), `SENTRY_DSN`, `UPSTASH_REDIS_REST_URL/TOKEN`.

## 키 없이 되는 것과 안 되는 것
- **키 없이 되는 것.** Supabase 로컬 스택 전부, Mailpit, `wrangler dev`의 R2, Meilisearch, Typesense, GlitchTip, Unleash(기본 개발용 토큰이 들어 있음), Valkey와 SRH는 키 없이 돕니다.
- **LLM 대역.** `ai/test`의 `MockLanguageModelV4`와 `simulateReadableStream`으로 스트리밍까지 흉내 냅니다 (https://ai-sdk.dev/docs/ai-sdk-core/testing).
- **흉내 낼 수 없는 것.** 실제 수신함까지 메일이 도착하는 일과 실제 모델이 내는 출력입니다.
- **소유자가 직접 발급해야 하는 것.**
  - Resend: 계정과 API 키를 만들고 도메인을 DNS로 인증해야 합니다. `delivered@resend.dev` 같은 테스트 주소로 보내도 할당량이 줄어듭니다 (https://resend.com/docs/dashboard/emails/send-test-emails).
  - SES: 리전마다 샌드박스로 시작합니다. 운영 권한은 Trust & Safety 팀이 심사합니다 (https://docs.aws.amazon.com/console/ses/sandbox).
  - 그 밖에 LLM 프로바이더 키(호스트 게이트웨이에만 넣음), PostHog·Sentry 프로젝트 키, Supabase·Cloudflare 계정이 필요합니다.

## 한국 사정
- **검색.** Postgres 내장 전문 검색에는 한국어 스테머가 없습니다. Snowball 목록에 한국어가 없기 때문입니다 (https://snowballstem.org/algorithms/).
  - PGroonga는 바이그램으로 부분 일치를 줍니다.
  - 형태소 분석이 필요하면 Meilisearch를 씁니다. lindera KO 사전을 씁니다 (https://www.meilisearch.com/docs/learn/resources/language).
- **리전.**
  - Supabase: 서울 `ap-northeast-2`가 있습니다 (https://supabase.com/docs/guides/platform/regions).
  - Vercel: 서울 `icn1`이 있지만 함수의 기본 리전이 `iad1`이라 직접 바꿔야 합니다 (https://vercel.com/docs/regions).
  - Fly.io: 서울이 없고 가장 가까운 곳이 도쿄 `nrt`입니다 (https://docs.fly.io/reference/regions).
- **광고 메일 규정.** 정보통신망법 제50조의 광고 메일 규정은 확인하지 못했습니다. 법제처 사이트가 오늘(11/13 21시~11/14 21시) 점검 중이었습니다.

## 추천과 이유
1. **기본 arm은 Supabase 로컬 스택입니다.** `-x logflare,vector,supavisor`로 메모리를 줄입니다. 포트가 기본값끼리 부딪히므로 빌더가 프로젝트마다 포트 세트를 정해 줘야 합니다.
2. **S3 서버는 따로 두지 않습니다.** 꼭 필요할 때만 RustFS(Apache 2.0)를 씁니다. MinIO는 업데이트가 끊겼습니다.
3. **메일은 로컬에서 Mailpit, 배포 후에는 Resend입니다.** 무료분이 있고 API가 단순합니다.
4. **검색은 PGroonga로 시작합니다.** 컨테이너가 하나도 늘지 않습니다. 오타 허용이나 형태소 분석이 필요할 때 Meilisearch를 더합니다.
5. **오류 추적은 GlitchTip입니다.** 256~512MB로 가볍고 Sentry SDK를 그대로 씁니다. 배포 후에는 DSN만 Sentry SaaS로 바꾸면 됩니다.
   - Sentry와 PostHog의 자가 호스팅은 16GB급이라 제외합니다.
   - 분석은 키가 있을 때 PostHog Cloud를 붙입니다.
6. **속도 제한은 Valkey와 SRH에 `@upstash/ratelimit`을 얹습니다.** 같은 코드가 배포 후 Upstash에서도 돌게 하려는 선택입니다.
7. **배포는 Supabase Cloud(서울)와 Vercel(icn1)입니다.**
   - Supabase Free 플랜은 프로젝트 2개, 1주일 비활성 시 일시정지, 이미지 변환 미포함입니다 (https://supabase.com/pricing).
   - Vercel Hobby의 cron은 하루 1회, 시간 단위 정밀도라서 예약 작업은 Supabase Cron에 둡니다 (https://vercel.com/docs/cron-jobs/usage-and-pricing).
   - Cloudflare는 Next.js에 대해 아직 베타인 vinext를 권하고 있어 옮겨 가는 비용이 큽니다 (https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/).
   - 배포 후에는 호스트 게이트웨이가 없으니 `LLM_BASE_URL`과 키를 배포 환경의 비밀값으로 옮겨야 합니다.

## 확인하지 못한 것
- Supabase 로컬 스택의 라이선스, 실제 시작 시간, Apple silicon에서의 실측 메모리.
- 로컬 S3 엔드포인트 경로.
- `@upstash/ratelimit`이 SRH 위에서 실제로 동작하는지.
- RustFS의 GA 여부, Garage 공식 이미지 이름.
- GlitchTip·Umami 라이선스(공식 문서에서 확인하지 못함).
- PostHog의 플래그 무료분, SES 샌드박스 수치.
- Resend를 도메인 인증 없이 쓸 때 수신자 제한.
- 정보통신망법 제50조 원문, 네이버·다음 메일 도달률, 분석 데이터의 국외 이전 요건.
- 조사 도중 웹 검색 예산이 바닥나서 Sentry Spotlight 같은 일부 항목은 덜 확인했습니다.