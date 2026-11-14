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

/**
 * The request was made against something that has changed since the client read it: a review of a document that
 * is no longer the one to revise. The client reads it again and decides. Maps to RPC `stale`.
 */
export class StaleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleError';
  }
}

/** A dependency (container runtime, model provider, credential) is missing or unreachable. Maps to RPC `unavailable`. */
export class UnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnavailableError';
  }
}

/**
 * Asked over a connection that is not allowed to ask it: something only a client on the daemon's own Mac may
 * do was requested from elsewhere. Maps to RPC `policy_denied`.
 */
export class LocalOnlyError extends Error {
  constructor(what: string) {
    super(`${what}은(는) 데몬이 도는 이 Mac에서 연 앱에서만 할 수 있습니다. 다른 기기에서는 볼 수만 있습니다.`);
    this.name = 'LocalOnlyError';
  }
}
