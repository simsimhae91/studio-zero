---
name: login-google
does: Signing in with Google on a product, through the owner's one Google OAuth client and the login relay on this Mac.
check: "none: shown by signing in, as SKILL.md (Accounts) says: `sz-eyes supabase start` in the product's folder prints whether Google is on, and a person who is one of the app's test users presses the Google button on the running product and signs in to the end (Google documents no call that proves an id and a secret without a person)"
keys:
  - id: login/google/client-id
    env: GOOGLE_CLIENT_ID
    what: the Client ID of the owner's Google OAuth client of type Web application (public: it travels in every sign-in address)
    without: stops
    costs: free; a Google account and a Google Cloud project
  - id: login/google/client-secret
    env: GOOGLE_CLIENT_SECRET
    what: the Client secret of that client, shown in full only when it is made
    without: stops
    costs: free
---

# login-google: signing in with Google

How sign-in works is in `../SKILL.md` (Accounts): one client for every product, the relay's one address registered with Google, `sz-eyes supabase start` reading these keys from the vault itself. This file makes the keys an arm, so that `sz-eyes arm need login-google` guides the owner when one is missing. The owner's whole guide, with Google's errors: `docs/guides/studio-zero/shared-login-apps.html` (checked against Google's pages on 2026-11-14).

- **When**: a product with accounts. Email sign-in needs no key, so no product waits on this arm: without it, the Google button stays behind a setting.
- **On the server**: on Supabase the stack takes both keys itself. A server of the product's own gets the secret by name (`sz-eyes secret run GOOGLE_CLIENT_SECRET=login/google/client-secret -- <launch>`); the client id may reach a page, the secret never.
- **Limits**: while the app is in Testing, only the Google accounts listed as its test users sign in (100 at most); the consent screen shows the app's name, not the product's; a real phone signs in only once the product has a public address.
- **Users told**: the privacy policy names Google as where the person signs in and what it passes on (name, email, picture).
- **Shown to be real**: a test user signs in with Google on the running product to the end, once; after that the build presses the button and sees Google's own page (the studio stops at the provider's door).

## 주인이 할 일

### Google OAuth 클라이언트의 키 (`login/google/client-id`, `login/google/client-secret`)

한 번만 하면 이 Mac에서 짓는 모든 제품이 이 클라이언트로 로그인합니다.

1. https://console.cloud.google.com 에서 프로젝트를 만들거나 고릅니다.
2. Google Auth Platform > Overview > Get started 에서 앱 이름과 지원 이메일을 넣고, Audience는 External을 고르고, 연락처를 넣습니다.
3. Audience > Test users 에 로그인해 볼 Google 계정을 넣습니다. 게시 상태가 Testing인 동안은 이 계정들만 로그인됩니다.
4. Clients > Create client 에서 유형을 Web application으로 하고, Authorized redirect URIs에 `http://localhost:49210/oauth/callback` 을 그대로 넣습니다. Authorized JavaScript origins는 비워 둡니다.
5. 아래 줄을 이 세션의 입력창에 붙여 넣기만 하고 Enter는 아직 누르지 않습니다. 줄을 복사하면 클립보드가 그 줄로 바뀌므로, 키보다 먼저 붙여 넣습니다: `! pbpaste | sz-eyes secret set login/google/client-id` 그다음 Client ID를 복사하고, 이 세션으로 돌아와 Enter를 누릅니다.
6. 같은 순서로 한 번 더 합니다. 이 줄을 먼저 붙여 넣고: `! pbpaste | sz-eyes secret set login/google/client-secret` Client secret을 복사한 뒤, 돌아와 Enter를 누릅니다. (시크릿 전체는 만들 때 한 번만 보입니다. 놓쳤으면 새로 만듭니다.)
7. 설정이 반영되는 데 5분에서 몇 시간이 걸릴 수 있습니다. 제품 폴더에서 `sz-eyes supabase start` 가 Google이 켜졌다고 말하면, 제품의 Google 단추를 눌러 테스트 사용자 계정으로 끝까지 로그인해 봅니다.

안 될 때(redirect_uri_mismatch, access_denied)는 `docs/guides/studio-zero/shared-login-apps.html` 의 표를 봅니다.
