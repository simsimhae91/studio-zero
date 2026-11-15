# 작은 서비스 여럿을 어디에 올릴까 (2026-11-15 조사)

Opus 서브에이전트가 제공자 자신의 가격·약관·문서 페이지를 2026-11-15에 읽고 보고한 것을 줄였다. 전제: 한국의 한 사람이 작은 상업 서비스를 여럿 만든다(웹 화면 + 계정·DB·파일이 있는 백엔드). 대부분은 안 될 것이므로 아무도 안 올 때의 비용이 0에 가까워야 하고, 에이전트가 토큰만으로 배포·되돌리기·로그를 할 수 있어야 한다. 약관과 가격은 바뀐다: 소유자에게 값을 말하기 전에 그 페이지를 다시 읽는다.

## 무료 구간과 상업 이용

| 제공자 | 무료 구간 | 무료에서 상업 이용 |
|---|---|---|
| Vercel Hobby | 호출 100만, 전송 100GB, 프로젝트 200개, 로그 1시간, 되돌리기는 직전 배포까지만 | **안 됨.** 약관 4조(2026-10-19 개정): "You shall only use the Services under a Hobby plan for your personal or non-commercial use." 3조는 Hobby 콘텐츠를 AI 학습에 쓸 수 있다고 함 |
| Cloudflare Workers Free | 하루 10만 요청, 요청당 CPU 10ms, Worker 100개. D1 10개(각 500MB), R2 10GB, Durable Objects SQLite 5GB. Containers는 유료만 | **됨.** Self-Serve Agreement(2025-09-12)에 비상업 조항 없음. 단 2.2.1(h): 무료 구간의 사이트에서 카드 정보를 "처리하거나 수집"하면 안 됨(결제사의 창을 쓰면 카드 정보는 그쪽에 들어간다) |
| Supabase Free | 활성 프로젝트 2개, 1주일 안 쓰면 일시정지. DB 500MB, MAU 5만, 백업 없음 | 비상업 조항 없음 |
| Fly.io | 무료 구간 없음. 단 개인 조직의 월 청구가 $5 미만이면 면제 | 해당 없음 |
| Neon Free | 프로젝트 100개, 0으로 줄어듦, 브랜치 10개, 기록 6시간 | 언급 없음 |
| Railway Free | 월 $1 크레딧, 커스텀 도메인 0개 | 언급 없음 |
| Render Free | 15분 쉬면 잠듦, 무료 Postgres는 30일 뒤 사라짐 | "production에 쓰지 말라" |
| Netlify Free | 월 300 크레딧(운영 배포 1회 15) | 언급 없음 |
| Firebase Spark | Firestore 1GiB, Auth MAU 5만. App Hosting과 Functions는 Blaze 필요 | 조항 없음 |

## 가장 낮은 유료 단계

| 제공자 | 값 | 서비스 1개 | 서비스 20개 |
|---|---|---|---|
| Cloudflare | 계정당 $5 | $5 | **$5** + 사용량 |
| Vercel Pro | 자리당 $20($20 크레딧 포함), 프로젝트 무제한 | $20 | $20 + 사용량 |
| Supabase Pro | 조직당 $25(Micro 1대 포함), 프로젝트마다 Micro 약 $10 | $25 | 약 $215 |
| Fly | shared-cpu-1x 256MB가 30일 $2.19, 멈춘 머신은 디스크만 | 약 $2~3($5 미만 면제) | 늘 켜 두면 약 $44, 쉴 때 멈추게 하면 약 $3~6 |
| Railway Hobby | $5 + 사용량 | $5 | 늘 켜 두면 약 $50+ |
| Render | 인스턴스 약 $7 + Postgres 약 $6 | 약 $13 | 약 $260 |
| Neon Launch | 최소 없음, 사용량 | 사용량 | 사용량 |

## 서울

- **Cloudflare:** 서울 PoP. 조사한 기계(한국)에서 cloudflare.com, 무료 pages.dev 사이트 모두 `colo=ICN`. D1 위치 힌트는 "apac"까지만(도시 미상). 무료 구간의 **커스텀 도메인**이 한국 통신사에서 ICN으로 가는지는 확인하지 못함(반대 사례는 풍문뿐).
- **Vercel:** `icn1` 컴퓨트 리전. 자체 DB 없음.
- **Supabase:** ap-northeast-2(서울) DB.
- **Firebase:** Firestore는 서울(asia-northeast3), App Hosting은 서울 없음.
- **Fly:** 도쿄(`nrt`)가 가장 가깝고 한국 리전 없음.
- **Railway, Render, Neon:** 싱가포르뿐.
- 그 기계에서 잰 TLS 핸드셰이크: 서울 20ms, 도쿄 85~90ms, 싱가포르 158ms, us-east-1 405ms.

## 에이전트가 돌릴 수 있는 명령 (토큰만으로, 브라우저 로그인 없이)

| 제공자 | 인증 | 배포 | 목록·되돌리기 | 로그 | 비밀 넣기 | 도메인 |
|---|---|---|---|---|---|---|
| Cloudflare | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | `wrangler deploy` | `wrangler deployments list --json`, `wrangler rollback <ver> --message m` | `wrangler tail --format json --status error`(실시간만) | `printf %s "$V" \| wrangler secret put K` | `[[routes]] custom_domain=true`. **DNS가 Cloudflare에 있어야 함** |
| Vercel | `VERCEL_TOKEN` 등 | `vercel deploy --prod` | `vercel list`, `vercel rollback <url>` | `vercel logs --environment production --query 'level:error' --since 1h --json` | `vercel env add K --environment production < file` | `vercel domains add` |
| Fly | `FLY_API_TOKEN` | `fly deploy` | `fly releases --image --json`, 되돌리기는 `fly deploy --image <옛 이미지>` | `fly logs --no-tail --json` | `fly secrets import`(stdin) | `fly certs add`(확인 못 함) |
| Supabase | `SUPABASE_ACCESS_TOKEN`, `--yes` | `supabase db push --yes`, `functions deploy` | 백업·PITR 복원뿐 | 확인 못 함 | `supabase secrets set`(stdin 여부 확인 못 함) | 유료 추가 기능 |
| Railway | `RAILWAY_TOKEN` | `railway up --detach` | 되돌리기는 대시보드만 | `railway logs -n 100` | `railway variable set` | `railway domain` |
| Render | `RENDER_API_KEY` | git 또는 이미지만(로컬 폴더 안 됨) | API | | API | API |

## 남는 데이터

- **Cloudflare:** 볼륨 없음(Containers 2026-04-13 GA, 디스크는 휘발). SQLite는 D1(시점 복원 무료 7일, 유료 30일) 또는 Durable Object.
- **Fly:** 볼륨 GB당 $0.15, 하루 한 번 스냅샷 5일 보관. SQLite 파일을 쓰는 Node 서버의 자연스러운 집.
- **Supabase:** 무료는 백업 없음. Pro는 하루 한 번 7일. PITR은 월 약 $100.
- **Neon:** 무료 6시간 기록.

## 미리 보기

Vercel은 푸시마다 미리 보기. Cloudflare는 버전마다 주소(`wrangler versions upload --preview-alias staging`), D1 브랜치는 없음. Supabase 브랜치는 시간당 $0.01344(월 약 $10). Neon 브랜치 10개 무료.

## 2025~2026의 변화

- Deno 팀이 Cloudflare로(2026-10-09), Deno Deploy는 2027-04 종료.
- Cloudflare 2026-02-20 장애 6시간 7분. 새 프로젝트는 Pages 말고 Workers를 쓰라고 문서가 말함.
- Railway는 2026-05-19에 Google Cloud가 계정을 정지해 약 8시간 장애. 무료 구간 축소.
- Supabase us-east-2 장애 2026-02-12, 3시간 42분.
- Netlify는 2025-09-04에 크레딧 요금제로.
- Fly의 무료 허용량은 2024-10에 끝남.

## 조사자의 권고와 내 입장

조사자: 기본은 **Cloudflare Workers + D1**(상업 이용이 무료, 전체가 $0 또는 $5, 서울에서 실행, 토큰 CLI가 전부 됨). 위험: D1의 위치가 "apac"까지만, Workers는 완전한 Node가 아님, 무료 CPU 10ms, 커스텀 도메인은 DNS를 옮겨야 함, 카드 조항 때문에 결제는 결제사의 창으로. 대안은 **Vercel Pro + Supabase Pro**(둘 다 서울, 로그인 내장, CLI가 가장 좋음; 첫 손님 전에 월 $45, 프로젝트마다 약 $10 더). Fly(도쿄)는 SQLite 파일을 쓰는 Node 서버의 자리.

내 입장(이 저장소의 `plugin/skills/backend/SKILL.md`에 적은 것): 여럿을 만들어 대부분이 안 되는 것을 전제로 하면 쉬는 비용이 0인 쪽이 기본이어야 한다. 그래서 새 제품의 기본은 Worker + D1, 계정·실시간·네이티브 SDK가 중심이면 Supabase, 이미 Node 서버이거나 오래 떠 있는 프로세스가 필요하면 컨테이너. 이미 있는 프로젝트는 가진 것을 그대로 쓴다. 같은 날 이 Mac에서 wrangler 4.162로 Worker + D1을 계정 없이 띄워 봤다(설치 10초·216MB, 마이그레이션 1.4초, 주어진 포트에서 응답, 띄운 프로세스 번호로 끄면 남는 것 없음).

## 확인하지 못한 것

D1 "apac"의 실제 도시, 무료 커스텀 도메인의 한국 내 경로, Supabase 커스텀 도메인 값과 유료 프로젝트 일시정지 가능 여부, Render 가격(페이지가 안 열려 Render의 글에서), Railway·Netlify·Firebase App Hosting의 명령 되돌리기, `supabase secrets set`의 stdin, 지난 로그를 명령으로 가져오기(Cloudflare는 실시간만).

## 출처 (모두 2026-11-15에 읽음)

vercel.com/legal/terms, /pricing, /docs/plans/hobby, /docs/regions, /docs/cli · cloudflare.com/terms · developers.cloudflare.com/workers/platform/{pricing,limits}, /workers/wrangler/commands, /workers/configuration/{routing/custom-domains,previews}, /d1/{configuration/data-location,platform/pricing,platform/limits}, /durable-objects/reference/data-location, /containers · blog.cloudflare.com/cloudflare-outage-february-20-2026 · supabase.com/pricing, /docs/guides/platform/{regions,billing-on-supabase,backups,custom-domains}, /docs/guides/deployment/branching, /docs/guides/auth/social-login/auth-kakao · docs.fly.io/about/pricing, /reference/regions, /flyctl, /volumes/snapshots · neon.com/pricing · railway.com/pricing, docs.railway.com · render.com/docs/{free,regions,cli,rollbacks} · netlify.com/pricing · firebase.google.com/pricing, /docs/app-hosting, /docs/firestore/locations · deno.com/blog/cloudflare · planetscale.com/pricing · turso.tech/pricing
