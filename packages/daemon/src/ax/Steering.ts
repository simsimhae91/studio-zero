/**
 * Messages the owner sends to a task while it is running. The engine picks them up at its next turn boundary
 * and reads them alongside its tool results, so a long task can be redirected without being stopped.
 * In memory on purpose: a steering message is about what is happening now and has no meaning after a restart.
 */
export class SteeringQueue {
  readonly #pending = new Map<string, string[]>();

  push(taskId: string, text: string): void {
    this.#pending.set(taskId, [...(this.#pending.get(taskId) ?? []), text]);
  }

  /** Takes everything queued for a task. */
  drain(taskId: string): string[] {
    const messages = this.#pending.get(taskId) ?? [];
    this.#pending.delete(taskId);
    return messages;
  }

  clear(taskId: string): void {
    this.#pending.delete(taskId);
  }
}

/** How a steering message is put to the engine. The text is the owner's own, so it is an instruction, not data. */
export function steeringNote(messages: readonly string[]): string {
  return `The owner sent ${messages.length === 1 ? 'this' : 'these'} while you were working. Take ${messages.length === 1 ? 'it' : 'them'} into account from here on, without starting over:\n${messages.map((m) => `- ${m}`).join('\n')}`;
}
