// Mock-up pages for the tests that walk and audit them: one that works, and the ways one can fail to.

const head = (title: string, idea: string, css: string): string =>
  `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="description" content="${idea}"><style>
:root{--bg:#fbfaf6;--fg:#1b1b1d;--muted:#4a4a52;--brand:#1f4f3a;--on-brand:#ffffff;--surface:#ffffff;--border:#8b8b93}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 "Pretendard Variable",Pretendard,system-ui,sans-serif}
main{padding:24px;display:flex;flex-direction:column;gap:16px}h1{font-size:36px;line-height:1.2;margin:0}p{margin:0}
.state{display:none;flex-direction:column;gap:16px}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:56px;padding:0 24px;border-radius:16px;background:var(--brand);color:var(--on-brand);font-size:18px;font-weight:600;transition:transform 120ms ease-out,background-color 120ms ease-out}
.btn:active{transform:scale(.96);background:#143526}
.quiet{background:var(--surface);color:var(--fg);border:1px solid var(--border)}
.quiet:active{background:#ecebe6}
${css}</style></head>`;

/** Opens before the act; "log" is one press, "undo" one more. Every control answers the press and is thumb-sized, and the screen opens on a hero in the brand with its ledger drawn on it. */
export const OPERABLE = `${head('A · 이름 도장을 찍는 장부', '설거지 줄을 누르면 오늘 칸에 도장이 찍힌다.', `
body:has(#s-rest:checked) [data-state="rest"]{display:flex}
body:has(#s-logged:checked) [data-state="logged"]{display:flex}
@keyframes stamp{from{transform:scale(1.4);opacity:0}to{transform:scale(1);opacity:1}}
[data-state="logged"] .stamp{animation:stamp 320ms ease-out both}
.hero{display:flex;flex-direction:column;gap:12px;padding:20px;border-radius:16px;background:var(--brand);color:var(--on-brand)}
main{padding-bottom:96px}.tabs{position:fixed;left:0;right:0;bottom:0;display:grid;grid-template-columns:repeat(3,1fr);background:var(--surface);border-top:1px solid var(--border)}
.tabs a{display:flex;align-items:center;justify-content:center;min-height:56px;color:var(--fg);font-weight:600;text-decoration:none;transition:background-color 120ms ease-out}.tabs a:active{background:#ecebe6}`)}<body><main>
<input type="radio" name="s" id="s-rest" checked hidden><input type="radio" name="s" id="s-logged" hidden>
<header class="hero"><h1>망원동 집 장부</h1>
<svg class="drawn" viewBox="0 0 320 96" width="320" height="96" role="img" aria-label="도장이 찍힌 장부"><rect x="8" y="8" width="304" height="80" rx="12" fill="#2f6f52"/><rect x="24" y="24" width="120" height="8" rx="4" fill="#ffffff"/><rect x="24" y="44" width="176" height="8" rx="4" fill="#9fd0b6"/><rect x="24" y="64" width="96" height="8" rx="4" fill="#9fd0b6"/><circle cx="260" cy="48" r="26" fill="none" stroke="#ffffff" stroke-width="4"/><path d="M248 48l9 9 16-18" fill="none" stroke="#ffffff" stroke-width="4"/></svg></header>
<section class="state" data-state="rest"><p>설거지 · 보통 매일 · 20분</p><label class="btn" for="s-logged" data-step="log:1">설거지 20분 적기</label></section>
<section class="state" data-state="logged"><p class="stamp" data-done="log">지우 방금 · 설거지 20분</p><label class="btn quiet" for="s-rest" data-step="undo:1">되돌리기</label></section>
<section class="state" data-state="rest"><p data-done="undo">오늘 적은 집안일이 없어요</p></section>
</main><nav class="tabs"><a href="#book">장부</a><a href="#week">이번 주</a><a href="#home">우리 집</a></nav></body></html>`;

/** The page as the studio used to get them: frozen in the moment after, with nothing to press. */
export const FROZEN = `${head('B · 한 자리를 누르는 집 약도', '싱크대를 누르면 그 자리에 기록이 꽂힌다.', '')}<body><main>
<h1>망원동 집</h1><p data-done="log">지우 방금 · 설거지 20분</p><span class="btn quiet">되돌리기</span>
</main></body></html>`;

/** A toast fixed over the button that carries the step, a control too small for a thumb, and one that gives nothing back. */
export const COVERED = `${head('C · 다이얼', '다이얼을 맞추고 누른다.', `
body:has(#c-on:checked) .done{display:block}.done{display:none}
.tiny{display:inline-block;width:24px;height:24px;background:var(--brand)}
.toast{position:fixed;left:0;right:0;top:0;height:260px;background:var(--surface);border-bottom:1px solid var(--border)}`)}<body><main>
<input type="checkbox" id="c-on" hidden><h1>코스 다이얼</h1>
<label class="tiny" for="c-on" data-step="log:1"></label><p class="done" data-done="log">적음</p>
<div class="toast">민석이 이번 주에 침구 빨래를 맡기로 했어요</div>
</main></body></html>`;

/** The control is there and pressing it does nothing: the outcome never shows. Small, and it has no pressed state. */
export const DEAD = `${head('D · 판', '누르면 적힌다.', '.tiny{display:inline-block;width:28px;height:28px;background:var(--brand)}.done{display:none}')}<body><main>
<h1>누르면 적히는 판</h1><span class="tiny" data-step="log:1"></span><p class="done" data-done="log">적음</p>
</main></body></html>`;

export const FLOW_TASKS = [
  { id: 'log', goal: '설거지 20분을 적는다', outcome: '오늘 칸에 지우의 기록이 남는다' },
  { id: 'undo', goal: '방금 적은 것을 되돌린다', outcome: '기록이 사라진다' },
];

/** A screen spec that holds, for the design-task tests. */
export const SCREEN_SPEC = {
  coreMoment: '지우가 설거지를 끝내고 3초 안에 20분을 적는다.',
  screens: [
    {
      id: 'H-01',
      name: '오늘 장부',
      purpose: '방금 한 집안일을 한 번 눌러 적는다.',
      entry: ['앱 실행', '알림'],
      elements: [
        { name: '집안일 줄', rule: '누르면 오늘 칸에 내 이름 도장이 찍힌다. 같은 일을 다시 누르면 한 번 더 적힌다.', goesTo: null },
        { name: '되돌리기', rule: '적은 뒤 5초 동안 보인다. 누르면 방금 기록이 흔적 없이 사라진다.', goesTo: null },
        { name: '집안일 고치기', rule: '집안일 이름과 걸리는 시간을 고치는 화면으로 간다.', goesTo: 'S-01' },
      ],
      states: [{ name: '기록 없음', shows: '오늘 적은 집안일이 없어요' }, { name: '저장 실패', shows: '적지 못했어요. 다시 누르면 다시 시도합니다.' }],
      exceptions: ['초대받은 사람은 다른 사람의 기록을 지울 수 없다.'],
    },
    { id: 'S-01', name: '집안일 고치기', purpose: '집안일의 이름과 시간을 고친다.', entry: ['H-01'], elements: [{ name: '시간', rule: '5분 단위로 5분에서 180분까지 고른다.', goesTo: null }], states: [], exceptions: [] },
    { id: 'A-01', name: '가입과 로그인', purpose: '이메일과 비밀번호로 가입하거나 로그인한다.', entry: ['로그인하지 않고 앱을 열 때'], elements: [{ name: '가입', rule: '이메일과 8자 이상의 비밀번호를 넣으면 바로 로그인된다.', goesTo: 'H-01' }], states: [{ name: '이미 쓰는 이메일', shows: '이미 가입한 이메일이에요. 로그인해 주세요.' }], exceptions: [] },
  ],
  tasks: [
    { id: 'log', goal: '설거지 20분을 적는다', outcome: '오늘 칸에 지우의 기록이 남는다', screen: 'H-01' },
    { id: 'undo', goal: '방금 적은 것을 되돌린다', outcome: '기록이 사라진다', screen: 'H-01' },
  ],
  events: [{ name: 'chore_logged', when: '기록이 저장될 때', measures: '주간 기록 수' }, { name: 'chore_undone', when: '되돌리기를 누를 때', measures: '잘못 누른 비율' }],
  // How it works: who uses it, how they get in, what each does from arriving to done, and what is kept.
  roles: [{ id: 'housemate', name: '같이 사는 사람', does: '자기가 한 집안일을 적고, 집의 다른 사람이 적은 것을 본다.' }],
  entry: {
    signUp: 'A-01',
    signIn: 'A-01',
    signOut: '집안일 고치기 화면의 로그아웃을 누르면 가입과 로그인 화면으로 간다.',
    sessionEnded: '다음에 무엇을 누르든 가입과 로그인 화면으로 가고, 로그인하면 보던 화면으로 돌아온다.',
    forgot: '첫 버전에는 없다. 로그인 화면이 새로 가입하라고 알려 준다.',
    leave: '첫 버전에는 없다. 집안일 고치기 화면에 문의할 주소를 적어 둔다.',
  },
  noAccounts: null,
  scenarios: [
    {
      id: 'first',
      role: 'housemate',
      steps: [
        { id: 'sign-up', screen: 'A-01', does: '이메일과 비밀번호로 가입한다', saves: 'auth 사용자와 members 행', outcome: '오늘 장부가 보인다' },
        { id: 'log', screen: 'H-01', does: '설거지 20분을 적는다', saves: 'logs 행', outcome: '오늘 칸에 기록이 남는다' },
      ],
    },
    {
      id: 'second',
      role: 'housemate',
      after: 'first',
      steps: [
        { id: 'sign-up', screen: 'A-01', does: '초대받은 이메일로 가입한다', saves: 'auth 사용자와 members 행', outcome: '오늘 장부가 보인다' },
        { id: 'see', screen: 'H-01', does: '오늘 장부를 본다', saves: null, outcome: '먼저 가입한 사람의 설거지 기록이 보인다' },
      ],
    },
  ],
  data: [
    { table: 'members', holds: '한 집에 속한 한 사람', readers: 'members' },
    { table: 'logs', holds: '누가 언제 어떤 집안일을 몇 분 했는지', readers: 'members' },
  ],
};
