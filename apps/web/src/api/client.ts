/** Thin fetch wrapper for the Binder API. Same origin (Vite proxies /api), so cookies are first-party. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type RequestOptions = { expectedUserId?: string }

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options?.expectedUserId === undefined
        ? {}
        : { 'X-Binder-Expected-User': options.expectedUserId }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(
      res.status,
      payload?.error ?? 'unknown',
      payload?.message ?? `${method} /api${path} failed with ${res.status}`,
    )
  }
  return payload as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}
