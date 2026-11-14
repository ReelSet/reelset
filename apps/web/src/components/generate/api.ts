import type {
  ApiError,
  ApiKeyDto,
  CreditsDto,
  GenerateListResponse,
  GenerateResponse,
  ReelRequestDto,
} from '@/lib/generate/types'

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiError['error'] | 'network',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      cache: 'no-store',
    })
  } catch {
    throw new ApiFailure('network', 'Network problem. Check your connection and try again.', 0)
  }
  if (res.status === 401) {
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`
    throw new ApiFailure('unauthorized', 'Please sign in.', 401)
  }
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null
  if (!res.ok) {
    throw new ApiFailure(
      body?.error ?? 'internal',
      body?.message ?? 'Something went wrong. Please try again.',
      res.status,
    )
  }
  return body as T
}

export const generate = (urls: string[]) =>
  call<GenerateResponse>('/api/generate', { method: 'POST', body: JSON.stringify({ urls }) })
export const listRequests = () => call<GenerateListResponse>('/api/generate')
export const getRequest = (id: string) =>
  call<{ request: ReelRequestDto }>(`/api/generate/${encodeURIComponent(id)}`)
export const getCredits = () => call<CreditsDto>('/api/credits')
export const requestCredits = (message?: string) =>
  call<unknown>('/api/credits/request', {
    method: 'POST',
    body: JSON.stringify(message ? { message } : {}),
  })
export const listKeys = () => call<{ keys: ApiKeyDto[] } | ApiKeyDto[]>('/api/keys')
export const createKey = (name: string) =>
  call<{ key: ApiKeyDto; token: string }>('/api/keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
export const revokeKey = (id: string) =>
  call<unknown>(`/api/keys/${encodeURIComponent(id)}`, { method: 'DELETE' })

export const isOpen = (r: ReelRequestDto) => r.status !== 'done' && r.status !== 'failed'
