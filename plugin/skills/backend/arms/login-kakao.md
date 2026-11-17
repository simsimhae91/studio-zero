---
name: login-kakao
does: Signing in with Kakao on a product, through the owner's one Kakao developer app and the login relay on this Mac.
check: "none: shown by signing in, as SKILL.md (Accounts) says: `sz-eyes supabase start` in the product's folder prints whether Kakao is on, and a person presses the Kakao button on the running product and signs in to the end (Kakao documents no call that proves an id and a secret without a person)"
keys:
  - id: login/kakao/client-id
    env: KAKAO_CLIENT_ID
    what: the REST API key of the owner's Kakao app, which is its client id (public: it travels in every sign-in address)
    without: stops
    costs: free; a Kakao account with identity verification, and the app switched to a 개인 개발자 비즈 앱 (no business registration needed)
  - id: login/kakao/client-secret
    env: KAKAO_CLIENT_SECRET
    what: the client secret code of that app
    without: stops
    costs: free
---

# login-kakao: signing in with Kakao

How sign-in works is in `../SKILL.md` (Accounts): one app for every product, the relay's one address registered with Kakao, `sz-eyes supabase start` reading these keys from the vault itself. This file makes the keys an arm, so that `sz-eyes arm need login-kakao` guides the owner when one is missing. The owner's whole guide, with Kakao's error codes: `docs/guides/studio-zero/shared-login-apps.html` (checked against Kakao's pages on 2026-11-14).

- **When**: a product with accounts whose people are Korean. Email sign-in needs no key, so no product waits on this arm: without it, the Kakao button stays behind a setting.
- **On the server**: on Supabase the stack takes both keys itself. A server of the product's own gets the secret by name (`sz-eyes secret run KAKAO_CLIENT_SECRET=login/kakao/client-secret -- <launch>`); the client id may reach a page, the secret never.
- **Limits**: Kakao takes ten redirect addresses at most, so the relay's one address serves every product; the consent screen shows the app's name, not the product's; a real phone signs in only once the product has a public address.
- **Users told**: the privacy policy names Kakao as where the person signs in and what it passes on (nickname, picture, email, as the person agrees on Kakao's own screen).
- **Shown to be real**: a person signs in with Kakao on the running product to the end, once; after that the build presses the button and sees Kakao's own page (the studio stops at the provider's door).

## 주인이 할 일

### 카카오 개발자 앱의 키 (`login/kakao/client-id`, `login/kakao/client-secret`)

한 번만 하면 이 Mac에서 짓는 모든 제품이 이 앱으로 로그인합니다.

1. https://developers.kakao.com/console/app 에서 [앱 생성]을 누릅니다. 앱 이름(예: Studio Zero), 회사명(개인이면 본인 이름), 카테고리를 넣고 저장하고, 앱 아이콘을 올립니다.
2. [앱] > [일반] > [비즈니스 정보] > [개인 개발자 비즈 앱]으로 바꿉니다. 사업자등록은 필요 없고, 본인인증(오른쪽 위 프로필 > [계정 설정] > [본인인증])과 앱 아이콘이 있어야 합니다.
3. [카카오 로그인] > [사용 설정]을 ON으로 합니다.
4. [카카오 로그인] > [동의항목]에서 닉네임, 프로필 사진, 카카오계정(이메일)을 켭니다.
5. [앱] > [플랫폼 키] > [REST API 키]를 열고, 리다이렉트 URI 칸에 `http://localhost:49210/oauth/callback` 을 그대로 넣습니다(http, localhost, 끝에 / 없음).
6. 같은 화면의 [클라이언트 시크릿]에서 코드를 발급하고 활성화가 ON인지 봅니다.
7. REST API 키를 복사하고, 이 세션의 입력창에 이 한 줄을 실행합니다: `! pbpaste | sz-eyes secret set login/kakao/client-id`
8. 클라이언트 시크릿 코드를 복사하고 이 한 줄을 실행합니다: `! pbpaste | sz-eyes secret set login/kakao/client-secret`
9. 제품 폴더에서 `sz-eyes supabase start` 가 카카오가 켜졌다고 말하면, 제품의 카카오 단추를 눌러 끝까지 로그인해 봅니다.

안 될 때(KOE006, KOE205 등)는 `docs/guides/studio-zero/shared-login-apps.html` 의 표를 봅니다.
