import { z } from 'zod';
import { TaskKind } from '@studio-zero/protocol';

/**
 * Every side effect the daemon can perform on someone's behalf is one of these typed actions.
 * If something is not expressible as an Action, the daemon has no code path that does it.
 */
export const Action = z.discriminatedUnion('kind', [
  // Budget gate in front of every model request the daemon makes or proxies.
  z.object({ kind: z.literal('llm.request'), projectId: z.string(), taskId: z.string().nullable(), model: z.string() }),

  z.object({ kind: z.literal('project.delete'), projectId: z.string(), deleteWorkspace: z.boolean() }),
  z.object({ kind: z.literal('task.extend-budget'), projectId: z.string(), taskId: z.string(), addTokens: z.number().int().positive(), spentTokens: z.number().int().nonnegative().optional() }),
  z.object({ kind: z.literal('task.steer'), projectId: z.string(), taskId: z.string() }),
  z.object({ kind: z.literal('checkpoint.fork'), projectId: z.string(), checkpointId: z.string() }),
  z.object({ kind: z.literal('scratch.promote'), scratchId: z.string(), target: z.enum(['build', 'document']) }),
  z.object({ kind: z.literal('knowledge.run'), jobKind: z.enum(['research', 'document']) }),
  z.object({ kind: z.literal('task.submit'), projectId: z.string(), taskKind: TaskKind, budgetTokens: z.number().int() }),
  // The owner's verdict on a plan a task is waiting with, before any code: approving it starts the build on that
  // plan, asking for changes has it drafted again. Bound to the version and the hash of the text that was shown.
  z.object({ kind: z.literal('plan.review.resolve'), projectId: z.string(), taskId: z.string(), version: z.number().int(), planHash: z.string() }),
  // Saving, pausing, resuming or removing a prompt the daemon submits as a task by itself later. Each run it
  // starts is still a `task.submit` and spends through `llm.request`; this decides who may set one up at all.
  z.object({ kind: z.literal('schedule.configure'), projectId: z.string(), op: z.enum(['create', 'pause', 'resume', 'delete']), scheduleId: z.string().nullable(), taskKind: TaskKind, every: z.number().int().nullable() }),

  // Confined to the project's container. The command text is recorded for the audit trail, not pattern-matched:
  // filtering shell strings is not a security boundary, the container is.
  z.object({ kind: z.literal('sandbox.exec'), projectId: z.string(), command: z.string() }),
  z.object({ kind: z.literal('sandbox.write'), projectId: z.string(), path: z.string() }),
  z.object({ kind: z.literal('sandbox.lifecycle'), projectId: z.string(), op: z.enum(['start', 'stop', 'recreate']) }),
  // An interactive shell in the project's container, for the owner. Contained exactly as `sandbox.exec` is.
  z.object({ kind: z.literal('sandbox.terminal'), projectId: z.string() }),
  // One question to another vendor's model through its subscription CLI: it spends the owner's quota there.
  z.object({ kind: z.literal('advisor.ask'), projectId: z.string(), advisor: z.enum(['codex', 'gemini']) }),

  // Opening a page the owner named as a design reference. It is opened inside the QA browser container, never
  // on this Mac, and only a public https page is ever opened: `url` is checked again by the rule.
  z.object({ kind: z.literal('reference.capture'), projectId: z.string(), url: z.string() }),
  // A picture for the product, made by a subscription's image tool on the host and written into the workspace.
  z.object({ kind: z.literal('image.generate'), projectId: z.string(), taskId: z.string().nullable(), path: z.string() }),
  // Holding this Mac awake (or letting it sleep again).
  z.object({ kind: z.literal('power.set'), mode: z.enum(['off', 'system', 'display']) }),
  // Copying a finished Core task's branch out of its sandbox into the studio's own checkout, as a new feature
  // branch. Adds a ref; changes no file and no existing branch.
  z.object({ kind: z.literal('selfhost.export'), projectId: z.string(), branch: z.string() }),
  // Moving the base branch of the studio's own checkout forward to a branch a Core task produced.
  z.object({ kind: z.literal('selfhost.merge'), projectId: z.string(), branch: z.string() }),

  z.object({ kind: z.literal('checkpoint.rollback'), projectId: z.string(), checkpointId: z.string() }),
  z.object({ kind: z.literal('git.merge'), projectId: z.string(), branch: z.string(), into: z.string() }),

  z.object({ kind: z.literal('kirby.ingest'), projectId: z.string(), repoUrl: z.string() }),
  z.object({ kind: z.literal('kirby.materialize'), projectId: z.string(), proposalId: z.string() }),

  z.object({ kind: z.literal('lesson.activate'), lessonId: z.string(), scope: z.enum(['project', 'global']), projectId: z.string().nullable() }),
  z.object({ kind: z.literal('eval.disable'), projectId: z.string(), evalId: z.string() }),

  // Reaching beyond the sandbox through a tool server (MCP). `host` is where the call will go (a remote host, or
  // `local:<program>` for a server that runs on this Mac), taken from the stored server by daemon code, so what
  // the owner approves names the destination.
  z.object({ kind: z.literal('mcp.search'), projectId: z.string() }),
  z.object({ kind: z.literal('mcp.call'), projectId: z.string(), serverId: z.string(), host: z.string(), tool: z.string() }),
  z.object({ kind: z.literal('mcp.configure'), serverId: z.string(), op: z.enum(['add', 'remove', 'revoke']) }),

  // Connecting or disconnecting an outside API and its key for a project.
  z.object({ kind: z.literal('external.configure'), projectId: z.string(), name: z.string(), op: z.enum(['set', 'remove']) }),
  // A call from a project's own code to an outside API, with the owner's key put in by the gateway. `host` is
  // where the stored connection says it goes.
  z.object({ kind: z.literal('external.call'), projectId: z.string(), name: z.string(), host: z.string() }),

  z.object({ kind: z.literal('vault.write'), credentialId: z.string() }),
  z.object({ kind: z.literal('vault.delete'), credentialId: z.string() }),
]);
export type Action = z.infer<typeof Action>;
export type ActionKind = Action['kind'];

/**
 * Who is asking. Derived from the transport by daemon code, never from message content:
 * - `owner`: an authenticated control-socket client (`desktop`), or an owner identified by a messenger relay.
 * - `agent`: a model-driven loop acting inside a task.
 * - `system`: the daemon's own harness logic (verify, reflect, evolve).
 */
export type Actor = { type: 'owner'; via: 'desktop' | 'telegram' | 'slack' | 'ntfy' } | { type: 'agent'; taskId: string } | { type: 'system' };

export function actorLabel(actor: Actor): string {
  return actor.type === 'owner' ? `owner:${actor.via}` : actor.type === 'agent' ? `agent:${actor.taskId}` : 'system';
}

export function actionProjectId(action: Action): string | null {
  return 'projectId' in action ? action.projectId : null;
}

/**
 * The text a human sees on an approval prompt, in the owner's language. Built here from the action's fields so
 * that what is approved is exactly what will run; a model never writes its own approval prompt.
 */
export function describeAction(action: Action): string {
  const n = (value: number): string => value.toLocaleString('en-US');
  switch (action.kind) {
    case 'llm.request':
      return `모델 요청 (${action.model})`;
    case 'project.delete':
      return `프로젝트 ${action.projectId}${action.deleteWorkspace ? '와 워크스페이스를' : '를'} 삭제`;
    case 'task.extend-budget':
      return `작업 ${action.taskId}이(가) 토큰 예산을 다 썼습니다${action.spentTokens === undefined ? '' : ` (지금까지 ${n(action.spentTokens)} 토큰)`}. 여기서 ${n(action.addTokens)} 토큰을 더 쓰게 할까요?`;
    case 'task.steer':
      return `작업 ${action.taskId}에 방향 전달`;
    case 'checkpoint.fork':
      return `체크포인트 ${action.checkpointId}에서 새 갈래 만들기`;
    case 'scratch.promote':
      return `작업 노트 ${action.scratchId}을(를) ${action.target === 'build' ? '프로젝트로' : '문서로'} 승격`;
    case 'knowledge.run':
      return action.jobKind === 'research' ? '자료 조사 시작' : '문서 작성 시작';
    case 'task.submit':
      return `${action.taskKind} 작업 시작 (예산 ${n(action.budgetTokens)} 토큰)`;
    case 'plan.review.resolve':
      return `작업 ${action.taskId}의 계획 ${action.version}번째 안에 답하기`;
    case 'schedule.configure': {
      const when = action.every === null ? '정한 시각에 한 번' : `${n(action.every)}분마다`;
      const op = { create: '추가', pause: '일시 정지', resume: '다시 켜기', delete: '삭제' }[action.op];
      return `프로젝트 ${action.projectId}의 예약 작업 ${op} (${action.taskKind}, ${when})`;
    }
    case 'sandbox.exec':
      return `샌드박스에서 실행: ${action.command.slice(0, 200)}`;
    case 'sandbox.write':
      return `샌드박스에 파일 쓰기: ${action.path}`;
    case 'sandbox.lifecycle':
      return `샌드박스 ${action.op}`;
    case 'sandbox.terminal':
      return `프로젝트 ${action.projectId}의 샌드박스에서 터미널 열기`;
    case 'advisor.ask':
      return `${action.advisor === 'codex' ? 'Codex' : 'Gemini'}에게 의견 묻기`;
    case 'image.generate':
      return `제품에 쓸 이미지 생성 (${action.path.slice(0, 120)})`;
    case 'reference.capture':
      return `레퍼런스 페이지 ${action.url.slice(0, 120)}을(를) QA 브라우저 컨테이너에서 열어 측정`;
    case 'power.set':
      return action.mode === 'off' ? '이 Mac의 잠자기 방지 해제' : action.mode === 'system' ? '이 Mac이 잠들지 않게 유지 (화면은 꺼질 수 있음)' : '이 Mac의 화면을 켜 둔 채 유지';
    case 'selfhost.export':
      return `Studio Zero 저장소에 작업 결과를 브랜치 "${action.branch}"(으)로 내보내기`;
    case 'selfhost.merge':
      return `Studio Zero 저장소에 브랜치 "${action.branch}" 병합`;
    case 'checkpoint.rollback':
      return `워크스페이스를 체크포인트 ${action.checkpointId}(으)로 되돌리기`;
    case 'git.merge':
      return `브랜치 "${action.branch}"를 "${action.into}"에 병합`;
    case 'kirby.ingest':
      return `${action.repoUrl} 저장소를 받아 분석`;
    case 'kirby.materialize':
      return `제안 ${action.proposalId}을(를) 별도 브랜치에 구현`;
    case 'lesson.activate':
      return `${action.scope === 'global' ? '전역' : '프로젝트'} 교훈 ${action.lessonId} 적용`;
    case 'eval.disable':
      return `회귀 체크 ${action.evalId} 끄기`;
    case 'mcp.search':
      return '외부 도구 찾기';
    case 'mcp.call':
      return action.host.startsWith('local:')
        ? `이 Mac에서 실행되는 도구 서버 ${action.serverId} (${action.host.slice(6)})의 "${action.tool}" 도구를 프로젝트 ${action.projectId}에서 쓰도록 허용할까요? 이 도구는 샌드박스 밖, 이 Mac에서 직접 동작합니다. 승인하면 이 프로젝트에서는 이 도구를 다시 묻지 않습니다.`
        : `외부 도구 서버 ${action.serverId} (${action.host})의 "${action.tool}" 도구를 프로젝트 ${action.projectId}에서 쓰도록 허용할까요? 승인하면 이 프로젝트에서는 이 도구를 다시 묻지 않습니다.`;
    case 'mcp.configure':
      return `외부 도구 서버 ${action.serverId} ${action.op === 'add' ? '추가' : action.op === 'remove' ? '삭제' : '허용 취소'}`;
    case 'external.configure':
      return `프로젝트 ${action.projectId}의 외부 API "${action.name}" ${action.op === 'set' ? '연결' : '연결 해제'}`;
    case 'external.call':
      return `프로젝트 ${action.projectId}가 외부 API "${action.name}" (${action.host}) 호출`;
    case 'vault.write':
      return `자격 증명 ${action.credentialId} 저장`;
    case 'vault.delete':
      return `자격 증명 ${action.credentialId} 삭제`;
  }
}
