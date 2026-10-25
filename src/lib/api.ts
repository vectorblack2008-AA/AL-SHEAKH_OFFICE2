export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(message: string, status = 500, code = 'ERROR', details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

type QueryValue = string | number | boolean | null | undefined

/**
 * Session-expiry signal. The app context listens for it, drops the cached user
 * and sends the browser back to the login screen. Login failures are excluded
 * so a wrong password does not look like an expired session.
 */
export const UNAUTHORIZED_EVENT = 'alsheikh:unauthorized'

function signalUnauthorized(status: number, path: string) {
  if (status !== 401 || path.startsWith('/api/auth/login')) return
  window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
}

export function withQuery(path: string, params?: Record<string, QueryValue>): string {
  if (!params) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    })
  } catch {
    throw new ApiError('Unable to reach the server. Check your connection and try again.', 0, 'NETWORK_ERROR')
  }

  if (response.status === 204) return undefined as T

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null)

  if (!response.ok) {
    signalUnauthorized(response.status, path)
    const body = payload as { error?: string; code?: string; details?: unknown } | null
    throw new ApiError(
      body?.error || `Request failed with status ${response.status}`,
      response.status,
      body?.code || 'REQUEST_FAILED',
      body?.details,
    )
  }

  return payload as T
}

export const api = {
  get<T>(path: string, params?: Record<string, QueryValue>, signal?: AbortSignal): Promise<T> {
    return request<T>(withQuery(path, params), { method: 'GET', signal })
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' })
  },
  async download(path: string, params?: Record<string, QueryValue>): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(withQuery(path, params), { credentials: 'include' })
    if (!response.ok) {
      signalUnauthorized(response.status, path)
      const payload = await response.json().catch(() => null)
      throw new ApiError(payload?.error || 'Export failed', response.status, payload?.code || 'EXPORT_FAILED')
    }
    const disposition = response.headers.get('content-disposition') || ''
    const match = /filename="?([^";]+)"?/i.exec(disposition)
    return { blob: await response.blob(), filename: match?.[1] || 'export.csv' }
  },
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}
