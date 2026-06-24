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
  week?: number | null
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

export type AuditRetentionStatus = {
  enabled: boolean
  retention_days: number
  job_scheduled: boolean
  next_run_time?: string | null
  max_retention_days: number
}

export type BotStatus = {
  status: 'connected' | 'disconnected' | 'disabled' | 'unknown' | 'error'
  last_heartbeat?: string | null
  stale: boolean
  detail?: string | null
  checked_at: string
}

export type BotCommand = {
  id: number
  name: string
  description?: string | null
  trigger: string
  params?: string | null
  response: string
  enabled: boolean
  /** "template" = editable text-response command; "builtin" = code-defined slash command. */
  kind: 'template' | 'builtin'
  handler_key?: string | null
  /** Slash group prefix, e.g. "classroom". Null = top-level `/name`. */
  group_name?: string | null
  /** Default item cap for list commands (coursework/announcements/todo); null = system default (10). */
  default_limit?: number | null
  created_at?: string | null
  updated_at?: string | null
}

/** Editable fields for creating/updating a bot command. */
export type BotCommandInput = {
  name: string
  description?: string | null
  trigger?: string
  params?: string | null
  response: string
  enabled?: boolean
  group_name?: string | null
  default_limit?: number | null
}

/** A Discord course↔channel link (mirrors the bot's `/classroom link`). */
export type Link = {
  id: number
  // Snowflakes are strings: JS Number can't hold 64-bit Discord IDs losslessly.
  guild_id: string
  course_id: string
  course_name?: string | null
  channel_id: string
  /** Optional role pinged in the channel when new items are posted. */
  notify_role_id?: string | null
  /** Special mention target, takes precedence over notify_role_id. */
  notify_target?: 'everyone' | 'here' | null
  is_active: boolean
  last_sync_announcement?: string | null
  last_sync_coursework?: string | null
}

export type LinkInput = {
  guild_id: string
  course_id: string
  channel_id: string
  notify_role_id?: string | null
  notify_target?: 'everyone' | 'here' | null
  is_active?: boolean
}

/** A reverse-synced Discord text channel (bot writes these; empty if bot offline). */
export type DiscordChannel = {
  guild_id: string
  guild_name: string
  channel_id: string
  channel_name: string
}

/** A reverse-synced Discord role (bot writes these; empty if bot offline). */
export type DiscordRole = {
  guild_id: string
  guild_name: string
  role_id: string
  role_name: string
}

/** A WebUI-editable bot response template (DB is the source of truth). */
export type BotMessage = {
  key: string
  template: string
  description?: string | null
  /** True if the key has an in-code default (deleting reverts to it). */
  is_default: boolean
  updated_at?: string | null
}

export type BotMessageInput = {
  key: string
  template: string
  description?: string | null
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

export type TodoItem = {
  item_id: string
  course_id: string
  title?: string | null
  due_date?: string | null
  status?: string | null
  course_work_link?: string | null
  last_updated?: string | null
}

export type SearchResultKind =
  | 'course'
  | 'coursework'
  | 'material'
  | 'announcement'

export type SearchCategoryKey = 'course' | 'classwork' | 'stream'

export type SearchResult = {
  kind: SearchResultKind
  course_id: string
  course_name?: string | null
  item_id?: string | null
  title: string
  subtitle?: string | null
  snippet?: string | null
  attachment?: string | null
  alternate_link?: string | null
  url: string
}

export type SearchCategory = {
  key: SearchCategoryKey
  label: string
  total: number
  has_more: boolean
  items: SearchResult[]
}

export type SearchResponse = {
  query: string
  limit: number
  categories: SearchCategory[]
}

export type AuditCategory = 'general' | 'api' | 'discord'

export type AuditLog = {
  id: number
  created_at: string | null
  category: AuditCategory
  action: string
  actor?: string | null
  target?: string | null
  status: string
  duration_ms?: number | null
  detail?: string | null
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
  // Server time (Asia/Tokyo); weekday 1=Mon … 7=Sun (matches course `week`).
  serverTime: () =>
    request<{ now: string; weekday: number; weekday_name: string }>('/time'),
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
  listTodos: (params: { status?: string; course_id?: string } = {}) => {
    const qs = new URLSearchParams()
    if (params.status) qs.append('status', params.status)
    if (params.course_id) qs.append('course_id', params.course_id)
    const q = qs.toString()
    return request<{ items: TodoItem[]; total: number }>(`/todos${q ? `?${q}` : ''}`)
  },
  search: (q: string, limit = 5) =>
    request<SearchResponse>(
      `/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
  listAudit: (params: { category?: string; action?: string; search?: string; page?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => {
      if (v != null && v !== '') qs.append(k, String(v))
    })
    const q = qs.toString()
    return request<{ rows: AuditLog[]; total: number; page: number; limit: number }>(
      `/audit${q ? `?${q}` : ''}`
    )
  },
  botStatus: () => request<BotStatus>('/bot/status'),
  listBotCommands: () =>
    request<{ items: BotCommand[]; total: number }>('/bot/commands'),
  createBotCommand: (body: BotCommandInput) =>
    request<BotCommand>('/bot/commands', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateBotCommand: (id: number, body: Partial<BotCommandInput>) =>
    request<BotCommand>(`/bot/commands/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteBotCommand: (id: number) =>
    request<{ status: string; id: number }>(`/bot/commands/${id}`, {
      method: 'DELETE',
    }),
  listLinks: (guildId?: string) =>
    request<{ items: Link[]; total: number }>(
      guildId != null ? `/links?guild_id=${guildId}` : '/links'
    ),
  listDiscordChannels: () =>
    request<{ items: DiscordChannel[]; total: number }>('/discord/channels'),
  listDiscordRoles: () =>
    request<{ items: DiscordRole[]; total: number }>('/discord/roles'),
  createLink: (body: LinkInput) =>
    request<Link>('/links', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateLink: (
    id: number,
    body: Partial<
      Pick<
        LinkInput,
        | 'guild_id'
        | 'course_id'
        | 'channel_id'
        | 'notify_role_id'
        | 'notify_target'
        | 'is_active'
      >
    >
  ) =>
    request<Link>(`/links/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteLink: (id: number) =>
    request<{ status: string; id: number }>(`/links/${id}`, {
      method: 'DELETE',
    }),
  listBotMessages: () =>
    request<{ items: BotMessage[]; total: number }>('/bot/messages'),
  createBotMessage: (body: BotMessageInput) =>
    request<BotMessage>('/bot/messages', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  setBotMessage: (key: string, template: string, description?: string | null) =>
    request<BotMessage>(`/bot/messages/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ template, description }),
    }),
  deleteBotMessage: (key: string) =>
    request<{ key: string; deleted: boolean; is_default: boolean }>(
      `/bot/messages/${encodeURIComponent(key)}`,
      { method: 'DELETE' }
    ),
  getScheduler: () => request<SchedulerStatus>('/scheduler'),
  updateScheduler: (body: { interval_minutes?: number; enabled?: boolean }) =>
    request<SchedulerStatus>('/scheduler', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getAuditRetention: () => request<AuditRetentionStatus>('/audit/retention'),
  updateAuditRetention: (body: { retention_days?: number; enabled?: boolean }) =>
    request<AuditRetentionStatus>('/audit/retention', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
}