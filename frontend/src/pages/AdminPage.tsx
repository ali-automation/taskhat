import { useEffect, useState } from 'react'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import Select from '@atlaskit/select'
import Lozenge from '@atlaskit/lozenge'
import DynamicTable from '@atlaskit/dynamic-table'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import { token } from '@atlaskit/tokens'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  useAdminActivate,
  useAdminCreateInvite,
  useAdminDeactivate,
  useAdminDeleteInvite,
  useAdminInvites,
  useAdminProjects,
  useAdminSetAdmin,
  useAdminSettings,
  useAdminSystem,
  useAdminUpdateSettings,
  useAdminUsers,
} from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { api, ApiError } from '../api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUser } from '../api/types'
import { FieldsAdmin, WorkflowsAdmin, WorkTypesAdmin } from './WorkItemsAdmin'
import { SchemeDetailPage, SchemesListPage } from './PermissionSchemesAdmin'
import IncomingMailPage from './IncomingMailPage'
import { ArchivedSpacesPage, AuditLogPage, CategoriesPage, DefaultsPage, GlobalPermissionsPage, SecurityPage, SpaceRolesPage, TestEmailWidget } from './SystemAdmin'
import { WebhooksAdmin } from './IntegrationsAdmin'
import { AutomationListPage, FlowEditorPage } from './AutomationAdmin'
import { useAdminCategories, useAdminSchemes, useAdminSetProjectCategory, useAdminSetProjectScheme } from '../api/hooks'
import { t, fmtDate, fmtDateTime } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function InviteModal({ forUser, onClose }: { forUser: AdminUser | null; onClose: () => void }) {
  const createInvite = useAdminCreateInvite()
  const [email, setEmail] = useState(forUser && !forUser.email.endsWith('@imported.invalid') ? forUser.email : '')
  const [result, setResult] = useState<{ inviteUrl: string; emailSent: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader>
        <ModalTitle>{forUser ? t('Invite {name}', { name: forUser.displayName }) : t('Invite user')}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {forUser && (
          <p style={{ fontSize: 13, marginBottom: 12, ...subtleText }}>
            {t('This sends a link that lets this person set a password and take over the account')}
            {forUser.imported ? t(' (imported from Jira, including all their history)') : ''}.
          </p>
        )}
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>
          {t('Email to send the invite to')}
        </label>
        <TextField autoFocus value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="person@company.com" />
        {error && (
          <div style={{ marginTop: 10 }}>
            <SectionMessage appearance="error">{error}</SectionMessage>
          </div>
        )}
        {result && (
          <div style={{ marginTop: 12 }}>
            <SectionMessage appearance="success" title={result.emailSent ? t('Invite email sent') : t('Invite created (email not configured — share the link)')}>
              <code style={{ fontSize: 11, wordBreak: 'break-all', display: 'block', marginTop: 4 }}>{result.inviteUrl}</code>
            </SectionMessage>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          {result ? t('Close') : t('Cancel')}
        </Button>
        {!result && (
          <Button
            appearance="primary"
            isLoading={createInvite.isPending}
            onClick={async () => {
              setError(null)
              try {
                const res = await createInvite.mutateAsync({ email, userId: forUser?.id })
                setResult({ inviteUrl: res.inviteUrl, emailSent: res.emailSent })
              } catch (err) {
                setError(err instanceof ApiError ? Object.values(err.body.errors)[0] ?? err.message : t('failed'))
              }
            }}
          >
            {t('Send invite')}
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}

function UsersTab() {
  const { user: me } = useAuth()
  const [query, setQuery] = useState('')
  const { data: users } = useAdminUsers(query)
  const { data: invites } = useAdminInvites()
  const deleteInvite = useAdminDeleteInvite()
  const activate = useAdminActivate()
  const deactivate = useAdminDeactivate()
  const setAdmin = useAdminSetAdmin()
  const [inviteFor, setInviteFor] = useState<AdminUser | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const rows = (users ?? []).map((u) => ({
    key: u.id,
    cells: [
      {
        key: 'name',
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size="small" name={u.displayName} src={u.avatarUrl ?? undefined} />
            <span>
              <Link to={`/people/${u.id}`} style={{ fontWeight: 500 }}>{u.displayName}</Link>
              <span style={{ display: 'block', fontSize: 12, ...subtleText }}>{u.email}</span>
            </span>
          </span>
        ),
      },
      {
        key: 'badges',
        content: (
          <span style={{ display: 'flex', gap: 4 }}>
            {u.isAdmin && <Lozenge appearance="inprogress" isBold>{t('Admin')}</Lozenge>}
            {!u.isActive && <Lozenge>{t('Deactivated')}</Lozenge>}
            {u.imported && <Lozenge appearance="moved">{t('Imported')}</Lozenge>}
          </span>
        ),
      },
      { key: 'title', content: <span style={subtleText}>{u.jobTitle}</span> },
      {
        key: 'actions',
        content: (
          <DropdownMenu
            trigger={({ triggerRef, ...props }) => (
              <Button ref={triggerRef} {...props} appearance="subtle" spacing="compact">
                ⋯
              </Button>
            )}
            shouldRenderToParent
          >
            <DropdownItemGroup>
              <DropdownItem onClick={() => { setInviteFor(u); setInviteOpen(true) }}>
                {u.imported || !u.isActive ? t('Invite / claim account…') : t('Send password reset link…')}
              </DropdownItem>
              {u.id !== me?.id && (
                <>
                  {u.isActive ? (
                    <DropdownItem onClick={() => deactivate.mutate({ id: u.id })}>{t('Deactivate')}</DropdownItem>
                  ) : (
                    <DropdownItem onClick={() => activate.mutate({ id: u.id })}>{t('Activate')}</DropdownItem>
                  )}
                  <DropdownItem onClick={() => setAdmin.mutate({ id: u.id, body: { isAdmin: !u.isAdmin } })}>
                    {u.isAdmin ? t('Remove admin access') : t('Make admin')}
                  </DropdownItem>
                </>
              )}
            </DropdownItemGroup>
          </DropdownMenu>
        ),
      },
    ],
  }))

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ width: 260 }}>
          <TextField isCompact placeholder={t('Search users')} value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
        </div>
        <span style={{ flex: 1 }} />
        <Button appearance="primary" onClick={() => { setInviteFor(null); setInviteOpen(true) }}>
          {t('Invite user')}
        </Button>
      </div>

      <DynamicTable
        head={{ cells: [{ key: 'n', content: t('User') }, { key: 'b', content: '' }, { key: 't', content: t('Job title') }, { key: 'a', content: '' }] }}
        rows={rows}
      />

      {(invites ?? []).length > 0 && (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, margin: '20px 0 8px' }}>{t('Pending invites')}</div>
          <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8 }}>
            {(invites ?? []).map((inv) => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 13, borderBottom: `1px solid ${token('color.border', '#F1F2F4')}` }}>
                <span style={{ flex: 1 }}>
                  {inv.email}
                  <span style={{ ...subtleText }}>{t(' — invited by {name}, expires {date}', { name: inv.invitedBy.displayName, date: fmtDate(inv.expiresAt) })}</span>
                </span>
                <Button appearance="subtle" spacing="compact" onClick={() => deleteInvite.mutate(inv.id)}>
                  {t('Revoke')}
                </Button>
              </div>
            ))}
          </div>
        </>
      )}

      <ModalTransition>
        {inviteOpen && <InviteModal forUser={inviteFor} onClose={() => setInviteOpen(false)} />}
      </ModalTransition>
    </div>
  )
}

function SpacesTab() {
  const { data: projects } = useAdminProjects()
  const { data: categories } = useAdminCategories()
  const setCategory = useAdminSetProjectCategory()
  const { data: schemes } = useAdminSchemes()
  const setScheme = useAdminSetProjectScheme()
  const catOptions = [{ label: t('No category'), value: '' }, ...(categories ?? []).map((c) => ({ label: c.name, value: c.id }))]
  const schemeOptions = (schemes ?? []).map((sc) => ({ label: sc.name, value: sc.id }))
  const [leadFor, setLeadFor] = useState<string | null>(null)
  const [leadEmail, setLeadEmail] = useState('')
  const setLead = async (key: string) => {
    const { api } = await import('../api/client')
    await api(`/admin/projects/${key}/lead`, { method: 'PUT', body: JSON.stringify({ email: leadEmail }) })
    setLeadFor(null)
    setLeadEmail('')
    window.location.reload()
  }
  const del = async (key: string) => {
    if (!confirm(t('Delete space {key} and ALL its work items? This cannot be undone.', { key }))) return
    const { api } = await import('../api/client')
    await api(`/admin/projects/${key}`, { method: 'DELETE' })
    window.location.reload()
  }

  const rows = (projects ?? []).map((p) => ({
    key: p.id,
    cells: [
      {
        key: 'name',
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar appearance="square" size="small" name={p.name} />
            <Link to={`/projects/${p.key}/summary`} style={{ fontWeight: 500 }}>{p.name}</Link>
            <span style={subtleText}>({p.key})</span>
            {p.archivedAt && <Lozenge appearance="moved">{t('Archived')}</Lozenge>}
          </span>
        ),
      },
      { key: 'lead', content: <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Avatar size="xsmall" name={p.lead.displayName} src={p.lead.avatarUrl ?? undefined} />{p.lead.displayName}</span> },
      {
        key: 'category',
        content: (
          <div style={{ minWidth: 150 }}>
            <Select
              spacing="compact"
              options={catOptions}
              value={catOptions.find((o) => o.label === p.category) ?? catOptions[0]}
              onChange={(o) => setCategory.mutate({ key: p.key, id: o && o.value !== '' ? o.value : null })}
            />
          </div>
        ),
      },
      {
        key: 'scheme',
        content: (
          <div style={{ minWidth: 170 }}>
            <Select
              spacing="compact"
              options={schemeOptions}
              value={schemeOptions.find((o) => o.value === p.schemeId) ?? null}
              onChange={(o) => o && setScheme.mutate({ key: p.key, schemeId: o.value })}
            />
          </div>
        ),
      },
      { key: 'members', content: p.memberCount },
      { key: 'issues', content: p.issueCount },
      {
        key: 'actions',
        content: (
          <span style={{ display: 'flex', gap: 4 }}>
            <Button appearance="subtle" spacing="compact" onClick={() => setLeadFor(p.key)}>{t('Change lead')}</Button>
            <Button appearance="subtle" spacing="compact" onClick={() => del(p.key)}>{t('Delete')}</Button>
          </span>
        ),
      },
    ],
  }))

  return (
    <div>
      <DynamicTable
        head={{ cells: [{ key: 'n', content: t('Space') }, { key: 'l', content: t('Lead') }, { key: 'c', content: t('Category') }, { key: 's', content: t('Permission scheme') }, { key: 'm', content: t('Members') }, { key: 'i', content: t('Work items') }, { key: 'a', content: '' }] }}
        rows={rows}
      />
      <ModalTransition>
        {leadFor && (
          <Modal onClose={() => setLeadFor(null)} width="small">
            <ModalHeader><ModalTitle>{t('Change lead of {key}', { key: leadFor })}</ModalTitle></ModalHeader>
            <ModalBody>
              <TextField autoFocus placeholder="new-lead@company.com" value={leadEmail} onChange={(e) => setLeadEmail(e.currentTarget.value)} />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setLeadFor(null)}>{t('Cancel')}</Button>
              <Button appearance="primary" onClick={() => setLead(leadFor)}>{t('Save')}</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}

// SettingRow renders Jira's read-only "label | value" definition rows.
function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', padding: '10px 0', fontSize: 14 }}>
      <div style={{ width: 340, flexShrink: 0, color: token('color.text.subtle', '#44546F') }}>{label}</div>
      <div style={{ flex: 1 }}>{value || <span style={subtleText}>—</span>}</div>
    </div>
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 20, fontWeight: 600, margin: '28px 0 6px' }}>{children}</h2>
}

const REG_OPTIONS = [
  { label: t('Open — anyone can sign up'), value: 'open' },
  { label: t('Invite-only'), value: 'invite-only' },
]
const LANG_OPTIONS = [
  { label: t('English'), value: 'en' },
  { label: 'العربية (Arabic)', value: 'ar' },
]

// Jira's System > General configuration: read-only view + "Edit settings".
function GeneralConfiguration() {
  const { data: settings } = useAdminSettings()
  const update = useAdminUpdateSettings()
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const current = settings ?? {}

  if (form) {
    const set = (k: string) => (e: React.FormEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value })
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>{t('System settings')}</h1>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Title')}</span>
          <TextField value={form.site_name ?? ''} onChange={set('site_name')} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>
            {t('Introduction (shown on the log-in screen)')}
          </span>
          <TextField value={form.introduction ?? ''} onChange={set('introduction')} placeholder={t('Welcome to our tracker')} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Sign-up mode')}</span>
          <Select
            options={REG_OPTIONS}
            value={REG_OPTIONS.find((o) => o.value === (form.registration_mode ?? 'open'))}
            onChange={(v) => v && setForm({ ...form, registration_mode: v.value })}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Default language')}</span>
          <Select
            options={LANG_OPTIONS}
            value={LANG_OPTIONS.find((o) => o.value === (form.default_language || 'en'))}
            onChange={(v) => v && setForm({ ...form, default_language: v.value })}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            appearance="primary"
            isLoading={update.isPending}
            onClick={async () => {
              await update.mutateAsync(form)
              setForm(null)
            }}
          >
            {t('Save')}
          </Button>
          <Button appearance="subtle" onClick={() => setForm(null)}>{t('Cancel')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('System settings')}</h1>
        <Button onClick={() => setForm({ ...current })}>{t('Edit settings')}</Button>
      </div>
      <SectionHeading>{t('General Settings')}</SectionHeading>
      <SettingRow label={t('Title')} value={current.site_name} />
      <SettingRow label={t('Email from')} value={current.smtp_from} />
      <SettingRow label={t('Introduction')} value={current.introduction} />
      <SettingRow
        label={t('Sign-up mode')}
        value={
          <Lozenge appearance={current.registration_mode === 'invite-only' ? 'inprogress' : 'success'}>
            {current.registration_mode === 'invite-only' ? t('Invite-only') : t('Open')}
          </Lozenge>
        }
      />
      <SectionHeading>{t('Internationalization')}</SectionHeading>
      <SettingRow label={t('Default language')} value={LANG_OPTIONS.find((o) => o.value === (current.default_language || 'en'))?.label} />
      <SettingRow label={t('Indexing language')} value={t('English (built-in Postgres full-text search)')} />
    </div>
  )
}

// Jira's System > Mail > Outgoing mail (SMTP lives in the DB, overrides env).
function OutgoingMail() {
  const { data: settings } = useAdminSettings()
  const update = useAdminUpdateSettings()
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const current = settings ?? {}

  if (form) {
    const set = (k: string) => (e: React.FormEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value })
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>{t('Outgoing mail')}</h1>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>
            {t('SMTP server (host:port — empty falls back to the environment default)')}
          </span>
          <TextField value={form.smtp_addr ?? ''} onChange={set('smtp_addr')} placeholder="smtp.company.com:587" />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('From address')}</span>
          <TextField value={form.smtp_from ?? ''} onChange={set('smtp_from')} placeholder="taskhat@company.com" />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>
            {t('Username (empty = no authentication)')}
          </span>
          <TextField value={form.smtp_username ?? ''} onChange={set('smtp_username')} placeholder="mailer@company.com" />
        </label>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>
            {t('Password (leave the ******** unchanged to keep the stored one)')}
          </span>
          <TextField type="password" value={form.smtp_password ?? ''} onChange={set('smtp_password')} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button
            appearance="primary"
            isLoading={update.isPending}
            onClick={async () => {
              await update.mutateAsync(form)
              setForm(null)
            }}
          >
            {t('Save')}
          </Button>
          <Button appearance="subtle" onClick={() => setForm(null)}>{t('Cancel')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Outgoing mail')}</h1>
        <Button onClick={() => setForm({ ...current })}>{t('Edit settings')}</Button>
      </div>
      <p style={{ fontSize: 13, ...subtleText, margin: '8px 0 4px' }}>
        {t('Used for invite emails and watcher notifications. Values here override the container environment.')}
      </p>
      <SectionHeading>{t('SMTP server')}</SectionHeading>
      <SettingRow label={t('Host')} value={current.smtp_addr || (current._smtp_env_addr ? `${current._smtp_env_addr} (${t('from environment')})` : '')} />
      <SettingRow label={t('From address')} value={current.smtp_from || (current._smtp_env_from ? `${current._smtp_env_from} (${t('from environment')})` : '')} />
      <SettingRow
        label={t('Authentication')}
        value={
          current.smtp_username
            ? `${current.smtp_username} (${t('password set')})`
            : current._smtp_env_username
              ? `${current._smtp_env_username} (${current._smtp_env_password_set ? t('password set, from environment') : t('NO password in environment')})`
              : t('none — open relay')
        }
      />
      <p style={{ fontSize: 12, marginTop: 8, ...subtleText }}>
        {t('Use host:587 for STARTTLS or host:465 for implicit TLS. Credentials are required by virtually every real provider.')}
      </p>
      <TestEmailWidget />
    </div>
  )
}

function DemoDataCard() {
  const qc = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['demo-data'],
    queryFn: () => api<{ taskhat: boolean; dochat: boolean; projectKey: string; wikiKey: string }>('/admin/demo-data'),
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = (method: 'POST' | 'DELETE') => {
    setBusy(true)
    setError('')
    api('/admin/demo-data', { method })
      .then(() => {
        qc.invalidateQueries({ queryKey: ['demo-data'] })
        qc.invalidateQueries({ queryKey: ['projects'] })
        qc.invalidateQueries({ queryKey: ['wiki-spaces'] })
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')))
      .finally(() => setBusy(false))
  }
  const present = status && (status.taskhat || status.dochat)
  return (
    <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, padding: '14px 16px', marginBottom: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {t('Demo data')}{' '}
            {status && (present
              ? <Lozenge appearance="success">{t('present')}</Lozenge>
              : <Lozenge>{t('not installed')}</Lozenge>)}
          </div>
          <div style={{ fontSize: 12, ...subtleText, marginTop: 2 }}>
            {t('Sample “Nimbus” spaces in TaskHat and DocHat: epics, sprints, comments, worklogs, releases, wiki pages, a whiteboard, a blog and a calendar. The read-only demo account gets viewer access automatically.')}
          </div>
        </div>
        {present ? (
          <Button appearance="danger" isLoading={busy} onClick={() => run('DELETE')}>{t('Remove demo data')}</Button>
        ) : (
          <Button appearance="primary" isLoading={busy} onClick={() => run('POST')}>{t('Create demo data')}</Button>
        )}
      </div>
      {error && <p style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24'), marginTop: 8 }}>{error}</p>}
    </div>
  )
}

function SystemTab() {
  const { data } = useAdminSystem()
  const tiles: [string, string][] = [
    ['users', t('Active users')],
    ['projects', t('Spaces')],
    ['issues', t('Work items')],
    ['comments', t('Comments')],
    ['sessions', t('Sessions (7d)')],
  ]
  const jobs = (data?.importJobs ?? []) as { projectKey: string; source: string; status: string; createdAt: string; owner: string }[]
  const queues = (data?.queues ?? {}) as Record<string, number>
  return (
    <div>
      <DemoDataCard />
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {tiles.map(([key, label]) => (
          <div key={key} style={{ flex: 1, border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontSize: 26, fontWeight: 600 }}>{String(data?.[key] ?? '—')}</div>
            <div style={{ fontSize: 12, ...subtleText }}>{label}</div>
          </div>
        ))}
      </div>
      {Object.keys(queues).length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          {Object.entries(queues).map(([name, depth]) => (
            <div key={name} style={{ flex: 1, border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, padding: '14px 16px' }}>
              <div style={{ fontSize: 26, fontWeight: 600 }}>{depth < 0 ? '—' : depth}</div>
              <div style={{ fontSize: 12, ...subtleText }}>{t('Queue: {name}', { name })}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Recent imports (all users)')}</div>
      <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8 }}>
        {jobs.map((j, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 14px', fontSize: 13, borderBottom: `1px solid ${token('color.border', '#F1F2F4')}` }}>
            <span style={{ fontWeight: 600, width: 70 }}>{j.projectKey}</span>
            <span style={{ width: 80, ...subtleText }}>{j.source === 'jira_api' ? t('Jira API') : t('CSV')}</span>
            <Lozenge appearance={j.status === 'done' ? 'success' : j.status === 'failed' ? 'removed' : 'inprogress'}>{j.status}</Lozenge>
            <span style={{ flex: 1, textAlign: 'end', ...subtleText }}>
              {j.owner} · {fmtDateTime(j.createdAt)}
            </span>
          </div>
        ))}
        {jobs.length === 0 && <div style={{ padding: 14, fontSize: 13, ...subtleText }}>{t('No imports yet.')}</div>}
      </div>
    </div>
  )
}

// Route-driven admin settings pages; the sidebar (SettingsSidebar) is the nav.
export default function AdminPage() {
  const { isAdmin } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  // Legacy deep links: /admin?tab=…
  useEffect(() => {
    const tab = params.get('tab')
    if (tab) {
      const map: Record<string, string> = {
        users: '/admin/users',
        spaces: '/admin/spaces',
        settings: '/admin/system/general',
        system: '/admin/system/info',
      }
      navigate(map[tab] ?? '/admin/users', { replace: true })
    }
  }, [params, navigate])

  if (!isAdmin) {
    return <SectionMessage appearance="warning" title={t('Administrator access required')}>{t('Ask an admin to grant you access.')}</SectionMessage>
  }

  const path = location.pathname
  if (path.startsWith('/admin/users')) {
    return (
      <div style={{ maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>{t('User management')}</h1>
        <UsersTab />
      </div>
    )
  }
  if (path.startsWith('/admin/spaces')) {
    return (
      <div style={{ maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>{t('Manage spaces')}</h1>
        <SpacesTab />
      </div>
    )
  }
  if (path === '/admin/automation') return <AutomationListPage />
  if (path.startsWith('/admin/automation/')) return <FlowEditorPage />
  if (path.startsWith('/admin/integrations')) return <WebhooksAdmin />
  if (path === '/admin/work-items/permissions') return <SchemesListPage />
  if (path.startsWith('/admin/work-items/permissions/')) return <SchemeDetailPage />
  if (path === '/admin/work-items/types') return <WorkTypesAdmin />
  if (path === '/admin/work-items/workflows') return <WorkflowsAdmin />
  if (path === '/admin/work-items/fields') return <FieldsAdmin />
  if (path === '/admin/system/mail') return <OutgoingMail />
  if (path === '/admin/system/incoming-mail') return <IncomingMailPage />
  if (path === '/admin/system/audit') return <AuditLogPage />
  if (path === '/admin/system/security') return <SecurityPage />
  if (path === '/admin/system/permissions') return <GlobalPermissionsPage />
  if (path === '/admin/system/roles') return <SpaceRolesPage />
  if (path === '/admin/system/defaults') return <DefaultsPage />
  if (path === '/admin/spaces/categories') return <CategoriesPage />
  if (path === '/admin/spaces/archived') return <ArchivedSpacesPage />
  if (path === '/admin/system/info') {
    return (
      <div style={{ maxWidth: 960 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>{t('System info')}</h1>
        <SystemTab />
      </div>
    )
  }
  return <GeneralConfiguration />
}
