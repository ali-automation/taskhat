export interface User {
  id: string
  email: string
  displayName: string
  avatarUrl: string | null
  isActive: boolean
  isDemo?: boolean
  createdAt: string
}

export interface AuthResponse {
  accessToken: string
  user: User
  isAdmin?: boolean
}

// Jira-style error body
export interface ApiErrorBody {
  errorMessages: string[]
  errors: Record<string, string>
}

export class ApiError extends Error {
  status: number
  body: ApiErrorBody

  constructor(status: number, body: ApiErrorBody) {
    super(body.errorMessages[0] ?? `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

let accessToken: string | null = null

export function setAccessToken(token: string | null) {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

async function parseError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody = { errorMessages: [], errors: {} }
  try {
    body = await res.json()
  } catch {
    body.errorMessages = [res.statusText]
  }
  return new ApiError(res.status, body)
}

async function rawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (init.body != null && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`)
  return fetch(`/api/v1${path}`, { ...init, headers, credentials: 'same-origin' })
}

// api() attaches the access token and transparently retries once after a
// refresh when the token has expired.
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawFetch(path, init)
  // Refresh even when the in-memory token is gone (e.g. one refresh failed
  // during a redeploy) — the session cookie may still be perfectly valid.
  if (res.status === 401) {
    const refreshed = await tryRefresh()
    if (refreshed) res = await rawFetch(path, init)
  }
  if (!res.ok) throw await parseError(res)
  if (res.status === 204) return undefined as T
  return res.json()
}

export async function tryRefresh(): Promise<AuthResponse | null> {
  const res = await fetch('/api/v1/auth/refresh', { method: 'POST', credentials: 'same-origin' })
  if (!res.ok) {
    setAccessToken(null)
    return null
  }
  const data: AuthResponse = await res.json()
  setAccessToken(data.accessToken)
  return data
}

export type LoginResult = AuthResponse | { requires2fa: true; mfaToken: string }

export async function login(email: string, password: string): Promise<LoginResult> {
  const data = await api<AuthResponse & { requires2fa?: boolean; mfaToken?: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (data.requires2fa && data.mfaToken) return { requires2fa: true, mfaToken: data.mfaToken }
  setAccessToken(data.accessToken)
  return data
}

export async function demoLogin(): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/demo', { method: 'POST', body: '{}' })
  setAccessToken(data.accessToken)
  return data
}

export async function login2FA(mfaToken: string, code: string): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/login/2fa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken, code }),
  })
  setAccessToken(data.accessToken)
  return data
}

export async function register(email: string, password: string, displayName: string): Promise<AuthResponse> {
  const data = await api<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
  setAccessToken(data.accessToken)
  return data
}

export async function logout(): Promise<void> {
  await api<void>('/auth/logout', { method: 'POST' })
  setAccessToken(null)
}

// apiBlob fetches a binary resource (attachment) with auth and token refresh.
export async function apiBlob(path: string): Promise<Blob> {
  let res = await rawFetch(path)
  if (res.status === 401 && accessToken) {
    const refreshed = await tryRefresh()
    if (refreshed) res = await rawFetch(path)
  }
  if (!res.ok) throw await parseError(res)
  return res.blob()
}
