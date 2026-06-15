export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

/** Absolute URL for an attachment download path returned by the API
 * (e.g. `/courses/{id}/attachments/{db_id}/download`). */
export function fileUrl(path: string): string {
  return `${API_BASE}${path}`
}

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
  message?: string | null
  percent?: number | null
  error_message?: string | null
  started_at?: string | null
  finished_at?: string | null
}

export type SchedulerStatus = {
  enabled: boolean
  interval_minutes: number
  running: boolean
  job_scheduled: boolean
  next_run_time?: string | null
}

export type BotStatus = {
  status: 'connected' | 'disconnected' | 'disabled' | 'unknown' | 'error'
  last_heartbeat?: string | null
  stale: boolean
  detail?: string | null
  checked_at: string
}

export type Topic = { id?: string; name?: string; [k: string]: unknown }

export type Attachment = {
  id: number
  source: 'drive' | 'link' | 'form' | 'youtube'
  title?: string | null
  source_url?: string | null
  content_type?: string | null
  file_size?: number | null
  exported?: boolean
  fetch_status: 'pending' | 'fetched' | 'failed' | 'skipped'
  download_url?: string | null
}

export type ClassworkItem = {
  id?: string
  topic_id?: string | null
  title?: string
  work_type?: string
  update_time?: string
  alternate_link?: string
  description?: string
  attachments?: Attachment[]
  [k: string]: unknown
}
export type ClassworkResponse = {
  coursework: ClassworkItem[]
  topics: Topic[]
  materials: ClassworkItem[]
  topic_filter?: string | null
}

export const api = {
  health: () => request<{ status: string }>('/health'),
  status: () =>
    request<{
      google_credentials: string
      python?: string
      version?: string
      google?: {
        token_exists: boolean
        client_secret_exists: boolean
        valid: boolean
        drive_scope?: boolean
        missing_scopes?: string[]
        expired?: boolean | null
        error?: string | null
        fix_hint?: string
      }
    }>('/status'),
  version: () => request<{ version: string }>('/version'),
  googleAuthStart: (origin: string) =>
    request<{ authorization_url: string; redirect_uri: string; state: string }>(
      `/auth/google/start?origin=${encodeURIComponent(origin)}`
    ),
  listCourses: () => request<{ items: Course[]; total: number }>('/courses'),
  getCourse: (id: string) => request<Course>(`/courses/${id}`),
  getStream: (id: string, limit = 50, offset = 0) =>
    request<{ items: StreamItem[]; count: number }>(
      `/courses/${id}/stream?limit=${limit}&offset=${offset}`
    ),
  getClasswork: (id: string, topicId?: string | null) => {
    const qs = topicId ? `?topic_id=${encodeURIComponent(topicId)}` : ''
    return request<ClassworkResponse>(`/courses/${id}/classwork${qs}`)
  },
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
  syncStatus: (params: { page?: number; limit?: number; search?: string; status?: string; resource?: string } = {}) => {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') searchParams.append(k, String(v))
    })
    const qs = searchParams.toString()
    return request<{ runs: SyncRun[]; total?: number; page?: number; limit?: number }>(`/sync/status${qs ? `?${qs}` : ''}`)
  },
  triggerSync: () => request<{ status: string }>('/sync', { method: 'POST' }),
  triggerCourseSync: (courseId: string) =>
    request<{ status: string }>(`/sync/${courseId}`, { method: 'POST' }),
  clearDeadRun: (runId: number) =>
    request<{ status: string; run_id: number }>(`/sync/runs/${runId}/clear`, { method: 'POST' }),
  deleteRun: (runId: number) =>
    request<{ status: string; run_id: number }>(`/sync/runs/${runId}`, { method: 'DELETE' }),
  botStatus: () => request<BotStatus>('/bot/status'),
  getScheduler: () => request<SchedulerStatus>('/scheduler'),
  updateScheduler: (body: { interval_minutes?: number; enabled?: boolean }) =>
    request<SchedulerStatus>('/scheduler', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}