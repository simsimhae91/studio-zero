# 에이전트가 만든 것을 내보낼 때 무엇이 깨졌나, 무엇으로 막나 (2026-11-15 조사)

Opus 서브에이전트가 2026-11-15에 1차 자료를 읽고 보고한 것을 줄였다. 표시: **[P]** 제공자 자신의 문서나 연구자 본인의 공개, **[A]** 당사자의 자기 사고 보고, **[S]** 전해 들은 것(기사, 요약).

## 빌더와 플랫폼이 배포 전후에 하는 것

- **Lovable [P]:** 게시 창이 열릴 때 빠른 검사(RLS와 접근 규칙, 스토리지 규칙, 치명적 npm CVE, 인증 없는 MCP). 깊은 검사는 수동이고 코드를 읽는 유일한 검사. 치명적 발견이 게시를 막는 것은 관리자가 켜야 함. CVE-2025-48757을 찾은 연구자: 그 검사는 "정책이 있는지만 보고, 맞는지는 안 본다" [P].
- **Bolt [P, 2026-07-30]:** "보안 감사 실행"은 누르는 단추.
- **v0 [P, 2025-08-04]:** 클라이언트 코드의 비밀과 `NEXT_PUBLIC_` 오용을 본다. 2025년 7월에 "안전하지 않은 배포 1만 7천 건 차단".
- **Replit [P]:** 2025-07-21부터 개발과 운영 DB가 분리. 게시할 때 실제 DB를 비교해 SQL을 만들고, 행을 잃을 수 있으면 주황색. 승인한 마이그레이션은 "되돌릴 수 없다". 문서: 이름 바꾸기 대신 새 열을 고르는 것이 "운영 데이터를 잃는 가장 흔한 길". 체크포인트 되돌리기는 운영 데이터를 되돌리지 않는다.
- **Base44 [P]:** 검사는 수동. 게시 창은 "경고하지만 막지 않는다".
- **Firebase Studio [P]:** 2026-06-22 신규 가입 중단, 2027-03-22 종료.
- **Netlify Database [P, 2026-09-01]:** 운영 게시마다 백업 뒤 마이그레이션. 배포를 되돌려도 DB는 안 돌아온다.
- **Vercel [P]:** Deployment Checks가 필수 검사를 통과할 때까지 운영 빌드를 붙든다(Force Promote로 넘어갈 수 있음). 즉시 되돌리기는 환경 변수와 DB를 되돌리지 않는다. Vercel MCP는 "사용자 계정과 같은 권한"이고 배포할 수 있다. 플러그인의 기본 훅은 맥락만 넣고 아무것도 막지 않는다.
- **Supabase MCP [P]:** 읽기 전용 모드, 프로젝트 범위. 파괴적 SQL과 과금되는 생성에 확인을 묻지만 스스로 "가드레일이지 보장이 아니다"라고 함.
- **Cloudflare Code Mode MCP [P]:** OAuth 범위 줄이기가 유일한 통제.

**아무도 보지 않는 것:** RLS 정책이 뜻으로 맞는지(한 사람이 다른 사람의 행을 읽는지), 데이터 마이그레이션의 뜻, 백업이 실제로 되살아나는지, 배포 뒤 살아 있는 제품의 동작, 지출.

## 현장에서 깨진 것과, 잡았을 기계 검사

| 깨진 것 | 수치 | 잡는 검사 |
|---|---|---|
| Lovable RLS 노출 [P, 2025-05-29] | 1,645개 앱 중 170개(10.3%), 303개 끝점. 쓰기 권한으로 `payment_status`를 "paid"로 바꿈 | anon 키와 세션 없이 모든 테이블을 읽고 써 본다 |
| Base44 인증 우회 [P, Wiz 2025-07-29] | 인증 없는 가입·검증 끝점 | 세션 없이 모든 경로를 훑는다 |
| 내보낸 코드 속 비밀 [P] | Escape: 앱 5,600개에서 비밀 400개+, 번들 속 Supabase 서비스 키. RedHunt: 13만 사이트 중 약 2만 6천(5곳 중 1곳). GitGuardian: Claude Code가 도운 커밋의 유출률 3.2%(기준 1.5%) | 소스가 아니라 **빌드된 번들**을 훑는다. JWT를 풀어 `role=service_role`을 본다 |
| 에이전트가 운영 데이터를 지움 | Replit/SaaStr: 임원 1,206·회사 1,196건, 개발과 운영이 한 DB [S]. DataTalks.Club: `terraform destroy`가 스냅샷까지 지움, 약 24시간 뒤 AWS 지원이 194만 행 복구 [A]. PocketOS: Railway 볼륨과 백업이 9초 만에 삭제, 쓸 수 있는 백업은 석 달 전 것 [S] | 에이전트가 파괴적 운영 자격을 갖지 않는다. 백업은 그 자원의 수명 밖에. 되살리기 연습 |
| 파괴적 마이그레이션 | Replit의 이름 바꾸기 함정 [P]. `db push --force-reset`이 테이블 87개 삭제 [S] | 마이그레이션 종류를 가르고 사본에서 미리 돌린다 |
| 폭주하는 지출 | METR: 노출된 키로 약 $60만어치 토큰 [A] | 한도에서 멈추는 예산, 키별 상한 |
| 미리 보기 유출 | 측정된 연구 없음 | 미리 보기는 보호하고 짧게 |

## 작은 제품의 마이그레이션

- **넓히고 나서 줄이기**(expand/contract)가 코드 되돌리기를 안전하게 한다: Vercel, Cloudflare, Netlify의 되돌리기는 데이터를 건드리지 않는다 [P].
- Neon의 에이전트 스킬 [P]: "운영의 브랜치에서, 운영 같은 데이터로 마이그레이션을 시험하라."
- Supabase [P]: 개발·운영 프로젝트 분리, CLI 마이그레이션, 한 달에 한 번 되살리기 연습. 스토리지 객체는 백업에 없다. 미리 보기 브랜치는 운영 데이터 없이 시작.
- Prisma [P]: 6.15는 에이전트가 `migrate reset`을 돌리기 전에 명시적 동의를 요구. 8은 reset을 없애고 연산을 더하기/넓히기/데이터/파괴로 가른다. 원칙: 위험한 행동은 시작조차 못 하게.
- 사실상 앞으로만 간다: 되돌리려면 반대 변경을 게시한다 [P, Replit].

## 내보낸 뒤 확인

- Vercel Rolling Releases는 Pro 한 프로젝트·Enterprise만, 지표에 따른 자동 되돌리기는 문서에 없음. Cloudflare 점진 배포도 자동 되돌리기 없음, 최근 100개 버전으로 되돌릴 수 있고 바인딩은 안 돌아감 [P].
- 살아 있는 빌드의 신원: Vercel은 `VERCEL_GIT_COMMIT_SHA`, Cloudflare는 버전 메타데이터 바인딩 [P].
- **한 사람의 서비스에 현실적인 것:** 이 트래픽에서 카나리는 뜻이 없다. 검사 뒤에 승격을 붙들고, 배포 주소를 걸어 보고, 승격하고, 운영 주소가 의도한 SHA를 말하는지 보고, 전용 테스트 계정으로 핵심 주장을 운영에서 돌리고, 30~60분 오류를 보고, 실패하면 자동으로 되돌린다.

## 에이전트가 읽을 수 있는 관측

- Sentry 무료 [P]: 오류 5천, 사용자 1명, 30일. 가격표는 "API: No", "MCP: Yes".
- GlitchTip [P]: 호스팅 무료 월 1천 건, 또는 직접 띄움.
- PostHog [S]: 월 약 100만 이벤트 무료. MCP에 읽기 전용 헤더 [P].
- Cloudflare Web Analytics [P]: 무료, 쿠키 없음, GraphQL API.
- Umami Hobby는 API 없음, Plausible은 무료 없음 [P].
- 한국 [S]: 개인정보 보호법 30조 1항 7호(자동 수집 장치의 설치·운영·거부를 처리방침에), 2024-01-31 개인정보위(개인을 식별하지 않는 행태정보는 동의 없이 처리 가능, 투명하게), 2023-09-15부터 국외 보관은 처리방침에 나라와 받는 자를 밝히면 됨. 실무: 쿠키 없는 분석 + 처리자와 나라를 적은 방침. 세션 리플레이와 사용자에 묶인 이벤트는 개인정보.

## 운영을 만지는 에이전트에 대한 2026년의 글

- Anthropic auto mode [P, 2026-03-25]: "운영 배포 실행", 강제 푸시, 대량 삭제를 기본으로 막는다. 실제 과한 행동의 17%를 놓치며 "중요한 인프라에서 사람의 검토를 대신하지 못한다".
- OpenAI Codex [P]: 네트워크는 기본으로 꺼짐, 파괴적이라고 표시한 MCP 도구는 늘 승인.
- Vercel "Agent responsibly" [P, 2026-03-30]: "초록색 CI는 더는 안전의 증거가 아니다."
- Sentry [P, 2026-05-26]: 에이전트는 초안 PR을 열고 사람이 합친다.

## 조사자가 권한 관문 8줄 (값진 순)

1. **접근 탐침.** 공개 키만으로 모든 테이블·버킷·함수에 읽기·쓰기·지우기를, 세션 없이 그리고 B로서 A의 행에.
2. **빌드 산출물 훑기.** 번들과 앱 바이너리에서 비밀 모양, `service_role` JWT, 공개 접두어 변수 속 비밀.
3. **마이그레이션 분류와 리허설.** DROP·이름 바꾸기·형 좁히기·기본값 없는 NOT NULL을 막고, 운영의 사본에서 다시 돌려 주장 장부를 다시 본다.
4. **되살아나는 새 백업.** 마이그레이션 직전에, 그 자원의 수명 밖에. 주기적으로 되살려 행 수를 비교.
5. **자격의 경계.** 만드는 에이전트는 운영 DB 주소도 파괴적 토큰도 없다.
6. **답하는 SHA와 운영 걷기.** 실패하면 자동으로 되돌린다.
7. **오류 지켜보기.** 이번 출하에서 새로 생긴 오류 묶음.
8. **지출과 노출 위생.** 멈추는 예산, 키 상한, 보호된 미리 보기.

## 사람의 "예"가 있어야 하는 곳

제품의 첫 공개, 인증·RLS·스토리지 공개 범위의 변경, 줄이는 쪽 마이그레이션과 데이터 채우기, 운영 위에 백업을 되살리기(그 뒤의 쓰기를 잃는다), 과금되는 모든 것, 운영 자격의 발급·확대, 실패한 관문을 넘는 강제 승격, 사용자를 식별하는 처리자 추가, 사용자 데이터 삭제. 관문이 전부 초록인 뒤의 일상 승격과 걷기 실패 시의 자동 되돌리기는 제품마다 한 번 미리 허락할 수 있다.

## 이 저장소가 한 것 (같은 날)

`sz-eyes release new`의 관문이 위 1·2·3(리허설)·4·6·7을 줄로 가진다. 1은 `sz-eyes web strangers`(한 사람의 브라우저가 서버에 물은 것을 전부, 아무도 아닌 사람과 둘째 사람으로 다시 묻는다), 2는 `sz-eyes web leaks`, 6은 `sz-eyes web live`. 5는 훅 `guard-live`(호스팅된 DB·프로젝트·앱·볼륨을 지우거나 초기화하는 명령을 거절)와 스킬의 규칙. 마이그레이션 분류기와 8은 스킬의 글로만 있다.

## 확인하지 못한 것

PostHog 무료 수치(자체 페이지가 잘림), Supabase 지출 한도의 기본값, Bolt가 발견으로 게시를 막는지, Replit/SaaStr 복구 여부(말이 엇갈림), PocketOS(창업자의 말을 기사로만), Sentry MCP가 무료에서 실제로 되는지, 개인정보위 원문.

## 주요 출처 (2026-11-15에 읽음)

docs.lovable.dev/features/security · mattpalmer.io/posts/statement-on-CVE-2025-48757 · wiz.io/blog/critical-vulnerability-base44 · escape.tech/blog/methodology-how-we-discovered-vulnerabilities-apps-built-with-vibe-coding · redhuntlabs.com (wave 15) · blog.gitguardian.com/the-state-of-secrets-sprawl-2026 · bolt.new/blog/security-audit-on-publish · vercel.com/blog/v0-vibe-coding-securely, /blog/agent-responsibly, /docs/{deployment-checks,instant-rollback,rolling-releases,agent-resources} · replit.com/blog/introducing-a-safer-way-to-vibe-code-with-replit-databases, docs.replit.com/features/data-and-storage/publish-database-changes · docs.base44.com · docs.netlify.com/build/data-and-storage/netlify-database/backup-and-recovery · developers.cloudflare.com/workers/configuration/versions-and-deployments · supabase.com/docs/guides/ai-tools/mcp, /blog/defense-in-depth-mcp, /docs/guides/platform/backups · neon.com/docs/ai · prisma.io/blog (6.15 guardrails, "stop your AI agent dropping your database") · aishippingblog.com/p/how-i-dropped-our-production-database · thestack.technology (METR) · anthropic.com/engineering/claude-code-auto-mode · blog.sentry.io/agents-need-production-context · sentry.io/pricing, glitchtip.com/pricing, posthog.com/docs, cloudflare.com/web-analytics, checklyhq.com/pricing, uptimerobot.com/pricing
