// The walk that tells a product that works from a picture of one, against the real things: a browser, a small
// product served to it, and a Supabase stack. Opt-in like the other tests that need the container engine.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { chromium, devices } from 'playwright-core';
import { ScreenSpec, type Project } from '@studio-zero/protocol';
import { ProjectArms } from '../src/arms/ProjectArms.ts';
import { SupabaseStack } from '../src/arms/SupabaseStack.ts';
import { samplePhoto } from '../src/qa/samplePhoto.ts';
import { Backend, renderScenarioFeedback, walkScenarios } from '../src/qa/ScenarioRunner.ts';
import { resolveDockerBin } from '../src/sandbox/dockerBin.ts';
import type { OrbStackManager } from '../src/sandbox/OrbStackManager.ts';
import { checkScreenSpec, checkWorks } from '../src/scratch/ScreenSpec.ts';
import { runCommand } from '../src/util/run.ts';
import { sampleProject } from './helpers.ts';

/** A club's shared ledger, as small as a product with two kinds of people can be. */
const PLAN = ScreenSpec.parse({
  coreMoment: '총무가 영수증을 올리면 회원이 자기 화면에서 본다.',
  screens: [
    { id: 'A-01', name: '가입과 로그인', purpose: '이메일과 비밀번호로 들어온다.', entry: ['로그인하지 않고 열 때'], elements: [], states: [], exceptions: [] },
    { id: 'H-01', name: '장부', purpose: '모임의 지출을 올리고 본다.', entry: ['A-01'], elements: [], states: [], exceptions: [] },
  ],
  tasks: [{ id: 'post', goal: '지출을 올린다', outcome: '장부에 줄이 생긴다', screen: 'H-01' }],
  events: [],
  roles: [{ id: 'treasurer', name: '총무', does: '모임을 만들고 지출을 올린다.' }, { id: 'member', name: '회원', does: '코드로 들어와 지출을 본다.' }],
  entry: { signUp: 'A-01', signIn: 'A-01', signOut: '첫 버전에는 없다. 브라우저를 닫으면 된다고 알려 준다.', sessionEnded: '다음 요청에서 가입과 로그인 화면으로 돌아간다.', forgot: '첫 버전에는 없다. 새로 가입하라고 알려 준다.', leave: '첫 버전에는 없다. 총무에게 말하라고 알려 준다.' },
  scenarios: [
    { id: 'treasurer', role: 'treasurer', steps: [
      { id: 'sign-up', screen: 'A-01', does: '가입한다', saves: 'auth 사용자', outcome: '장부 화면이 보인다' },
      { id: 'open-club', screen: 'H-01', does: '코드를 정해 모임을 만든다', saves: 'clubs 행과 members 행', outcome: '모임 이름이 보인다' },
      { id: 'post', screen: 'H-01', does: '지출을 올린다', saves: 'entries 행', outcome: '장부에 줄이 생긴다' },
    ] },
    { id: 'member', role: 'member', after: 'treasurer', steps: [
      { id: 'sign-up', screen: 'A-01', does: '가입한다', saves: 'auth 사용자', outcome: '장부 화면이 보인다' },
      { id: 'join', screen: 'H-01', does: '총무가 정한 코드로 들어간다', saves: 'members 행', outcome: '모임 이름이 보인다' },
      { id: 'see', screen: 'H-01', does: '장부를 본다', saves: null, outcome: '총무가 올린 줄이 보인다' },
    ] },
  ],
  data: [{ table: 'clubs', holds: '모임 하나', readers: 'members' }, { table: 'members', holds: '모임에 속한 한 사람', readers: 'members' }, { table: 'entries', holds: '지출 한 건', readers: 'members' }],
});

const SCHEMA = `create table public.clubs (id bigint generated always as identity primary key, code text unique not null, owner uuid not null default auth.uid() references auth.users (id) on delete cascade);
create table public.members (club_id bigint not null references public.clubs (id) on delete cascade, user_id uuid not null default auth.uid() references auth.users (id) on delete cascade, primary key (club_id, user_id));
create table public.entries (id bigint generated always as identity primary key, club_id bigint not null references public.clubs (id) on delete cascade, author uuid not null default auth.uid() references auth.users (id) on delete cascade, memo text not null);
alter table public.clubs enable row level security;
alter table public.members enable row level security;
alter table public.entries enable row level security;
create schema private;
create function private.is_member(club bigint) returns boolean language sql security definer set search_path = '' stable as $$ select exists (select 1 from public.members m where m.club_id = club and m.user_id = (select auth.uid())) $$;
grant usage on schema private to authenticated;
grant execute on function private.is_member(bigint) to authenticated;
create policy "members see their club" on public.clubs for select to authenticated using (owner = (select auth.uid()) or private.is_member(id));
create policy "a person opens a club" on public.clubs for insert to authenticated with check (owner = (select auth.uid()));
create policy "members see each other" on public.members for select to authenticated using (private.is_member(club_id));
create policy "the owner joins their club" on public.members for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.clubs c where c.id = club_id and c.owner = (select auth.uid())));
create policy "members read the ledger" on public.entries for select to authenticated using (private.is_member(club_id));
create policy "members post to the ledger" on public.entries for insert to authenticated with check (author = (select auth.uid()) and private.is_member(club_id));
create function public.join_club(code text) returns bigint language plpgsql security definer set search_path = '' as $$
declare found bigint;
begin
  select c.id into found from public.clubs c where c.code = join_club.code;
  if found is null then raise exception 'no club has that code'; end if;
  insert into public.members (club_id, user_id) values (found, (select auth.uid())) on conflict do nothing;
  return found;
end $$;
revoke execute on function public.join_club(text) from public, anon;
grant execute on function public.join_club(text) to authenticated;
grant select, insert on public.clubs, public.members, public.entries to authenticated;`;

/**
 * The product, in one page, speaking to the backend the way a client library does. `mode` makes it one of the
 * things a build can be while looking the same: `real`; `fake`, whose sign-up never reaches the backend; and
 * `memory`, which keeps what a person posts in the page and nowhere else.
 */
const page = (api: string, key: string, mode: string): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>장부</title>
<style>body{font:16px system-ui;margin:24px}input,button{font:inherit;padding:10px 14px;margin:4px 0;display:block;min-height:44px}button:active{transform:scale(.97);background:#ddd}</style></head>
<body><div id="app"></div><script>
const API=${JSON.stringify(api)},KEY=${JSON.stringify(key)},MODE=${JSON.stringify(mode)};
let session=JSON.parse(localStorage.getItem('session')||'null'),signingIn=false,club=null,entries=[],error='';const memory=[];
const call=async(path,init={})=>{const res=await fetch(API+path,{...init,headers:{apikey:KEY,'content-type':'application/json',...(session&&session.access_token!=='fake'?{authorization:'Bearer '+session.access_token}:{}),...(init.headers||{})}});const body=await res.json().catch(()=>null);if(!res.ok)throw new Error((body&&(body.msg||body.message))||String(res.status));return body;};
const load=async()=>{if(!session||MODE==='fake')return;const clubs=await call('/rest/v1/clubs?select=id,code&order=id.desc&limit=1');club=clubs[0]||null;entries=club?(MODE==='memory'?memory:await call('/rest/v1/entries?select=id,memo&club_id=eq.'+club.id+'&order=id')):[];};
const val=(id)=>document.getElementById(id).value.trim();
const act=(fn)=>async()=>{try{error='';await fn();await load();}catch(e){error=String(e.message||e);}render();};
function render(){const app=document.getElementById('app');
 if(!session){const id=signingIn?'sign-in':'sign-up',n=signingIn?2:1;
  app.innerHTML='<h1>'+(signingIn?'로그인':'가입')+'</h1><input id="email" type="email" autocomplete="email" data-step="'+id+':'+n+'" placeholder="이메일"><input id="password" type="password" data-step="'+id+':'+(n+1)+'" placeholder="비밀번호"><button id="go" data-step="'+id+':'+(n+2)+'">'+(signingIn?'로그인':'가입하기')+'</button>'+(signingIn?'':'<button id="other" data-step="sign-in:1">이미 계정이 있어요</button>')+'<p>'+error+'</p>';
  document.getElementById('go').onclick=act(async()=>{const body={email:val('email'),password:val('password')};session=MODE==='fake'&&!signingIn?{access_token:'fake',user:{email:body.email}}:await call(signingIn?'/auth/v1/token?grant_type=password':'/auth/v1/signup',{method:'POST',body:JSON.stringify(body)});localStorage.setItem('session',JSON.stringify(session));});
  const other=document.getElementById('other');if(other)other.onclick=()=>{signingIn=true;render();};return;}
 let html='<header data-done="sign-up"><b data-done="sign-in">내 장부</b> '+session.user.email+'</header><p>'+error+'</p>';
 if(!club)html+='<input id="new-code" data-step="open-club:1" data-sample="RUN-{run}" placeholder="새 모임 코드"><button id="make" data-step="open-club:2">모임 만들기</button><input id="join-code" data-step="join:1" data-sample="RUN-{run}" placeholder="받은 코드"><button id="join" data-step="join:2">코드로 들어가기</button>';
 else html+='<h2 data-done="open-club"><span data-done="join">모임 '+club.code+'</span></h2><input id="memo" data-step="post:1" data-sample="물·간식" placeholder="무엇에 썼나요"><button id="add" data-step="post:2">올리기</button><ul>'+entries.map((e)=>'<li data-done="post"><span data-done="see">'+e.memo+'</span></li>').join('')+'</ul>'+(entries.length?'':'<p>아직 올린 지출이 없어요</p>');
 app.innerHTML=html;
 const on=(id,fn)=>{const el=document.getElementById(id);if(el)el.onclick=act(fn);};
 on('make',async()=>{const made=await call('/rest/v1/clubs',{method:'POST',headers:{Prefer:'return=representation'},body:JSON.stringify({code:val('new-code')})});await call('/rest/v1/members',{method:'POST',body:JSON.stringify({club_id:made[0].id})});});
 on('join',async()=>{await call('/rest/v1/rpc/join_club',{method:'POST',body:JSON.stringify({code:val('join-code')})});});
 on('add',async()=>{if(MODE==='memory')memory.push({id:memory.length+1,memo:val('memo')});else await call('/rest/v1/entries',{method:'POST',body:JSON.stringify({club_id:club.id,memo:val('memo')})});});}
load().catch((e)=>{error=String(e.message||e);}).then(render);
</script></body></html>`;

test('the plan this walk uses holds as a plan for a product that works', () => {
  assert.deepEqual(checkScreenSpec(PLAN, { draft: true }), []);
  assert.deepEqual(checkWorks(PLAN), []);
});

test('a real walk: a product that works passes; one that fakes its sign-up, forgets on reload, or lets a stranger read is told exactly that', { skip: process.env.SZ_TEST_ENGINE !== '1' && 'set SZ_TEST_ENGINE=1 to run (needs OrbStack, the Supabase command line and Chrome)' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'sz-walk-home-'));
  const workspace = mkdtempSync(join(tmpdir(), 'sz-walk-ws-'));
  mkdirSync(join(home, 'docker'), { recursive: true });
  writeFileSync(join(home, 'docker', 'config.json'), '{}\n');
  mkdirSync(join(workspace, '.git/info'), { recursive: true });
  const socket = join(process.env.HOME ?? '', '.orbstack/run/docker.sock');
  const stack = new SupabaseStack({ home, run: runCommand, engineEndpoint: async () => (existsSync(socket) ? `unix://${socket}` : 'unix:///var/run/docker.sock'), dockerBin: resolveDockerBin('docker') });
  const put = (path: string, content: string): void => {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), content);
  };
  const sandboxes = {
    exec: async (_project: Project, script: string) => runCommand('bash', ['-c', script], { cwd: workspace }),
    readFile: async (_project: Project, path: string) => ({ content: readFileSync(join(workspace, path), 'utf8'), truncated: false }),
    writeFile: async (_project: Project, path: string, content: string | Uint8Array) => put(path, String(content)),
  } as unknown as OrbStackManager;
  const arms = new ProjectArms({ stack, sandboxes });
  const project: Project = { ...sampleProject('walk-real'), id: 'prj_walk_real_test', template: 'web-vite-react' };

  let mode = 'real';
  let api = '';
  let key = '';
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page(api, key, mode)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    put('supabase/migrations/0001_ledger.sql', SCHEMA);
    const applied = await arms.applySchema(project);
    assert.equal(applied.ok, true, applied.text);
    const info = (await arms.ensure(project))!.info;
    api = info.apiUrl;
    key = info.publishableKey;
    const backend = new Backend(info, (script) => arms.sql(project, script));
    // The API learns of new tables a moment after the schema commits.
    for (let i = 0; i < 30 && (await fetch(`${api}/rest/v1/clubs?select=id`, { headers: { apikey: key } })).status === 404; i++) await new Promise((resolve) => setTimeout(resolve, 500));
    let restarts = 0;
    const walk = (run: string) => walkScenarios({ browser, base, phone: null, spec: PLAN, backend, run, restart: async () => { restarts += 1; await arms.rest(project); await arms.ensure(project); } });
    const users = async (run: string): Promise<string> => (await arms.sql(project, `select count(*) from auth.users where email like 'sz-%-${run}@example.com';\n`)).stdout.trim();

    // --- a product that works: both scenarios to the end, a restart survived, a second sign-in, nothing leaked
    const good = await walk('aaaa1111');
    assert.deepEqual(good, { walked: 2, problems: [], logins: [], looks: [] }, renderScenarioFeedback({ ...good, scenarios: 2 }));
    assert.equal(restarts, 1);
    assert.equal(await users('aaaa1111'), '3', 'the treasurer, the member and the stranger all signed up for real');
    // The second person typed the code the first one picked, and both carried this walk's name.
    assert.equal((await arms.sql(project, "select code from public.clubs order by id desc limit 1;\n")).stdout.trim(), 'RUN-aaaa1111');
    await backend.forget('aaaa1111');
    assert.equal(await users('aaaa1111'), '0', 'the walk\'s people are taken out again');
    assert.equal((await arms.sql(project, 'select count(*) from public.entries;\n')).stdout.trim(), '0', 'and what hung on them went with them');

    // --- the same screens with a sign-up that never reaches the backend
    mode = 'fake';
    const fake = await walk('bbbb2222');
    assert.equal(fake.walked, 0);
    assert.match(fake.problems[0]!, /^Scenario "treasurer" \(총무\), step 1 "sign-up": the screen showed its outcome, and the backend has no user with the address the studio typed into the email field \(sz-treasurer-bbbb2222@example\.com\)/);
    assert.equal(restarts, 1, 'what comes after is not looked at until the scenarios are walked');
    await backend.forget('bbbb2222');

    // --- and with what a person posts kept in the page: it is gone after a reload
    mode = 'memory';
    const memory = await walk('cccc3333');
    assert.match(memory.problems.join('\n'), /Scenario "treasurer" \(총무\): after a reload, nothing carrying data-done="post" is on screen \(장부에 줄이 생긴다\)[\s\S]*The screen said: "내 장부 sz-treasurer-cccc3333@example\.com 모임 RUN-cccc3333[\s\S]*아직 올린 지출이 없어요/);
    // What that person did save is said with it: a builder cannot ask the backend from its sandbox.
    assert.match(memory.problems.join('\n'), /Rows made or changed by then: clubs \(1\) \[\{.*"code":"RUN-cccc3333".*members \(1\) \[\{/);
    assert.doesNotMatch(memory.problems.join('\n'), /entries \(\d+\)/, 'and what it did not save is not there to be seen');
    await backend.forget('cccc3333');

    // --- the product is right and a policy is not: any signed-in person may read the ledger
    mode = 'real';
    put('supabase/migrations/0002_open.sql', 'create policy "anyone signed in reads the ledger" on public.entries for select to authenticated using (true);');
    assert.equal((await arms.applySchema(project)).ok, true, 'a policy that is too wide is still a policy: only a person who is not meant to read can show it');
    const open = await walk('dddd4444');
    assert.equal(open.walked, 2);
    assert.deepEqual(open.problems, ['Table entries ("members" may read it): a stranger who had only signed up read 1 row that the scenarios\' people made. Its select policy lets any signed-in person through; write it against who the row belongs to.']);
    await backend.forget('dddd4444');

    // --- a step whose control is not there says which, with what the screen said and what the backend refused
    put('supabase/migrations/0003_closed.sql', 'drop policy "a person opens a club" on public.clubs;');
    assert.equal((await arms.applySchema(project)).ok, true);
    const refused = await walk('eeee5555');
    assert.equal(refused.walked, 0);
    assert.match(refused.problems[0]!, /^Scenario "treasurer" \(총무\), step 2 "open-club" \(코드를 정해 모임을 만든다\): 2 marked controls were pressed and nothing carrying data-done="open-club" came on screen\. Expected afterwards: 모임 이름이 보인다\. The screen said: "내 장부 sz-treasurer-eeee5555@example\.com new row violates row-level security policy for table "clubs" 모임 만들기 코드로 들어가기" The backend refused: 403 POST \/rest\/v1\/clubs: \{"code":"42501"[^|]*row-level security/);
    assert.match(refused.problems[0]!, / No row of any table had been made or changed by then\.$/);
    await backend.forget('eeee5555');
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
    await arms.forget(project).catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }
});

/** A two-screen product nobody signs in to: a count on the first screen and its result on the second, kept in the browser. */
const COUNTER_PLAN = ScreenSpec.parse({
  coreMoment: '오늘 마신 물을 한 번 눌러 적고 결과를 본다.',
  screens: [
    { id: 'H-01', name: '오늘', purpose: '마신 물을 적는다.', entry: ['앱을 열 때'], elements: [], states: [], exceptions: [] },
    { id: 'R-01', name: '결과', purpose: '오늘 마신 양을 본다.', entry: ['H-01'], elements: [], states: [], exceptions: [] },
  ],
  tasks: [{ id: 'drink', goal: '물 한 잔을 적는다', outcome: '오늘 칸에 한 잔이 보인다', screen: 'H-01' }],
  events: [],
  roles: [{ id: 'visitor', name: '쓰는 사람', does: '마신 물을 적고 결과를 본다.' }],
  entry: null,
  noAccounts: '이 기기에만 적는 메모라서 계정이 없다.',
  scenarios: [
    { id: 'drinks', role: 'visitor', steps: [
      { id: 'drink', screen: 'H-01', does: '물 한 잔을 적는다', saves: null, outcome: '오늘 칸에 한 잔이 보인다' },
      // Pressed on the first screen, and it ends on the second: the screen's own mark says which was measured.
      { id: 'result', screen: 'H-01', does: '결과를 연다', saves: null, outcome: '오늘 마신 양이 보인다' },
      { id: 'share', screen: 'R-01', does: '결과를 자랑한다', saves: null, outcome: '자랑했다는 표시가 보인다' },
      { id: 'photo', screen: 'R-01', does: '컵 사진을 고른다', saves: null, outcome: '고른 사진의 크기가 보인다' },
    ] },
  ],
  data: [],
});

/** `faint` gives the second screen a line of text nobody can read. */
const counter = (faint: boolean): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>물</title>
<style>body{margin:0;padding:24px;font:16px/1.6 system-ui;background:#fff;color:#111}button{font:inherit;min-height:48px;padding:0 20px;border:0;border-radius:8px;background:#124;color:#fff;display:block;margin:12px 0}button:active{background:#000}h1{font-size:24px;margin:0}p{margin:8px 0}.note{color:${faint ? '#d8d8d8' : '#333'}}</style></head>
<body><div id="app"></div><script>
const s=JSON.parse(localStorage.getItem('s')||'{"cups":0,"at":"home","shared":false,"photo":""}');
const keep=()=>{localStorage.setItem('s',JSON.stringify(s));render();};
function render(){const app=document.getElementById('app');
 if(s.at==='home'){app.innerHTML='<main data-screen="H-01"><h1>오늘</h1><button id="drink" data-step="drink:1">물 한 잔</button>'+(s.cups>0?'<p data-done="drink">'+s.cups+'잔 마셨어요</p><button id="open" data-step="result:1">결과 보기</button>':'<p>아직 적은 물이 없어요</p>')+'</main>';
  document.getElementById('drink').onclick=()=>{s.cups+=1;keep();};const open=document.getElementById('open');if(open)open.onclick=()=>{s.at='result';keep();};return;}
 app.innerHTML='<main data-screen="R-01"><h1 data-done="result">오늘 '+(s.cups*200)+'mL</h1><p class="note">하루 권장량은 1.5리터에서 2리터 사이입니다</p><button id="share" data-step="share:1">자랑하기</button>'+(s.shared?'<p data-done="share">자랑했어요</p>':'')+'<button id="pick" data-step="photo:1">사진 고르기</button>'+(s.photo?'<p data-done="photo">'+s.photo+'</p>':'')+'</main>';
 document.getElementById('share').onclick=()=>{s.shared=true;keep();};
 // The way a picker library does it: an input made for the moment and clicked.
 document.getElementById('pick').onclick=()=>{const input=document.createElement('input');input.type='file';input.accept='image/*';input.onchange=async()=>{const file=input.files[0];const bitmap=await createImageBitmap(file);s.photo=file.name+' '+file.type+' '+bitmap.width+'x'+bitmap.height;keep();};input.click();};}
render();
</script></body></html>`;

test('what a walk stands on is measured where it stands: a screen as it is first seen, at the size walked, and a line nobody can read is found on the screen it is on', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  assert.deepEqual([...checkScreenSpec(COUNTER_PLAN, { draft: true }), ...checkWorks(COUNTER_PLAN)], []);
  let faint = true;
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(counter(faint)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const walk = (look: boolean) => walkScenarios({ browser, base, phone: devices['iPhone 15 Pro']!, spec: COUNTER_PLAN, backend: null, run: 'ffff6666', restart: async () => undefined, ...(look ? { look: { template: 'mobile-expo' as const } } : {}) });
  try {
    const seen = await walk(true);
    assert.deepEqual([seen.walked, seen.problems], [1, []]);
    // Four steps stood on two screens: each is measured the first time a step stands on it.
    assert.deepEqual(seen.looks.map((look) => [look.screen, look.scenario]), [['H-01', 'drinks'], ['R-01', 'drinks']]);
    const heavy = (screen: string): string[] => seen.looks.find((look) => look.screen === screen)!.findings.filter((f) => f.severity !== 'minor' && f.category === 'contrast').map((f) => `${f.rule} ${f.viewport} ${f.route}: ${f.message}`);
    assert.deepEqual(heavy('H-01'), [], 'the first screen is readable');
    assert.equal(heavy('R-01').length, 1);
    assert.match(heavy('R-01')[0]!, /^contrast\/text iphone-15-pro R-01: "하루 권장량은 1\.5리터에서 2리터 사이입니다" has contrast 1\.\d+:1; .*it fails AA/);
    // The person was asked for a photo: the chooser was answered with the studio's sample, and it is a picture a browser can read.
    assert.match(await (async () => { const context = await browser.newContext(); const page = await context.newPage(); await page.goto(base); await page.evaluate(() => { localStorage.setItem('s', JSON.stringify({ cups: 1, at: 'result', shared: true, photo: '' })); }); await page.reload(); page.on('filechooser', (chooser) => void chooser.setFiles({ name: 'sample-photo.png', mimeType: 'image/png', buffer: samplePhoto() })); await page.click('#pick'); const text = await page.locator('[data-done="photo"]').innerText(); await context.close(); return text; })(), /^sample-photo\.png image\/png 640x480$/);
    // The picture is of the screen as the person had it: a PNG, taken on the second screen with their figure on it.
    for (const look of seen.looks) assert.deepEqual([...look.png!.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

    // The same product with the line readable: nothing above minor about its colours on either screen.
    faint = false;
    const clean = await walk(true);
    assert.deepEqual(clean.looks.flatMap((look) => look.findings.filter((f) => f.severity !== 'minor' && f.category === 'contrast')), []);
    // And a walk nobody asked to measure measures nothing.
    assert.deepEqual((await walk(false)).looks, []);
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the people a walk made are taken out again: a backend that will not let one go is said, and is cleared all the same', async () => {
  // Found on 2026-11-15 in the first long run's project: 353 made-up people from 51 walks were still in its
  // database. A trigger of the product's own recomputed a score for the person being deleted, the delete failed,
  // and the studio had asked for it without looking at the answer.
  const REFUSED = 'ERROR:  insert or update on table "daily_scores" violates foreign key constraint "daily_scores_user_id_fkey"\nCONTEXT:  PL/pgSQL function meals_rescore() line 3 at PERFORM';
  const info = { id: 'x', apiUrl: 'http://127.0.0.1:1', apiUrlFromSandbox: 'http://host:1', publishableKey: 'pk', adminKeys: [], dbUrl: '', mailUrl: null, logins: [] } as unknown as ConstructorParameters<typeof Backend>[0];
  const scripts: string[] = [];
  const holding = new Backend(info, async (script) => (scripts.push(script) === 1 ? { exitCode: 3, stdout: '', stderr: REFUSED } : { exitCode: 0, stdout: '', stderr: '' }));
  const said = await holding.forget('abcd1234');
  assert.match(said ?? '', /violates foreign key constraint "daily_scores_user_id_fkey".*meals_rescore\(\)/s);
  assert.equal(scripts.length, 2, 'asked plainly, and then with the product\'s own triggers held off');
  assert.match(scripts[0]!, /^delete from auth\.users where email like 'sz-%-abcd1234@example\.com';\n$/);
  assert.match(scripts[1]!, /disable trigger user[\s\S]*delete from auth\.users where email like 'sz-%-abcd1234@example\.com';[\s\S]*enable trigger user/);
  // A backend that lets them go is asked once and has nothing to say.
  const asked: string[] = [];
  assert.equal(await new Backend(info, async (script) => (asked.push(script), { exitCode: 0, stdout: '', stderr: '' })).forget('abcd1234'), null);
  assert.equal(asked.length, 1);
});

test('a screen is measured again in the state a press puts it in: a second button that comes with saving, and breaks its label, is found', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  // The owner's find of 2026-11-15, on a product every gate had passed: a tip's dock holds one button until the tip
  // is saved, and two after, the new one too narrow for its words. The screen had been measured once, as first seen.
  let narrow = true;
  const tip = (): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>팁</title>
<style>body{margin:0;padding:24px;font:16px/1.6 system-ui;background:#fff;color:#111}h1{font-size:24px;margin:0}p{margin:8px 0}.dock{display:flex;gap:12px}button{font:inherit;font-weight:700;min-height:52px;padding:0 20px;border:0;border-radius:8px;background:#124;color:#fff;flex:1}button:active{background:#000}.dock .saved{flex:none;width:${narrow ? '116px' : 'auto'}}</style></head>
<body><div id="app"></div><script>
const s=JSON.parse(localStorage.getItem('s')||'{"saved":false,"at":"tip"}');
const keep=()=>{localStorage.setItem('s',JSON.stringify(s));render();};
function render(){const app=document.getElementById('app');
 if(s.at==='tip'){app.innerHTML='<main data-screen="H-01"><h1>물 먼저 한 컵</h1><p>식사 전에 물을 마시면 덜 먹게 돼요</p>'+(s.saved?'<p data-done="save">저장했어요</p>':'')+'<div class="dock">'+(s.saved?'<button id="open" class="saved" data-step="open:1">저장한 팁 보기</button>':'')+'<button id="save" data-step="save:1">'+(s.saved?'저장함':'이 팁 저장하기')+'</button></div></main>';
  document.getElementById('save').onclick=()=>{s.saved=true;keep();};const open=document.getElementById('open');if(open)open.onclick=()=>{s.at='saved';keep();};return;}
 app.innerHTML='<main data-screen="R-01"><h1 data-done="open">저장한 팁</h1><p>물 먼저 한 컵</p></main>';}
render();
</script></body></html>`;
  const plan = ScreenSpec.parse({
    ...COUNTER_PLAN,
    scenarios: [{ id: 'keeps', role: 'visitor', steps: [
      { id: 'save', screen: 'H-01', does: '팁을 저장한다', saves: null, outcome: '저장했다는 표시가 보인다' },
      { id: 'open', screen: 'H-01', does: '저장한 팁을 연다', saves: null, outcome: '저장한 팁 목록이 보인다' },
    ] }],
  });
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(tip()));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const walk = () => walkScenarios({ browser, base, phone: devices['iPhone 15 Pro']!, spec: plan, backend: null, run: 'cdcd8888', restart: async () => undefined, look: { template: 'mobile-expo' } });
  const heavy = (look: { findings: readonly { rule: string; severity: string }[] }): string[] => look.findings.filter((f) => f.severity !== 'minor').map((f) => f.rule);
  try {
    const seen = await walk();
    assert.deepEqual([seen.walked, seen.problems], [1, []]);
    // The tip as first seen, the tip once saved, and the list: the saved tip is the same screen in another state.
    assert.deepEqual(seen.looks.map((look) => look.screen), ['H-01', 'H-01', 'R-01']);
    assert.ok(!heavy(seen.looks[0]!).includes('type/broken-label'), 'as first seen it has one button, with room for its words');
    // Of the later state only what the screen had not already shown is kept, with a picture of that state.
    assert.deepEqual(seen.looks[1]!.findings.map((f) => `${f.severity} ${f.rule}: ${f.message}`), ['major type/broken-label: "저장한 팁 보기" is broken onto 2 lines inside its control.']);
    assert.deepEqual([...seen.looks[1]!.png!.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    // Given the width of its words the later state has nothing to add, and adds no look.
    narrow = false;
    assert.deepEqual((await walk()).looks.map((look) => look.screen), ['H-01', 'R-01']);
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a step longer than a core flow\'s is carried out to its end; one past what the studio presses in a step is told to split', async (t) => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 15_000 }).catch(() => null);
  if (!browser) return t.skip('headless Chrome cannot be launched here');
  // A profile form: each press shows the next control, and the outcome comes after the last. Kept across a reload.
  const form = (presses: number): string => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>프로필</title>
<style>body{margin:0;padding:24px;font:16px/1.6 system-ui;background:#fff;color:#111}button{font:inherit;min-height:48px;padding:0 20px;border:0;border-radius:8px;background:#124;color:#fff}button:active{background:#000}</style></head>
<body><div id="app"></div><script>
let at=Number(localStorage.getItem('at')||'1');
function render(){document.getElementById('app').innerHTML='<main data-screen="'+(at>6?'R-01':'H-01')+'">'+(at>${presses}?'<p data-done="profile">프로필을 저장했어요</p>':'<button id="next" data-step="profile:'+at+'">'+at+'번째 칸 채우기</button>')+'</main>';
 const next=document.getElementById('next');if(next)next.onclick=()=>{at+=1;localStorage.setItem('at',String(at));render();};}
render();
</script></body></html>`;
  const plan = ScreenSpec.parse({
    ...COUNTER_PLAN,
    scenarios: [{ id: 'fills', role: 'visitor', steps: [{ id: 'profile', screen: 'H-01', does: '프로필을 채운다', saves: null, outcome: '저장했다는 표시가 보인다' }] }],
  });
  let presses = 12;
  const server = createServer((_req, res) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(form(presses)));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const walk = () => walkScenarios({ browser, base, phone: devices['iPhone 15 Pro']!, spec: plan, backend: null, run: 'abab7777', restart: async () => undefined, look: { template: 'mobile-expo' } });
  try {
    // Twelve presses: more than a mock-up's core flow is walked for (eight), and a step of a real product.
    const long = await walk();
    assert.deepEqual([long.walked, long.problems], [1, []]);
    // The form's second page is a screen of its own that no step of the plan names: it was passed through, and measured.
    assert.deepEqual(long.looks.map((look) => look.screen), ['H-01', 'R-01']);
    presses = 30;
    const tooLong = await walk();
    assert.equal(tooLong.walked, 0);
    assert.equal(tooLong.problems.length, 1);
    assert.match(tooLong.problems[0]!, /^Scenario "fills" \(쓰는 사람\), step 1 "profile" \(프로필을 채운다\): 24 marked controls were pressed, which is as far as the studio goes in one step, and nothing carrying data-done="profile" had come on screen\. Split it: a step is one thing a person gets done, with its own id, its own marks counted from 1 and its own outcome on screen\. Expected afterwards: 저장했다는 표시가 보인다\. The screen said: "25번째 칸 채우기"/);
  } finally {
    await browser.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
});
