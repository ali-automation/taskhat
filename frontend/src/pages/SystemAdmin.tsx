import { useState } from 'react'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Lozenge from '@atlaskit/lozenge'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAdminAudit, useAdminCategories, useAdminCreateCategory, useAdminDeleteCategory,
  useAdminProjects, useAdminSettings, useAdminTestEmail,
  useAdminUnarchive, useAdminUpdateSettings, useAdminUsers,
} from '../api/hooks'
import { t, fmtDate, fmtDateTime } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function SettingRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', padding: '10px 0', fontSize: 14 }}>
      <div style={{ width: 340, flexShrink: 0, color: token('color.text.subtle', '#44546F') }}>{label}</div>
      <div style={{ flex: 1 }}>{value || <span style={subtleText}>—</span>}</div>
    </div>
  )
}

const ACTION_APPEARANCE = (action: string) =>
  action.includes('failed') || action.includes('locked') || action.includes('deleted') || action.includes('deactivated')
    ? 'removed'
    : action.includes('created') || action.includes('success') || action.includes('activated')
      ? 'success'
      : 'default'

// ---- Audit log ----

export function AuditLogPage() {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [startAt, setStartAt] = useState(0)
  const { data } = useAdminAudit(query, action, startAt)

  const actionOptions = [{ label: t('All actions'), value: '' }, ...(data?.actions ?? []).map((a) => ({ label: a, value: a }))]

  const rows = (data?.values ?? []).map((e) => ({
    key: e.id,
    cells: [
      { key: 'time', content: <span style={{ fontSize: 12, whiteSpace: 'nowrap', ...subtleText }}>{fmtDateTime(e.createdAt)}</span> },
      {
        key: 'actor',
        content: e.actor ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Avatar size="xsmall" name={e.actor.displayName} src={e.actor.avatarUrl ?? undefined} />
            {e.actor.displayName}
          </span>
        ) : (
          <span style={subtleText}>{t('anonymous')}</span>
        ),
      },
      { key: 'action', content: <Lozenge appearance={ACTION_APPEARANCE(e.action)}>{e.action}</Lozenge> },
      { key: 'target', content: <span style={{ fontSize: 13 }}>{e.target}</span> },
      {
        key: 'details',
        content: Object.keys(e.details ?? {}).length > 0 && (
          <code style={{ fontSize: 11, ...subtleText }}>{JSON.stringify(e.details)}</code>
        ),
      },
      { key: 'ip', content: <span style={{ fontSize: 12, ...subtleText }}>{e.ip.split(':')[0]}</span> },
    ],
  }))

  return (
    <div style={{ maxWidth: 1020 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Audit log')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Sensitive actions across the site: sign-ins (including failures and lockouts), invites, user and space administration, settings and workflow changes.')}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ width: 280 }}>
          <TextField isCompact placeholder={t('Filter by user, target or action')} value={query} onChange={(e) => { setQuery(e.currentTarget.value); setStartAt(0) }} />
        </div>
        <div style={{ width: 230 }}>
          <Select
            spacing="compact"
            options={actionOptions}
            value={actionOptions.find((o) => o.value === action) ?? actionOptions[0]}
            onChange={(o) => { setAction(o?.value ?? ''); setStartAt(0) }}
          />
        </div>
      </div>
      <DynamicTable
        head={{ cells: [
          { key: 't', content: t('Time') },
          { key: 'u', content: t('Actor') },
          { key: 'a', content: t('Action') },
          { key: 'g', content: t('Target') },
          { key: 'd', content: t('Details') },
          { key: 'i', content: t('IP') },
        ] }}
        rows={rows}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Button isDisabled={startAt === 0} onClick={() => setStartAt(Math.max(0, startAt - 50))}>{t('← Newer')}</Button>
        <Button isDisabled={data?.isLast ?? true} onClick={() => setStartAt(startAt + 50)}>{t('Older →')}</Button>
        <span style={{ fontSize: 12, ...subtleText }}>
          {data ? t('{from}–{to} of {total}', { from: startAt + 1, to: startAt + (data.values?.length ?? 0), total: data.total }) : ''}
        </span>
      </div>
    </div>
  )
}

// ---- Security policies ----

export function SecurityPage() {
  const { data: settings } = useAdminSettings()
  const update = useAdminUpdateSettings()
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const current = settings ?? {}

  const v = (k: string, def: string) => current[k] || def

  if (form) {
    const set = (k: string) => (e: React.FormEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.currentTarget.value })
    const num = (label: string, key: string, hint: string) => (
      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{label}</span>
        <TextField type="number" value={form[key] ?? ''} onChange={set(key)} />
        <span style={{ display: 'block', fontSize: 12, marginTop: 4, ...subtleText }}>{hint}</span>
      </label>
    )
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>{t('Security')}</h1>
        {num(t('Session lifetime (days)'), 'session_lifetime_days', t('How long a signed-in session lasts without re-login.'))}
        {num(t('Minimum password length'), 'min_password_len', t('Applies to sign-up, invites and password changes.'))}
        {num(t('Failed sign-in attempts before lockout'), 'login_lockout_attempts', t('Counted per email address.'))}
        {num(t('Lockout window (minutes)'), 'login_lockout_minutes', t('How long the lockout lasts.'))}
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Require two-step verification')}</span>
          <Select
            options={[{ label: t('Optional'), value: 'false' }, { label: t('Required for everyone'), value: 'true' }]}
            value={{ label: form.require_2fa === 'true' ? t('Required for everyone') : t('Optional'), value: form.require_2fa ?? 'false' }}
            onChange={(o) => setForm({ ...form, require_2fa: o?.value ?? 'false' })}
          />
          <span style={{ display: 'block', fontSize: 12, marginTop: 4, ...subtleText }}>{t('People without it see a persistent prompt to enroll after signing in.')}</span>
        </label>
        <h2 style={{ fontSize: 18, margin: '20px 0 10px' }}>{t('Single sign-on (OIDC)')}</h2>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('SSO sign-in')}</span>
          <Select
            options={[{ label: t('Disabled'), value: 'false' }, { label: t('Enabled'), value: 'true' }]}
            value={{ label: form.oidc_enabled === 'true' ? t('Enabled') : t('Disabled'), value: form.oidc_enabled ?? 'false' }}
            onChange={(o) => setForm({ ...form, oidc_enabled: o?.value ?? 'false' })}
          />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Issuer URL')}</span>
          <TextField value={form.oidc_issuer ?? ''} onChange={set('oidc_issuer')} placeholder="https://accounts.google.com" />
          <span style={{ display: 'block', fontSize: 12, marginTop: 4, ...subtleText }}>{t('The provider must serve /.well-known/openid-configuration. Redirect URI: {url}', { url: window.location.origin + '/api/v1/auth/oidc/callback' })}</span>
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Client ID')}</span>
          <TextField value={form.oidc_client_id ?? ''} onChange={set('oidc_client_id')} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Client secret')}</span>
          <TextField type="password" value={form.oidc_client_secret ?? ''} onChange={set('oidc_client_secret')} />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Sign-in button label')}</span>
          <TextField value={form.oidc_label ?? ''} onChange={set('oidc_label')} placeholder={t('Continue with SSO')} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button appearance="primary" isLoading={update.isPending} onClick={async () => { await update.mutateAsync(form); setForm(null) }}>{t('Save')}</Button>
          <Button appearance="subtle" onClick={() => setForm(null)}>{t('Cancel')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Security')}</h1>
        <Button onClick={() => setForm({
          ...current,
          session_lifetime_days: v('session_lifetime_days', '30'),
          min_password_len: v('min_password_len', '8'),
          login_lockout_attempts: v('login_lockout_attempts', '10'),
          login_lockout_minutes: v('login_lockout_minutes', '15'),
          require_2fa: v('require_2fa', 'false'),
          oidc_enabled: v('oidc_enabled', 'false'),
          oidc_issuer: v('oidc_issuer', ''),
          oidc_client_id: v('oidc_client_id', ''),
          oidc_client_secret: v('oidc_client_secret', ''),
          oidc_label: v('oidc_label', ''),
        })}>{t('Edit settings')}</Button>
      </div>
      <p style={{ fontSize: 13, ...subtleText, margin: '8px 0 4px' }}>
        {t('Policies are enforced immediately; failed-login counters live in Redis and lockouts appear in the audit log.')}
      </p>
      <SettingRow label={t('Session lifetime')} value={t('{n} days', { n: v('session_lifetime_days', '30') })} />
      <SettingRow label={t('Minimum password length')} value={t('{n} characters', { n: v('min_password_len', '8') })} />
      <SettingRow label={t('Sign-in lockout')} value={t('{attempts} failed attempts → locked for {minutes} minutes', { attempts: v('login_lockout_attempts', '10'), minutes: v('login_lockout_minutes', '15') })} />
      <SettingRow label={t('Two-step verification')} value={v('require_2fa', 'false') === 'true' ? t('Required for everyone') : t('Optional')} />
      <SettingRow label={t('Single sign-on (OIDC)')} value={v('oidc_enabled', 'false') === 'true' ? t('Enabled') + ' · ' + v('oidc_issuer', '') : t('Disabled')} />
    </div>
  )
}

// ---- Global permissions ----

export function GlobalPermissionsPage() {
  const { data: settings } = useAdminSettings()
  const update = useAdminUpdateSettings()
  const { data: users } = useAdminUsers('')
  const admins = (users ?? []).filter((u) => u.isAdmin)
  const mode = settings?.create_projects_mode || 'everyone'
  const options = [
    { label: t('Everyone'), value: 'everyone' },
    { label: t('Administrators only'), value: 'admins-only' },
  ]

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Global permissions')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t("Site-wide permissions. Per-space access is managed in each space's settings (Access).")}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500 }}>{t('Create spaces')}</div>
          <div style={{ fontSize: 12, ...subtleText }}>{t('Who can create new spaces on this site.')}</div>
        </div>
        <div style={{ width: 220 }}>
          <Select
            spacing="compact"
            options={options}
            value={options.find((o) => o.value === mode)}
            onChange={(o) => o && update.mutate({ ...settings, create_projects_mode: o.value })}
          />
        </div>
      </div>
      <div style={{ padding: '10px 0' }}>
        <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{t('Administer site')}</div>
        <div style={{ fontSize: 12, marginBottom: 10, ...subtleText }}>
          {t('Site administrators — grant or remove in User management.')}
        </div>
        {admins.map((u) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 14 }}>
            <Avatar size="small" name={u.displayName} src={u.avatarUrl ?? undefined} />
            {u.displayName} <span style={subtleText}>{u.email}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Space roles (reference) ----

const ROLES: { role: string; appearance: 'inprogress' | 'default' | 'new'; caps: string }[] = [
  { role: t('Admin'), appearance: 'inprogress', caps: t('Everything a member can, plus space settings: details, access, workflow & statuses, labels, notifications, archive/delete. The space lead is always an admin.') },
  { role: t('Member'), appearance: 'default', caps: t('Create and edit work items, transition them, comment, attach files, plan sprints, watch and vote.') },
  { role: t('Viewer'), appearance: 'new', caps: t('Read-only: browse the board, backlog and work items — no edits, comments or transitions.') },
]

export function SpaceRolesPage() {
  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Space roles')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('The three roles every space uses. Assign them per space under Space settings → Access. (Custom permission schemes are on the backlog.)')}
      </p>
      {ROLES.map((r) => (
        <div key={r.role} style={{ display: 'flex', gap: 16, padding: '12px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
          <div style={{ width: 110 }}><Lozenge appearance={r.appearance} isBold>{r.role}</Lozenge></div>
          <div style={{ flex: 1, fontSize: 14 }}>{r.caps}</div>
        </div>
      ))}
    </div>
  )
}

// ---- Default user preferences ----

export function DefaultsPage() {
  const { data: settings } = useAdminSettings()
  const update = useAdminUpdateSettings()
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const current = settings ?? {}

  const LANDING = [
    { label: t('For you (your work)'), value: 'your-work' },
    { label: t('Spaces directory'), value: 'projects' },
    { label: t('Search work items'), value: 'issues' },
  ]
  const LANGS = [
    { label: t('English'), value: 'en' },
    { label: 'العربية (Arabic)', value: 'ar' },
  ]

  if (form) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 20 }}>{t('Default user preferences')}</h1>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Default time zone (IANA name, empty = browser)')}</span>
          <TextField value={form.default_timezone ?? ''} onChange={(e) => setForm({ ...form, default_timezone: e.currentTarget.value })} placeholder="Asia/Baghdad" />
        </label>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Default language')}</span>
          <Select options={LANGS} value={LANGS.find((o) => o.value === (form.default_language || 'en'))} onChange={(o) => o && setForm({ ...form, default_language: o.value })} />
        </label>
        <label style={{ display: 'block', marginBottom: 20 }}>
          <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t('Default landing page')}</span>
          <Select options={LANDING} value={LANDING.find((o) => o.value === (form.default_landing_page || 'your-work'))} onChange={(o) => o && setForm({ ...form, default_landing_page: o.value })} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button appearance="primary" isLoading={update.isPending} onClick={async () => { await update.mutateAsync(form); setForm(null) }}>{t('Save')}</Button>
          <Button appearance="subtle" onClick={() => setForm(null)}>{t('Cancel')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Default user preferences')}</h1>
        <Button onClick={() => setForm({ ...current })}>{t('Edit settings')}</Button>
      </div>
      <p style={{ fontSize: 13, ...subtleText, margin: '8px 0 4px' }}>
        {t('Applied to accounts created from now on (sign-up or invite). Existing users keep their own preferences.')}
      </p>
      <SettingRow label={t('Default time zone')} value={current.default_timezone} />
      <SettingRow label={t('Default language')} value={LANGS.find((o) => o.value === (current.default_language || 'en'))?.label} />
      <SettingRow label={t('Default landing page')} value={LANDING.find((o) => o.value === (current.default_landing_page || 'your-work'))?.label} />
    </div>
  )
}

// ---- Space categories ----

export function CategoriesPage() {
  const { data: cats } = useAdminCategories()
  const createCat = useAdminCreateCategory()
  const deleteCat = useAdminDeleteCategory()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Space categories')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Group spaces by team or product. Assign a category to each space in Manage spaces.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
      {(cats ?? []).map((c) => (
        <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, marginBottom: 6, fontSize: 14 }}>
          <span style={{ fontWeight: 500, flex: 1 }}>{c.name}</span>
          <span style={subtleText}>{c.spaceCount === 1 ? t('{n} space', { n: c.spaceCount }) : t('{n} spaces', { n: c.spaceCount })}</span>
          <Button appearance="subtle" spacing="compact" onClick={() => { setError(null); deleteCat.mutate(c.id, { onError: (e) => setError(e instanceof ApiError ? e.message : t('delete failed')) }) }}>
            {t('Delete')}
          </Button>
        </div>
      ))}
      {(cats ?? []).length === 0 && <p style={{ fontSize: 13, ...subtleText }}>{t('No categories yet.')}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <TextField placeholder={t('New category (e.g. Platform)')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </div>
        <Button
          appearance="primary"
          isDisabled={!name.trim()}
          isLoading={createCat.isPending}
          onClick={() => {
            setError(null)
            createCat.mutate(name.trim(), { onSuccess: () => setName(''), onError: (e) => setError(e instanceof ApiError ? e.message : t('create failed')) })
          }}
        >
          {t('Add category')}
        </Button>
      </div>
    </div>
  )
}

// ---- Archived spaces ----

export function ArchivedSpacesPage() {
  const { data: projects } = useAdminProjects()
  const unarchive = useAdminUnarchive()
  const archived = (projects ?? []).filter((p) => p.archivedAt)

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Archived spaces')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Hidden from the space list and search. Direct links keep working; unarchiving restores them fully.')}
      </p>
      {archived.map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, marginBottom: 6, fontSize: 14 }}>
          <Avatar appearance="square" size="small" src={p.avatarUrl ?? undefined} name={p.name} />
          <span style={{ fontWeight: 500 }}>{p.name}</span>
          <span style={subtleText}>({p.key})</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, ...subtleText }}>{t('archived {date}', { date: fmtDate(p.archivedAt!) })}</span>
          <Button spacing="compact" isLoading={unarchive.isPending} onClick={() => unarchive.mutate(p.key)}>{t('Unarchive')}</Button>
        </div>
      ))}
      {archived.length === 0 && <p style={{ fontSize: 13, ...subtleText }}>{t('No archived spaces.')}</p>}
    </div>
  )
}

// ---- Test email widget (embedded in Outgoing mail) ----

export function TestEmailWidget() {
  const testEmail = useAdminTestEmail()
  const [to, setTo] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{t('Send a test email')}</div>
      <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
        <div style={{ flex: 1 }}>
          <TextField isCompact placeholder="you@company.com" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        </div>
        <Button
          spacing="compact"
          isDisabled={!to.trim()}
          isLoading={testEmail.isPending}
          onClick={() => {
            setResult(null)
            testEmail.mutate(to.trim(), {
              onSuccess: (r) => { setFailed(false); setResult(t('Sent via {smtp} — check the inbox.', { smtp: r.smtp })) },
              onError: (e) => { setFailed(true); setResult(e instanceof ApiError ? e.message : t('sending failed')) },
            })
          }}
        >
          {t('Send test')}
        </Button>
      </div>
      {result && (
        <div style={{ marginTop: 8, fontSize: 13, color: failed ? token('color.text.danger', '#AE2E24') : token('color.text.success', '#216E4E') }}>
          {result}
        </div>
      )}
    </div>
  )
}
