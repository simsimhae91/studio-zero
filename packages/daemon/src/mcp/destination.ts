import { basename } from 'node:path';
import type { McpServerRow } from '../db/Store.ts';

const LOCAL = 'local:';

/**
 * Where a call to this server goes, as one short string: the host of a remote server, or `local:<program>` for
 * one that runs on this Mac. It is part of the action the owner approves and is re-derived when the call is
 * made, so an approval cannot be carried over to a server whose address or program has since changed.
 */
export function destinationOf(server: McpServerRow): string {
  return server.transport === 'stdio' ? `${LOCAL}${basename(server.command ?? '')}` : new URL(server.url).host;
}

/** True for a destination that is a program on this Mac: its tools act here, outside every sandbox. */
export const isLocalDestination = (destination: string): boolean => destination.startsWith(LOCAL);
