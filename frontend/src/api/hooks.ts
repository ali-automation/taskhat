import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiBlob, ApiError } from './client'
import type { User } from './client'
import type { WikiComment, WikiAttachment, WikiSpaceMember, WikiTemplate, WikiBlogPost, WikiCalendarEvent, WikiCalendarDueItem, WikiCalendarSprint, StarredWikiPage, ArchivedWikiPage, StarredWikiSpace, TrashedWikiPage, WikiVersion, WikiVersionContent, WikiDraft, WikiPage, WikiPageNode, WikiSpace, Dashboard, DashboardGadget, GadgetType, PieSlice, IssueLink, AutomationRule, AutomationRuleInput, AutomationRun, APIToken, Webhook, WebhookDelivery, AuditEntry, SpaceCategory, UserNotifyPrefs, ActivityEntry, AdminProject, AdminUser, PermissionScheme, MailHandler, CustomField, WorkType, WorkflowTransition, WorkflowDetail, WorkflowUpdateInput, AdminWorkflowRow, AppNotification, ImportJob, Version, Invite, LabelInfo, Profile, SessionInfo, Attachment, Board, BurndownPoint, Comment, ProjectSummary, SavedFilter, ColumnUpdateInput, EpicStats, Issue, IssueEvent, IssueFieldsInput, Member, Page, Project, Sprint, Status, Transition } from './types'

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects') })
}

export function useProject(key: string | undefined) {
  return useQuery({
    queryKey: ['project', key],
    queryFn: () => api<Project>(`/projects/${key}`),
    enabled: !!key,
  })
}

export function useStatuses(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['statuses', projectKey],
    queryFn: () => api<Status[]>(`/projects/${projectKey}/statuses`),
    enabled: !!projectKey,
    staleTime: 5 * 60 * 1000,
  })
}

export function useMembers(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['members', projectKey],
    queryFn: () => api<Member[]>(`/projects/${projectKey}/members`),
    enabled: !!projectKey,
  })
}

export interface IssueListFilter {
  query?: string
  status?: string
  type?: string
  assignee?: string
  startAt?: number
}

export function useProjectIssues(projectKey: string | undefined, filter: IssueListFilter) {
  const params = new URLSearchParams()
  if (filter.query) params.set('query', filter.query)
  if (filter.status) params.set('status', filter.status)
  if (filter.type) params.set('type', filter.type)
  if (filter.assignee) params.set('assignee', filter.assignee)
  params.set('startAt', String(filter.startAt ?? 0))
  return useQuery({
    queryKey: ['issues', projectKey, filter],
    queryFn: () => api<Page<Issue>>(`/projects/${projectKey}/issues?${params}`),
    enabled: !!projectKey,
    placeholderData: (prev) => prev,
  })
}

export function useIssue(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['issue', issueKey],
    queryFn: () => api<Issue>(`/issues/${issueKey}`),
    enabled: !!issueKey,
  })
}

export function useChangelog(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['changelog', issueKey],
    queryFn: () => api<{ values: IssueEvent[] }>(`/issues/${issueKey}/changelog`),
    enabled: !!issueKey,
  })
}

export function useTransitions(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['transitions', issueKey],
    queryFn: () => api<{ transitions: Transition[] }>(`/issues/${issueKey}/transitions`),
    enabled: !!issueKey,
  })
}

export function useUserSearch(query: string) {
  return useQuery({
    queryKey: ['users', query],
    queryFn: () => api<User[]>(`/users?query=${encodeURIComponent(query)}`),
    staleTime: 60 * 1000,
  })
}

export function useCreateProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { key: string; name: string; description?: string; projectType?: string }) =>
      api<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useCreateIssue() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fields: IssueFieldsInput) =>
      api<Issue>('/issues', { method: 'POST', body: JSON.stringify({ fields }) }),
    onSuccess: (issue) => qc.invalidateQueries({ queryKey: ['issues', issue.projectKey] }),
  })
}

function applyIssue(qc: ReturnType<typeof useQueryClient>, issue: Issue) {
  qc.setQueryData(['issue', issue.key], issue)
  qc.invalidateQueries({ queryKey: ['issues', issue.projectKey] })
  qc.invalidateQueries({ queryKey: ['board-issues'] })
  qc.invalidateQueries({ queryKey: ['backlog'] })
  qc.invalidateQueries({ queryKey: ['sprint-issues'] })
  qc.invalidateQueries({ queryKey: ['children'] })
  qc.invalidateQueries({ queryKey: ['epics', issue.projectKey] })
  qc.invalidateQueries({ queryKey: ['changelog', issue.key] })
  qc.invalidateQueries({ queryKey: ['transitions', issue.key] })
}

export function useUpdateIssue(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (fields: IssueFieldsInput) =>
      api<Issue>(`/issues/${issueKey}`, { method: 'PUT', body: JSON.stringify({ fields }) }),
    onSuccess: (issue) => applyIssue(qc, issue),
  })
}

export function useBoards(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['boards', projectKey],
    queryFn: () => api<Board[]>(`/projects/${projectKey}/boards`),
    enabled: !!projectKey,
    staleTime: 60 * 1000,
  })
}

export function useBoardIssues(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board-issues', boardId],
    queryFn: () => api<{ total: number; values: Issue[]; sprint: Sprint | null; hiddenDone?: number }>(`/boards/${boardId}/issues`),
    enabled: !!boardId,
  })
}

export function useSprints(boardId: string | undefined, includeClosed = false) {
  return useQuery({
    queryKey: ['sprints', boardId, includeClosed],
    queryFn: () => api<Sprint[]>(`/boards/${boardId}/sprints?includeClosed=${includeClosed}`),
    enabled: !!boardId,
  })
}

export function useBacklog(boardId: string | undefined) {
  return useQuery({
    queryKey: ['backlog', boardId],
    queryFn: () => api<{ total: number; values: Issue[] }>(`/boards/${boardId}/backlog`),
    enabled: !!boardId,
  })
}

export function useSprintIssues(sprintId: string) {
  return useQuery({
    queryKey: ['sprint-issues', sprintId],
    queryFn: () => api<{ total: number; values: Issue[] }>(`/sprints/${sprintId}/issues`),
  })
}

export function useEpics(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['epics', projectKey],
    queryFn: () => api<EpicStats[]>(`/projects/${projectKey}/epics`),
    enabled: !!projectKey,
  })
}

export function useChildren(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['children', issueKey],
    queryFn: () => api<{ values: Issue[] }>(`/issues/${issueKey}/children`),
    enabled: !!issueKey,
  })
}

export function useBurndown(sprintId: string | undefined) {
  return useQuery({
    queryKey: ['burndown', sprintId],
    queryFn: () => api<{ sprint: Sprint; total: number; points: BurndownPoint[] }>(`/sprints/${sprintId}/burndown`),
    enabled: !!sprintId,
  })
}

export function invalidatePlanning(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['sprints'] })
  qc.invalidateQueries({ queryKey: ['backlog'] })
  qc.invalidateQueries({ queryKey: ['sprint-issues'] })
  qc.invalidateQueries({ queryKey: ['board-issues'] })
  qc.invalidateQueries({ queryKey: ['epics'] })
}

export function useCreateSprint(boardId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<Sprint>(`/boards/${boardId}/sprints`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => invalidatePlanning(qc),
  })
}

export function useStartSprint(sprintId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; goal: string; startAt: string; endAt: string }) =>
      api<Sprint>(`/sprints/${sprintId}/start`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidatePlanning(qc),
  })
}

export function useCompleteSprint(sprintId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (moveToSprintId: string | null) =>
      api<{ sprint: Sprint; movedIssues: number }>(`/sprints/${sprintId}/complete`, {
        method: 'POST',
        body: JSON.stringify({ moveToSprintId }),
      }),
    onSuccess: () => invalidatePlanning(qc),
  })
}

export function useDeleteSprint() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sprintId: string) => api<void>(`/sprints/${sprintId}`, { method: 'DELETE' }),
    onSuccess: () => invalidatePlanning(qc),
  })
}

export function useUpdateSprint(sprintId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; goal: string }) =>
      api<Sprint>(`/sprints/${sprintId}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => invalidatePlanning(qc),
  })
}

export function useUpdateColumns(boardId: string | undefined, projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (columns: ColumnUpdateInput[]) =>
      api<Board>(`/boards/${boardId}/columns`, { method: 'PUT', body: JSON.stringify({ columns }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boards', projectKey] }),
  })
}

export function useRankIssue(boardId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ issueKey, before, after }: { issueKey: string; before?: string; after?: string }) =>
      api<Issue>(`/issues/${issueKey}/rank`, {
        method: 'PUT',
        body: JSON.stringify(before ? { rankBeforeIssue: before } : { rankAfterIssue: after }),
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['board-issues', boardId] }),
  })
}

export function useTransitionIssue(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (transitionId: string) =>
      api<Issue>(`/issues/${issueKey}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: transitionId } }),
      }),
    onSuccess: (issue) => applyIssue(qc, issue),
  })
}

export function useComments(issueKey: string) {
  return useQuery({
    queryKey: ['comments', issueKey],
    queryFn: () => api<{ values: Comment[] }>(`/issues/${issueKey}/comments`),
  })
}

export function useAddComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { body?: string; bodyDoc?: unknown }) =>
      api<Comment>(`/issues/${issueKey}/comments`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comments', issueKey] })
      qc.invalidateQueries({ queryKey: ['changelog', issueKey] })
    },
  })
}

export function useUpdateComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; body?: string; bodyDoc?: unknown }) =>
      api<Comment>(`/issues/${issueKey}/comments/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', issueKey] }),
  })
}

export function useDeleteComment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/issues/${issueKey}/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['comments', issueKey] }),
  })
}

export function useAttachments(issueKey: string) {
  return useQuery({
    queryKey: ['attachments', issueKey],
    queryFn: () => api<{ values: Attachment[] }>(`/issues/${issueKey}/attachments`),
  })
}

export function useUploadAttachment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<Attachment>(`/issues/${issueKey}/attachments`, { method: 'POST', body: form })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attachments', issueKey] })
      qc.invalidateQueries({ queryKey: ['changelog', issueKey] })
    },
  })
}

export function useDeleteAttachment(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attachments', issueKey] }),
  })
}

// Object URL for an attachment blob (image previews, downloads).
export function useAttachmentURL(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['attachment-blob', id],
    queryFn: async () => URL.createObjectURL(await apiBlob(`/attachments/${id}?inline=true`)),
    enabled,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  })
}

export function useWatchers(issueKey: string) {
  return useQuery({
    queryKey: ['watchers', issueKey],
    queryFn: () => api<{ values: import('./client').User[]; isWatching: boolean }>(`/issues/${issueKey}/watchers`),
  })
}

export function useToggleWatch(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (watch: boolean) =>
      api<void>(`/issues/${issueKey}/watchers`, { method: watch ? 'POST' : 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['watchers', issueKey] }),
  })
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ values: AppNotification[]; unread: number }>('/notifications'),
    refetchInterval: 60_000,
  })
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) =>
      api<void>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useSearch(tql: string, startAt: number, enabled: boolean) {
  return useQuery({
    queryKey: ['search', tql, startAt],
    queryFn: () =>
      api<Page<Issue>>(`/search?tql=${encodeURIComponent(tql)}&startAt=${startAt}&maxResults=50`),
    enabled,
    placeholderData: (prev) => prev,
    retry: false,
  })
}

export function useQuickSearch(q: string, opts?: { space?: string; contributor?: string; withRecents?: boolean }) {
  const space = opts?.space ?? ''
  const contributor = opts?.contributor ?? ''
  return useQuery({
    queryKey: ['quicksearch', q, space, contributor],
    queryFn: () =>
      api<{ values: Issue[]; wikiPages?: WikiSearchHit[]; recentWiki?: RecentViewedWikiPage[] }>(
        `/quicksearch?q=${encodeURIComponent(q)}&space=${encodeURIComponent(space)}&contributor=${encodeURIComponent(contributor)}`),
    enabled: q.trim().length >= 2 || !!opts?.withRecents,
    placeholderData: (prev) => prev,
  })
}

export function useWikiShortcuts(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-shortcuts', key],
    queryFn: () => api<WikiShortcut[]>(`/wiki/spaces/${key}/shortcuts`),
    enabled: !!key,
  })
}

export function useCreateWikiShortcut(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; url: string }) =>
      api<{ id: string }>(`/wiki/spaces/${key}/shortcuts`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-shortcuts', key] }),
  })
}

export function useDeleteWikiShortcut(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/shortcuts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-shortcuts', key] }),
  })
}

export function useFilters() {
  return useQuery({ queryKey: ['filters'], queryFn: () => api<SavedFilter[]>('/filters') })
}

export function useCreateFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; tql: string; isShared: boolean }) =>
      api<SavedFilter>('/filters', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters'] }),
  })
}

export function useDeleteFilter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/filters/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['filters'] }),
  })
}

export function useProjectSummary(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['summary', projectKey],
    queryFn: () => api<ProjectSummary>(`/projects/${projectKey}/summary`),
    enabled: !!projectKey,
  })
}

export type { ActivityEntry }

export function useImportJobs() {
  return useQuery({ queryKey: ['import-jobs'], queryFn: () => api<ImportJob[]>('/import/jira') })
}

export function useImportJob(id: string | undefined) {
  return useQuery({
    queryKey: ['import-job', id],
    queryFn: () => api<ImportJob>(`/import/jira/${id}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'scanning' || status === 'running' || status === 'created' ? 1500 : false
    },
  })
}

export function useStartImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { site: string; email: string; apiToken: string; projectKey: string } | FormData) =>
      api<ImportJob>('/import/jira', {
        method: 'POST',
        body: input instanceof FormData ? input : JSON.stringify({ source: 'api', ...input }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-jobs'] }),
  })
}

export function useStartConfluenceImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { site: string; email: string; apiToken: string; spaceKey: string; targetKey?: string }) =>
      api<ImportJob>('/import/jira', {
        method: 'POST',
        body: JSON.stringify({ source: 'confluence', ...input }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['import-jobs'] }),
  })
}

export function useRunImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<ImportJob>(`/import/jira/${id}/run`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: (job) => {
      qc.setQueryData(['import-job', job.id], job)
      qc.invalidateQueries({ queryKey: ['import-jobs'] })
    },
  })
}

export function useVersions(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['versions', projectKey],
    queryFn: () => api<Version[]>(`/projects/${projectKey}/versions`),
    enabled: !!projectKey,
  })
}

export function useVersion(projectKey: string, versionId: string | undefined) {
  return useQuery({
    queryKey: ['version', versionId],
    queryFn: () => api<{ version: Version; issues: Issue[] }>(`/projects/${projectKey}/versions/${versionId}`),
    enabled: !!versionId,
  })
}

export function useCreateVersion(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; startDate?: string; releaseDate?: string }) =>
      api<Version>(`/projects/${projectKey}/versions`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['versions', projectKey] }),
  })
}

export function useUpdateVersion(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; description?: string; startDate?: string; releaseDate?: string }) =>
      api<Version>(`/projects/${projectKey}/versions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['versions', projectKey] })
      qc.invalidateQueries({ queryKey: ['version', v.id] })
    },
  })
}

export function useSetVersionStatus(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, moveOpenTo }: { id: string; status: string; moveOpenTo?: string }) =>
      api<Version>(`/projects/${projectKey}/versions/${id}/status`, { method: 'POST', body: JSON.stringify({ status, moveOpenTo }) }),
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['versions', projectKey] })
      qc.invalidateQueries({ queryKey: ['version', v.id] })
    },
  })
}

export function useDeleteVersion(projectKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${projectKey}/versions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['versions', projectKey] }),
  })
}

export function useAccount() {
  return useQuery({ queryKey: ['account'], queryFn: () => api<Profile>('/account') })
}

function useAccountMutation<TBody>(path: string, method = 'PUT') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TBody) => api<Profile>(path, { method, body: JSON.stringify(body) }),
    onSuccess: (profile) => {
      qc.setQueryData(['account'], profile)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export const useUpdateProfile = () =>
  useAccountMutation<{ displayName: string; publicName: string; jobTitle: string; department: string; organization: string; location: string }>('/account/profile')
export const useUpdateEmail = () => useAccountMutation<{ email: string; currentPassword: string }>('/account/email')
export const useUpdatePreferences = () => useAccountMutation<{ timezone?: string; theme?: string; language?: string; landingPage?: string }>('/account/preferences')

export function useUpdatePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api<void>('/account/password', { method: 'PUT', body: JSON.stringify(body) }),
  })
}

export function useUploadUserImage(kind: 'avatar' | 'header') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<Profile>(`/account/${kind}`, { method: 'POST', body: form })
    },
    onSuccess: (profile) => qc.setQueryData(['account'], profile),
  })
}

export function useDeleteUserImage(kind: 'avatar' | 'header') {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/account/${kind}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['account'] }),
  })
}

export function useSessions() {
  return useQuery({ queryKey: ['sessions'], queryFn: () => api<{ values: SessionInfo[] }>('/account/sessions') })
}

export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string | null) =>
      api<void>(id ? `/account/sessions/${id}` : '/account/sessions', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  })
}

export function usePersonProfile(id: string | undefined) {
  return useQuery({
    queryKey: ['person', id],
    queryFn: () => api<{ profile: Profile; sharedProjects: Project[] }>(`/users/${id}/profile`),
    enabled: !!id,
  })
}

export function useSiteInfo() {
  return useQuery({
    queryKey: ['site'],
    queryFn: () => api<{ siteName: string; registrationMode: string; introduction: string; language: string; require2fa: boolean; ssoEnabled: boolean; ssoLabel: string; demoMode: boolean; demoContactUrl: string; demoInstagramUrl: string }>('/site'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdminUsers(query: string) {
  return useQuery({
    queryKey: ['admin-users', query],
    queryFn: () => api<AdminUser[]>(`/admin/users?query=${encodeURIComponent(query)}`),
    placeholderData: (prev) => prev,
  })
}

function useAdminAction(path: (id: string) => string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: unknown }) =>
      api<void>(path(id), { method: 'POST', body: JSON.stringify(body ?? {}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-users'] }),
  })
}

export const useAdminActivate = () => useAdminAction((id) => `/admin/users/${id}/activate`)
export const useAdminDeactivate = () => useAdminAction((id) => `/admin/users/${id}/deactivate`)
export const useAdminSetAdmin = () => useAdminAction((id) => `/admin/users/${id}/admin`)

export function useAdminInvites() {
  return useQuery({ queryKey: ['admin-invites'], queryFn: () => api<Invite[]>('/admin/invites') })
}

export function useAdminCreateInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; userId?: string }) =>
      api<{ invite: Invite; inviteUrl: string; emailSent: boolean }>('/admin/invites', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invites'] }),
  })
}

export function useAdminDeleteInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-invites'] }),
  })
}

export function useAdminProjects() {
  return useQuery({ queryKey: ['admin-projects'], queryFn: () => api<AdminProject[]>('/admin/projects') })
}

export function useAdminSettings() {
  return useQuery({ queryKey: ['admin-settings'], queryFn: () => api<Record<string, string>>('/admin/settings') })
}

export function useAdminUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: Record<string, string>) =>
      api<Record<string, string>>('/admin/settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (settings) => {
      qc.setQueryData(['admin-settings'], settings)
      qc.invalidateQueries({ queryKey: ['site'] })
    },
  })
}

export function useAdminSystem() {
  return useQuery({ queryKey: ['admin-system'], queryFn: () => api<Record<string, unknown>>('/admin/system') })
}

// ---- Stage 8: space settings ----

function invalidateSpace(qc: ReturnType<typeof useQueryClient>, key: string | undefined) {
  qc.invalidateQueries({ queryKey: ['project', key] })
  qc.invalidateQueries({ queryKey: ['projects'] })
}

export function useUpdateProjectDetails(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description: string; leadId?: string | null; defaultAssigneeId: string | null; url?: string; categoryId?: string }) =>
      api<Project>(`/projects/${projectKey}/details`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (project) => {
      qc.setQueryData(['project', projectKey], project)
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['members', projectKey] })
    },
  })
}

export function useUploadProjectAvatar(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<Project>(`/projects/${projectKey}/avatar`, { method: 'POST', body: form })
    },
    onSuccess: (project) => {
      qc.setQueryData(['project', projectKey], project)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useDeleteProjectAvatar(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>(`/projects/${projectKey}/avatar`, { method: 'DELETE' }),
    onSuccess: () => invalidateSpace(qc, projectKey),
  })
}

export function useUpdateMemberRole(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api<void>(`/projects/${projectKey}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectKey] }),
  })
}

export function useRemoveMember(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) =>
      api<void>(`/projects/${projectKey}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', projectKey] }),
  })
}

export function useLabelInfo(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['labelinfo', projectKey],
    queryFn: () => api<LabelInfo[]>(`/projects/${projectKey}/labelinfo`),
    enabled: !!projectKey,
  })
}

export function useRenameLabel(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name, newName }: { name: string; newName: string }) =>
      api<void>(`/projects/${projectKey}/labels/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ newName }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labelinfo', projectKey] })
      qc.invalidateQueries({ queryKey: ['labels', projectKey] })
      qc.invalidateQueries({ queryKey: ['issues', projectKey] })
    },
  })
}

export function useDeleteLabel(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api<void>(`/projects/${projectKey}/labels/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['labelinfo', projectKey] })
      qc.invalidateQueries({ queryKey: ['labels', projectKey] })
      qc.invalidateQueries({ queryKey: ['issues', projectKey] })
    },
  })
}

function invalidateWorkflow(qc: ReturnType<typeof useQueryClient>, projectKey: string | undefined) {
  qc.invalidateQueries({ queryKey: ['statuses', projectKey] })
  qc.invalidateQueries({ queryKey: ['boards', projectKey] })
  qc.invalidateQueries({ queryKey: ['board-issues'] })
}

export function useCreateStatus(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; category: string }) =>
      api<Status>(`/projects/${projectKey}/statuses`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWorkflow(qc, projectKey),
  })
}

export function useRenameStatus(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api<void>(`/projects/${projectKey}/statuses/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    onSuccess: () => invalidateWorkflow(qc, projectKey),
  })
}

export function useDeleteStatus(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${projectKey}/statuses/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWorkflow(qc, projectKey),
  })
}

export function useReorderColumns(boardId: string | undefined, projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (columnIds: string[]) =>
      api<Board>(`/boards/${boardId}/columns/order`, { method: 'PUT', body: JSON.stringify({ columnIds }) }),
    onSuccess: () => invalidateWorkflow(qc, projectKey),
  })
}

export function useSetArchived(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (archived: boolean) =>
      api<Project>(`/projects/${projectKey}/${archived ? 'archive' : 'unarchive'}`, { method: 'POST' }),
    onSuccess: (project) => {
      qc.setQueryData(['project', projectKey], project)
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useUpdateNotifyPrefs(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: Record<string, boolean>) =>
      api<Project>(`/projects/${projectKey}/notifications`, { method: 'PUT', body: JSON.stringify(prefs) }),
    onSuccess: (project) => qc.setQueryData(['project', projectKey], project),
  })
}

export function useDeleteProject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectKey: string) => api<void>(`/projects/${projectKey}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })
}

export function useUserNotifyPrefs() {
  return useQuery({
    queryKey: ['user-notify-prefs'],
    queryFn: () => api<UserNotifyPrefs>('/account/notifications'),
  })
}

export function useUpdateUserNotifyPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: UserNotifyPrefs) =>
      api<UserNotifyPrefs>('/account/notifications', { method: 'PUT', body: JSON.stringify(prefs) }),
    onSuccess: (prefs) => qc.setQueryData(['user-notify-prefs'], prefs),
  })
}


// ---- Stage 11: work items ----

export function useWorkTypes() {
  return useQuery({
    queryKey: ['work-types'],
    queryFn: () => api<WorkType[]>('/work-types'),
    staleTime: 5 * 60 * 1000,
  })
}

export function useAdminWorkTypes() {
  return useQuery({ queryKey: ['admin-work-types'], queryFn: () => api<WorkType[]>('/admin/work-types') })
}

function invalidateWorkTypes(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['work-types'] })
  qc.invalidateQueries({ queryKey: ['admin-work-types'] })
}

export function useAdminCreateWorkType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; glyph: string; color: string }) =>
      api<WorkType>('/admin/work-types', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWorkTypes(qc),
  })
}

export function useAdminUpdateWorkType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; glyph: string; color: string; isEnabled: boolean }) =>
      api<WorkType>(`/admin/work-types/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => invalidateWorkTypes(qc),
  })
}

export function useAdminDeleteWorkType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/work-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateWorkTypes(qc),
  })
}

export function useProjectFields(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['project-fields', projectKey],
    queryFn: () => api<CustomField[]>(`/projects/${projectKey}/fields`),
    enabled: !!projectKey,
    staleTime: 60 * 1000,
  })
}

export function useAdminFields() {
  return useQuery({ queryKey: ['admin-fields'], queryFn: () => api<CustomField[]>('/admin/fields') })
}

function invalidateFields(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['admin-fields'] })
  qc.invalidateQueries({ queryKey: ['project-fields'] })
}

export function useAdminCreateField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; type: string; options: string[]; projectKey: string | null }) =>
      api<CustomField>('/admin/fields', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => invalidateFields(qc),
  })
}

export function useAdminUpdateField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name: string; options: string[] }) =>
      api<CustomField>(`/admin/fields/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => invalidateFields(qc),
  })
}

export function useAdminDeleteField() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/fields/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateFields(qc),
  })
}

export function useProjectTransitions(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['project-transitions', projectKey],
    queryFn: () => api<WorkflowTransition[]>(`/projects/${projectKey}/transitions`),
    enabled: !!projectKey,
  })
}

export function useCreateProjectTransition(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; fromStatusId: string | null; toStatusId: string }) =>
      api<WorkflowTransition>(`/projects/${projectKey}/transitions`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-transitions', projectKey] }),
  })
}

export function useDeleteProjectTransition(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/projects/${projectKey}/transitions/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-transitions', projectKey] }),
  })
}

export function useAdminWorkflows() {
  return useQuery({ queryKey: ['admin-workflows'], queryFn: () => api<AdminWorkflowRow[]>('/admin/workflows') })
}

export function useAdminWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ['admin-workflow', id],
    queryFn: () => api<WorkflowDetail>(`/admin/workflows/${id}`),
    enabled: !!id,
  })
}

export function useUpdateAdminWorkflow(id: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WorkflowUpdateInput) =>
      api<WorkflowDetail>(`/admin/workflows/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (detail) => {
      qc.setQueryData(['admin-workflow', id], detail)
      qc.invalidateQueries({ queryKey: ['admin-workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow'] })
      qc.invalidateQueries({ queryKey: ['statuses'] })
      qc.invalidateQueries({ queryKey: ['board'] })
    },
  })
}

export function useCreateAdminWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) =>
      api<{ id: string }>('/admin/workflows', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-workflows'] }),
  })
}

export function useCopyAdminWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<{ id: string }>(`/admin/workflows/${id}/copy`, { method: 'POST', body: '{}' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-workflows'] }),
  })
}

export function useDeleteAdminWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/workflows/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-workflows'] }),
  })
}

export function useAssignAdminWorkflow() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, projectKey }: { id: string; projectKey: string }) =>
      api<void>(`/admin/workflows/${id}/assign`, { method: 'POST', body: JSON.stringify({ projectKey }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow'] })
      qc.invalidateQueries({ queryKey: ['statuses'] })
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['boards'] })
    },
  })
}

export function useWorkflow(projectKey: string | undefined) {
  return useQuery({
    queryKey: ['workflow', projectKey],
    queryFn: () => api<WorkflowDetail>(`/projects/${projectKey}/workflow`),
    enabled: !!projectKey,
  })
}

export function useUpdateWorkflow(projectKey: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WorkflowUpdateInput) =>
      api<WorkflowDetail>(`/projects/${projectKey}/workflow`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (detail) => {
      qc.setQueryData(['workflow', projectKey], detail)
      qc.invalidateQueries({ queryKey: ['statuses', projectKey] })
      qc.invalidateQueries({ queryKey: ['project-transitions', projectKey] })
      qc.invalidateQueries({ queryKey: ['board'] })
      qc.invalidateQueries({ queryKey: ['boards', projectKey] })
    },
  })
}


// ---- Stage 12: system admin ----

export function useAdminAudit(query: string, action: string, startAt: number) {
  const params = new URLSearchParams({ query, action, startAt: String(startAt) })
  return useQuery({
    queryKey: ['admin-audit', query, action, startAt],
    queryFn: () =>
      api<{ total: number; isLast: boolean; values: AuditEntry[]; actions: string[] }>(`/admin/audit?${params}`),
    placeholderData: (prev) => prev,
  })
}

export function useAdminTestEmail() {
  return useMutation({
    mutationFn: (to: string) =>
      api<{ sent: boolean; smtp: string; from: string }>('/admin/settings/test-email', {
        method: 'POST',
        body: JSON.stringify({ to }),
      }),
  })
}

export function useAdminMailHandlers() {
  return useQuery({ queryKey: ['admin-mail-handlers'], queryFn: () => api<MailHandler[]>('/admin/mail-handlers') })
}

export function useAdminCreateMailHandler() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: object) => api<MailHandler>('/admin/mail-handlers', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mail-handlers'] }),
  })
}

export function useAdminUpdateMailHandler() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; [k: string]: unknown }) =>
      api<MailHandler>(`/admin/mail-handlers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mail-handlers'] }),
  })
}

export function useAdminDeleteMailHandler() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/mail-handlers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-mail-handlers'] }),
  })
}

export function useAdminSchemes() {
  return useQuery({ queryKey: ['admin-schemes'], queryFn: () => api<PermissionScheme[]>('/admin/schemes') })
}

export function useAdminScheme(id: string) {
  return useQuery({ queryKey: ['admin-scheme', id], queryFn: () => api<PermissionScheme>(`/admin/schemes/${id}`), enabled: !!id })
}

export function useAdminCreateScheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description: string; copyFrom: string }) =>
      api<PermissionScheme>('/admin/schemes', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-schemes'] }),
  })
}

export function useAdminUpdateScheme(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api<PermissionScheme>(`/admin/schemes/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (sc) => {
      qc.setQueryData(['admin-scheme', id], sc)
      qc.invalidateQueries({ queryKey: ['admin-schemes'] })
    },
  })
}

export function useAdminDeleteScheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/schemes/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-schemes'] }),
  })
}

export function useAdminAddGrant(schemeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { permission: string; granteeType: string; granteeId: string | null }) =>
      api<PermissionScheme>(`/admin/schemes/${schemeId}/grants`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (sc) => qc.setQueryData(['admin-scheme', schemeId], sc),
  })
}

export function useAdminRemoveGrant(schemeId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (grantId: string) => api<PermissionScheme>(`/admin/schemes/${schemeId}/grants/${grantId}`, { method: 'DELETE' }),
    onSuccess: (sc) => qc.setQueryData(['admin-scheme', schemeId], sc),
  })
}

export function useAdminSetProjectScheme() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, schemeId }: { key: string; schemeId: string }) =>
      api<void>(`/admin/projects/${key}/scheme`, { method: 'PUT', body: JSON.stringify({ schemeId }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-schemes'] })
    },
  })
}

export function useAdminCategories() {
  return useQuery({ queryKey: ['admin-categories'], queryFn: () => api<SpaceCategory[]>('/admin/categories') })
}

export function useAdminCreateCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => api<SpaceCategory>('/admin/categories', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-categories'] }),
  })
}

export function useAdminDeleteCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-categories'] })
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
    },
  })
}

export function useAdminSetProjectCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, id }: { key: string; id: string | null }) =>
      api<void>(`/admin/projects/${key}/category`, { method: 'PUT', body: JSON.stringify({ id }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-categories'] })
    },
  })
}

export function useAdminUnarchive() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => api<Project>(`/admin/projects/${key}/unarchive`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}


// ---- Stage 13: integrations ----

export function useAPITokens() {
  return useQuery({ queryKey: ['api-tokens'], queryFn: () => api<APIToken[]>('/account/api-tokens') })
}

export function useCreateAPIToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (label: string) =>
      api<{ token: string; info: APIToken }>('/account/api-tokens', { method: 'POST', body: JSON.stringify({ label }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

export function useRevokeAPIToken() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/account/api-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-tokens'] }),
  })
}

export interface WebhookInput {
  name: string
  url: string
  secret?: string | null
  events: string[]
  projectKey: string | null
  isEnabled?: boolean
}

export function useAdminWebhooks() {
  return useQuery({ queryKey: ['admin-webhooks'], queryFn: () => api<Webhook[]>('/admin/webhooks') })
}

export function useAdminCreateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WebhookInput) => api<Webhook>('/admin/webhooks', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-webhooks'] }),
  })
}

export function useAdminUpdateWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: WebhookInput & { id: string }) =>
      api<Webhook>(`/admin/webhooks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-webhooks'] }),
  })
}

export function useAdminDeleteWebhook() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/admin/webhooks/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-webhooks'] }),
  })
}

export function useWebhookDeliveries(id: string | null) {
  return useQuery({
    queryKey: ['webhook-deliveries', id],
    queryFn: () => api<WebhookDelivery[]>(`/admin/webhooks/${id}/deliveries`),
    enabled: !!id,
    refetchInterval: 5000,
  })
}


// ---- Stage 14/15: automation (admin- or space-scoped via spaceKey) ----

function automationBase(spaceKey?: string | null) {
  return spaceKey ? `/projects/${spaceKey}/automation` : '/admin/automation'
}

export function useAutomationRules(spaceKey?: string | null) {
  return useQuery({
    queryKey: ['automation-rules', spaceKey ?? 'admin'],
    queryFn: () => api<AutomationRule[]>(automationBase(spaceKey)),
  })
}

export function useAutomationRule(id: string | undefined, spaceKey?: string | null) {
  return useQuery({
    queryKey: ['automation-rule', id],
    queryFn: () => api<AutomationRule>(`${automationBase(spaceKey)}/${id}`),
    enabled: !!id && id !== 'new',
  })
}

export function useCreateAutomationRule(spaceKey?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AutomationRuleInput) =>
      api<AutomationRule>(automationBase(spaceKey), { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  })
}

export function useUpdateAutomationRule(spaceKey?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: AutomationRuleInput & { id: string }) =>
      api<AutomationRule>(`${automationBase(spaceKey)}/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (rule) => {
      qc.setQueryData(['automation-rule', rule.id], rule)
      qc.invalidateQueries({ queryKey: ['automation-rules'] })
    },
  })
}

export function useDeleteAutomationRule(spaceKey?: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`${automationBase(spaceKey)}/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['automation-rules'] }),
  })
}

export function useAutomationRuns(id: string | undefined, spaceKey?: string | null) {
  return useQuery({
    queryKey: ['automation-runs', id],
    queryFn: () => api<AutomationRun[]>(`${automationBase(spaceKey)}/${id}/runs`),
    enabled: !!id && id !== 'new',
    refetchInterval: 5000,
  })
}

export function useManualFlows(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['manual-flows', issueKey],
    queryFn: () => api<AutomationRule[]>(`/issues/${issueKey}/manual-flows`),
    enabled: !!issueKey,
    staleTime: 30 * 1000,
  })
}

export function useRunManualFlow(issueKey: string) {
  return useMutation({
    mutationFn: (ruleId: string) =>
      api<{ queued: boolean }>(`/issues/${issueKey}/manual-flows/${ruleId}`, { method: 'POST' }),
  })
}


// ---- Stage 17: work item links ----

export function useIssueLinks(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['links', issueKey],
    queryFn: () => api<IssueLink[]>(`/issues/${issueKey}/links`),
    enabled: !!issueKey,
  })
}

export function useCreateLink(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { linkType: string; direction: 'outward' | 'inward'; otherKey: string }) =>
      api<IssueLink[]>(`/issues/${issueKey}/links`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (links) => {
      qc.setQueryData(['links', issueKey], links)
      qc.invalidateQueries({ queryKey: ['links'] })
    },
  })
}

export function useDeleteLink(issueKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) => api<void>(`/issues/${issueKey}/links/${linkId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['links'] }),
  })
}

// ---- Stage 18: dashboards ----

export function useDashboards() {
  return useQuery({ queryKey: ['dashboards'], queryFn: () => api<Dashboard[]>('/dashboards') })
}

export function useDashboard(id: string | undefined) {
  return useQuery({
    queryKey: ['dashboard', id],
    queryFn: () => api<Dashboard>(`/dashboards/${id}`),
    enabled: !!id,
  })
}

export interface DashboardInput {
  name: string
  description: string
  isShared: boolean
}

export function useCreateDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DashboardInput) =>
      api<Dashboard>('/dashboards', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

export function useUpdateDashboard(id: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DashboardInput) =>
      api<Dashboard>(`/dashboards/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (d) => {
      qc.setQueryData(['dashboard', id], d)
      qc.invalidateQueries({ queryKey: ['dashboards'] })
    },
  })
}

export function useDeleteDashboard() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  })
}

export interface GadgetInput {
  type: GadgetType
  title: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>
}

export function useAddGadget(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: GadgetInput) =>
      api<DashboardGadget>(`/dashboards/${dashboardId}/gadgets`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  })
}

export function useUpdateGadget(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ gadgetId, ...body }: GadgetInput & { gadgetId: string }) =>
      api<void>(`/dashboards/${dashboardId}/gadgets/${gadgetId}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  })
}

export function useDeleteGadget(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (gadgetId: string) =>
      api<void>(`/dashboards/${dashboardId}/gadgets/${gadgetId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  })
}

export function useSaveLayout(dashboardId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (layout: { id: string; col: number; position: number }[]) =>
      api<void>(`/dashboards/${dashboardId}/layout`, { method: 'PUT', body: JSON.stringify(layout) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', dashboardId] }),
  })
}

export function useGadgetPie(tql: string, by: string, enabled: boolean) {
  return useQuery({
    queryKey: ['gadget-pie', tql, by],
    queryFn: () => api<{ values: PieSlice[] }>(`/gadgets/pie?tql=${encodeURIComponent(tql)}&by=${by}`),
    enabled,
    retry: false,
  })
}

export function useGadgetActivity(projectKey: string) {
  return useQuery({
    queryKey: ['gadget-activity', projectKey],
    queryFn: () => api<{ values: ActivityEntry[] }>(`/gadgets/activity?project=${encodeURIComponent(projectKey)}`),
  })
}

export function useGadgetBurndown(projectKey: string, enabled: boolean) {
  return useQuery({
    queryKey: ['gadget-burndown', projectKey],
    queryFn: () => api<{ sprint: Sprint | null }>(`/gadgets/burndown?project=${encodeURIComponent(projectKey)}`),
    enabled,
    retry: false,
  })
}


// ---- Stage W1: DocHat wiki ----

export function useWikiSpaces() {
  return useQuery({ queryKey: ['wiki-spaces'], queryFn: () => api<WikiSpace[]>('/wiki/spaces') })
}

export function useCreateWikiSpace() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { key: string; name: string; description: string }) =>
      api<WikiSpace>('/wiki/spaces', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-spaces'] }),
  })
}

export function useWikiStarred() {
  return useQuery({
    queryKey: ['wiki-starred'],
    queryFn: () => api<{ pages: StarredWikiPage[]; spaces: StarredWikiSpace[] }>('/wiki/starred'),
  })
}

export function useWikiSpaceFlags(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-space-flags', key],
    queryFn: () => api<{ starred: boolean; watching: boolean }>(`/wiki/spaces/${key}/flags`),
    enabled: !!key,
  })
}

export function useWikiSpaceAction(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ action, body, method }: { action: string; body?: unknown; method?: string }) =>
      api<unknown>(`/wiki/spaces/${key}${action}`, { method: method ?? 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-space-flags', key] })
      qc.invalidateQueries({ queryKey: ['wiki-space', key] })
      qc.invalidateQueries({ queryKey: ['wiki-spaces'] })
      qc.invalidateQueries({ queryKey: ['wiki-starred'] })
    },
  })
}

export function useWikiTrashList(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-trash', key],
    queryFn: () => api<TrashedWikiPage[]>(`/wiki/spaces/${key}/trash`),
    enabled: !!key,
  })
}

export function useWikiTrashAction(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, purge }: { id: string; purge: boolean }) =>
      purge
        ? api<void>(`/wiki/pages/${id}/purge`, { method: 'DELETE' })
        : api<void>(`/wiki/pages/${id}/restore`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-trash', key] })
      qc.invalidateQueries({ queryKey: ['wiki-space', key] })
    },
  })
}

export function useWikiStarState(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-star', pageId],
    queryFn: () => api<{ starred: boolean }>(`/wiki/pages/${pageId}/star`),
    enabled: !!pageId,
  })
}

export function useToggleWikiStar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pageId: string) => api<{ starred: boolean }>(`/wiki/pages/${pageId}/star`, { method: 'POST' }),
    onSuccess: (data, pageId) => {
      qc.setQueryData(['wiki-star', pageId], data)
      qc.invalidateQueries({ queryKey: ['wiki-starred'] })
    },
  })
}

export function useRenameWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api<void>(`/wiki/pages/${id}/rename`, { method: 'PUT', body: JSON.stringify({ title }) }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] })
      qc.invalidateQueries({ queryKey: ['wiki-page', id] })
      qc.invalidateQueries({ queryKey: ['wiki-starred'] })
    },
  })
}

export function useCopyWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<WikiPage>(`/wiki/pages/${id}/copy`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] }),
  })
}

export function useMoveWikiPageTo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, spaceKey, parentId }: { id: string; spaceKey: string; parentId: string | null }) =>
      api<void>(`/wiki/pages/${id}/moveto`, { method: 'POST', body: JSON.stringify({ spaceKey, parentId }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space'] }),
  })
}

export function useArchiveWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api<void>(`/wiki/pages/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
    onSuccess: (_d, { id }) => {
      qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] })
      qc.invalidateQueries({ queryKey: ['wiki-archived', spaceKey] })
      qc.invalidateQueries({ queryKey: ['wiki-page', id] })
    },
  })
}

export function useWikiArchivedPages(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-archived', key],
    queryFn: () => api<ArchivedWikiPage[]>(`/wiki/spaces/${key}/archived`),
    enabled: !!key,
  })
}

export function useWikiCalendar(key: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ['wiki-calendar', key, from, to],
    queryFn: () => api<{ events: WikiCalendarEvent[]; dueItems: WikiCalendarDueItem[]; sprints: WikiCalendarSprint[] }>(
      `/wiki/spaces/${key}/calendar?from=${from}&to=${to}`),
    enabled: !!key,
  })
}

export function useCreateWikiCalendarEvent(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; description: string; startDate: string; endDate: string; color: string }) =>
      api<{ id: string }>(`/wiki/spaces/${key}/calendar`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-calendar', key] }),
  })
}

export function useUpdateWikiCalendarEvent(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title: string; description: string; startDate: string; endDate: string; color: string }) =>
      api<void>(`/wiki/calendar/events/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-calendar', key] }),
  })
}

export function useDeleteWikiCalendarEvent(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/calendar/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-calendar', key] }),
  })
}

export function useWikiBlogPosts(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-blog', key],
    queryFn: () => api<WikiBlogPost[]>(`/wiki/spaces/${key}/blog`),
    enabled: !!key,
  })
}

export function useWikiSpaceMembers(key: string) {
  return useQuery({ queryKey: ['wiki-members', key], queryFn: () => api<WikiSpaceMember[]>(`/wiki/spaces/${key}/members`) })
}

export function useSetWikiSpaceMember(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { email: string; role: string }) =>
      api<WikiSpaceMember[]>(`/wiki/spaces/${key}/members`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (members) => qc.setQueryData(['wiki-members', key], members),
  })
}

export function useRemoveWikiSpaceMember(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api<void>(`/wiki/spaces/${key}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-members', key] }),
  })
}

export function useSetWikiSpaceAccess(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (defaultRole: string) =>
      api<void>(`/wiki/spaces/${key}/access`, { method: 'PUT', body: JSON.stringify({ defaultRole }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', key] }),
  })
}

export function useUpdateWikiSpaceMeta(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description: string }) =>
      api<WikiSpace>(`/wiki/spaces/${key}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wiki-space', key] })
      qc.invalidateQueries({ queryKey: ['wiki-spaces'] })
    },
  })
}

export function useWikiTemplates(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-templates', key],
    queryFn: () => api<WikiTemplate[]>(`/wiki/spaces/${key}/templates`),
    enabled: !!key,
  })
}

export function useCreateWikiTemplate(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; description?: string; icon?: string; fromPageId?: string; bodyDoc?: unknown }) =>
      api<{ id: string }>(`/wiki/spaces/${key}/templates`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-templates', key] }),
  })
}

export function useWikiDeleteTemplate(key: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-templates', key] }),
  })
}

export function useWikiSpace(key: string | undefined) {
  return useQuery({
    queryKey: ['wiki-space', key],
    queryFn: () => api<{ space: WikiSpace; pages: WikiPageNode[]; myRole: string }>(`/wiki/spaces/${key}`),
    enabled: !!key,
  })
}

export function useWikiPage(id: string | undefined) {
  return useQuery({
    queryKey: ['wiki-page', id],
    queryFn: () => api<WikiPage>(`/wiki/pages/${id}`),
    enabled: !!id,
  })
}

export function useSaveWikiCanvas(pageId: string, spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; doc: unknown }) =>
      api<void>(`/wiki/pages/${pageId}/canvas`, { method: 'PUT', body: JSON.stringify(body) }),
    // Keep the sidebar tree's title in sync with renames.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] }),
  })
}

export function useCreateWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { title: string; icon: string; parentId: string | null; bodyDoc: unknown; kind?: string }) =>
      api<WikiPage>(`/wiki/spaces/${spaceKey}/pages`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] }),
  })
}

export function useUpdateWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title: string; icon: string; bodyDoc: unknown }) =>
      api<WikiPage>(`/wiki/pages/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (page) => {
      qc.setQueryData(['wiki-page', page.id], page)
      qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] })
    },
  })
}

export function useDeleteWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/pages/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] }),
  })
}


export function useWikiPageDraft(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-draft', pageId],
    queryFn: async () => {
      try {
        return await api<WikiDraft>(`/wiki/pages/${pageId}/draft`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
    enabled: !!pageId,
  })
}

export interface WikiDraftInput {
  draftId?: string
  pageId: string | null
  spaceKey: string
  parentId: string | null
  title: string
  bodyDoc: unknown
}

// Autosave endpoint — called from a debounce, not a mutation hook.
export function saveWikiDraft(body: WikiDraftInput): Promise<WikiDraft> {
  return api<WikiDraft>('/wiki/drafts', { method: 'PUT', body: JSON.stringify(body) })
}

export function deleteWikiDraft(id: string): Promise<void> {
  return api<void>(`/wiki/drafts/${id}`, { method: 'DELETE' })
}

export function useMoveWikiPage(spaceKey: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; parentId: string | null; position: number }) =>
      api<void>(`/wiki/pages/${id}/move`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-space', spaceKey] }),
  })
}


export interface RecentWikiPage {
  id: string
  title: string
  spaceKey: string
  spaceName: string
  updatedAt: string
}

export function useRecentWikiPages(enabled: boolean) {
  return useQuery({
    queryKey: ['wiki-recent'],
    queryFn: () => api<RecentWikiPage[]>('/wiki/recent'),
    enabled,
  })
}


// ---- Stage W3: wiki versions, comments, watchers, attachments ----

export function useWikiVersions(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-versions', pageId],
    queryFn: () => api<WikiVersion[]>(`/wiki/pages/${pageId}/versions`),
    enabled: !!pageId,
  })
}

export function useWikiVersion(pageId: string | undefined, n: number | undefined) {
  return useQuery({
    queryKey: ['wiki-version', pageId, n],
    queryFn: () => api<WikiVersionContent>(`/wiki/pages/${pageId}/versions/${n}`),
    enabled: !!pageId && !!n,
  })
}

export function useRestoreWikiVersion(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (n: number) => api<WikiPage>(`/wiki/pages/${pageId}/versions/${n}/restore`, { method: 'POST' }),
    onSuccess: (page) => {
      qc.setQueryData(['wiki-page', pageId], page)
      qc.invalidateQueries({ queryKey: ['wiki-versions', pageId] })
      qc.invalidateQueries({ queryKey: ['wiki-space', page.spaceKey] })
    },
  })
}

export function useWikiComments(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-comments', pageId],
    queryFn: () => api<WikiComment[]>(`/wiki/pages/${pageId}/comments`),
    enabled: !!pageId,
  })
}

export function useAddWikiComment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { body: string; bodyDoc: unknown; parentId?: string; inlineText?: string; inlineOccurrence?: number }) =>
      api<WikiComment>(`/wiki/pages/${pageId}/comments`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-comments', pageId] }),
  })
}

export function useResolveWikiComment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, resolved }: { id: string; resolved: boolean }) =>
      api<WikiComment>(`/wiki/comments/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolved }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-comments', pageId] }),
  })
}

export function useUpdateWikiComment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; body: string; bodyDoc: unknown }) =>
      api<Comment>(`/wiki/comments/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-comments', pageId] }),
  })
}

export function useDeleteWikiComment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/comments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-comments', pageId] }),
  })
}

export function useWikiWatch(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-watch', pageId],
    queryFn: () => api<{ watching: boolean; count: number }>(`/wiki/pages/${pageId}/watch`),
    enabled: !!pageId,
  })
}

export function useSetWikiWatch(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (watch: boolean) =>
      api<{ watching: boolean; count: number }>(`/wiki/pages/${pageId}/watch`, { method: watch ? 'POST' : 'DELETE' }),
    onSuccess: (state) => qc.setQueryData(['wiki-watch', pageId], state),
  })
}

export function useWikiAttachments(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-attachments', pageId],
    queryFn: () => api<WikiAttachment[]>(`/wiki/pages/${pageId}/attachments`),
    enabled: !!pageId,
  })
}

export function useUploadWikiAttachment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api<WikiAttachment[]>(`/wiki/pages/${pageId}/attachments`, { method: 'POST', body: form })
    },
    onSuccess: (atts) => qc.setQueryData(['wiki-attachments', pageId], atts),
  })
}

export function useDeleteWikiAttachment(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/wiki/attachments/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wiki-attachments', pageId] }),
  })
}


// ---- Stage W4: restrictions, share, labels, wiki search ----

export interface RecentViewedWikiPage {
  id: string
  title: string
  icon: string
  kind: string
  spaceKey: string
  spaceName: string
  viewedAt: string
  draft: boolean
}

export interface WikiShortcut {
  id: string
  title: string
  url: string
}

export interface WikiSearchHit {
  id: string
  title: string
  icon: string
  spaceKey: string
  spaceName: string
  kind: string
  draft: boolean
}

export function useWikiRestrictions(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-restrictions', pageId],
    queryFn: () => api<User[]>(`/wiki/pages/${pageId}/restrictions`),
    enabled: !!pageId,
  })
}

export function useSetWikiRestrictions(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (userIds: string[]) =>
      api<User[]>(`/wiki/pages/${pageId}/restrictions`, { method: 'PUT', body: JSON.stringify({ userIds }) }),
    onSuccess: (users) => {
      qc.setQueryData(['wiki-restrictions', pageId], users)
      qc.invalidateQueries({ queryKey: ['wiki-space'] })
    },
  })
}

export function useShareWikiPage(pageId: string) {
  return useMutation({
    mutationFn: (body: { userIds: string[]; message: string }) =>
      api<void>(`/wiki/pages/${pageId}/share`, { method: 'POST', body: JSON.stringify(body) }),
  })
}

export function useWikiLabels(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-labels', pageId],
    queryFn: () => api<string[]>(`/wiki/pages/${pageId}/labels`),
    enabled: !!pageId,
  })
}

export function useSetWikiLabels(pageId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (labels: string[]) =>
      api<string[]>(`/wiki/pages/${pageId}/labels`, { method: 'PUT', body: JSON.stringify({ labels }) }),
    onSuccess: (labels) => qc.setQueryData(['wiki-labels', pageId], labels),
  })
}

export function useWikiPagesByLabel(spaceKey: string | undefined, label: string | undefined) {
  return useQuery({
    queryKey: ['wiki-by-label', spaceKey, label],
    queryFn: () => api<WikiPageNode[]>(`/wiki/spaces/${spaceKey}/labels/${encodeURIComponent(label ?? '')}`),
    enabled: !!spaceKey && !!label,
  })
}


export function useMentionedOn(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['mentioned-on', issueKey],
    queryFn: () => api<WikiSearchHit[]>(`/issues/${issueKey}/mentioned-on`),
    enabled: !!issueKey,
  })
}
