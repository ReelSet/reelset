import { errorFields, type Logger } from '@reelset/core'
import { UnauthorizedError, requireUser } from '@/server/auth'
import { getDb } from '@/server/db'
import type { ApiError } from '@/lib/generate/types'
import { resolveViewer, type Viewer } from './service'

export function apiError(
  error: ApiError['error'],
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const body: ApiError = { error, message }
  return Response.json(body, { status, headers })
}

/** Resolves the signed-in viewer, or the 401 response to return. */
export async function viewerOrResponse(returnTo: string, log: Logger): Promise<Viewer | Response> {
  try {
    const user = await requireUser(returnTo)
    return await resolveViewer(getDb(), user)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return apiError('unauthorized', 'Sign in to continue.', 401)
    }
    log.error(errorFields(err), 'viewer resolution failed')
    return apiError('internal', 'Something went wrong.', 500)
  }
}

export function internalError(log: Logger, err: unknown): Response {
  log.error(errorFields(err), 'route failed')
  return apiError('internal', 'Something went wrong. Please try again.', 500)
}
