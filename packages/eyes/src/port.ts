import { createServer } from 'node:net';

/**
 * A port nothing is listening on, asked of the machine. A number someone chose can belong to other work on the
 * same machine: the first long run chose one, found a server answering there, and took it for its own.
 */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => (address && typeof address === 'object' ? done(address.port) : fail(new Error('the machine gave no port'))));
    });
  });
}
