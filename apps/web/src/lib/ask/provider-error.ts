const UNAVAILABLE_STATUSES = new Set([401, 402, 403, 408, 429])

// No status means the request never got an answer (network, timeout, malformed body).
export function isUnavailableStatus(status: number | undefined): boolean {
  return status === undefined || status >= 500 || UNAVAILABLE_STATUSES.has(status)
}

// Base for AI provider failures; `unavailable` marks outages, quota and auth that a retry later may fix.
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly unavailable: boolean,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function isProviderUnavailable(err: unknown): boolean {
  return err instanceof ProviderError && err.unavailable
}
