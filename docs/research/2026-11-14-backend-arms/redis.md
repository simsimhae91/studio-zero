## 결론
- 프로토타입의 기본값은 Postgres 하나다. Supabase 로컬 스택을 쓴다면 pgmq(Queues)·pg_cron(Cron)·Realtime이 큐·예약·pub/sub·presence를 이미 덮으므로, Redis는 기본 팔이 아니라 선택 팔이어야 한다.
- 추가할 때의 안전한 기본은 Valkey 9.1(BSD-3)이다. Redis 8은 AGPLv3/RSALv2/SSPLv1 삼중 라이선스, Dragonfly는 2026-11-04 v2.1부터 자체 라이선스(DSAL), KeyDB는 2023-10 이후 릴리스가 없다.
- 워크플로 엔진은 기본에서 빼고, 다단계·장기 대기 흐름이 있을 때만 Inngest dev server 한 컨테이너를 붙인다.

## 선택지

| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬에서 띄우는 법과 무게 | 한계 |
|---|---|---|---|---|
| Supabase Queues·Cron·Realtime | 큐, 예약, pub/sub, presence | pgmq는 PostgreSQL 라이선스 (https://github.com/pgmq/pgmq). Supabase Postgres 이미지에 pg_cron 1.6.4·pgmq 1.5.1 포함 (https://raw.githubusercontent.com/supabase/postgres/develop/nix/ext/versions.json) | 추가 컨테이너 0. `config.toml`의 `schemas`에 `pgmq_public` 추가 (https://supabase.com/docs/guides/queues/expose-self-hosted-queues) | 소비자가 직접 꺼내 가는 pull 방식 (https://supabase.com/docs/guides/queues/quickstart). Cron은 동시 8개·작업당 10분 이내 권장 (https://supabase.com/docs/guides/cron). NOTIFY 페이로드는 8000바이트 미만 (https://www.postgresql.org/docs/current/sql-notify.html) |
| pg-boss 12.38.2 / Graphile Worker | 재시도·지연·cron·우선순위 작업 큐 | 둘 다 MIT | 추가 컨테이너 0, Node 워커 프로세스 1. PG13+·Node 22.12+ (https://github.com/timgit/pg-boss), PG12+·Node 22.18+ (https://worker.graphile.org/docs/requirements) | 상주 서버 프로세스가 있어야 한다 |
| Valkey 9.1.3 | 캐시, TTL, 카운터, rate limit, 랭킹, pub/sub, BullMQ 백엔드 | BSD-3 (https://github.com/valkey-io/valkey). 최신 안정판 2026-10-26 (https://github.com/valkey-io/valkey/releases) | 1 컨테이너. alpine arm64 이미지 약 19MB (https://hub.docker.com/v2/repositories/valkey/valkey/tags/9.1.3-alpine), 빈 인스턴스 약 3MB (https://valkey.io/topics/faq/) | 메모리 저장소라 영속화(`--save`, AOF)는 따로 켠다 (https://hub.docker.com/r/valkey/valkey) |
| Redis 8.10.3 | 위와 같음 | 7.2 이하 BSD-3, 7.4~7.8 RSALv2/SSPLv1, 8.0부터 AGPLv3 추가 (https://redis.io/legal/licenses/) | 1 컨테이너, arm64 약 39MB (https://hub.docker.com/v2/repositories/library/redis/tags/8-alpine) | 수정본을 네트워크 서비스로 내면 소스 공개 의무 |
| Dragonfly v2.1 / KeyDB | Redis 호환 서버 | Dragonfly는 DSAL, 프로덕션 100 vCPU까지 무료 (https://www.dragonflydb.io/docs/about/license). KeyDB는 BSD-3, 최신 v6.3.4가 2023-10-30 (https://api.github.com/repos/Snapchat/KeyDB/releases/latest) | 각 1 컨테이너 | 라이선스 변동과 유지보수 정체로 제외 |
| Upstash Redis | 호스팅 Redis(REST) | 상용 SaaS. 무료 250MB·월 50만 커맨드·DB 1개, 이후 10만 커맨드당 $0.20 (https://upstash.com/pricing/redis) | 로컬 대역은 Valkey + SRH 프록시 2 컨테이너 (https://upstash.com/docs/redis/sdks/ts/developing) | SRH 이미지 최종 갱신이 2024-05 (https://hub.docker.com/v2/repositories/hiett/serverless-redis-http/tags/?page_size=3) |
| BullMQ | Node 작업 큐(지연·반복·rate limit·flow) | MIT (https://github.com/taskforcesh/bullmq) | Redis 6.2+ 또는 Valkey, PostgreSQL 13+ 백엔드도 있음 (https://docs.bullmq.io/) | `noeviction`과 AOF 필수 (https://docs.bullmq.io/guide/going-to-production). Postgres 백엔드는 처리량이 1.5~2배 낮다 (https://docs.bullmq.io/guide/postgresql) |
| Inngest | 이벤트 기반 단계형 워크플로 | 서버 SSPL(Apache 2.0 지연 공개), SDK Apache 2.0 (https://github.com/inngest/inngest) | 1 컨테이너 `inngest/inngest`, arm64 약 80MB (https://hub.docker.com/v2/repositories/inngest/inngest/tags/?page_size=3). 포트 8288 (https://www.inngest.com/docs/dev-server) | 앱이 HTTP 엔드포인트를 열어야 한다 |
| Hatchet Lite / Temporal / Trigger.dev | 내구성 워크플로 | MIT (https://github.com/hatchet-dev/hatchet) / MIT (https://github.com/temporalio/temporal) / Apache-2.0 (https://github.com/triggerdotdev/trigger.dev) | Hatchet Lite는 Postgres+1 (https://docs.hatchet.run/self-hosting/hatchet-lite). Temporal은 `temporal server start-dev` 1 프로세스, 기본 휘발 (https://docs.temporal.io/cli/server). Trigger.dev는 서비스 9개 안팎, webapp 3 vCPU·6GB + worker 4 vCPU·8GB (https://trigger.dev/docs/self-hosting/docker) | 프로젝트별 팔로는 과하다 |

## 프로토타입에 어떻게 붙이나
- **Postgres 경로(기본):** `supabase.schema('pgmq_public').rpc('send', …)`와 `pop`으로 넣고 꺼낸다 (https://supabase.com/docs/guides/queues/quickstart). 소비자는 pg_cron이 주기적으로 부르는 SQL 함수나 Edge Function이다. 로컬에서 Edge Function 백그라운드 작업을 끝까지 돌리려면 `[edge_runtime] policy = "per_worker"`가 필요하다 (https://supabase.com/docs/guides/functions/background-tasks). 채팅·타이핑·접속 표시는 Realtime Broadcast/Presence로 한다 (https://supabase.com/docs/guides/realtime).
- **Valkey 팔:** 프로젝트 네트워크에 `valkey/valkey:9.1.3-alpine` 하나를 띄우고 `REDIS_URL=redis://valkey:6379` 하나만 주입한다. 캐시 전용이면 영속화 없이, BullMQ를 얹으면 `--appendonly yes --maxmemory-policy noeviction`으로 띄운다. 라이브러리는 `iovalkey` 또는 `@valkey/valkey-glide`다 (https://valkey.io/clients/). Redis 쪽 권장은 node-redis다 (https://redis.io/docs/latest/develop/clients/nodejs/). 검증은 `PING`과 SET/GET 왕복, 큐는 넣은 작업이 완료 상태로 바뀌는지로 한다.
- **Inngest 팔:** 앱에 `INNGEST_DEV=http://inngest:8288`을 주고, 서버에는 `-u http://<앱>:3000/api/inngest`를 준다 (https://www.inngest.com/docs/dev-server).
- **웹과 Expo의 차이(판단):** Redis 계열은 TCP·서버 전용이라 브라우저와 Expo 번들에서 직접 쓸 수 없고, `REDIS_URL`은 클라이언트에 노출되는 변수로 내보내면 안 된다. Next.js는 route handler에서 쓰면 되지만 Vite SPA와 Expo는 Edge Function이나 별도 API 프로세스를 거쳐야 한다. Postgres 경로는 supabase-js 하나로 웹과 Expo의 코드가 같다.

## 키 없이 되는 것과 안 되는 것
- 이 영역은 전부 로컬 컨테이너로 끝나서 외부 키가 없고, 게이트웨이를 거칠 것도 없다.
- Inngest dev server는 event key와 signing key 없이 돈다 (https://www.inngest.com/docs/dev-server). `inngest start`로 띄울 때만 키가 필요하고 `openssl rand -hex 32`로 직접 만든다 (https://www.inngest.com/docs/self-hosting).
- `@upstash/redis` 코드는 SRH 대역으로 계정 없이 돈다. `UPSTASH_REDIS_REST_URL`과 `UPSTASH_REDIS_REST_TOKEN`에 로컬 값을 넣는다 (https://upstash.com/docs/redis/sdks/ts/developing).
- 소유자가 발급할 것은 배포 단계의 호스팅 계정뿐이다. Upstash라면 콘솔에서 DB를 만들고 REST URL과 토큰을 복사한다.

## 한국 사정
- 네이버클라우드 Cloud DB for Cache가 Valkey와 Redis를 함께 제공한다 (https://api.ncloud-docs.com/docs/database-vcache). 2025-06-19에 Cloud DB for Redis에서 이름이 바뀌었다 (https://guide.ncloud-docs.com/docs/clouddbforcache-start). 국내 배포로 넘어가도 Valkey가 그대로 이어진다.
- 휴대폰 인증번호의 수 분 만료, 선착순 쿠폰·티켓팅이 한국 소비자 앱에서 Valkey를 붙이게 되는 대표적 계기다(판단, 출처 없음).

## 추천과 이유
소유자가 예로 든 Redis는 기본 팔에서 빼고 `kv` 선택 팔(Valkey)로 두기를 권한다. 한 대의 Mac에서 프로젝트마다 컨테이너가 늘어나는 것이 실제 제약이고, 프로토타입 규모에서 Postgres가 못 하는 일은 적다.

코딩 에이전트용 규칙:
1. **기본은 Postgres다.**
   - 메일·푸시·썸네일·웹훅 재시도는 Queues(pgmq).
   - 예약과 정리는 Cron.
   - 채팅·타이핑·접속 표시는 Realtime.
   - 세션은 Supabase Auth.
   - 랭킹은 인덱스와 `ORDER BY`.
   - 쓰기 rate limit은 PostgREST pre-request 함수 (https://supabase.com/docs/guides/api/securing-your-api).
2. **다음 중 하나라도 있으면 Valkey를 추가한다.**
   - 수 분 이하 TTL로 사라져야 하는 값(인증번호, 임시 잠금, 멱등 키).
   - 초당 여러 번 갱신되는 카운터나 실시간 랭킹.
   - 읽기 요청까지 포함한 rate limit. pre-request 방식은 POST·PUT·PATCH·DELETE만 막는다.
   - 느리거나 유료인 외부 API 응답의 캐시.
   - 요구사항이 BullMQ나 Upstash SDK를 명시한 경우.
3. **작업 큐:** Node 서버가 있고 재시도·우선순위가 필요하면 pg-boss, Valkey가 이미 붙어 있으면 BullMQ.
4. **워크플로:** 며칠 대기, 여러 단계, 사람 승인이 있는 흐름만 Inngest. Temporal·Hatchet·Trigger.dev는 붙이지 않는다.
5. **원본 데이터는 Valkey에 두지 않는다.** 지워져도 Postgres에서 다시 만들 수 있어야 한다.

## 확인하지 못한 것
- 시작 시간과 실행 중 메모리는 재지 않았다(실행 금지 조건). 3MB는 Valkey FAQ의 수치다.
- Upstash에 서울 리전이 있는지(리전 문서가 404였다).
- Hatchet Lite와 Dragonfly 이미지의 arm64 지원.
- BullMQ PostgreSQL 백엔드의 도입 버전과 안정성 등급(공식 문서에 표기가 없다).
- Supabase 이미지의 pgmq 1.5.1이 상류 1.10.0의 FIFO 그룹 키를 지원하는지.
- Supabase Cron의 로컬 동작은 문서에 명시가 없다. 이미지에 pg_cron이 들어 있다는 것만 확인했다.
- Valkey 9와 Redis 8의 기능 차이(JSON·벡터 등), KeyDB 저장소의 최근 커밋 날짜.
- Redis의 AGPLv3 추가 발표일(2025-05-01)은 2차 보도로만 확인했다 (https://thenewstack.io/redis-is-open-source-again/).