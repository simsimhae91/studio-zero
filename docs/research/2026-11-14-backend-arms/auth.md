## 결론
- 인증 팔은 Supabase Auth(GoTrue)로 만듭니다. GoTrue 하나로 이메일·비밀번호, 매직링크, OTP, Google, Apple, Kakao가 해결되고, Naver는 custom OAuth 제공자로 붙입니다.
- 키가 없을 때 쓰는 대역 로그인은 GoTrue 옆에 가짜 IdP를 하나 띄워서 같은 PKCE·콜백 흐름을 그대로 탑니다. Kakao는 GoTrue 코드에 주소를 바꾸는 설정이 있어서 제공자 이름까지 그대로 둘 수 있습니다.
- Expo는 Expo Go로 OAuth를 시험할 수 없으므로 개발 빌드가 필요합니다. 감사(audit)는 지금처럼 웹 타깃으로 하면 됩니다.

## 선택지
| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬 구동과 무게 | 한계 |
|---|---|---|---|---|
| Supabase Auth (GoTrue) | 이메일·비밀번호, 매직링크, OTP, 전화, Google, Apple, Kakao 내장. 2026-04 GA된 custom OAuth/OIDC 제공자 (https://supabase.com/docs/guides/auth/custom-oauth-providers) | MIT, 자가 호스팅 가능 (https://github.com/supabase/auth) | 전체 `supabase start`는 컨테이너 13개, 권장 RAM 7GB. `-x`로 서비스를 뺄 수 있음 (https://supabase.com/docs/reference/cli/supabase-start). GoTrue만 쓰면 Postgres 하나로 Kong 없이 돎 | Naver 미내장. Google 제공자는 URL 설정을 무시함 (https://raw.githubusercontent.com/supabase/auth/master/internal/api/provider/google.go) |
| Better Auth (Auth.js 흡수) | Kakao·Naver 내장, Expo 플러그인 제공 (https://better-auth.com/docs/authentication/kakao) | MIT, 앱 안에 들어가는 라이브러리. Auth.js는 "now part of Better Auth" (https://authjs.dev/) | 추가 컨테이너 0개, 프로젝트 DB를 씀 | 메일·SMS 발송을 직접 구현해야 함 (https://better-auth.com/docs/authentication/email-password). Vite SPA에는 서버가 따로 필요 |
| Clerk | 개발 인스턴스는 공유 Google 자격증명으로 키 없이 동작 (https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google). Kakao는 custom OIDC로 (https://clerk.com/docs/guides/configure/auth-strategies/social-connections/custom-provider) | 호스팅 서비스 | 로컬 컨테이너 없음 | 인터넷과 Clerk 키가 필요해 local-first에 맞지 않음 |
| Firebase Auth | 에뮬레이터가 가짜 IdP 로그인 페이지를 띄우고 SMS 코드와 메일 링크를 터미널에 찍어 줌 (https://firebase.google.com/docs/emulator-suite/connect_auth) | 운영은 Google 클라우드 | firebase-tools 에뮬레이터 | 서명 없는 토큰. Kakao 같은 OIDC는 업그레이드한 프로젝트만 가능 (https://firebase.google.com/docs/auth/web/openid-connect) |
| Keycloak | OIDC 브로커 | Apache-2.0 (https://github.com/keycloak/keycloak) | 컨테이너 1개, `start-dev`. 512MB 힙을 쓰려면 컨테이너 750MB, 소규모 운영 권장 2GB (https://www.keycloak.org/server/containers) | 무겁고 Kakao·Naver 내장이 없음 |
| mock-oauth2-server | 대역 전용 OIDC 서버. 아무 사용자명과 클레임을 입력하는 로그인 화면 제공 | MIT, 이미지 `ghcr.io/navikt/mock-oauth2-server`, 포트 8080 (https://github.com/navikt/mock-oauth2-server) | 컨테이너 1개(JVM) | 운영에는 쓸 수 없음 |

## 프로토타입에 어떻게 붙이나
- **로컬 설정**: `config.toml`에 `site_url`, `additional_redirect_urls`, `[auth.external.kakao|google|apple]`(`client_id`, `secret = "env(...)"`)를 씁니다. 메일은 Mailpit(웹 UI 포트 54324)로 받습니다. 전화번호는 `[auth.sms.test_otp]`로 고정 코드를 줍니다 (https://supabase.com/docs/guides/local-development/cli/config).
- **콜백 주소**: Google에는 `http://127.0.0.1:54321/auth/v1/callback`을 등록합니다. Google은 localhost만 HTTP를 허용하고 와일드카드는 허용하지 않습니다 (https://supabase.com/docs/guides/auth/social-login/auth-google, https://developers.google.com/identity/protocols/oauth2/web-server). Kakao에는 `http://localhost:54321/auth/v1/callback`을 등록합니다 (https://supabase.com/docs/guides/auth/social-login/auth-kakao).
- **컨테이너에 넣는 변수**: `SUPABASE_URL`, `SUPABASE_ANON_KEY` 둘뿐입니다. 제공자 secret은 GoTrue 사이드카에만 들어가고 프로젝트 컨테이너에는 들어가지 않습니다.
- **웹**: `supabase-js`의 `signInWithOAuth({provider:'kakao'})`를 씁니다.
- **Expo**: `makeRedirectUri()`로 주소를 만들어 `skipBrowserRedirect: true`로 넘기고, `WebBrowser.openAuthSessionAsync`로 연 뒤 `setSession`을 부릅니다. 허용 목록에는 `scheme://**`를 넣습니다 (https://supabase.com/docs/guides/auth/native-mobile-deep-linking).
- **Expo Go는 안 됨**: Expo 문서가 "Expo Go cannot be used for local development and testing of OAuth"라고 못 박고 있습니다 (https://docs.expo.dev/guides/authentication/). 네이티브 Google 로그인 라이브러리도 개발 빌드가 필요합니다 (https://docs.expo.dev/guides/google-authentication/). 예외로 Sign in with Apple은 Expo Go에서 시험할 수 있습니다 (https://supabase.com/docs/guides/auth/social-login/auth-apple).
- **Kakao 네이티브**: `@react-native-kakao/user`(MIT)를 씁니다 (https://github.com/mym0404/react-native-kakao). 이 라이브러리의 문서 도메인 rnkakao.dev는 지금 무관한 도박 사이트로 리다이렉트되므로, 엔진이 그 링크를 따라가지 않게 막아야 합니다.

## 키 없이 되는 것과 안 되는 것
**키 없이 되는 것**
- 이메일·비밀번호, 매직링크, OTP: Mailpit으로 끝까지 동작합니다.
- 전화 OTP: `test_otp` 고정 코드로 동작합니다.

**대역 로그인 설계**
- **Kakao**: GoTrue의 Kakao 제공자는 `URL` 설정 하나로 kauth와 kapi 호스트를 함께 바꿉니다. `chooseHost` 함수가 `http://mock:8080` 같은 값을 그대로 씁니다 (https://raw.githubusercontent.com/supabase/auth/master/internal/api/provider/kakao.go, https://raw.githubusercontent.com/supabase/auth/master/internal/api/provider/provider.go). 따라서 `/oauth/authorize`, `/oauth/token`, `/v2/user/me`를 Kakao 모양으로 흉내 내는 작은 서버를 빌더가 직접 만들면, 제공자 이름도 콜백도 운영과 같습니다.
- **Google·Naver**: mock-oauth2-server를 issuer로 하는 `custom:google-dev` 같은 custom OIDC 제공자로 붙입니다. 클라이언트 헬퍼는 환경변수에 따라 제공자 이름만 바꿉니다.
- **Expo 대역**: 네이티브 SDK는 흉내 낼 수 없으므로, 대역 모드에서는 브라우저 흐름으로 로그인합니다.

**소유자가 직접 발급해야 하는 것**
- **Google**: OAuth 클라이언트를 만듭니다. 웹용과 iOS·Android용이 따로 있고, Android는 SHA-1 지문이 필요합니다. 기본 범위(openid, email, profile)만 쓰면 테스트 사용자 100명 제한과 7일 만료가 적용되지 않습니다 (https://support.google.com/cloud/answer/15549945).
- **Kakao**: 앱을 만들고 REST API 키(=client_id)와 클라이언트 시크릿을 받습니다. 카카오 로그인 상태를 ON으로 켜고, 리다이렉트 URI를 등록합니다. 리다이렉트 URI는 최대 10개, 완전 일치, 경로에 파라미터 불가입니다 (http://developers.kakao.com/docs/ko/app-setting/app).
- **Apple**: 유료 개발자 계정이 필요하고, Services ID와 6개월마다 다시 만드는 secret이 필요합니다.
- **SMS**: 발송 업체 계정이 필요합니다(한국 사정 참고).

## 한국 사정
- **Kakao 동의항목**: 닉네임과 프로필 사진은 기본 제공입니다. 이메일은 비즈 앱이나 테스트 앱이어야 합니다. 이름, 성별, 생일, 전화번호는 추가 기능을 신청해야 하고 심사에 영업일 3~5일이 걸립니다 (http://developers.kakao.com/docs/ko/kakaologin/utilize, http://developers.kakao.com/docs/ko/kakaologin/prerequisite).
- **개인 개발자 비즈 앱**: 본인인증과 약관 동의만으로 전환됩니다. 전환하면 이메일 필수 동의를 설정할 수 있고, 테스트 앱을 최대 5개 만들 수 있습니다 (http://developers.kakao.com/docs/ko/app-setting/app).
- **Kakao OIDC**: Kakao는 OIDC 디스커버리를 제공하므로 Keycloak, Clerk, Firebase에도 붙일 수 있습니다 (https://kauth.kakao.com/.well-known/openid-configuration).
- **전화 OTP**: 국내 발송은 발신번호 사전등록이 필요합니다. 명의자 인증과 3개월 이내 발급한 통신서비스 이용증명원을 내야 합니다 (https://docs.nhncloud.com/ko/Notification/SMS/ko/console-guide/). Twilio로 보내면 "[국제발신]"이 붙고 번호 앞에 009/006이 붙습니다 (https://www.twilio.com/en-us/guidelines/kr/sms). 그래서 GoTrue의 Send SMS hook으로 호스트 게이트웨이를 거쳐 국내 업체로 보내는 길을 권합니다 (https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook).
- **App Store 4.8**: 소셜 로그인을 넣으면, 수집을 이름·이메일로 한정하고 이메일을 숨길 수 있는 동등한 로그인을 함께 제공해야 합니다.
- **App Store 5.1.1(v)**: 계정을 만들 수 있는 앱은 앱 안에서 계정을 삭제할 수 있어야 합니다 (https://developer.apple.com/app-store/review/guidelines/).
- **Sign in with Apple**: 계정 삭제 때 토큰을 폐기해야 합니다. 한국 개발자는 Services ID를 새로 등록할 때 server-to-server 알림 엔드포인트가 필수입니다 (https://developer.apple.com/support/offering-account-deletion-in-your-app/).

## 추천과 이유
- **인증 팔은 GoTrue 단독 구성으로 합니다.** Postgres와 GoTrue만 쓰고, 개발 중에는 Mailpit과 mock IdP를 함께 띄웁니다.
  - 소유자가 제안한 Supabase와 그대로 이어집니다.
  - Kakao가 내장이고, Naver는 custom 제공자로 붙습니다.
  - secret이 사이드카에 머물러 "키는 컨테이너에 넣지 않는다" 규칙과 맞습니다.
- **Better Auth는 넣지 않습니다.** 엔진이 프로젝트마다 인증 코드를 새로 쓰게 되어 실패할 곳이 늘어납니다.
- **Clerk와 Firebase는 넣지 않습니다.** 로컬 전용으로 돌릴 수 없습니다.
- **Keycloak은 넣지 않습니다.** 무게에 비해 얻는 것이 적습니다.
- **모든 템플릿에 기본으로 넣을 것**: 계정 삭제 엔드포인트, Apple 로그인 버튼, Expo 개발 빌드.

## 확인하지 못한 것
- 이번 세션은 중간에 검색 한도를 다 써서 아래 항목을 검증하지 못했습니다.
- **Naver**: 콘솔 규칙, 검수 절차, localhost 허용 여부. developers.naver.com 페이지를 가져올 수 없었습니다. Naver 사용자 정보 응답이 중첩 구조라서 Supabase custom OAuth2 제공자가 그 필드를 제대로 읽는지도 확인하지 못했습니다.
- **Kakao localhost**: Kakao 문서에는 localhost 허용 여부가 없습니다. Supabase 문서의 안내로만 추정했습니다.
- **Kakao 이메일 범위**: GoTrue Kakao 제공자는 기본 scope에 `account_email`을 넣습니다. 비즈 앱이 아닌 앱에서 이 요청이 오류를 내는지 확인하지 못했습니다.
- **로컬 CLI 설정**: `config.toml`로 custom 제공자를 선언할 수 있는지, Kakao `url`을 설정할 수 있는지 확인하지 못했습니다.
- **Kakao 네이티브 토큰 연결**: `signInWithIdToken`이 kakao를 받는지, `@react-native-kakao`가 Expo Go에서 동작하는지 확인하지 못했습니다.
- **대역 흐름의 호스트 이름**: mock issuer 호스트 이름이 브라우저와 GoTrue 컨테이너 양쪽에서 같게 풀리는지(OrbStack 도메인) 확인하지 못했습니다.
- **기타**: 메모리 사용량과 시작 시간은 직접 재지 않았습니다. 또 확인하지 못한 것은 Clerk의 자가 호스팅 불가 공식 문구와 요금, Firebase 에뮬레이터 요구사항, PASS 같은 본인인증이 4.8 예외에 해당하는지, Better Auth 매직링크 플러그인입니다.