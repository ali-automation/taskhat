import { useEffect, useRef, useState } from 'react'
import { TwoFactorSection } from '../components/TwoFactor'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import Select from '@atlaskit/select'
import SectionMessage from '@atlaskit/section-message'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import {
  useAccount,
  useDeleteUserImage,
  useRevokeSession,
  useSessions,
  useUpdateEmail,
  useUpdatePassword,
  useUpdatePreferences,
  useUpdateProfile,
  useUploadUserImage,
} from '../api/hooks'
import { ApiError } from '../api/client'
import { t, fmtDateTime } from '../i18n'
import { applyTheme, type ThemeChoice } from '../theme'
import type { Profile } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

type Tab = 'profile' | 'email' | 'security' | 'preferences'

const TABS: { key: Tab; label: string }[] = [
  { key: 'profile', label: t('Profile and visibility') },
  { key: 'email', label: t('Email') },
  { key: 'security', label: t('Security') },
  { key: 'preferences', label: t('Account preferences') },
]

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 14 }}>
      <span style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{label}</span>
      {children}
    </label>
  )
}

function ProfileTab({ profile }: { profile: Profile }) {
  const updateProfile = useUpdateProfile()
  const uploadAvatar = useUploadUserImage('avatar')
  const uploadHeader = useUploadUserImage('header')
  const deleteHeader = useDeleteUserImage('header')
  const avatarInput = useRef<HTMLInputElement>(null)
  const headerInput = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    displayName: profile.displayName,
    publicName: profile.publicName,
    jobTitle: profile.jobTitle,
    department: profile.department,
    organization: profile.organization,
    location: profile.location,
  })
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setForm({
      displayName: profile.displayName,
      publicName: profile.publicName,
      jobTitle: profile.jobTitle,
      department: profile.department,
      organization: profile.organization,
      location: profile.location,
    })
  }, [profile])

  const set = (k: keyof typeof form) => (e: React.FormEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.currentTarget.value })

  return (
    <div>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t('Profile and visibility')}</h2>
      <p style={{ fontSize: 13, marginBottom: 20, ...subtleText }}>
        {t('Manage your personal information, and control what other people see.')}
      </p>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Profile photo and header image')}</div>
      <div
        style={{
          borderRadius: 8,
          overflow: 'hidden',
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          marginBottom: 24,
        }}
      >
        <div
          onClick={() => headerInput.current?.click()}
          title={t('Change header image')}
          style={{
            height: 128,
            cursor: 'pointer',
            background: profile.headerUrl
              ? `url(${profile.headerUrl}) center/cover`
              : 'linear-gradient(90deg, #FFAB00, #FFE380)',
            position: 'relative',
          }}
        >
          {(uploadHeader.isPending || uploadAvatar.isPending) && (
            <span style={{ position: 'absolute', right: 12, top: 12 }}>
              <Spinner />
            </span>
          )}
        </div>
        <div style={{ padding: '0 24px 16px', display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div
            onClick={() => avatarInput.current?.click()}
            title={t('Change profile photo')}
            style={{ marginTop: -48, cursor: 'pointer', borderRadius: '50%', border: `4px solid ${token('elevation.surface', '#FFFFFF')}` }}
          >
            <Avatar size="xxlarge" name={profile.displayName} src={profile.avatarUrl ?? undefined} />
          </div>
          <div style={{ fontSize: 12, paddingBottom: 8, ...subtleText }}>
            {t('Click the photo or header to upload a new image (max 5 MB).')}
            {profile.headerUrl && (
              <>
                {' '}
                <button
                  type="button"
                  onClick={() => deleteHeader.mutate()}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: token('color.link', '#0C66E4'), padding: 0, fontSize: 12 }}
                >
                  {t('Remove header')}
                </button>
              </>
            )}
          </div>
        </div>
        <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && uploadAvatar.mutate(e.currentTarget.files[0])} />
        <input ref={headerInput} type="file" accept="image/*" hidden onChange={(e) => e.currentTarget.files?.[0] && uploadHeader.mutate(e.currentTarget.files[0])} />
      </div>

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('About you')}</div>
      <div style={{ maxWidth: 440 }}>
        <FieldBlock label={t('Full name')}><TextField value={form.displayName} onChange={set('displayName')} /></FieldBlock>
        <FieldBlock label={t('Public name')}><TextField value={form.publicName} onChange={set('publicName')} placeholder={profile.displayName} /></FieldBlock>
        <FieldBlock label={t('Job title')}><TextField value={form.jobTitle} onChange={set('jobTitle')} placeholder={t('e.g. DevOps engineer')} /></FieldBlock>
        <FieldBlock label={t('Department')}><TextField value={form.department} onChange={set('department')} /></FieldBlock>
        <FieldBlock label={t('Organization')}><TextField value={form.organization} onChange={set('organization')} /></FieldBlock>
        <FieldBlock label={t('Based in')}><TextField value={form.location} onChange={set('location')} placeholder={t('e.g. Baghdad, Iraq')} /></FieldBlock>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            appearance="primary"
            isLoading={updateProfile.isPending}
            onClick={async () => {
              await updateProfile.mutateAsync(form)
              setSaved(true)
              setTimeout(() => setSaved(false), 2500)
            }}
          >
            {t('Save changes')}
          </Button>
          {saved && <span style={{ fontSize: 13, color: token('color.text.success', '#216E4E') }}>{t('Saved ✓')}</span>}
        </div>
      </div>
    </div>
  )
}

function EmailTab({ profile }: { profile: Profile }) {
  const updateEmail = useUpdateEmail()
  const [email, setEmail] = useState(profile.email)
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div style={{ maxWidth: 440 }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t('Email')}</h2>
      <p style={{ fontSize: 13, marginBottom: 20, ...subtleText }}>
        {t('Your email address is used to log in and receive notifications.')}
      </p>
      <FieldBlock label={t('Email address')}><TextField value={email} onChange={(e) => setEmail(e.currentTarget.value)} /></FieldBlock>
      <FieldBlock label={t('Current password')}><TextField type="password" value={password} onChange={(e) => setPassword(e.currentTarget.value)} /></FieldBlock>
      {msg && (
        <div style={{ marginBottom: 12 }}>
          <SectionMessage appearance={msg.ok ? 'success' : 'error'}>{msg.text}</SectionMessage>
        </div>
      )}
      <Button
        appearance="primary"
        isLoading={updateEmail.isPending}
        onClick={async () => {
          setMsg(null)
          try {
            await updateEmail.mutateAsync({ email, currentPassword: password })
            setPassword('')
            setMsg({ ok: true, text: t('Email updated.') })
          } catch (err) {
            setMsg({ ok: false, text: err instanceof ApiError ? Object.values(err.body.errors)[0] ?? err.message : t('failed') })
          }
        }}
      >
        {t('Save')}
      </Button>
    </div>
  )
}

function browserFromUA(ua: string): string {
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('OPR/')) return 'Opera'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Safari/')) return 'Safari'
  if (ua.includes('curl')) return 'curl'
  return t('Unknown browser')
}

function osFromUA(ua: string): string {
  if (ua.includes('Windows')) return 'Windows'
  if (ua.includes('Mac OS')) return 'macOS'
  if (ua.includes('Android')) return 'Android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS'
  if (ua.includes('Linux')) return 'Linux'
  return ''
}

function SecurityTab() {
  const updatePassword = useUpdatePassword()
  const { data: sessions } = useSessions()
  const revoke = useRevokeSession()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  return (
    <div style={{ maxWidth: 620 }}>
      <h2 style={{ fontSize: 20, marginBottom: 20 }}>{t('Security')}</h2>
      <TwoFactorSection />

      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Change password')}</div>
      <div style={{ maxWidth: 440 }}>
        <FieldBlock label={t('Current password')}><TextField type="password" value={current} onChange={(e) => setCurrent(e.currentTarget.value)} /></FieldBlock>
        <FieldBlock label={t('New password (min 8 characters)')}><TextField type="password" value={next} onChange={(e) => setNext(e.currentTarget.value)} /></FieldBlock>
        {msg && (
          <div style={{ marginBottom: 12 }}>
            <SectionMessage appearance={msg.ok ? 'success' : 'error'}>{msg.text}</SectionMessage>
          </div>
        )}
        <Button
          appearance="primary"
          isLoading={updatePassword.isPending}
          onClick={async () => {
            setMsg(null)
            try {
              await updatePassword.mutateAsync({ currentPassword: current, newPassword: next })
              setCurrent('')
              setNext('')
              setMsg({ ok: true, text: t('Password changed. All other sessions have been logged out.') })
            } catch (err) {
              setMsg({ ok: false, text: err instanceof ApiError ? Object.values(err.body.errors)[0] ?? err.message : t('failed') })
            }
          }}
        >
          {t('Change password')}
        </Button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '28px 0 8px' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('Active sessions')}</span>
        <Button appearance="subtle" spacing="compact" onClick={() => revoke.mutate(null)}>
          {t('Log out all other sessions')}
        </Button>
      </div>
      <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8 }}>
        {(sessions?.values ?? []).map((s) => (
          <div
            key={s.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 14px',
              borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`,
              fontSize: 13,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>
                {browserFromUA(s.userAgent)}
                {osFromUA(s.userAgent) && ` · ${osFromUA(s.userAgent)}`}{' '}
                {s.current && (
                  <span style={{ color: token('color.text.success', '#216E4E'), fontWeight: 600, fontSize: 12 }}>
                    {t('(this session)')}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, ...subtleText }}>
                {s.ip} · {t('last active {date}', { date: fmtDateTime(s.lastSeenAt) })}
              </div>
            </div>
            {!s.current && (
              <Button appearance="subtle" spacing="compact" onClick={() => revoke.mutate(s.id)}>
                {t('Revoke')}
              </Button>
            )}
          </div>
        ))}
        {(sessions?.values ?? []).length === 0 && (
          <div style={{ padding: 14, fontSize: 13, ...subtleText }}>{t('No active sessions.')}</div>
        )}
      </div>
      <p style={{ fontSize: 12, marginTop: 8, ...subtleText }}>
        {t('Revoked sessions can keep a valid access token for up to 15 minutes.')}
      </p>
    </div>
  )
}

function PreferencesTab({ profile }: { profile: Profile }) {
  const updatePrefs = useUpdatePreferences()
  const timezones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']
  const tzOptions = timezones.map((tz) => ({ label: tz, value: tz }))
  const themeOptions = [
    { label: t('Light'), value: 'light' },
    { label: t('Dark'), value: 'dark' },
    { label: t('Match browser'), value: 'auto' },
  ]
  const [tz, setTz] = useState(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [theme, setTheme] = useState(profile.theme || 'light')
  const [saved, setSaved] = useState(false)

  return (
    <div style={{ maxWidth: 440 }}>
      <h2 style={{ fontSize: 20, marginBottom: 4 }}>{t('Account preferences')}</h2>
      <p style={{ fontSize: 13, marginBottom: 20, ...subtleText }}>
        {t('These preferences follow you on any device you log in from.')}
      </p>
      <FieldBlock label={t('Timezone')}>
        <Select
          options={tzOptions}
          value={{ label: tz, value: tz }}
          onChange={(v) => v && setTz(v.value)}
        />
      </FieldBlock>
      <FieldBlock label={t('Theme')}>
        <Select
          options={themeOptions}
          value={themeOptions.find((o) => o.value === theme) ?? themeOptions[0]}
          onChange={(v) => v && setTheme(v.value)}
        />
      </FieldBlock>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button
          appearance="primary"
          isLoading={updatePrefs.isPending}
          onClick={async () => {
            await updatePrefs.mutateAsync({ timezone: tz, theme })
            applyTheme(theme as ThemeChoice)
            setSaved(true)
            setTimeout(() => setSaved(false), 2500)
          }}
        >
          {t('Save')}
        </Button>
        {saved && <span style={{ fontSize: 13, color: token('color.text.success', '#216E4E') }}>{t('Saved ✓')}</span>}
      </div>
    </div>
  )
}

export default function AccountPage() {
  const { data: profile, isLoading } = useAccount()
  const [tab, setTab] = useState<Tab>('profile')

  if (isLoading || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>{t('Account')}</h1>
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, marginBottom: 24 }}>
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '8px 10px',
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
              color: tab === key ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
              boxShadow: tab === key ? `inset 0 -2px 0 ${token('color.border.selected', '#0C66E4')}` : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'profile' && <ProfileTab profile={profile} />}
      {tab === 'email' && <EmailTab profile={profile} />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'preferences' && <PreferencesTab profile={profile} />}
    </div>
  )
}
