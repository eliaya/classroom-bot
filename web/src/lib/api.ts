const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = import.meta.env.VITE_ADMIN_API_TOKEN
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json() as Promise<T>
}

export type Course = {
  id: string
  name: string
  section?: string | null
  room?: string | null
  owner_id?: string | null
  state?: string | null
  alternate_link?: string | null
  synced_at?: string | null
}

export type StreamItem = {
  type: 'announcement' | 'coursework'
  id: string
  course_id: string
  title?: string
  text?: string
  work_type?: string
  update_time?: string
  alternate_link?: string
}

export type SyncRun = {
  id: number
  course_id?: string | null
  resource: string
  status: string
  items_count: number
  error_message?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  status: () =>
    request<{
      google_credentials: string
      python?: string
      google?: {
        token_exists: boolean
        client_secret_exists: boolean
        valid: boolean
        missing_scopes?: string[]
        expired?: boolean | null
        error?: string | null
        fix_hint?: string
      }
    }>('/status'),
  listCourses: () => request<{ items: Course[]; total: number }>('/courses'),
  getCourse: (id: string) => request<Course>(`/courses/${id}`),
  getStream: (id: string, limit = 50, offset = 0) =>
    request<{ items: StreamItem[]; count: number }>(
      `/courses/${id}/stream?limit=${limit}&offset=${offset}`
    ),
  getClasswork: (id: string) =>
    request<{
      coursework: Array<Record<string, unknown>>
      topics: Array<Record<string, unknown>>
      materials: Array<Record<string, unknown>>
    }>(`/courses/${id}/classwork`),
  getPeople: (id: string) =>
    request<{
      items: Array<{
        user_id: string
        role: string
        full_name?: string
        email?: string
      }>
      total: number
    }>(`/courses/${id}/people`),
  syncStatus: () => request<{ runs: SyncRun[] }>('/sync/status'),
  triggerSync: () => request<{ status: string }>('/sync', { method: 'POST' }),
  triggerCourseSync: (courseId: string) =>
    request<{ status: string }>(`/sync/${courseId}`, { method: 'POST' }),
}