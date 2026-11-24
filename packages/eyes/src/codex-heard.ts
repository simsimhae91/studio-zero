import { globSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Heard } from './dive.ts';

/** Codex also uses the user role for injected context. Only its user-input events attest to what was typed. */
export async function codexHeard(thread: string, from: number, env: NodeJS.ProcessEnv): Promise<Heard[]> {
  const sessions = join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  const heard: Heard[] = [];
  for (const file of globSync(`*/*/*/rollout-*-${thread}.jsonl`, { cwd: sessions })) {
    const transcript = join(sessions, file);
    try {
      await using handle = await open(transcript, 'r');
      let inThread = false;
      for await (const line of handle.readLines()) {
        if (!line.includes('"session_meta"') && !line.includes('"UserMessage"') && !line.includes('"user_message"')) continue;
        let row;
        try {
          row = JSON.parse(line);
        } catch {
          continue; // The active rollout may end partway through its next record.
        }
        const event = row?.payload;
        if (row?.type === 'session_meta') {
          inThread = event?.id === thread && (event.thread_source == null || event.thread_source === 'user') && !event.source?.subagent;
          continue;
        }
        if (!inThread || row?.type !== 'event_msg' || !event || typeof row.timestamp !== 'string' || !(Date.parse(row.timestamp) >= from)) continue;
        if (event.thread_id !== undefined && event.thread_id !== thread) continue;
        if (event.type === 'user_message' && typeof event.message === 'string') {
          heard.push({ at: row.timestamp, kind: 'typed', words: event.message, transcript });
        } else if (event.type === 'item_completed' && event.thread_id === thread && event.item?.type === 'UserMessage' && Array.isArray(event.item.content)) {
          for (const part of event.item.content) {
            if (part?.type === 'text' && typeof part.text === 'string') heard.push({ at: row.timestamp, kind: 'typed', words: part.text, transcript });
          }
        }
      }
    } catch (error) {
      // A rotated or sandbox-inaccessible rollout can still have a record in the prompt hook.
      if (!['ENOENT', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  return heard;
}
