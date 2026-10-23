import { useAuthStore } from '@/stores/auth-store'
import { BASE } from '@/lib/area'
import { hardNavigate } from '@/lib/navigate'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api'

/** Absolute URL for an attachment download path returned by the API
 * (e.g. `/courses/{id}/attachments/{db_id}/download`). */
export function fileUrl(path: string): string {
  return `${API_BASE}${path}`
}

/** A non-2xx API response. `status` lets callers tell 401 from 403. */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

// Auth is the session cookie the API sets on sign-in; the browser sends it on
// these same-origin requests by itself, so there is no token to attach.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) {
    const text = await res.text()
    // Session gone mid-use: back to sign-in, returning here afterwards. The
    // /auth/ calls are excluded so the route guard can handle "not signed in".
    if (res.status === 401 && !path.startsWith('/auth/')) {
      useAuthStore.getState().auth.reset()
      const here = window.location.pathname + window.location.search
      hardNavigate(`${BASE}/login?redirect=${encodeURIComponent(here)}`)
    }
    throw new ApiError(res.status, text || res.statusText)
  }
  return res.json() as Promise<T>
}

/** The signed-in user, as returned by GET /auth/me. An empty `permissions`
 *  list means the account is awaiting approval. */
export type Me = {
  id: number
  email: string
  name: string | null
  picture_url: string | null
  role: string | null
  permissions: string[]
}

export type AdminUser = {
  id: number
  email: string
  name: string | null
  picture_url: string | null
  role_id: number | null
  is_active: boolean
  /** Listed in ADMIN_EMAILS: the admin role is re-applied on every sign-in. */
  is_env_admin: boolean
  created_at: string | null
  last_login_at: string | null
}

export type Role = {
  id: number
  name: string
  description: string | null
  permissions: string[]
  is_system: boolean
}

/** A Discord server the bot is in. `mine` = connected to you, `unbound` =
 *  free to claim, `taken` = someone else's (only user administrators see these). */
export type DiscordGuild = {
  guild_id: string
  guild_name: string | null
  state: 'mine' | 'unbound' | 'taken'
}

export type RoleInput = {
  name: string
  description?: string | null
  permissions: string[]
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
  /** Time of the latest announcement, coursework or material. */
  last_update?: string | null
  /** Hidden from the dashboard and calendar (this app only). */
  archived?: boolean
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

/** An announcement or coursework, as listed on the dashboard calendar. */
export type Post = {
  type: 'announcement' | 'coursework' | 'material'
  id: string
  course_id: string
  title: string
  /** When it was last updated (ISO-8601 UTC), as the course pages show. */
  time: string
  alternate_link?: string | null
  /** Who posted it (a `CoursePerson.user_id` of its course). */
  creator_user_id?: string | null
}

export type CoursePerson = {
  course_id: string
  user_id: string
  role: string
  full_name?: string | null
  photo_url?: string | null
}

export type CalendarEvent = {
  id: string
  /** Name of the Google calendar it is on. */
  calendar: string
  /** The course it belongs to: its calendar's, or the one its title names. */
  course_id?: string | null
  title: string
  /** All-day events carry dates (end exclusive); the rest date-times. */
  all_day: boolean
  start: string
  end: string | null
  link?: string | null
  /** May hold HTML, as typed in Google Calendar. */
  description?: string | null
  location?: string | null
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
  /** Attachments this run moved to external storage (not kept on the server). */
  external_attachments?: number
  started_at?: string | null
  finished_at?: string | null
}

export type SchedulerStatus = {
  enabled: boolean
  interval_minutes: number
  poll_interval_minutes: number
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

export type BackupScope = 'database' | 'full'

export type BackupJob = {
  id: string
  scope: BackupScope
  status: 'pending' | 'running' | 'completed' | 'failed' | 'deleted'
  phase: string
  actor: string
  archive_filename?: string | null
  archive_bytes?: number | null
  file_count: number
  error_summary?: string | null
  created_at?: string | null
  completed_at?: string | null
  expires_at?: string | null
}

export type RestoreJob = {
  id: string
  backup_id: string
  safety_backup_id?: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  phase: string
  safe_to_retry: boolean
  error_summary?: string | null
  created_at?: string | null
  completed_at?: string | null
}

export type BackupSettings = {
  enabled: boolean
  scope: BackupScope
  hour: number
  minute: number
  job_scheduled: boolean
  next_run_time?: string | null
  retention_days: number
  max_retention_days: number
}

export type StorageProvider = 'opencloud' | 'nextcloud' | 'gdrive'

export type OpenCloudSettings = {
  enabled: boolean
  /** OpenCloud and Nextcloud are WebDAV; Google Drive uses the Google connection. */
  provider: StorageProvider
  webdav_url: string
  username: string
  folder: string
  has_token: boolean
  /** The administrator's Roles → External Storage switch. */
  available: boolean
}

/** A Gmail mailbox, category or the user's own label. */
export type MailLabel = {
  id: string
  name: string
  type: 'system' | 'user'
  /** The label's colour in Gmail (user labels only), as hex. */
  color: string | null
  /** Drafts in Drafts, unread conversations elsewhere; null for Archive. */
  count: number | null
}

export type MailLabels = { granted: boolean; mailboxes: MailLabel[]; labels: MailLabel[] }

export type MailThreadSummary = {
  id: string
  from_name: string
  from_email: string
  subject: string
  snippet: string
  /** Epoch milliseconds of the last message. */
  date: number
  count: number
  unread: boolean
  starred: boolean
  label_ids: string[]
}

export type MailMessage = {
  id: string
  from_name: string
  from_email: string
  to: string
  reply_to: string
  date: number
  unread: boolean
  /** Plain text; HTML mail is converted on the server. */
  text: string
  /** The HTML body with inline images as data URIs; shown only in a sandboxed frame. */
  html?: string | null
}

export type MailThread = {
  id: string
  subject: string
  label_ids: string[]
  messages: MailMessage[]
}

export type ExternalStorageAdmin = {
  enabled: boolean
}

export type BotStatus = {
  status: 'connected' | 'disconnected' | 'disabled' | 'unknown' | 'error'
  last_heartbeat?: string | null
  stale: boolean
  detail?: string | null
  checked_at: string
}

export type BotSettings = {
  has_token: boolean
  /** The bot account's name, once a token is saved. */
  bot_name: string | null
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

/** One of the user's tags; `count` is how many things carry it. */
export type Tag = { id: number; name: string; count: number }

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
        /** Email of the connected Google Classroom account, when known. */
        account?: string | null
      }
    }>('/status'),
  version: () => request<{ version: string }>('/version'),
  // Server time (Asia/Tokyo); weekday 1=Mon … 7=Sun (matches course `week`).
  serverTime: () =>
    request<{ now: string; weekday: number; weekday_name: string }>('/time'),
  me: () => request<Me>('/auth/me'),
  loginStart: (origin: string, next: string) =>
    request<{ authorization_url: string }>(
      `/auth/login/start?origin=${encodeURIComponent(origin)}&next=${encodeURIComponent(next)}`
    ),
  /** Admin sign-in without Google. `next` comes back checked by the API. */
  loginPassword: (email: string, password: string, next: string) =>
    request<{ next: string }>('/auth/login/password', {
      method: 'POST',
      body: JSON.stringify({ email, password, next }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  listUsers: () => request<{ items: AdminUser[]; total: number }>('/users'),
  updateUser: (id: number, body: { role_id?: number | null; is_active?: boolean }) =>
    request<AdminUser>(`/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listRoles: () =>
    request<{ items: Role[]; total: number; modules: Record<string, string[]> }>('/roles'),
  createRole: (body: RoleInput) =>
    request<Role>('/roles', { method: 'POST', body: JSON.stringify(body) }),
  updateRole: (id: number, body: Partial<RoleInput>) =>
    request<Role>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRole: (id: number) =>
    request<{ id: number; deleted: boolean }>(`/roles/${id}`, { method: 'DELETE' }),
  listTags: () => request<{ items: Tag[]; total: number }>('/tags'),
  createTag: (name: string) =>
    request<Tag>('/tags', { method: 'POST', body: JSON.stringify({ name }) }),
  renameTag: (id: number, name: string) =>
    request<Tag>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteTag: (id: number) =>
    request<{ id: number; deleted: boolean }>(`/tags/${id}`, { method: 'DELETE' }),
  getAssignedTags: (target: string) =>
    request<{ target: string; tag_ids: number[] }>(`/tags/assigned?target=${encodeURIComponent(target)}`),
  setAssignedTags: (target: string, tag_ids: number[]) =>
    request<{ target: string; tag_ids: number[] }>('/tags/assigned', {
      method: 'PUT',
      body: JSON.stringify({ target, tag_ids }),
    }),
  listMailLabels: () => request<MailLabels>('/mail/labels'),
  listMailThreads: (params: { label: string; q?: string; unread?: boolean; page_token?: string }) => {
    const qs = new URLSearchParams({ label: params.label })
    if (params.q) qs.set('q', params.q)
    if (params.unread) qs.set('unread', 'true')
    if (params.page_token) qs.set('page_token', params.page_token)
    return request<{ items: MailThreadSummary[]; next_page_token: string | null }>(`/mail/threads?${qs}`)
  },
  getMailThread: (id: string) => request<MailThread>(`/mail/threads/${encodeURIComponent(id)}`),
  modifyMailThread: (id: string, body: { add?: string[]; remove?: string[] }) =>
    request<{ id: string; label_ids: string[] }>(`/mail/threads/${encodeURIComponent(id)}/modify`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  trashMailThread: (id: string) =>
    request<{ id: string; trashed: boolean }>(`/mail/threads/${encodeURIComponent(id)}/trash`, {
      method: 'POST',
    }),
  getExternalStorage: () => request<ExternalStorageAdmin>('/roles/external-storage'),
  updateExternalStorage: (body: Partial<ExternalStorageAdmin>) =>
    request<ExternalStorageAdmin>('/roles/external-storage', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  googleAuthStart: (origin: string) =>
    request<{ authorization_url: string; redirect_uri: string; state: string }>(
      `/auth/google/start?origin=${encodeURIComponent(origin)}`
    ),
  listCourses: () => request<{ items: Course[]; total: number }>('/courses'),
  getCourse: (id: string) => request<Course>(`/courses/${id}`),
  /** Posts of every course, or of `courseId`, in `[start, end)` (ISO-8601 UTC). */
  listPosts: (start: string, end: string, courseId?: string) =>
    request<{ items: Post[]; count: number }>(
      `/courses/posts?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
        (courseId ? `&course_id=${encodeURIComponent(courseId)}` : '')
    ),
  // `granted` is false until the user allowed Google Calendar access.
  listCalendarEvents: (start: string, end: string) =>
    request<{ granted: boolean; items: CalendarEvent[] }>(
      `/courses/calendar-events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
    ),
  getStream: (id: string, limit = 50, offset = 0) =>
    request<{ items: StreamItem[]; count: number }>(
      `/courses/${id}/stream?limit=${limit}&offset=${offset}`
    ),
  getClasswork: (id: string, topicId?: string | null) => {
    const qs = topicId ? `?topic_id=${encodeURIComponent(topicId)}` : ''
    return request<ClassworkResponse>(`/courses/${id}/classwork${qs}`)
  },
  // Every course's teachers and students.
  listPeople: () => request<{ items: CoursePerson[] }>('/courses/people'),
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
  listTodos: () => request<{ items: TodoItem[]; total: number }>('/todos'),
  /** The dashboard Kanban layout the user saved, or null before the first save. */
  getBoard: <T,>() => request<{ data: T | null }>('/dashboard/board'),
  saveBoard: <T,>(data: T) =>
    request<{ data: T }>('/dashboard/board', { method: 'PUT', body: JSON.stringify({ data }) }),
  setCourseArchived: (id: string, archived: boolean) =>
    request<{ id: string; archived: boolean }>(`/dashboard/courses/${encodeURIComponent(id)}/archived`, {
      method: 'PUT',
      body: JSON.stringify({ archived }),
    }),
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
  getBotSettings: () => request<BotSettings>('/bot/settings'),
  // The token is write-only: an empty string removes the bot.
  updateBotSettings: (token: string) =>
    request<BotSettings>('/bot/settings', { method: 'PUT', body: JSON.stringify({ token }) }),
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
  listGuilds: () =>
    request<{ items: DiscordGuild[]; total: number }>('/discord/guilds'),
  releaseGuild: (guildId: string) =>
    request<{ guild_id: string; state: string }>(`/discord/guilds/${guildId}/bind`, {
      method: 'DELETE',
    }),
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
  updateScheduler: (body: {
    interval_minutes?: number
    poll_interval_minutes?: number
    enabled?: boolean
  }) =>
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

  listBackups: () =>
    request<{ items: BackupJob[]; total: number }>('/backup?limit=50'),
  getBackup: (id: string) => request<BackupJob>(`/backup/${id}`),
  createBackup: (scope: BackupScope) =>
    request<BackupJob>('/backup', {
      method: 'POST',
      body: JSON.stringify({ scope }),
    }),
  deleteBackup: (id: string) =>
    request<{ status: string }>(`/backup/${id}`, { method: 'DELETE' }),
  getBackupSettings: () => request<BackupSettings>('/backup/settings'),
  updateBackupSettings: (body: {
    enabled?: boolean
    scope?: BackupScope
    hour?: number
    minute?: number
    retention_days?: number
  }) =>
    request<BackupSettings>('/backup/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  getOpenCloudSettings: () => request<OpenCloudSettings>('/sync/opencloud'),
  // app_token is write-only: an empty string keeps the stored one.
  updateOpenCloudSettings: (
    body: Partial<Omit<OpenCloudSettings, 'has_token' | 'available'>> & { app_token?: string }
  ) =>
    request<OpenCloudSettings>('/sync/opencloud', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  restoreBackup: (id: string) =>
    request<RestoreJob>(`/backup/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ confirmation: id }),
    }),
  getRestore: (id: string) => request<RestoreJob>(`/backup/restores/${id}`),

  /** Download an archive. The session cookie rides along on a plain
   *  navigation, and the response is an attachment, so the page stays put. */
  downloadBackup: (id: string) => {
    hardNavigate(fileUrl(`/backup/${id}/download`))
  },
}