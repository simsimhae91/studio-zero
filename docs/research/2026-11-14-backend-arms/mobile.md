## 결론
1. Expo 프로토타입의 기본 팔은 추가 컨테이너 없이 됩니다: supabase-js, 플랫폼별 세션 저장소, TanStack Query 영속화, expo-image-picker 업로드, 브라우저 방식 OAuth. 이 묶음은 웹 타깃에서 헤드리스로 검증됩니다.
2. 푸시, 네이티브 Kakao·Google SDK, 보안 저장소, 유니버설 링크, OTA는 웹 타깃에 없거나 개발 빌드가 필요해 호스트 Mac의 시뮬레이터나 실기기에서만 확인됩니다.
3. 오프라인 동기화 엔진과 네이티브 로그인 SDK는 기본이 아니라 선택 팔로 두십시오.

## 선택지
| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬에서 띄우는 법과 무게 | 한계 |
|---|---|---|---|---|
| supabase-js + `expo-sqlite/localStorage` | 세션 유지·토큰 갱신 | 클라이언트 라이브러리 | 컨테이너 0, Expo 공식 구성 (https://docs.expo.dev/guides/using-supabase/) | 웹에서는 import가 no-op (https://docs.expo.dev/versions/latest/sdk/sqlite/) |
| expo-secure-store | 토큰 보안 보관 | 클라이언트 라이브러리 | 컨테이너 0 | 웹 없음, 일부 iOS는 약 2048바이트 초과 거부 (https://docs.expo.dev/versions/latest/sdk/securestore/) |
| react-native-mmkv | 빠른 키-값 | MIT | 컨테이너 0 | V4는 Nitro Module, RN 0.76+, `expo prebuild` (https://github.com/mrousavy/react-native-mmkv) |
| TanStack Query + AsyncStorage persister | 읽기 캐시 오프라인 | 클라이언트 라이브러리 | 컨테이너 0 | 오프라인 쓰기 재개는 문서에 없음 (https://tanstack.com/query/latest/docs/framework/react/plugins/createAsyncStoragePersister) |
| PowerSync | 양방향 오프라인 동기화 | 서비스 FSL, Open Edition 자가 호스팅 무료 (https://www.powersync.com/blog/powersync-open-edition-release) | `journeyapps/powersync-service` + 버킷 저장소(MongoDB 또는 Postgres), +2 컨테이너 (https://github.com/powersync-ja/self-host-demo); 메모리·시작 시간 미측정 | Expo Go는 `@powersync/adapter-sql-js`만, 네이티브는 OP-SQLite (https://docs.powersync.com/client-sdks/reference/react-native-and-expo) |
| ElectricSQL + TanStack DB | 읽기 경로 동기화 | Apache-2.0 (https://github.com/electric-sql/electric) | `electricsql/electric` 1개, `wal_level=logical`, 포트 3000 (https://electric.ax/docs/guides/installation); 무게 미측정 | 쓰기 경로는 직접 구현 |
| Legend-State, WatermelonDB, RxDB | 클라이언트 동기화 계층 | MIT, MIT, 미확인 | 컨테이너 0 | Legend-State v3는 beta, latest는 2.1.15 (https://registry.npmjs.org/@legendapp/state); WatermelonDB는 동기화 백엔드 직접 구현 (https://github.com/Nozbe/WatermelonDB); RxDB의 RN 권장 저장소는 premium (https://rxdb.info/react-native-database.html) |
| expo-notifications + Expo push service | 로컬·원격 알림 | Expo 호스팅, 전송 무료, 프로젝트당 초당 600건 (https://docs.expo.dev/push-notifications/faq/) | 컨테이너 0 | 웹 없음, Expo Go 원격 푸시 불가, 개발 빌드 필요 (https://docs.expo.dev/versions/latest/sdk/notifications/) |
| Sentry, PostHog | 오류·분석 | 자가 호스팅판 FSL, MIT | 각각 최소 16GB RAM이라 로컬 동반 부적합 (https://develop.sentry.dev/self-hosted/, https://posthog.com/docs/self-host) | PostHog 자가 호스팅은 공식 미지원 |
| EAS Update, EAS Build | OTA, 개발 빌드 | Expo 클라우드; Free는 1,000 MAU, Android 15·iOS 15 빌드까지 (https://expo.dev/pricing) | 해당 없음 | JS·에셋만 갱신, `expo-updates`가 든 빌드 필요 (https://docs.expo.dev/eas-update/introduction/) |

## 프로토타입에 어떻게 붙이나
- **환경변수:** `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. 실기기와 Android 에뮬레이터는 `127.0.0.1` 대신 Mac의 LAN 주소를 써야 하므로 (https://docs.expo.dev/guides/using-supabase/) 웹용과 기기용 URL을 따로 주입합니다.
- **세션:** `storage: localStorage`, `autoRefreshToken`, `persistSession`, `detectSessionInUrl: false`에 `AppState`로 `startAutoRefresh`/`stopAutoRefresh`를 겁니다(같은 문서).
- **소셜 로그인 기본형:** `signInWithOAuth({ skipBrowserRedirect: true })` → `expo-web-browser`의 `openAuthSessionAsync` → 돌아온 URL로 `setSession`. 웹에서는 `maybeCompleteAuthSession()`이 필요합니다 (https://supabase.com/docs/guides/auth/native-mobile-deep-linking).
- **리디렉션 주소:** `makeRedirectUri`는 Expo Go에서 `exp://`, 개발 빌드에서 커스텀 스킴, 웹에서 https를 돌려줍니다 (https://docs.expo.dev/versions/latest/sdk/auth-session/).
- **로컬 공급자 설정:** 로컬 Supabase는 `[auth.external.kakao]`와 `[auth.external.google]`을 `env()` 비밀값으로 받습니다 (https://supabase.com/docs/guides/local-development/cli/config).
- **업로드:** `expo-image-picker`는 웹에서 `file`, 네이티브에서 `uri`·`base64`를 줍니다 (https://docs.expo.dev/versions/latest/sdk/imagepicker/). 네이티브는 `decode(base64)` ArrayBuffer와 `contentType`으로 올리고 (https://supabase.com/docs/reference/javascript/storage-from-upload), 6MB를 넘으면 TUS입니다 (https://supabase.com/docs/guides/storage/uploads/standard-uploads).
- **폰트:** 공식 지원은 OTF·TTF입니다. woff2는 웹·iOS만 되고 Android는 안 되며, 미지원 형식은 앱을 죽일 수 있습니다. 가변 폰트는 SDK 58부터 Android(10 이상)·iOS에서 되지만 iOS는 named instance만 고릅니다 (https://docs.expo.dev/develop/user-interface/fonts/). 따라서 가변 woff2는 웹 전용이고, 기기에는 TTF/OTF를 넣습니다.
- **오프라인:** `onlineManager`에 `expo-network`, `focusManager`에 `AppState`를 연결합니다 (https://tanstack.com/query/latest/docs/framework/react/react-native). expo-sqlite를 웹에서 쓰려면 wasm과 COOP/COEP 헤더 설정이 필요합니다 (https://docs.expo.dev/versions/latest/sdk/sqlite/).
- **네이티브 SDK:** Google은 Expo Go에서 못 쓰고 (https://react-native-google-signin.github.io/docs/setting-up/expo), Kakao는 config plugin의 `nativeAppKey`와 Kakao Maven 저장소가 필요합니다 (https://rnkakao.mjstudio.net/docs/install-expo). `npx expo run:ios|android`는 Xcode와 Android Studio를 요구하므로 (https://docs.expo.dev/develop/development-builds/introduction/) 빌드는 컨테이너가 아니라 호스트에서 돕니다.
- **분석·오류:** Sentry는 `@sentry/react-native/expo` 플러그인과 `getSentryExpoConfig`를 씁니다 (https://docs.sentry.io/platforms/react-native/manual-setup/expo/). PostHog는 `host` 옵션을 게이트웨이로 돌리고 웹에서는 `expo-file-system` 대신 AsyncStorage를 씁니다 (https://posthog.com/docs/libraries/react-native).

## 키 없이 되는 것과 안 되는 것
- **키 없이:** 이메일 가입(로컬 기본값은 이메일 확인 꺼짐, 메일은 Mailpit 54324), 익명 로그인(기본 꺼짐이라 켜야 함) (https://supabase.com/docs/guides/local-development/cli/config), 세션 유지, CRUD, 업로드, 폰트, 웹 라우트, 로컬 알림(Expo Go에서도 동작) (https://docs.expo.dev/versions/latest/sdk/notifications/).
- **대역 가능:** 분석·오류 수집은 게이트웨이가 요청을 받아 기록하면 됩니다. OAuth 공급자 대역은 제 영역 밖이라 검증하지 않았습니다.
- **소유자 발급:**
  - Android 푸시: Firebase 프로젝트, `google-services.json`, EAS에 올리는 FCM V1 서비스 계정 키 (https://docs.expo.dev/push-notifications/fcm-credentials/).
  - iOS 푸시: 유료 Apple Developer 계정과 EAS `projectId` (https://docs.expo.dev/push-notifications/push-notifications-setup/).
  - Kakao: REST API 키, client secret, Redirect URI 등록 (https://supabase.com/docs/guides/auth/social-login/auth-kakao).
  - 지도: Google Maps API 키 (https://docs.expo.dev/versions/latest/sdk/map-view/).
- **헤드리스 웹으로 검증:** 가입·로그인, 새로고침 뒤 세션, 데이터와 실시간, 파일 입력 업로드, 폰트 로드, 오프라인 캐시, 분석 요청 가로채기.
- **시뮬레이터나 기기 필요:** SecureStore, MMKV, 푸시(Google Play 에뮬레이터 또는 Xcode 14+ iOS 시뮬레이터) (https://docs.expo.dev/versions/latest/sdk/notifications/), 커스텀 스킴·유니버설 링크(Expo Go는 제한적) (https://docs.expo.dev/linking/overview/), 네이티브 로그인, 카메라(iOS 시뮬레이터에 없음), OTA, 네이티브 크래시, 지도.

## 한국 사정
- Kakao `account_email` 동의 항목은 Biz App이어야 하고, 아니면 Supabase에서 "Allow users without an email"을 켭니다. 로컬 콜백은 `http://localhost:54321/auth/v1/callback`입니다 (https://supabase.com/docs/guides/auth/social-login/auth-kakao).
- `@react-native-kakao`는 MIT이고 V2부터 웹을 지원하며, Map 모듈은 Expo Go에서 안 됩니다 (https://github.com/mym0404/react-native-kakao). v3는 RN 0.76+, Expo SDK 52+, New Architecture를 요구하나 미출시로 적혀 있습니다 (https://rnkakao.mjstudio.net/docs/intro).
- `rnkakao.dev`는 무관한 사이트로 넘어갑니다. 문서는 `rnkakao.mjstudio.net`입니다.

## 추천과 이유
1. 기본 팔은 위의 컨테이너 0 묶음으로 합니다. 웹 타깃 감사와 같은 코드가 기기에서도 돌기 때문입니다.
2. 소셜 로그인은 브라우저 방식 OAuth를 기본으로 합니다. 웹, Expo Go, 개발 빌드에서 한 코드로 됩니다. 무료 Google 라이브러리는 웹을 지원하지 않으므로 (https://react-native-google-signin.github.io/docs/install) 네이티브 SDK는 개발 빌드가 생긴 뒤의 2단계 팔입니다.
3. 알림은 앱 내 알림함(DB + 실시간)을 기본으로 하고, OS 푸시는 키가 있을 때 붙는 전달 채널로 둡니다. expo-notifications가 웹에 없어 알림함만 자동 검증됩니다.
4. 오프라인 쓰기가 요구될 때만 PowerSync를 답니다. 웹과 Expo를 모두 지원합니다 (https://docs.powersync.com/resources/supported-platforms).
5. SDK 58(2026-10-15, RN 0.88)로 고정합니다 (https://expo.dev/changelog/sdk-58). Expo Go는 iOS 실기기에서 로그인을 요구하므로 (https://expo.dev/changelog/expo-go-57-login) 자동화에서 뺍니다.
6. Sentry·PostHog 서버는 띄우지 않고 게이트웨이 대역으로 받습니다.

## 확인하지 못한 것
- 컨테이너 메모리와 시작 시간: 설치를 하지 않아 재지 못했습니다.
- PowerSync SDK의 Apache-2.0, RxDB와 TanStack Query의 라이선스.
- Kakao 네이티브 SDK(Map 제외), Sentry, PostHog가 Expo Go에서 도는지: 공식 문서에 명시가 없습니다.
- linux/arm64 컨테이너에서 Android 빌드가 안 된다는 점: 커뮤니티 글만 찾았습니다.
- Apple Developer 연회비, `xcrun simctl push`: Apple 문서로 확인하지 못했습니다.
- 로컬 `additional_redirect_urls`가 `exp://`나 커스텀 스킴을 받는지(문서는 "exact URLs"), Kakao가 LAN IP Redirect URI를 받는지.
- TanStack DB 성숙도(문서의 1.0 RC 이행 안내만 봄), WatermelonDB 0.28.0의 배포일, SDK 58용 Expo Go의 스토어 배포 여부.
- Supabase와 Expo 문서 페이지에 에이전트에게 피드백 제출을 시키는 문구가 있었으나, 사용자 지시가 아니라 따르지 않았습니다.