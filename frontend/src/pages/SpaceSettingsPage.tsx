import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import Spinner from '@atlaskit/spinner'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { api, ApiError } from '../api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  useBoards, useCreateStatus, useDeleteLabel, useDeleteProject, useDeleteProjectAvatar, useDeleteStatus,
  useLabelInfo, useMembers, useProject, useRemoveMember, useRenameLabel, useRenameStatus, useReorderColumns,
  useSetArchived, useStatuses, useUpdateColumns, useUpdateMemberRole, useUpdateNotifyPrefs,
  useUpdateProjectDetails, useUploadProjectAvatar,
} from '../api/hooks'
import type { Member, Status } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { AutomationListPage } from './AutomationAdmin'
import { ShowMoreHorizontalIcon } from '../components/coreIcons'
import { t } from '../i18n'

type Section =
  | 'details' | 'summary' | 'people' | 'permissions' | 'notifications' | 'email-audit'
  | 'automation' | 'features' | 'toolchain' | 'workflows'
  | 'layout' | 'screens' | 'fields' | 'collectors' | 'security'
  | 'versions' | 'components' | 'devtools' | 'apps'
  | 'board' | 'labels' | 'danger'

type NavItem = { key: Section; label: string; danger?: boolean }
type NavEntry = NavItem | { group: string; items: NavItem[] }

// Mirrors Jira's company-managed project settings sidebar.
const NAV: NavEntry[] = [
  { key: 'details', label: t('Details') },
  { key: 'summary', label: t('Summary') },
  { key: 'people', label: t('People') },
  { key: 'permissions', label: t('Permissions') },
  { group: t('Notifications'), items: [
    { key: 'notifications', label: t('Settings') },
    { key: 'email-audit', label: t('Space email audit') },
  ] },
  { key: 'automation', label: t('Automation') },
  { key: 'features', label: t('Features') },
  { key: 'toolchain', label: t('Toolchain') },
  { key: 'workflows', label: t('Workflows') },
  { group: t('Work items'), items: [
    { key: 'layout', label: t('Layout') },
    { key: 'screens', label: t('Screens') },
    { key: 'fields', label: t('Fields') },
    { key: 'collectors', label: t('Collectors') },
    { key: 'security', label: t('Security') },
  ] },
  { key: 'versions', label: t('Versions') },
  { key: 'components', label: t('Components') },
  { key: 'devtools', label: t('Development tools') },
  { key: 'apps', label: t('Apps') },
  { group: t('Board'), items: [
    { key: 'board', label: t('Columns and statuses') },
    { key: 'labels', label: t('Labels') },
    { key: 'danger', label: t('Danger zone'), danger: true },
  ] },
]

const ALL_SECTIONS: NavItem[] = NAV.flatMap((e) => ('group' in e ? e.items : [e]))

const CATEGORY_APPEARANCE = { todo: 'default', in_progress: 'inprogress', done: 'success' } as const
const CATEGORY_LABEL = { todo: t('To do'), in_progress: t('In progress'), done: t('Done') } as const

const h3Style: React.CSSProperties = { fontSize: 16, fontWeight: 600, marginBottom: 4 }
const hintStyle: React.CSSProperties = { fontSize: 12, color: token('color.text.subtlest', '#626F86') }
const cardStyle: React.CSSProperties = {
  border: `1px solid ${token('color.border', '#DFE1E6')}`,
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
}

// Jira-style "Space settings": breadcrumb, left sub-nav, section content.
export default function SpaceSettingsPage() {
  const { key = '', section: sectionParam } = useParams()
  const projectKey = key.toUpperCase()
  const normalized = sectionParam === 'access' ? 'people' : sectionParam
  const section = (ALL_SECTIONS.some((s) => s.key === normalized) ? normalized : 'details') as Section
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: project, isLoading } = useProject(projectKey)
  const { data: members } = useMembers(projectKey)
  const myRole = members?.find((m) => m.user.id === user?.id)?.role

  if (isLoading || !project || !members) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ fontSize: 14, marginBottom: 2 }}>
        <Link to="/projects" style={{ color: token('color.text.subtle', '#44546F'), textDecoration: 'none' }}>{t('Spaces')}</Link>
        <span style={{ color: token('color.text.subtlest', '#626F86'), margin: '0 6px' }}>/</span>
        <Link to={`/projects/${projectKey}/summary`} style={{ color: token('color.text.subtle', '#44546F'), textDecoration: 'none' }}>
          {project.name}
        </Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Space settings')}</h1>
        {project.archivedAt && <Lozenge appearance="moved" isBold>{t('Archived')}</Lozenge>}
      </div>

      {myRole !== 'admin' ? (
        <SectionMessage appearance="warning" title={t('Space admin access required')}>
          {t('Only space admins can manage settings for {name}. Ask the space lead ({lead}) for access.', { name: project.name, lead: project.lead.displayName })}
        </SectionMessage>
      ) : (
        <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
          <nav style={{ width: 200, flexShrink: 0 }}>
            {NAV.map((entry, idx) => {
              if ('group' in entry) {
                return (
                  <div key={idx} style={{ marginBottom: 2 }}>
                    <div style={{ padding: '7px 10px 3px', fontSize: 13, fontWeight: 600, color: token('color.text.subtle', '#44546F') }}>
                      {entry.group}
                    </div>
                    {entry.items.map((s) => (
                      <SettingsNavButton key={s.key} item={s} active={s.key === section} indent
                        onClick={() => navigate(`/projects/${projectKey}/settings/${s.key}`)} />
                    ))}
                  </div>
                )
              }
              return (
                <SettingsNavButton key={entry.key} item={entry} active={entry.key === section}
                  onClick={() => navigate(`/projects/${projectKey}/settings/${entry.key}`)} />
              )
            })}
          </nav>
          <div style={{ flex: 1, minWidth: 0 }}>
            {section === 'details' && <DetailsSection projectKey={projectKey} members={members} />}
            {section === 'summary' && <SummarySection projectKey={projectKey} members={members} />}
            {section === 'people' && <AccessSection projectKey={projectKey} members={members} />}
            {section === 'permissions' && <PermissionsSection projectKey={projectKey} />}
            {section === 'notifications' && <NotificationsSection projectKey={projectKey} />}
            {section === 'email-audit' && <EmailAuditSection projectKey={projectKey} />}
            {section === 'automation' && <AutomationListPage spaceKey={projectKey} />}
            {section === 'features' && <FeaturesSection projectKey={projectKey} />}
            {section === 'toolchain' && (
              <InfoSection title={t('Toolchain')}
                text={t('Connect development tools to link commits, branches and deployments to work items. TaskHat integrates through outgoing webhooks and API tokens today; dedicated tool connectors are on the roadmap.')}
                links={[{ label: t('Manage webhooks'), to: '/admin/integrations/webhooks' }, { label: t('API tokens'), to: '/settings/api-tokens' }]} />
            )}
            {section === 'workflows' && <WorkflowsSection projectKey={projectKey} />}
            {section === 'layout' && (
              <InfoSection title={t('Layout')}
                text={t('Jira lets admins rearrange the fields shown on the work item view. TaskHat uses a fixed layout: description and activity on the left, details (with your custom fields) on the right. Per-space layout configuration is on the roadmap.')} />
            )}
            {section === 'screens' && (
              <InfoSection title={t('Screens')}
                text={t('Jira maps operations (create, edit, transition) to different screens. TaskHat uses one consistent form for create and edit, so no screen configuration is needed. Custom fields added under Fields appear automatically.')} />
            )}
            {section === 'fields' && <FieldsSection projectKey={projectKey} />}
            {section === 'collectors' && (
              <InfoSection title={t('Collectors')}
                text={t('Jira collectors embed a feedback form on external websites. TaskHat can create work items from incoming email instead — configure a mailbox under Admin settings.')}
                links={[{ label: t('Incoming mail'), to: '/admin/integrations/mail' }]} />
            )}
            {section === 'security' && (
              <InfoSection title={t('Security')}
                text={t('Jira work item security levels restrict who can see individual work items. TaskHat restricts visibility per space through membership and permission schemes; per-item security levels are on the roadmap.')}
                links={[{ label: t('Permissions'), to: `/projects/${projectKey}/settings/permissions` }]} />
            )}
            {section === 'versions' && <VersionsSection projectKey={projectKey} />}
            {section === 'components' && <ComponentsSection projectKey={projectKey} members={members} />}
            {section === 'devtools' && (
              <InfoSection title={t('Development tools')}
                text={t('Connect source control to see branches, commits and pull requests on work items. Use outgoing webhooks to notify your CI of changes; richer integrations are on the roadmap.')}
                links={[{ label: t('Manage webhooks'), to: '/admin/integrations/webhooks' }]} />
            )}
            {section === 'apps' && (
              <InfoSection title={t('Apps')}
                text={t('Extend this space with integrations: outgoing webhooks push events to other systems, API tokens let scripts call the TaskHat API, and incoming mail turns emails into work items.')}
                links={[
                  { label: t('Manage webhooks'), to: '/admin/integrations/webhooks' },
                  { label: t('API tokens'), to: '/settings/api-tokens' },
                  { label: t('Incoming mail'), to: '/admin/integrations/mail' },
                ]} />
            )}
            {section === 'board' && <BoardSection projectKey={projectKey} />}
            {section === 'labels' && <LabelsSection projectKey={projectKey} />}
            {section === 'danger' && <DangerSection projectKey={projectKey} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Details ----

function SettingsNavButton({ item, active, indent, onClick }: {
  item: { key: string; label: string; danger?: boolean }; active: boolean; indent?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'start',
        padding: '6px 10px',
        paddingInlineStart: indent ? 22 : 10,
        marginBottom: 1,
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: active ? 600 : 400,
        color: active
          ? token('color.text.selected', '#0C66E4')
          : item.danger
            ? token('color.text.danger', '#AE2E24')
            : token('color.text.subtle', '#44546F'),
        background: active ? token('color.background.selected', '#E9F2FF') : 'none',
      }}
    >
      {item.label}
    </button>
  )
}

function DetailsSection({ projectKey, members }: { projectKey: string; members: Member[] }) {
  const { data: project } = useProject(projectKey)
  const update = useUpdateProjectDetails(projectKey)
  const uploadAvatar = useUploadProjectAvatar(projectKey)
  const deleteAvatar = useDeleteProjectAvatar(projectKey)
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ id: string; name: string }[]>('/categories'),
  })

  const [name, setName] = useState(project?.name ?? '')
  const [description, setDescription] = useState(project?.description ?? '')
  const [leadId, setLeadId] = useState(project?.lead.id ?? null)
  const [defaultAssigneeId, setDefaultAssigneeId] = useState(project?.defaultAssigneeId ?? null)
  const [url, setUrl] = useState(project?.url ?? '')
  const [categoryId, setCategoryId] = useState<string | null>(project?.categoryId ?? null)
  const [saved, setSaved] = useState(false)

  const memberOptions = members.map((m) => ({ label: m.user.displayName, value: m.user.id }))
  const assigneeOptions = [{ label: t('None (unassigned)'), value: null as string | null }, ...memberOptions]
  const categoryOptions = [
    { label: t('No category'), value: null as string | null },
    ...(categories ?? []).map((c) => ({ label: c.name, value: c.id as string | null })),
  ]

  const save = () => {
    setSaved(false)
    update.mutate(
      { name: name.trim(), description, leadId, defaultAssigneeId, url: url.trim(), categoryId: categoryId ?? '' },
      { onSuccess: () => setSaved(true) },
    )
  }

  if (!project) return null
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Details')}</h3>

      {/* Jira-style centered icon block */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, margin: '18px 0 20px' }}>
        <Avatar appearance="square" size="xlarge" src={project.avatarUrl ?? undefined} name={project.name} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadAvatar.mutate(f)
            e.target.value = ''
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => fileRef.current?.click()} isLoading={uploadAvatar.isPending}>
            {t('Change icon')}
          </Button>
          {project.avatarUrl && (
            <Button appearance="subtle" onClick={() => deleteAvatar.mutate()}>{t('Remove')}</Button>
          )}
        </div>
      </div>

      <p style={{ ...hintStyle, marginBottom: 14 }}>
        {t('Required fields are marked with an asterisk')} <span style={{ color: token('color.text.danger', '#AE2E24') }}>*</span>
      </p>

      <FieldRow label={t('Name') + ' *'}>
        <TextField value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
      </FieldRow>
      <FieldRow label={t('Space key') + ' *'} hint={t('The key prefixes every work item in this space and cannot be changed.')}>
        <TextField value={projectKey} isDisabled />
      </FieldRow>
      <FieldRow label={t('URL')} hint={t('A link to more information about this space, shown on the space summary.')}>
        <TextField value={url} placeholder="https://" onChange={(e) => setUrl((e.target as HTMLInputElement).value)} />
      </FieldRow>
      <FieldRow label={t('How your space is managed')}>
        <TextField value={t('TaskHat - software space')} isDisabled />
      </FieldRow>
      <FieldRow label={t('Category')} hint={t('Categories group spaces in the spaces directory.')}>
        <Select
          options={categoryOptions}
          value={categoryOptions.find((o) => o.value === categoryId) ?? categoryOptions[0]}
          onChange={(o) => setCategoryId(o?.value ?? null)}
        />
      </FieldRow>
      <FieldRow label={t('Description')}>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minimumRows={3}
          placeholder={t('What is this space about?')}
        />
      </FieldRow>
      <FieldRow label={t('Space lead')} hint={t('The lead is always a space admin.')}>
        <Select
          options={memberOptions}
          value={memberOptions.find((o) => o.value === leadId) ?? null}
          onChange={(o) => setLeadId(o?.value ?? null)}
        />
      </FieldRow>
      <FieldRow label={t('Default assignee')} hint={t('Applied when a work item is created without an assignee.')}>
        <Select
          options={assigneeOptions}
          value={assigneeOptions.find((o) => o.value === defaultAssigneeId) ?? assigneeOptions[0]}
          onChange={(o) => setDefaultAssigneeId(o?.value ?? null)}
        />
      </FieldRow>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20 }}>
        <Button appearance="primary" onClick={save} isLoading={update.isPending} isDisabled={!name.trim()}>
          {t('Save')}
        </Button>
        {saved && <span style={{ fontSize: 13, color: token('color.text.success', '#216E4E') }}>{t('Saved')}</span>}
        {update.isError && (
          <span style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>
            {update.error instanceof ApiError ? update.error.message : t('Something went wrong')}
          </span>
        )}
      </div>
    </div>
  )
}

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14, maxWidth: 420 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: token('color.text.subtle', '#44546F'), marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ ...hintStyle, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// ---- Access ----

function AccessSection({ projectKey, members }: { projectKey: string; members: Member[] }) {
  const { data: project } = useProject(projectKey)
  const { user, isAdmin } = useAuth()
  const { data: myPerms } = useQuery({
    queryKey: ['my-permissions', projectKey],
    queryFn: () => api<{ permissions: string[]; scheme: { id: string; name: string } }>(`/projects/${projectKey}/mypermissions`),
  })
  const updateRole = useUpdateMemberRole(projectKey)
  const removeMember = useRemoveMember(projectKey)
  const [error, setError] = useState<string | null>(null)

  const act = (fn: () => Promise<unknown>) => {
    setError(null)
    fn().catch((e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')))
  }

  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Access')}</h3>
      <p style={{ ...hintStyle, marginBottom: 4 }}>
        {t('Who can see and edit work in this space. Add people from the People tab on any space page or via “Add member”.')}
      </p>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('What each role can do is defined by the permission scheme: {name}', { name: myPerms?.scheme.name ?? '…' })}
        {isAdmin && myPerms && (
          <> · <Link to={`/admin/work-items/permissions/${myPerms.scheme.id}`}>{t('View scheme')}</Link></>
        )}
      </p>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <SectionMessage appearance="error">{error}</SectionMessage>
        </div>
      )}
      {members.map((m) => {
        const isLead = project?.lead.id === m.user.id
        const isSelf = user?.id === m.user.id
        return (
          <div
            key={m.user.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
            }}
          >
            <Avatar size="small" src={m.user.avatarUrl ?? undefined} name={m.user.displayName} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {m.user.displayName}{' '}
                {isLead && <Lozenge appearance="inprogress">{t('Lead')}</Lozenge>}{' '}
                {isSelf && <Lozenge>{t('You')}</Lozenge>}
              </div>
              <div style={hintStyle}>{m.user.email}</div>
            </div>
            <div style={{ width: 140 }}>
              <Select
                spacing="compact"
                isDisabled={isSelf || isLead}
                options={[
                  { label: t('Admin'), value: 'admin' },
                  { label: t('Member'), value: 'member' },
                  { label: t('Viewer'), value: 'viewer' },
                ]}
                value={{ label: t(m.role[0].toUpperCase() + m.role.slice(1)), value: m.role }}
                onChange={(o) => o && act(() => updateRole.mutateAsync({ userId: m.user.id, role: o.value }))}
              />
            </div>
            <DropdownMenu
              trigger={({ triggerRef, ...props }) => (
                <button
                  type="button"
                  ref={triggerRef as React.Ref<HTMLButtonElement>}
                  {...props}
                  aria-label={t('Member actions')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: token('color.text.subtle', '#44546F'),
                    display: 'inline-flex',
                  }}
                >
                  <ShowMoreHorizontalIcon label="" />
                </button>
              )}
              shouldRenderToParent
            >
              <DropdownItemGroup>
                <DropdownItem
                  isDisabled={isSelf || isLead}
                  onClick={() => act(() => removeMember.mutateAsync(m.user.id))}
                >
                  {t('Remove from space')}
                </DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}

// ---- Notifications ----

const NOTIFY_KINDS: { key: string; label: string; hint: string }[] = [
  { key: 'created', label: t('Work item created'), hint: t('Watchers get an email when a work item is created.') },
  { key: 'transitioned', label: t('Status changed'), hint: t('Watchers get an email when a work item moves between statuses.') },
  { key: 'updated', label: t('Work item updated'), hint: t('Watchers get an email when fields change.') },
  { key: 'comment', label: t('Comments'), hint: t('Watchers get an email for new comments.') },
]

function NotificationsSection({ projectKey }: { projectKey: string }) {
  const { data: project } = useProject(projectKey)
  const update = useUpdateNotifyPrefs(projectKey)

  if (!project) return null
  const prefs = project.notifyPrefs

  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Notifications')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('Choose which events send')} <strong>{t('email')}</strong> {t('to watchers. In-app notifications and @mention emails are always on.')}
      </p>
      {NOTIFY_KINDS.map(({ key, label, hint }) => {
        const enabled = prefs[key] ?? true
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 0',
              borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
              <div style={hintStyle}>{hint}</div>
            </div>
            <Toggle
              isChecked={enabled}
              onChange={() => {
                const next: Record<string, boolean> = {}
                for (const k of NOTIFY_KINDS) next[k.key] = prefs[k.key] ?? true
                next[key] = !enabled
                update.mutate(next)
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ---- Board ----

export function BoardSection({ projectKey, boardId }: { projectKey: string; boardId?: string }) {
  const { data: boards } = useBoards(projectKey)
  const board = (boardId ? boards?.find((b) => b.id === boardId) : undefined) ?? boards?.[0]
  const { data: statuses } = useStatuses(projectKey)
  const updateColumns = useUpdateColumns(board?.id, projectKey)
  const reorder = useReorderColumns(board?.id, projectKey)

  const [edits, setEdits] = useState<Record<string, { name: string; max: string }>>({})
  useEffect(() => setEdits({}), [board?.id])

  if (!board || !statuses) return <Spinner />

  const columns = board.columns
  const statusById = new Map(statuses.map((s) => [s.id, s]))

  const rowOf = (id: string, fallbackName: string, fallbackMax: number | null) =>
    edits[id] ?? { name: fallbackName, max: fallbackMax?.toString() ?? '' }

  const saveColumns = () => {
    updateColumns.mutate(
      columns.map((c) => {
        const row = rowOf(c.id, c.name, c.maxIssues)
        const max = row.max.trim() === '' ? null : Math.max(1, parseInt(row.max, 10) || 1)
        return { id: c.id, name: row.name.trim() || c.name, minIssues: c.minIssues, maxIssues: max }
      }),
      { onSuccess: () => setEdits({}) },
    )
  }

  const move = (index: number, delta: number) => {
    const ids = columns.map((c) => c.id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    reorder.mutate(ids)
  }

  return (
    <>
      <div style={cardStyle}>
        <h3 style={h3Style}>{t('Columns')}</h3>
        <p style={{ ...hintStyle, marginBottom: 12 }}>
          {t('Rename columns, set work-in-progress limits, and reorder them on the {board}.', { board: board.name })}
        </p>
        {columns.map((c, i) => {
          const row = rowOf(c.id, c.name, c.maxIssues)
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <TextField
                  value={row.name}
                  onChange={(e) =>
                    setEdits({ ...edits, [c.id]: { ...row, name: (e.target as HTMLInputElement).value } })
                  }
                />
              </div>
              <div style={{ width: 110 }}>
                <TextField
                  type="number"
                  placeholder={t('No limit')}
                  value={row.max}
                  onChange={(e) =>
                    setEdits({ ...edits, [c.id]: { ...row, max: (e.target as HTMLInputElement).value } })
                  }
                />
              </div>
              <Button appearance="subtle" isDisabled={i === 0} onClick={() => move(i, -1)}>↑</Button>
              <Button appearance="subtle" isDisabled={i === columns.length - 1} onClick={() => move(i, 1)}>↓</Button>
              <span style={{ ...hintStyle, width: 130 }}>
                {c.statusIds.map((id) => statusById.get(id)?.name).filter(Boolean).join(', ')}
              </span>
            </div>
          )
        })}
        <div style={{ marginTop: 12 }}>
          <Button appearance="primary" onClick={saveColumns} isLoading={updateColumns.isPending} isDisabled={Object.keys(edits).length === 0}>
            {t('Save columns')}
          </Button>
        </div>
      </div>

      <StatusesCard projectKey={projectKey} statuses={statuses} />
    </>
  )
}

function StatusesCard({ projectKey, statuses }: { projectKey: string; statuses: Status[] }) {
  const createStatus = useCreateStatus(projectKey)
  const renameStatus = useRenameStatus(projectKey)
  const deleteStatus = useDeleteStatus(projectKey)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<'todo' | 'in_progress' | 'done'>('todo')
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const categoryOptions = (['todo', 'in_progress', 'done'] as const).map((c) => ({ label: CATEGORY_LABEL[c], value: c }))

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={h3Style}>{t('Statuses')}</h3>
        <Link to={`/projects/${projectKey}/workflow`} style={{ fontSize: 13 }}>{t('Open workflow editor')}</Link>
      </div>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('This space owns its workflow — changes here don’t affect other spaces. Adding a status also adds a board column for it. The workflow editor adds transitions and rules on top.')}
      </p>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <SectionMessage appearance="error">{error}</SectionMessage>
        </div>
      )}
      {statuses.map((s) => {
        const value = renames[s.id] ?? s.name
        const dirty = value.trim() !== s.name && value.trim() !== ''
        return (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                value={value}
                onChange={(e) => setRenames({ ...renames, [s.id]: (e.target as HTMLInputElement).value })}
              />
            </div>
            <span style={{ width: 110 }}>
              <Lozenge appearance={CATEGORY_APPEARANCE[s.category]}>{CATEGORY_LABEL[s.category]}</Lozenge>
            </span>
            <Button
              isDisabled={!dirty}
              onClick={() => {
                setError(null)
                renameStatus.mutate(
                  { id: s.id, name: value.trim() },
                  {
                    onSuccess: () => setRenames((r) => { const { [s.id]: _drop, ...rest } = r; return rest }),
                    onError: (e) => setError(e instanceof ApiError ? e.message : t('Rename failed')),
                  },
                )
              }}
            >
              {t('Rename')}
            </Button>
            <Button
              appearance="subtle"
              onClick={() => {
                setError(null)
                deleteStatus.mutate(s.id, {
                  onError: (e) => setError(e instanceof ApiError ? e.message : t('Delete failed')),
                })
              }}
            >
              {t('Delete')}
            </Button>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
        <div style={{ flex: 1 }}>
          <TextField
            placeholder={t('New status name')}
            value={newName}
            onChange={(e) => setNewName((e.target as HTMLInputElement).value)}
          />
        </div>
        <div style={{ width: 160 }}>
          <Select
            spacing="compact"
            options={categoryOptions}
            value={categoryOptions.find((o) => o.value === newCategory)}
            onChange={(o) => o && setNewCategory(o.value)}
          />
        </div>
        <Button
          appearance="primary"
          isDisabled={!newName.trim()}
          isLoading={createStatus.isPending}
          onClick={() => {
            setError(null)
            createStatus.mutate(
              { name: newName.trim(), category: newCategory },
              {
                onSuccess: () => setNewName(''),
                onError: (e) => setError(e instanceof ApiError ? e.message : t('Create failed')),
              },
            )
          }}
        >
          {t('Add status')}
        </Button>
      </div>
    </div>
  )
}

// ---- Labels ----

function LabelsSection({ projectKey }: { projectKey: string }) {
  const { data: labels } = useLabelInfo(projectKey)
  const renameLabel = useRenameLabel(projectKey)
  const deleteLabel = useDeleteLabel(projectKey)
  const [renames, setRenames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const existing = useMemo(() => new Set((labels ?? []).map((l) => l.name)), [labels])

  if (!labels) return <Spinner />
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Labels')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('Rename or delete this space’s labels. Renaming to an existing label')} <strong>{t('merges')}</strong> {t('the two.')}
      </p>
      {error && (
        <div style={{ marginBottom: 12 }}>
          <SectionMessage appearance="error">{error}</SectionMessage>
        </div>
      )}
      {labels.length === 0 && <p style={hintStyle}>{t('No labels yet — add some from any work item.')}</p>}
      {labels.map((l) => {
        const value = renames[l.name] ?? l.name
        const target = value.trim()
        const dirty = target !== l.name && target !== ''
        const merges = dirty && existing.has(target)
        return (
          <div key={l.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <TextField
                value={value}
                onChange={(e) => setRenames({ ...renames, [l.name]: (e.target as HTMLInputElement).value })}
              />
            </div>
            <span style={{ ...hintStyle, width: 110 }}>
              {l.issueCount === 1 ? t('{n} work item', { n: l.issueCount }) : t('{n} work items', { n: l.issueCount })}
            </span>
            <Button
              isDisabled={!dirty}
              onClick={() => {
                setError(null)
                renameLabel.mutate(
                  { name: l.name, newName: target },
                  {
                    onSuccess: () => setRenames((r) => { const { [l.name]: _drop, ...rest } = r; return rest }),
                    onError: (e) => setError(e instanceof ApiError ? e.message : t('Rename failed')),
                  },
                )
              }}
            >
              {merges ? t('Merge') : t('Rename')}
            </Button>
            <Button
              appearance="subtle"
              onClick={() => {
                setError(null)
                deleteLabel.mutate(l.name, {
                  onError: (e) => setError(e instanceof ApiError ? e.message : t('Delete failed')),
                })
              }}
            >
              {t('Delete')}
            </Button>
          </div>
        )
      })}
    </div>
  )
}

// ---- Danger zone ----

function DangerSection({ projectKey }: { projectKey: string }) {
  const { data: project } = useProject(projectKey)
  const setArchived = useSetArchived(projectKey)
  const deleteProject = useDeleteProject()
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmKey, setConfirmKey] = useState('')

  if (!project) return null
  const archived = !!project.archivedAt

  return (
    <>
      <div style={cardStyle}>
        <h3 style={h3Style}>{archived ? t('Unarchive this space') : t('Archive this space')}</h3>
        <p style={{ ...hintStyle, marginBottom: 12 }}>
          {archived
            ? t('Bring the space back: it reappears in the space list and search.')
            : t('Hides the space from the space list and search. Nothing is deleted, direct links keep working, and you can unarchive anytime.')}
        </p>
        <Button appearance={archived ? 'primary' : 'warning'} isLoading={setArchived.isPending} onClick={() => setArchived.mutate(!archived)}>
          {archived ? t('Unarchive space') : t('Archive space')}
        </Button>
      </div>

      <div style={{ ...cardStyle, borderColor: token('color.border.danger', '#F87168') }}>
        <h3 style={h3Style}>{t('Delete this space')}</h3>
        <p style={{ ...hintStyle, marginBottom: 12 }}>
          {t('Permanently deletes {name} with all of its work items, comments and attachments. This cannot be undone.', { name: project.name })}
        </p>
        <Button appearance="danger" onClick={() => setConfirmDelete(true)}>{t('Delete space')}</Button>
      </div>

      <ModalTransition>
        {confirmDelete && (
          <Modal onClose={() => setConfirmDelete(false)}>
            <ModalHeader>
              <ModalTitle appearance="danger">{t('Delete {name}?', { name: project.name })}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p style={{ marginBottom: 12 }}>
                {t('All work items in')} <strong>{projectKey}</strong> {t('will be permanently deleted. Type the space key to confirm.')}
              </p>
              <TextField
                autoFocus
                placeholder={projectKey}
                value={confirmKey}
                onChange={(e) => setConfirmKey((e.target as HTMLInputElement).value)}
              />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button>
              <Button
                appearance="danger"
                isDisabled={confirmKey.trim().toUpperCase() !== projectKey}
                isLoading={deleteProject.isPending}
                onClick={() =>
                  deleteProject.mutate(projectKey, { onSuccess: () => navigate('/projects') })
                }
              >
                {t('Delete space')}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  )
}

// ---- Jira-parity sections (Stage 28) ----

function InfoSection({ title, text, links }: { title: string; text: string; links?: { label: string; to: string }[] }) {
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{title}</h3>
      <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F'), maxWidth: 640, lineHeight: 1.6 }}>{text}</p>
      {links && links.length > 0 && (
        <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          {links.map((l) => <Link key={l.to} to={l.to} style={{ fontSize: 13 }}>{l.label}</Link>)}
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, value, to }: { label: string; value: React.ReactNode; to?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
      <div style={{ width: 200, fontSize: 13, fontWeight: 600, color: token('color.text.subtle', '#44546F') }}>{label}</div>
      <div style={{ flex: 1, fontSize: 13 }}>{value}</div>
      {to && <Link to={to} style={{ fontSize: 13 }}>{t('View')}</Link>}
    </div>
  )
}

function SummarySection({ projectKey, members }: { projectKey: string; members: Member[] }) {
  const { data: project } = useProject(projectKey)
  const base = `/projects/${projectKey}/settings`
  const { data: statuses } = useQuery({ queryKey: ['sum-statuses', projectKey], queryFn: () => api<Status[]>(`/projects/${projectKey}/statuses`) })
  const { data: fields } = useQuery({ queryKey: ['space-fields', projectKey], queryFn: () => api<{ id: string }[]>(`/projects/${projectKey}/fields`) })
  const { data: versions } = useQuery({ queryKey: ['sum-versions', projectKey], queryFn: () => api<{ id: string }[]>(`/projects/${projectKey}/versions`) })
  const { data: components } = useQuery({ queryKey: ['space-components', projectKey], queryFn: () => api<{ id: string }[]>(`/projects/${projectKey}/components`) })
  const { data: scheme } = useQuery({ queryKey: ['space-scheme', projectKey], queryFn: () => api<{ name: string }>(`/projects/${projectKey}/permissionscheme`) })
  const { data: rules } = useQuery({ queryKey: ['sum-automation', projectKey], queryFn: () => api<{ id: string }[]>(`/projects/${projectKey}/automation`) })
  if (!project) return null
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Summary')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>{t('An overview of how the {key} space is configured.', { key: projectKey })}</p>
      <SummaryRow label={t('Name')} value={project.name} to={`${base}/details`} />
      <SummaryRow label={t('Category')} value={project.categoryName ?? t('No category')} to={`${base}/details`} />
      <SummaryRow label={t('Space lead')} value={project.lead.displayName} to={`${base}/details`} />
      <SummaryRow label={t('People')} value={t('{n} members', { n: members.length })} to={`${base}/people`} />
      <SummaryRow label={t('Permissions')} value={scheme?.name ?? '—'} to={`${base}/permissions`} />
      <SummaryRow label={t('Workflow')} value={t('{n} statuses', { n: statuses?.length ?? 0 })} to={`${base}/workflows`} />
      <SummaryRow label={t('Fields')} value={t('{n} custom fields', { n: fields?.length ?? 0 })} to={`${base}/fields`} />
      <SummaryRow label={t('Versions')} value={t('{n} versions', { n: versions?.length ?? 0 })} to={`${base}/versions`} />
      <SummaryRow label={t('Components')} value={t('{n} components', { n: components?.length ?? 0 })} to={`${base}/components`} />
      <SummaryRow label={t('Automation')} value={t('{n} rules', { n: (rules as { id: string }[] | undefined)?.length ?? 0 })} to={`${base}/automation`} />
      <SummaryRow label={t('Notifications')} value={t('Space notification preferences')} to={`${base}/notifications`} />
    </div>
  )
}

function PermissionsSection({ projectKey }: { projectKey: string }) {
  const { data: scheme, isLoading } = useQuery({
    queryKey: ['space-scheme-full', projectKey],
    queryFn: () => api<{ id: string; name: string; description: string; grants: { id: string; permission: string; granteeType: string; granteeName: string }[] }>(`/projects/${projectKey}/permissionscheme`),
  })
  if (isLoading) return <Spinner />
  if (!scheme) return null
  const byPermission = new Map<string, string[]>()
  for (const g of scheme.grants ?? []) {
    const who = g.granteeType === 'user' ? g.granteeName : t(g.granteeType)
    byPermission.set(g.permission, [...(byPermission.get(g.permission) ?? []), who])
  }
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Permissions')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('This space uses the permission scheme')} <strong>{scheme.name}</strong>.{' '}
        {t('Site admins manage schemes under Admin settings.')}
      </p>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{t('Permission')}</th>
            <th style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{t('Granted to')}</th>
          </tr>
        </thead>
        <tbody>
          {[...byPermission.entries()].map(([perm, whos]) => (
            <tr key={perm}>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{perm}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{whos.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function EmailAuditSection({ projectKey }: { projectKey: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['email-audit', projectKey],
    queryFn: () => api<{ values: { at: string; recipient: string; kind: string; issueKey: string; subject: string }[] }>(`/projects/${projectKey}/email-audit`),
    refetchInterval: 15000,
  })
  if (isLoading) return <Spinner />
  const rows = data?.values ?? []
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Space email audit')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>{t('The most recent notification emails sent for this space (up to 100).')}</p>
      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F') }}>{t('No notification emails have been recorded for this space yet.')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {[t('Time'), t('Recipient'), t('Event'), t('Work item')].map((h) => (
                <th key={h} style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, whiteSpace: 'nowrap' }}>{new Date(r.at).toLocaleString()}</td>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{r.recipient}</td>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{r.kind}</td>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                  {r.issueKey ? <Link to={`/browse/${r.issueKey}`}>{r.issueKey}</Link> : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const SPACE_FEATURES: { key: string; label: string; hint: string }[] = [
  { key: 'timeline', label: t('Timeline'), hint: t('Plan work on a Gantt-style timeline with dependencies.') },
  { key: 'backlog', label: t('Backlog'), hint: t('Groom upcoming work outside the board.') },
  { key: 'reports', label: t('Reports'), hint: t('Charts and insights about work in this space.') },
  { key: 'releases', label: t('Releases'), hint: t('Track versions and ship work in releases.') },
]

function FeaturesSection({ projectKey }: { projectKey: string }) {
  const { data: project } = useProject(projectKey)
  const qc = useQueryClient()
  const [saving, setSaving] = useState<string | null>(null)
  if (!project) return null
  const toggle = (key: string, on: boolean) => {
    setSaving(key)
    const features = { ...project.features, [key]: on }
    api(`/projects/${projectKey}/features`, { method: 'PUT', body: JSON.stringify({ features }) })
      .then((updated) => qc.setQueryData(['project', projectKey], updated))
      .finally(() => setSaving(null))
  }
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Features')}</h3>
      <p style={{ ...hintStyle, marginBottom: 14 }}>{t('Turn features on or off for this space. Turning a feature off hides its tab for everyone.')}</p>
      {SPACE_FEATURES.map((f) => (
        <div key={f.key} style={{ display: 'flex', alignItems: 'center', padding: '10px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{f.label}</div>
            <div style={hintStyle}>{f.hint}</div>
          </div>
          <Toggle
            isChecked={project.features[f.key] !== false}
            isDisabled={saving === f.key}
            onChange={() => toggle(f.key, !(project.features[f.key] !== false))}
          />
        </div>
      ))}
    </div>
  )
}

function WorkflowsSection({ projectKey }: { projectKey: string }) {
  const { data: statuses } = useQuery({ queryKey: ['sum-statuses', projectKey], queryFn: () => api<Status[]>(`/projects/${projectKey}/statuses`) })
  const navigate = useNavigate()
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Workflows')}</h3>
      <p style={{ ...hintStyle, marginBottom: 14 }}>{t('The workflow defines the statuses work items move through and which transitions are allowed.')}</p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('{key} workflow', { key: projectKey })}</div>
          <div style={hintStyle}>{t('{n} statuses', { n: statuses?.length ?? 0 })}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: 360 }}>
          {(statuses ?? []).map((s) => (
            <Lozenge key={s.id} appearance={CATEGORY_APPEARANCE[s.category as keyof typeof CATEGORY_APPEARANCE] ?? 'default'}>{s.name}</Lozenge>
          ))}
        </div>
        <Button appearance="primary" onClick={() => navigate(`/projects/${projectKey}/workflow`)}>{t('Edit workflow')}</Button>
      </div>
      <p style={{ ...hintStyle, marginTop: 12 }}>{t('Site admins can browse all workflows under Admin settings → Work items → Workflows.')}</p>
    </div>
  )
}

function FieldsSection({ projectKey }: { projectKey: string }) {
  const qc = useQueryClient()
  const { data: fields, isLoading } = useQuery({
    queryKey: ['space-fields-full', projectKey],
    queryFn: () => api<{ id: string; name: string; type: string; projectId: string | null; usageCount: number }[]>(`/projects/${projectKey}/fields`),
  })
  const [name, setName] = useState('')
  const [ftype, setFtype] = useState('text')
  const [options, setOptions] = useState('')
  const [error, setError] = useState('')
  const typeOptions = [
    { label: t('Text'), value: 'text' }, { label: t('Number'), value: 'number' },
    { label: t('Date'), value: 'date' }, { label: t('Select'), value: 'select' },
  ]
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['space-fields-full', projectKey] })
    qc.invalidateQueries({ queryKey: ['space-fields', projectKey] })
  }
  const create = () => {
    setError('')
    api(`/projects/${projectKey}/fields`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), type: ftype, options: options.split(',').map((s) => s.trim()).filter(Boolean) }),
    }).then(() => { setName(''); setOptions(''); refresh() })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')))
  }
  const remove = (id: string) => {
    api(`/projects/${projectKey}/fields/${id}`, { method: 'DELETE' }).then(refresh)
      .catch((e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')))
  }
  if (isLoading) return <Spinner />
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Fields')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>{t('Custom fields shown in the Details panel of work items in this space. Global fields apply to every space and are managed by site admins.')}</p>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr>
            {[t('Name'), t('Type'), t('Scope'), t('Used on'), ''].map((h, i) => (
              <th key={i} style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(fields ?? []).map((f) => (
            <tr key={f.id}>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{f.name}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{t(f.type)}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                {f.projectId ? <Lozenge appearance="inprogress">{t('This space')}</Lozenge> : <Lozenge>{t('Global')}</Lozenge>}
              </td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{t('{n} items', { n: f.usageCount })}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, textAlign: 'end' }}>
                {f.projectId && <Button appearance="subtle" spacing="compact" onClick={() => remove(f.id)}>{t('Delete')}</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Create a field for this space')}</h4>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 200 }}><TextField placeholder={t('Field name')} value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div style={{ width: 140 }}>
          <Select spacing="compact" options={typeOptions} value={typeOptions.find((o) => o.value === ftype)} onChange={(o) => o && setFtype(o.value)} />
        </div>
        {ftype === 'select' && (
          <div style={{ width: 220 }}><TextField placeholder={t('Options (comma separated)')} value={options} onChange={(e) => setOptions((e.target as HTMLInputElement).value)} /></div>
        )}
        <Button appearance="primary" isDisabled={!name.trim()} onClick={create}>{t('Create')}</Button>
      </div>
      {error && <p style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24'), marginTop: 8 }}>{error}</p>}
    </div>
  )
}

function VersionsSection({ projectKey }: { projectKey: string }) {
  const { data: versions, isLoading } = useQuery({
    queryKey: ['sum-versions-full', projectKey],
    queryFn: () => api<{ id: string; name: string; status: string; done: number; total: number }[]>(`/projects/${projectKey}/versions`),
  })
  if (isLoading) return <Spinner />
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Versions')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>
        {t('Versions group work into releases.')}{' '}
        <Link to={`/projects/${projectKey}/releases`}>{t('Manage them on the Releases tab.')}</Link>
      </p>
      {(versions ?? []).length === 0 ? (
        <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F') }}>{t('No versions yet.')}</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              {[t('Name'), t('Status'), t('Progress')].map((h) => (
                <th key={h} style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(versions ?? []).map((v) => (
              <tr key={v.id}>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                  <Link to={`/projects/${projectKey}/releases/${v.id}`}>{v.name}</Link>
                </td>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                  <Lozenge appearance={v.status === 'released' ? 'success' : v.status === 'archived' ? 'moved' : 'inprogress'}>{t(v.status)}</Lozenge>
                </td>
                <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                  {t('{done} of {total} done', { done: v.done, total: v.total })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

type SpaceComponent = { id: string; name: string; description: string; defaultAssignee: { id: string; displayName: string } | null; issueCount: number }

function ComponentsSection({ projectKey, members }: { projectKey: string; members: Member[] }) {
  const qc = useQueryClient()
  const { data: components, isLoading } = useQuery({
    queryKey: ['space-components-full', projectKey],
    queryFn: () => api<SpaceComponent[]>(`/projects/${projectKey}/components`),
  })
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<SpaceComponent | null>(null)
  const memberOptions = [{ label: t('None (unassigned)'), value: null as string | null },
    ...members.map((m) => ({ label: m.user.displayName, value: m.user.id as string | null }))]
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['space-components-full', projectKey] })
    qc.invalidateQueries({ queryKey: ['space-components', projectKey] })
  }
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))
  const create = () => {
    setError('')
    api(`/projects/${projectKey}/components`, {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), description, defaultAssigneeId: assigneeId }),
    }).then(() => { setName(''); setDescription(''); setAssigneeId(null); refresh() }).catch(fail)
  }
  const saveEdit = () => {
    if (!editing) return
    setError('')
    api(`/projects/${projectKey}/components/${editing.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: editing.name.trim(), description: editing.description, defaultAssigneeId: editing.defaultAssignee?.id ?? null }),
    }).then(() => { setEditing(null); refresh() }).catch(fail)
  }
  const remove = (id: string) => {
    setError('')
    api(`/projects/${projectKey}/components/${id}`, { method: 'DELETE' }).then(refresh).catch(fail)
  }
  if (isLoading) return <Spinner />
  return (
    <div style={cardStyle}>
      <h3 style={h3Style}>{t('Components')}</h3>
      <p style={{ ...hintStyle, marginBottom: 12 }}>{t('Components group work items into parts of your product, each with an optional default assignee.')}</p>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 16 }}>
        <thead>
          <tr>
            {[t('Name'), t('Description'), t('Default assignee'), t('Work items'), ''].map((h, i) => (
              <th key={i} style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtlest', '#626F86') }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(components ?? []).map((c) => (
            <tr key={c.id}>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, fontWeight: 500 }}>{c.name}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, color: token('color.text.subtle', '#44546F') }}>{c.description || '—'}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{c.defaultAssignee?.displayName ?? t('None (unassigned)')}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>{c.issueCount}</td>
              <td style={{ padding: '6px 10px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, textAlign: 'end', whiteSpace: 'nowrap' }}>
                <Button appearance="subtle" spacing="compact" onClick={() => setEditing({ ...c })}>{t('Edit')}</Button>
                <Button appearance="subtle" spacing="compact" onClick={() => remove(c.id)}>{t('Delete')}</Button>
              </td>
            </tr>
          ))}
          {(components ?? []).length === 0 && (
            <tr><td colSpan={5} style={{ padding: '12px 10px', color: token('color.text.subtle', '#44546F') }}>{t('No components yet.')}</td></tr>
          )}
        </tbody>
      </table>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Create component')}</h4>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: 180 }}><TextField placeholder={t('Name')} value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} /></div>
        <div style={{ width: 240 }}><TextField placeholder={t('Description')} value={description} onChange={(e) => setDescription((e.target as HTMLInputElement).value)} /></div>
        <div style={{ width: 200 }}>
          <Select spacing="compact" placeholder={t('Default assignee')} options={memberOptions}
            value={memberOptions.find((o) => o.value === assigneeId)} onChange={(o) => setAssigneeId(o?.value ?? null)} />
        </div>
        <Button appearance="primary" isDisabled={!name.trim()} onClick={create}>{t('Create')}</Button>
      </div>
      {error && <p style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24'), marginTop: 8 }}>{error}</p>}
      <ModalTransition>
        {editing && (
          <Modal onClose={() => setEditing(null)}>
            <ModalHeader hasCloseButton><ModalTitle>{t('Edit component')}</ModalTitle></ModalHeader>
            <ModalBody>
              <FieldRow label={t('Name')}>
                <TextField value={editing.name} onChange={(e) => setEditing({ ...editing, name: (e.target as HTMLInputElement).value })} />
              </FieldRow>
              <FieldRow label={t('Description')}>
                <TextField value={editing.description} onChange={(e) => setEditing({ ...editing, description: (e.target as HTMLInputElement).value })} />
              </FieldRow>
              <FieldRow label={t('Default assignee')}>
                <Select options={memberOptions}
                  value={memberOptions.find((o) => o.value === (editing.defaultAssignee?.id ?? null))}
                  onChange={(o) => setEditing({ ...editing, defaultAssignee: o?.value ? { id: o.value, displayName: o.label } : null })} />
              </FieldRow>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setEditing(null)}>{t('Cancel')}</Button>
              <Button appearance="primary" onClick={saveEdit} isDisabled={!editing.name.trim()}>{t('Save')}</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}
