## 결론
- 이 영역은 전부 SaaS라 프로젝트 옆에 띄울 컨테이너가 없다. 팔의 실체는 호스트 게이트웨이의 대역(stand-in)과, 소유자 키가 들어오면 그대로 통과시키는 프록시다.
- 개인 가입만으로 실제 테스트가 되는 것: Toss Payments, PortOne(카카오페이·KCP 본인인증 테스트 채널), Kakao Maps, RevenueCat Test Store. 우편번호는 키가 필요 없고 Web Push는 키를 직접 만든다.
- 사업자가 있어야 하는 것: 실결제, 네이버페이(테스트 키조차), 다날 본인인증, 알림톡, 스토어 실구매. 프로토타입에서는 대역으로만 흉내 낸다.

## 선택지
모두 컨테이너 0개다. 대역의 메모리와 시작 시간은 측정하지 않았다.

| 이름 | 무엇을 덮나 | 라이선스·자가 호스팅 | 로컬에서 띄우는 법과 무게 | 한계 |
|---|---|---|---|---|
| Toss Payments | 카드·간편결제·가상계좌·정기결제 | SaaS, 이메일만으로 가입 (https://docs.tosspayments.com/reference/using-api/api-keys) | `test_` 키로 가상 승인, 출금 없음 (https://docs.tosspayments.com/guides/v2/get-started/environment) | 페이코·카카오페이·휴대폰 인증·ARS는 일반 테스트 키로 불가 (같은 문서) |
| PortOne V2 | 여러 PG·간편결제·본인인증을 한 SDK로 | SaaS, 콘솔 가입은 "별도 계약 없이 무료" (https://developers.portone.io/opi/ko/integration/ready/readme?v=v2) | 콘솔에서 테스트 채널 추가 | KCP 테스트는 출금 없음 (https://help.portone.io/content/kcp_channel). KG이니시스는 실제 출금 뒤 23시대 자동 취소 (https://help.portone.io/content/inicis, 검색 인용) |
| 카카오페이·네이버페이 | 간편결제 | SaaS | 카카오페이: PortOne 테스트 CID `TC0ONETIME`, 계약 전 가능 (https://help.portone.io/content/kakaopay) | 네이버페이: 범용 테스트 키 없음, 결제형은 "최소 1개월 이상 매출발생" 입점 기준 (https://help.portone.io/content/naverpay) |
| RevenueCat | 인앱 구독 | SaaS, 월 추적 매출 $2,500까지 무료, 이후 1% (https://www.revenuecat.com/pricing) | Test Store는 스토어 설정 없이 구매 흐름 (https://www.revenuecat.com/docs/test-and-launch/sandbox/test-store). Expo Go에서는 mock (https://www.revenuecat.com/docs/getting-started/installation/expo) | 웹 구매는 Web Billing(Stripe) 필요. Test Store 키로 스토어 제출 금지 |
| expo-iap 3.4 | 스토어 결제 직접 | 라이브러리 | 로컬 불가 | Expo Go 불가, 실기기·스토어 계정·테스트 트랙 필수 (https://hyochan.github.io/expo-iap/getting-started/prerequisites) |
| 본인인증 (PortOne 경유) | PASS·SMS(다날, KCP), 통합인증(KG이니시스) | SaaS, "결제대행사와의 계약은 필수" (https://help.portone.io/content/identity-verification) | KCP 테스트 채널은 임의 6자리로 통과하는 모의 인증 (https://help.portone.io/content/kcp_channel) | 다날은 테스트 환경 없음 |
| Solapi·NHN Cloud·Aligo | SMS·알림톡 | SaaS | Aligo `testmode_yn=Y`는 과금·실발송 없이 같은 응답 (https://smartsms.aligo.in/admin/api/spec.html) | 발신번호 사전등록 필수 (https://solapi.com/guides/senderid) |
| Twilio | SMS | SaaS | test credentials는 과금·실발송 없음 (https://www.twilio.com/docs/iam/test-credentials) | 한국은 영숫자 발신 ID·국내 롱코드 미지원, [국제발신] 표기 (https://www.twilio.com/en-us/guidelines/kr/sms) |
| Kakao Maps | 지도·장소·주소·경로 | SaaS, 2026-07-21부터 신청·심사 없이 활성화 (https://devtalk.kakao.com/t/api-notice-on-new-kakao-map-api-features-and-free-quota-policy/150222) | JS 키와 도메인 등록(최대 10개) (https://developers.kakao.com/docs/ko/app-setting/app) | 무료 쿼터는 계정의 첫 활성화 앱에만. 지도 SDK 일 30만, 경로 일 1,000 (https://developers.kakao.com/docs/ko/getting-started/quota) |
| Naver Maps·T map | 지도·경로 | SaaS | Naver는 Web 서비스 URL(최대 10개)·패키지명·Bundle ID 등록 (https://guide.ncloud-docs.com/docs/maps-app) | Naver 무료 이용량은 대표 계정만 (https://guide.ncloud-docs.com/docs/maps-overview). T map 무료는 일 지도 10만·경로 1,000 (https://tmapapi.tmapmobility.com/terms.html) |
| 우편번호 (Daum/Kakao) | 주소 검색 | 무료, 키 없음, 사용량 제한 없음 (https://postcode.map.kakao.com/guide) | 스크립트 한 줄 | 좌표 미제공. 웹뷰는 `embed()` 권장 |
| 푸시 | 알림 | Web Push는 VAPID 키를 로컬에서 생성 (https://github.com/web-push-libs/web-push) | 웹은 서비스 워커 | expo-notifications는 Android·iOS만, Expo Go 원격 푸시 불가 (https://docs.expo.dev/versions/latest/sdk/notifications/). Firebase 에뮬레이터에 FCM 없음 (https://firebase.google.com/docs/emulator-suite) |

## 프로토타입에 어떻게 붙이나
- **키를 둘로 가른다.** 공개 키(Toss 클라이언트 키, PortOne `storeId`·`channelKey`, Kakao JavaScript 키)는 브라우저에 실리는 값이라 `VITE_`·`NEXT_PUBLIC_`·`EXPO_PUBLIC_` 변수로 넣는다. 비밀 키(Toss 시크릿 키, `PORTONE_API_SECRET`, 문자 API 키)는 게이트웨이에만 둔다.
- **컨테이너가 받는 것.** 게이트웨이 주소(예: `PAYMENTS_API_URL`, `IDENTITY_API_URL`, `SMS_API_URL`)와 공개 키다.
- **결제 흐름.** 결제창에서 `successUrl`로 돌아오면 앱 서버가 게이트웨이의 승인 엔드포인트를 부르고, 게이트웨이가 시크릿 키로 승인 API를 부른다.
- **본인인증 흐름.** `PortOne.requestIdentityVerification()` 뒤에 게이트웨이가 `GET /identity-verifications/{id}`를 조회한다 (https://developers.portone.io/opi/ko/extra/identity-verification/readme-v2?v=v2).
- **지도 키는 도메인에 묶인다.** Kakao는 등록 도메인 밖 요청을 거절하고, 무료 쿼터는 첫 앱 하나뿐이다. 프로젝트마다 앱을 만들지 말고 Kakao 앱 하나를 공유하며, 미리보기 출처(origin)를 고정된 몇 개로 묶어야 한다.
- **웹.** 브라우저 SDK를 그대로 쓴다.
- **Expo 결제·본인인증.** 웹뷰 기반 SDK를 쓴다.
  - `@portone/react-native-sdk`와 `react-native-webview` 조합은 Expo 51에서 테스트됐다 (https://github.com/portone-io/react-native-sdk).
  - Toss RN SDK는 `react-native-webview >=13.3 <14`를 요구한다 (https://docs.tosspayments.com/sdk/widget-rn).
  - 웹 타깃 감사에서는 `Platform.OS === 'web'` 분기로 브라우저 SDK를 쓰는 것이 현실적이다.
- **Expo 지도.** Kakao 공식 RN SDK는 찾지 못했다. Naver는 커뮤니티 `@mj-studio/react-native-naver-map`이 있고 Expo Go에서는 안 된다 (https://www.npmjs.com/package/@mj-studio/react-native-naver-map).

## 키 없이 되는 것과 안 되는 것
- **아무 키 없이**: 우편번호, Web Push, RevenueCat의 Expo Go mock, 게이트웨이 대역 전부.
- **대역이 흉내 내는 범위**
  - 결제: 승인·취소·실패 응답 모양.
  - 본인인증: 고정된 `verifiedCustomer`.
  - SMS·알림톡: 발송 대신 "보낸 메시지함" 화면에 쌓기.
  - 푸시: 로컬 알림(Expo Go에서도 동작).
  - 못 하는 것: 실제 카드사 인증 화면, 단말 수신, 실명 확인.
- **소유자가 개인 자격으로 발급**
  - Toss: 이메일 가입 후 개발자센터 API 키.
  - PortOne: 콘솔 가입, 테스트 채널 추가, API Secret 발급.
  - Kakao Developers: 앱 생성, 카카오맵 ON, JS SDK 도메인 등록 (https://developers.kakao.com/docs/ko/kakaomap/common).
  - RevenueCat: Test Store 키.
  - Solapi: 본인 명의 번호를 본인인증으로 등록.
- **사업자가 있어야**
  - Toss 주문서형·결제창형 키와 라이브 키(전자결제 신청 후).
  - 네이버페이, 다날 본인인증.
  - 알림톡: 사업자등록번호가 없으면 일반 채널만 만들 수 있고 (https://kakaobusiness.gitbook.io/main/channel/start), 개인 개발자 비즈 앱은 비즈니스 채널을 연결할 수 없다 (https://developers.kakao.com/docs/ko/app-setting/app).
  - iOS 원격 푸시: 유료 Apple Developer 계정 (https://docs.expo.dev/push-notifications/push-notifications-setup/).

## 한국 사정
- **문자**: 발신번호 사전등록제(전기통신사업법 제84조의2, 2015-10-16 시행)가 있다. 광고 문자는 사전 동의, 21시~8시 발송 금지, `(광고)` 표기, 080 무료 수신거부가 필요하다 (https://docs.nhncloud.com/ko/Notification/SMS/ko/sending-policy/).
- **알림톡**: 템플릿은 카카오 검수를 거치며 영업일 2일 이내다 (https://docs.nhncloud.com/ko/Notification/KakaoTalk%20Bizmessage/ko/alimtalk-overview/).
- **결제 웹뷰**: 카드사·은행 앱으로 넘어가는 앱투앱이 기본이라 스킴 등록이 필수다. iOS 27부터 `LSApplicationQueriesSchemes` 한도가 50에서 25로 준다 (https://docs.tosspayments.com/guides/v2/webview).

## 추천과 이유
1. **기본값은 대역이다.** 팔 목록은 `payments`, `identity`, `sms`(알림톡 포함), `maps`, `postcode`, `push`, `iap`. 키가 없어도 흐름 전체가 돌아야 작동하는 프로토타입이다.
2. **결제는 Toss Payments 직접 연동.** 테스트가 가상 승인이라 돈이 움직이지 않는다. PortOne은 PG에 따라 실제 출금이 일어난다. 본인인증만 PortOne의 KCP 테스트 채널을 쓴다.
3. **지도는 Kakao Maps.** 가입만으로 켜지고 쿼터가 크다. 앱 하나를 공유하고 출처를 고정한다.
4. **인앱 결제는 RevenueCat Test Store.** expo-iap는 실기기와 스토어 계정이 필요해 컨테이너 감사와 맞지 않는다.
5. **푸시는 웹 타깃의 Web Push와 앱 내 알림함.** 네이티브 원격 푸시는 개발 빌드와 Apple 계정이 생길 때 붙인다.
6. **문자는 대역이 기본.** 실발송은 개인 번호 등록이 되는 Solapi로 한다.

## 확인하지 못한 것
- 카카오페이·네이버페이 직접 연동 문서는 열리지 않아 PortOne 헬프센터로 대신 확인했다.
- Toss `successUrl`에 localhost가 허용된다는 공식 문구(커뮤니티 예제만 봤다)와 전자결제 신청의 사업자 요건 원문.
- Kakao JS SDK 도메인이 localhost와 포트를 어떻게 매칭하는지.
- Naver Maps 무료 이용량 수치와 결제수단 등록 필요 여부, T map 가입·상업적 이용 조건.
- 알림톡이 비즈니스 채널을 요구한다는 카카오 공식 원문(딜러사 블로그만 봤다).
- PortOne KCP 본인인증 테스트 MID는 같은 문서 안에서 서술이 엇갈린다. KG이니시스 통합인증 테스트의 실제 동작도 미확인이다.
- PortOne의 "23시대 자동 취소"는 검색 인용으로만 봤고 문서가 약 1,000일 전 것이다.
- PASS·KCP·다날 직계약 절차, Solapi 테스트 모드 유무, Toss·PortOne RN SDK의 Expo Go 동작.