/** The requested entity does not exist. Maps to RPC `not_found`. */
export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

/** The request is valid but cannot be applied to the current state. Maps to RPC `conflict`. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** A dependency (container runtime, model provider, credential) is missing or unreachable. Maps to RPC `unavailable`. */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnavailableError';
  }
}
