import type { Server } from 'node:http';
import type { Socket } from 'node:net';

/**
 * Tracks every connection a server accepts and returns a function that destroys whatever is still open.
 * `server.close()` waits for connections to end on their own, and upgraded (WebSocket) sockets are outside
 * the HTTP server's idle-connection handling, so a daemon that must always shut down needs this backstop.
 */
export function trackSockets(server: Server): () => void {
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return () => {
    for (const socket of sockets) socket.destroy();
  };
}
