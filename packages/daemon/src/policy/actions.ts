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
  z.object({ kind: z.literal('task.extend-budget'), projectId: z.string(), taskId: z.string(), addTokens: z.number().int().positive() }),
  z.object({ kind: z.literal('task.steer'), projectId: z.string(), taskId: z.string() }),
  z.object({ kind: z.literal('checkpoint.fork'), projectId: z.string(), checkpointId: z.string() }),
  z.object({ kind: z.literal('scratch.promote'), scratchId: z.string(), target: z.enum(['build', 'document']) }),
  z.object({ kind: z.literal('knowledge.run'), jobKind: z.enum(['research', 'document']) }),
  z.object({ kind: z.literal('task.submit'), projectId: z.string(), taskKind: TaskKind, budgetTokens: z.number().int() }),

  // Confined to the project's container. The command text is recorded for the audit trail, not pattern-matched:
  // filtering shell strings is not a security boundary, the container is.
  z.object({ kind: z.literal('sandbox.exec'), projectId: z.string(), command: z.string() }),
  z.object({ kind: z.literal('sandbox.write'), projectId: z.string(), path: z.string() }),
  z.object({ kind: z.literal('sandbox.lifecycle'), projectId: z.string(), op: z.enum(['start', 'stop', 'recreate']) }),

  z.object({ kind: z.literal('checkpoint.rollback'), projectId: z.string(), checkpointId: z.string() }),
  z.object({ kind: z.literal('git.merge'), projectId: z.string(), branch: z.string(), into: z.string() }),

  z.object({ kind: z.literal('kirby.ingest'), projectId: z.string(), repoUrl: z.string() }),
  z.object({ kind: z.literal('kirby.materialize'), projectId: z.string(), proposalId: z.string() }),

  z.object({ kind: z.literal('lesson.activate'), lessonId: z.string(), scope: z.enum(['project', 'global']), projectId: z.string().nullable() }),
  z.object({ kind: z.literal('eval.disable'), projectId: z.string(), evalId: z.string() }),

  // Reaching an outside service through a tool server (MCP). `host` is where the call will go, taken from the
  // stored server by daemon code, so what the owner approves names the destination.
  z.object({ kind: z.literal('mcp.search'), projectId: z.string() }),
  z.object({ kind: z.literal('mcp.call'), projectId: z.string(), serverId: z.string(), host: z.string(), tool: z.string() }),
  z.object({ kind: z.literal('mcp.configure'), serverId: z.string(), op: z.enum(['add', 'remove', 'revoke']) }),

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
      return `작업 ${action.taskId}이(가) 토큰 예산을 다 썼습니다. ${n(action.addTokens)} 토큰을 더 줄까요?`;
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
    case 'sandbox.exec':
      return `샌드박스에서 실행: ${action.command.slice(0, 200)}`;
    case 'sandbox.write':
      return `샌드박스에 파일 쓰기: ${action.path}`;
    case 'sandbox.lifecycle':
      return `샌드박스 ${action.op}`;
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
      return `외부 도구 서버 ${action.serverId} (${action.host})의 "${action.tool}" 도구를 프로젝트 ${action.projectId}에서 쓰도록 허용할까요? 승인하면 이 프로젝트에서는 이 도구를 다시 묻지 않습니다.`;
    case 'mcp.configure':
      return `외부 도구 서버 ${action.serverId} ${action.op === 'add' ? '추가' : action.op === 'remove' ? '삭제' : '허용 취소'}`;
    case 'vault.write':
      return `자격 증명 ${action.credentialId} 저장`;
    case 'vault.delete':
      return `자격 증명 ${action.credentialId} 삭제`;
  }
}
