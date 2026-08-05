import type { User } from './client'

export type IssueType = 'epic' | 'story' | 'task' | 'bug' | 'subtask'
export type Priority = 'highest' | 'high' | 'medium' | 'low' | 'lowest'
export type StatusCategory = 'todo' | 'in_progress' | 'done'

export interface Status {
  id: string
  name: string
  category: StatusCategory
  position: number
}

export interface Project {
  id: string
  key: string
  name: string
  description: string
  projectType: 'kanban' | 'scrum'
  lead: User
  avatarUrl: string | null
  defaultAssigneeId: string | null
  archivedAt: string | null
  notifyPrefs: Record<string, boolean>
  url: string
  features: Record<string, boolean>
  categoryId: string | null
  categoryName: string | null
  createdAt: string
  updatedAt: string
}

export interface LabelInfo {
  name: string
  issueCount: number
}

export interface WorkType {
  id: string
  key: string
  name: string
  glyph: 'epic' | 'story' | 'task' | 'bug' | 'subtask'
  color: string
  isEnabled: boolean
  builtin: boolean
  position: number
}

export interface CustomField {
  id: string
  projectId: string | null
  projectKey: string | null
  name: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[]
  position: number
  usageCount: number
}

export interface WorkflowTransition {
  id: string
  name: string
  from: Status | null
  to: Status
}

// ---- Stage 26: workflow editor ----

export type WorkflowRuleKind = 'restrict-who' | 'required-field' | 'auto-assign'

export interface WorkflowRule {
  id?: string
  kind: WorkflowRuleKind
  config: {
    users?: string[]
    roles?: string[]
    fields?: string[]
    assignee?: string
  }
}

export interface WorkflowStatusNode {
  id: string
  name: string
  category: 'todo' | 'in_progress' | 'done'
  position: number
  x: number | null
  y: number | null
}

export interface WorkflowEdge {
  id: string
  name: string
  fromStatusId: string | null
  toStatusId: string
  rules: WorkflowRule[]
}

export interface WorkflowDetail {
  id: string
  name: string
  statuses: WorkflowStatusNode[]
  transitions: WorkflowEdge[]
  usedIn: { key: string; name: string }[]
}

export interface AdminWorkflowRow {
  id: string
  name: string
  isDefault: boolean
  updatedAt: string
  spaces: { key: string; name: string }[]
}

export interface WorkflowUpdateInput {
  name?: string
  statuses: { id: string; name: string; category: string; x: number | null; y: number | null }[]
  transitions: {
    name: string
    fromRef: string | null
    toRef: string
    rules: { kind: WorkflowRuleKind; config: WorkflowRule['config'] }[]
  }[]
}

export interface Member {
  user: User
  role: 'admin' | 'member' | 'viewer'
}

export interface SprintRef {
  id: string
  name: string
  state: 'future' | 'active' | 'closed'
}

export interface IssueRef {
  id: string
  key: string
  summary: string
  type: IssueType
}

export interface Issue {
  id: string
  key: string
  projectKey: string
  projectName: string
  type: IssueType
  summary: string
  description: string
  descriptionDoc: unknown | null
  status: Status
  priority: Priority
  assignee: User | null
  reporter: User
  labels: string[]
  storyPoints: number | null
  sprint: SprintRef | null
  parent: IssueRef | null
  startDate: string | null
  dueDate: string | null
  fixVersions: VersionRef[]
  originalEstimateSeconds: number | null
  remainingEstimateSeconds: number | null
  timeSpentSeconds: number
  resolution: string | null
  resolvedAt: string | null
  custom: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface Page<T> {
  startAt: number
  maxResults: number
  total: number
  isLast: boolean
  values: T[]
}

export interface IssueEvent {
  id: string
  actor: User
  field: string
  oldValue: unknown
  newValue: unknown
  createdAt: string
}

export interface Transition {
  id: string
  name: string
  to: Status
}

export interface BoardColumn {
  id: string
  name: string
  position: number
  minIssues: number | null
  maxIssues: number | null
  statusIds: string[]
}

export interface Board {
  id: string
  projectKey: string
  name: string
  type: 'kanban' | 'scrum'
  columns: BoardColumn[]
}

export interface Sprint {
  id: string
  boardId: string
  name: string
  goal: string
  state: 'future' | 'active' | 'closed'
  startAt: string | null
  endAt: string | null
  completedAt: string | null
}

export interface EpicStats {
  id: string
  key: string
  summary: string
  done: number
  total: number
  points: number
}

export interface BurndownPoint {
  date: string
  remaining: number
  ideal: number
}

export interface ColumnUpdateInput {
  id: string
  name: string
  minIssues: number | null
  maxIssues: number | null
}

// The { fields: ... } envelope used by create/edit, mirroring Jira's API.
export interface IssueFieldsInput {
  project?: { key: string }
  issuetype?: { name: string }
  summary?: string
  description?: string
  descriptionDoc?: unknown
  priority?: { name: string }
  assignee?: { id: string | null }
  labels?: string[]
  duedate?: string
  startDate?: string
  fixVersions?: { id: string }[]
  originalEstimate?: string
  remainingEstimate?: string
  sprint?: { id: string | null } | null
  parent?: { key: string | null } | null
  storyPoints?: number | null
  custom?: Record<string, unknown>
}

export interface Comment {
  id: string
  author: User
  body: string
  bodyDoc: unknown | null
  editedAt: string | null
  createdAt: string
}

export interface Attachment {
  id: string
  filename: string
  mime: string
  sizeBytes: number
  uploader: User
  createdAt: string
}

export interface AppNotification {
  id: string
  kind: 'created' | 'updated' | 'transitioned' | 'comment' | 'mention' | 'shared'
  actor: User
  payload: { issueKey: string; summary: string; preview?: string; wikiPageId?: string; spaceKey?: string }
  readAt: string | null
  createdAt: string
}

export interface SavedFilter {
  id: string
  name: string
  tql: string
  isShared: boolean
  owner: User
  createdAt: string
  updatedAt: string
}

export interface StatusCount {
  status: string
  category: StatusCategory
  count: number
}

export interface WorkloadEntry {
  user: User | null
  openCount: number
}

export interface ActivityEntry {
  issueKey: string
  issueSummary: string
  field: string
  newValue: string
  actor: User
  createdAt: string
}

export interface ProjectSummary {
  statusCounts: StatusCount[] | null
  typeCounts: Record<string, number>
  workload: WorkloadEntry[] | null
  activity: ActivityEntry[] | null
  open: number
  done: number
  total: number
}

export type GadgetType = 'text' | 'tql_list' | 'pie_chart' | 'burndown' | 'workload' | 'activity' | 'quick_links'

export interface DashboardGadget {
  id: string
  type: GadgetType
  title: string
  col: number
  position: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: Record<string, any>
}

export interface Dashboard {
  id: string
  name: string
  description: string
  isShared: boolean
  isDefault: boolean
  owner: User | null // null = site dashboard, managed by admins
  gadgetCount: number
  gadgets?: DashboardGadget[]
  createdAt: string
  updatedAt: string
}

export interface PieSlice {
  label: string
  category: string
  count: number
}

export interface WikiSpace {
  id: string
  key: string
  name: string
  description: string
  homePageId: string | null
  defaultRole: string
  icon: string
  archivedAt: string | null
  ownerId: string | null
  categories: string[]
  pageCount: number
  createdAt: string
  updatedAt: string
}

export interface WikiSpaceMember {
  user: User
  role: string
}

export interface StarredWikiPage {
  id: string
  title: string
  icon: string
  kind: string
  spaceKey: string
  spaceName: string
}

export interface StarredWikiSpace {
  id: string
  key: string
  name: string
  icon: string
}

export interface TrashedWikiPage {
  id: string
  title: string
  icon: string
  kind: string
  deletedAt: string
}

export interface ArchivedWikiPage {
  id: string
  title: string
  icon: string
  kind: string
  archivedAt: string
}

export interface WikiCalendarEvent {
  id: string
  title: string
  description: string
  startDate: string
  endDate: string
  color: string
  author: User | null
}

export interface WikiCalendarDueItem {
  key: string
  summary: string
  type: string
  dueDate: string
  resolved: boolean
}

export interface WikiCalendarSprint {
  name: string
  projectKey: string
  state: string
  startAt: string | null
  endAt: string | null
}

export interface WikiBlogPost {
  id: string
  title: string
  icon: string
  excerpt: string
  author: User | null
  createdAt: string
}

export interface WikiTemplate {
  id: string
  name: string
  description: string
  icon: string
  bodyDoc: unknown | null
  author: User | null
  updatedAt: string
}

export interface WikiPageNode {
  id: string
  title: string
  icon: string
  kind: 'page' | 'whiteboard' | 'folder' | 'blog'
  parentId: string | null
  position: number
}

export interface WikiCrumb {
  id: string
  title: string
}

export interface WikiPage {
  id: string
  spaceId: string
  spaceKey: string
  spaceName: string
  parentId: string | null
  title: string
  icon: string
  kind: 'page' | 'whiteboard' | 'folder' | 'blog'
  position: number
  version: number
  bodyDoc: unknown | null
  bodyText: string
  isHome: boolean
  archivedAt: string | null
  views: number
  ancestors: WikiCrumb[]
  author: User | null
  updatedBy: User | null
  createdAt: string
  updatedAt: string
}

export interface WikiVersion {
  version: number
  title: string
  icon: string
  editedBy: User | null
  createdAt: string
}

export interface WikiVersionContent extends WikiVersion {
  bodyDoc: unknown | null
  bodyText: string
}

export interface WikiAttachment {
  id: string
  filename: string
  mime: string
  sizeBytes: number
  uploader: User | null
  createdAt: string
}

export interface WikiComment extends Comment {
  parentId: string | null
  inlineText: string
  inlineOccurrence: number
  resolvedAt: string | null
}

export interface WikiDraft {
  id: string
  pageId: string | null
  spaceId: string
  parentId: string | null
  title: string
  bodyDoc: unknown | null
  updatedAt: string
}

export interface ImportStats {
  phase: string
  progress?: string
  counts: Record<string, number> | null
  mapping?: {
    types: Record<string, string>
    statuses: Record<string, string>
    priorities: Record<string, string>
    users: Record<string, string>
  }
  errors?: string[]
}

export interface ImportJob {
  id: string
  source: 'jira_api' | 'jira_csv'
  projectKey: string
  status: 'created' | 'scanning' | 'scanned' | 'running' | 'done' | 'failed'
  stats: ImportStats | Record<string, never>
  error: string
  createdAt: string
  updatedAt: string
}

export interface Profile extends User {
  publicName: string
  jobTitle: string
  department: string
  organization: string
  location: string
  timezone: string
  theme: string
  language: string
  landingPage: string
  headerUrl: string | null
}

export interface KindPref {
  inapp?: boolean
  email?: boolean
}

export interface UserNotifyPrefs {
  emailEnabled?: boolean
  kinds?: Record<string, KindPref>
}

export interface SessionInfo {
  id: string
  ip: string
  userAgent: string
  createdAt: string
  lastSeenAt: string
  current: boolean
}

export interface AdminUser extends User {
  isAdmin: boolean
  imported: boolean
  jobTitle: string
}

export interface Invite {
  id: string
  email: string
  userId: string | null
  invitedBy: User
  createdAt: string
  expiresAt: string
}

export interface AdminProject extends Project {
  memberCount: number
  issueCount: number
  category: string
  schemeId: string
}

export interface MailHandler {
  id: string
  name: string
  projectKey: string
  projectName: string
  issueType: string
  mode: string
  token?: string
  imap: { host: string; port: number; tls: boolean; username: string; password?: string; folder: string }
  allowReplies: boolean
  isEnabled: boolean
  lastPolledAt: string | null
  lastError: string
  processedCount: number
  createdAt: string
}

export interface PermissionGrant {
  id: string
  permission: string
  granteeType: string
  granteeId: string | null
  granteeName: string
}

export interface PermissionScheme {
  id: string
  name: string
  description: string
  isDefault: boolean
  usedBy: number
  spaces?: string[]
  grants?: PermissionGrant[]
}

export interface AuditEntry {
  id: string
  actor: User | null
  action: string
  target: string
  details: Record<string, unknown>
  ip: string
  createdAt: string
}

export interface SpaceCategory {
  id: string
  name: string
  spaceCount: number
}

export interface Webhook {
  id: string
  name: string
  url: string
  hasSecret: boolean
  events: string[]
  projectId: string | null
  projectKey: string | null
  isEnabled: boolean
  createdAt: string
}

export interface WebhookDelivery {
  id: string
  eventType: string
  status: number
  error: string
  attempts: number
  summary: string
  createdAt: string
}

export interface APIToken {
  id: string
  label: string
  prefix: string
  lastUsedAt: string | null
  createdAt: string
}

export interface FlowComponent {
  kind: 'condition' | 'action' | 'branch' | 'ifelse'
  type: string
  config?: Record<string, unknown>
  components?: FlowComponent[]
  else?: FlowComponent[]
}

export interface FlowTrigger {
  type: string
  events?: string[]
  toStatusName?: string
  tql?: string
  intervalMinutes?: number
  fields?: string[]
  token?: string
}

export interface AutomationRule {
  id: string
  name: string
  description: string
  scopeProjectId: string | null
  scopeProjectKey: string | null
  owner: User | null
  trigger: FlowTrigger
  components: FlowComponent[]
  isEnabled: boolean
  allowSelfTrigger: boolean
  notifyOnError: 'once' | 'always' | 'never'
  consecutiveFailures: number
  lastRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface AutomationRunLine {
  component: string
  item?: string
  outcome: 'passed' | 'stopped' | 'done' | 'failed' | 'skipped'
  detail?: string
}

export interface AutomationRun {
  id: string
  eventType: string
  itemKey: string
  status: 'success' | 'no_action' | 'failure'
  log: AutomationRunLine[]
  durationMs: number
  createdAt: string
}

export interface AutomationRuleInput {
  name: string
  description: string
  scopeProjectKey: string | null
  ownerId: string | null
  trigger: FlowTrigger
  components: FlowComponent[]
  isEnabled: boolean
  allowSelfTrigger: boolean
  notifyOnError: string
}

export interface Worklog {
  id: string
  author: User
  seconds: number
  startedAt: string
  comment: string
  createdAt: string
  updatedAt: string
}

export interface Version {
  id: string
  name: string
  description: string
  startDate: string | null
  releaseDate: string | null
  status: 'unreleased' | 'released' | 'archived'
  releasedAt: string | null
  done: number
  total: number
  createdAt: string
  updatedAt: string
}

export interface VersionRef {
  id: string
  name: string
  status: 'unreleased' | 'released' | 'archived'
}

export interface IssueLink {
  id: string
  linkType: 'blocks' | 'relates' | 'duplicates'
  relationship: string
  other: {
    id: string
    key: string
    summary: string
    type: string
    statusName: string
    statusCategory: StatusCategory
    priority: Priority
    assigneeName: string | null
  }
}
