## 결론 (세 줄 이내)
기본 채팅·실시간 기능은 Supabase Realtime 하나로 만든다. 메시지는 Postgres 테이블에 저장하고, 새 메시지는 DB 트리거가 보내는 Broadcast로 전달하며, 입력 중 표시는 Broadcast, 접속 상태는 Presence로 처리한다. 이렇게 하면 키가 하나도 필요 없고 웹과 Expo가 같은 supabase-js로 붙는다.
푸시는 호스트 게이트웨이가 Expo push API를 대신 호출한다. 키가 없으면 실제로 보내지 않고 기록만 남기는 대역으로 동작한다. 음성·영상은 LiveKit을 별도 팔로 두고, 호스팅형 채팅 SaaS는 기본 구성에서 뺀다.

## 선택지
| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬에서 띄우는 법과 무게 | 한계 |
|---|---|---|---|---|
| Supabase Realtime | Broadcast, Presence, Postgres Changes, DB에서 보낸 Broadcast의 재생 | Apache 2.0, Elixir (https://github.com/supabase/realtime) | `supabase start`에 포함. 전체 스택은 RAM 7GB 이상 권장, `-x`로 서비스 13종 제외 가능 (https://supabase.com/docs/reference/cli/supabase-start). 자가 호스팅 최소 4GB (https://supabase.com/docs/guides/self-hosting/docker) | 기본 테넌트 한도: 동시 사용자 200, 초당 이벤트 100, 초당 조인 100 (https://raw.githubusercontent.com/supabase/realtime/main/ENVS.md). Postgres Changes는 단일 스레드에서 구독자마다 권한을 검사한다 (https://supabase.com/docs/guides/realtime/postgres-changes). Replay는 private 채널에서 DB가 보낸 메시지만, 최대 25건, 72시간 (https://supabase.com/docs/guides/realtime/broadcast) |
| Socket.IO + Redis | 전송만 제공. 인증·히스토리·presence는 직접 구현 | Redis 8은 RSALv2/SSPLv1/AGPLv3 중 선택 (https://redis.io/legal/licenses/), Valkey는 BSD-3 (https://github.com/valkey-io/valkey) | 서버와 Redis, 두 컨테이너 | 어댑터 최신판이 8.3.0(2024-03). sticky session 필수, 연결 상태 복구 미지원 (https://socket.io/docs/v4/redis-adapter/) |
| Centrifugo | pub/sub, presence, 핫 히스토리, 재접속 복구 | Apache 2.0, v6.10.3(2026-11-08) (https://github.com/centrifugal/centrifugo/releases) | 컨테이너 1개. 히스토리를 남기려면 Redis 또는 실험 단계인 PostgreSQL 16+ 브로커가 필요 (https://centrifugal.dev/docs/server/engines) | 푸시 API·user status는 PRO 전용. 라이선스 없이 쓰면 연결 20개까지 (https://centrifugal.dev/docs/pro/overview) |
| Ably | pub/sub, Ably Chat(입력 중 표시, presence, 히스토리) (https://ably.com/docs/chat/getting-started/react-native) | SaaS | 키 필수 | 무료 500 MAU, 보존 1개월, Pro는 연간 결제 시 월 $29 (https://ably.com/pricing) |
| Pusher Channels | pub/sub, presence 채널 | SaaS. 대역으로 Soketi(AGPL-3.0, Pusher 프로토콜 v7, 유지보수 불규칙) (https://github.com/soketi/soketi) | Soketi 컨테이너 1개 | Sandbox는 하루 20만 메시지, 동시 연결 100 (https://pusher.com/channels/pricing/). pusher-js의 React Native 지원은 deprecated (https://github.com/pusher/pusher-js) |
| Stream Chat | 완성형 채팅 UI와 백엔드 | SaaS | 키 필수. Expo용 패키지는 `stream-chat-expo` | 무료 Build 플랜은 1,000 MAU, 동시 연결 100 (https://getstream.io/chat/pricing/) |
| Sendbird | 완성형 채팅 | SaaS | 키 필수 | 체험판은 1,000 MAU, 피크 동시 연결 20. Starter는 연간 결제 시 월 $349 (https://sendbird.com/pricing/chat) |
| TalkJS | 완성형 채팅 UI | SaaS. 개발 모드 무료 (https://talkjs.com/pricing/) | `@talkjs/expo`는 Expo Go에서 안 돌아가 개발 빌드가 필요 (https://talkjs.com/docs/Getting_Started/Frameworks/React_Native/) | Basic은 월 $279, 10,000 MAU |
| PartyKit / Durable Objects | 방 단위 상태 서버 | partyserver는 ISC (https://github.com/cloudflare/partykit). workerd는 Apache 2.0, Linux arm64에서 테스트됨, "hardened sandbox 아님" (https://github.com/cloudflare/workerd) | wrangler dev | 호스팅 PartyKit은 2026-10-23 종료 (https://docs.partykit.io/). DO 무료 한도는 하루 10만 요청 (https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Liveblocks | presence, storage, broadcast, Yjs. 공유 목록 편집에 적합 | 서버는 AGPL v3, 클라이언트는 Apache 2.0. 프로덕션 자가 호스팅은 아직 안 됨 (https://liveblocks.io/blog/open-sourcing-the-liveblocks-sync-engine-and-dev-server) | `npx liveblocks dev` 또는 `ghcr.io/liveblocks/dev-server`, 포트 1153 | Comments·Notifications는 더미 데이터만 돌려준다 (https://liveblocks.io/docs/tools/dev-server) |
| LiveKit | 음성·영상 | Apache 2.0, 이미지 `livekit/livekit-server` (https://github.com/livekit/livekit) | `livekit-server --dev` (devkey/secret, 포트 7880) (https://docs.livekit.io/home/self-hosting/local/) | Expo Go 불가. 개발 빌드와 config plugin 2개 필요 (https://docs.livekit.io/transport/sdk-platforms/expo/) |

## 프로토타입에 어떻게 붙이나
**데이터 모델(제안):**
- `conversations(id, kind dm|group, title, dm_key unique, last_message_at)`
- `conversation_members(conversation_id, user_id, role, last_read_message_id, muted, PK 두 열)`
- `messages(id bigint identity, conversation_id, sender_id, body, created_at, edited_at, deleted_at, index(conversation_id, id desc))`
- `push_tokens(user_id, token, platform)`
- 안 읽은 수는 `id > last_read_message_id AND sender_id <> me`인 메시지 수로 센다.
- 입력 중 표시와 접속 상태는 저장하지 않는다.

**전달 방식:**
- `messages`에 INSERT 트리거를 걸고 `realtime.broadcast_changes()`를 `room:<conversation_id>` private 채널로 보낸다.
- 권한은 `realtime.messages`의 RLS로 거른다 (https://supabase.com/docs/guides/realtime/broadcast).
- 입력 중 표시는 Broadcast로 보낸다. 문서가 Presence는 느리게 바뀌는 상태용이고 빈번한 갱신은 Broadcast를 쓰라고 권한다 (https://supabase.com/docs/guides/realtime/presence).
- 공유 목록의 실시간 갱신은 프로토타입 규모라면 Postgres Changes로 충분하다.

**환경변수:** Expo는 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`를 쓴다 (https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native). 웹은 Vite·Next 각자의 접두사를 쓴다. 다음 이름은 제안이다.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
- `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`

**웹과 Expo의 차이:**
- Expo는 `react-native-url-polyfill`와 `expo-sqlite`의 localStorage가 추가로 필요하다 (위 Supabase Expo 문서).
- Android 에뮬레이터에서는 호스트 주소가 `10.0.2.2`다. API 28 이상은 평문 HTTP를 기본 차단하므로 개발 중에는 cleartext를 허용해야 한다 (https://socket.io/how-to/use-with-react-native).
- `expo-notifications`는 Android와 iOS 전용이다 (https://docs.expo.dev/versions/latest/sdk/notifications/). 따라서 웹 타깃 감사에서는 푸시를 검증할 수 없다.

## 키 없이 되는 것과 안 되는 것
**키 없이 되는 것:**
- Supabase Realtime, Centrifugo, Soketi, LiveKit dev 모드, Liveblocks dev 서버(`pk_localdev`)
- 웹앱 푸시: VAPID 키를 로컬에서 직접 생성한다 (https://github.com/web-push-libs/web-push). 서비스 워커가 필요하다 (https://developer.mozilla.org/en-US/docs/Web/API/Push_API).
- Expo push API는 기본 설정에서 인증이 없다. 다만 프로젝트에 푸시 자격 증명이 없으면 오류가 난다 (https://docs.expo.dev/push-notifications/sending-notifications/). 그래서 게이트웨이 대역이 `exp.host/--/api/v2/push/send`를 흉내 내 ticket을 돌려주고, 받은 payload를 기록해 검증한다.
- 로컬 알림은 Expo Go에서도 된다.

**안 되는 것:**
- SDK 53부터 Expo Go에서는 원격 푸시가 안 된다 (https://docs.expo.dev/push-notifications/faq/).
- 실제 전달은 개발 빌드가 있어야 한다. 대신 실기기는 없어도 된다. Google Play 서비스가 있는 Android 에뮬레이터나 iOS 시뮬레이터(Xcode 14+, macOS 13+, iOS 16+)에서 받을 수 있다 (https://docs.expo.dev/push-notifications/push-notifications-setup/).

**소유자가 직접 발급해야 하는 것:**
- Expo 계정의 EAS projectId
- Firebase 프로젝트의 FCM V1 자격 증명
- 유료 Apple Developer 계정으로 만드는 APNs 키 (위 setup 문서)

## 한국 사정
- 광고성 푸시는 수신자의 명시적 사전 동의가 필요하다.
- 오후 9시부터 다음 날 오전 8시까지 보내려면 별도 동의를 받아야 한다.
- 광고에는 전송자 명칭과 수신 거부 방법을 밝혀야 한다 (정보통신망법 제50조, https://casenote.kr/법령/정보통신망_이용촉진_및_정보보호_등에_관한_법률/제50조).
- 채팅 새 메시지 알림은 광고가 아니라고 보지만, 이는 내 해석이다. 광고 알림과 채팅 알림은 동의 항목을 분리해 두기를 권한다.

## 추천과 이유
1. **채팅·공유 목록은 Supabase Realtime으로 간다.** 인증·DB 팔과 같은 스택이고, 권한을 RLS 한 곳에서 다룬다. 키가 필요 없고, 웹과 Expo가 같은 클라이언트를 쓴다. 한도는 로컬 테넌트 기본값과 클라우드 Free가 같다. 다만 Replay가 25건·72시간으로 제한되므로 히스토리는 반드시 `messages` 테이블에서 읽는다.
2. **푸시는 게이트웨이 대역으로 처리한다.** 대역이 payload를 기록하고, 소유자의 자격 증명이 들어오면 Expo push로 실제 발송한다. 웹앱은 Web Push로 처리한다.
3. **음성·영상은 LiveKit을 선택 팔로 둔다.** 감사는 웹 타깃의 `livekit-client`로 한다.
4. **SaaS는 기본에서 뺀다.** 키 없이 로컬로 띄울 수 없고, 무료 한도가 작다(Sendbird 동시 연결 20, Stream·Pusher 동시 연결 100).
5. **Socket.IO는 쓰지 않는다.** 에이전트가 인증·히스토리·presence를 직접 짜야 하므로 결함이 늘어난다.
6. **PartyKit은 쓰지 않는다.** 호스팅이 종료됐다.
7. **Centrifugo는 Supabase를 쓰지 않는 프로젝트의 대안으로만 둔다.**

## 확인하지 못한 것
- 웹 검색 한도(200회)가 이 세션의 다른 에이전트들과 합쳐 소진돼 Redis·Valkey 비교는 공식 페이지 직접 조회로만 확인했다.
- `supabase start`의 실제 컨테이너 수·메모리·시작 시간은 측정하지 않았다. 각 서비스의 linux/arm64 이미지 제공 여부도 확인하지 못했다.
- Socket.IO의 라이선스는 확인하지 못했다.
- Ably의 공식 로컬 에뮬레이터는 찾지 못했다.
- Stream·Sendbird가 Expo Go에서 동작하는지, Sendbird에 서울 리전이 있는지 확인하지 못했다.
- Socket.IO 서버나 Centrifugo로 실시간을 쓸 때 새 메시지 푸시를 무엇이 보내는지는 직접 확인하지 않았다(Centrifugo의 푸시 API는 PRO 전용).
- 수신 동의를 재확인하는 주기는 시행령에 있는데, law.go.kr가 점검 중이어서 확인하지 못했다.
- Ably React Native 문서가 SDK 이름을 `@ably/pubsub-device`로 적고 있는데, 이것이 최근 이름이 바뀐 결과인지는 확인하지 못했다.