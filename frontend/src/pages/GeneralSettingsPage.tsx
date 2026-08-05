import { useState } from 'react'
import Button from '@atlaskit/button/new'
import Select from '@atlaskit/select'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useAccount, useUpdatePreferences } from '../api/hooks'
import { applyTheme, type ThemeChoice } from '../theme'
import { setLanguage, t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const LANGUAGES = [
  { label: 'English', value: 'en' },
  { label: 'العربية (Arabic)', value: 'ar' },
]
const THEMES = () => [
  { label: t('Light'), value: 'light' },
  { label: t('Dark'), value: 'dark' },
  { label: t('Match browser'), value: 'auto' },
]
const LANDING = () => [
  { label: t('For you (your work)'), value: 'your-work' },
  { label: t('Spaces'), value: 'projects' },
  { label: t('All work (search)'), value: 'issues' },
]

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18, maxWidth: 420 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: token('color.text.subtle', '#44546F'), marginBottom: 4 }}>
        {label}
      </div>
      {children}
      {hint && <div style={{ fontSize: 12, ...subtleText, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// Jira's personal "General settings" page: language, time zone, theme, landing.
export default function GeneralSettingsPage() {
  const { data: profile } = useAccount()
  const updatePrefs = useUpdatePreferences()
  const [saved, setSaved] = useState(false)
  const [form, setForm] = useState<{ language: string; timezone: string; theme: string; landingPage: string } | null>(null)

  if (!profile) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>
  }
  const value = form ?? {
    language: profile.language || 'en',
    timezone: profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    theme: profile.theme || 'light',
    landingPage: profile.landingPage || 'your-work',
  }
  const set = (patch: Partial<typeof value>) => {
    setSaved(false)
    setForm({ ...value, ...patch })
  }

  const timezones = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']
  const tzOptions = timezones.map((tz) => ({ label: tz, value: tz }))

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('General settings')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 24 }}>
        {t('Manage language, time zone, and other personal preferences. These follow you on any device.')}
      </p>

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>{t('Language and region')}</h3>
      <Row label={t('Language')} hint={t('TaskHat is available in English and Arabic; changing this reloads the app.')}>
        <Select
          options={LANGUAGES}
          value={LANGUAGES.find((o) => o.value === value.language) ?? LANGUAGES[0]}
          onChange={(o) => o && set({ language: o.value })}
        />
      </Row>
      <Row label={t('Time zone')} hint={t('Used for dates and times shown across TaskHat.')}>
        <Select
          options={tzOptions}
          value={{ label: value.timezone, value: value.timezone }}
          onChange={(o) => o && set({ timezone: o.value })}
        />
      </Row>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px' }}>{t('Appearance')}</h3>
      <Row label={t('Theme')}>
        <Select
          options={THEMES()}
          value={THEMES().find((o) => o.value === value.theme) ?? THEMES()[0]}
          onChange={(o) => o && set({ theme: o.value })}
        />
      </Row>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '24px 0 12px' }}>{t('Navigation')}</h3>
      <Row label={t('Default landing page')} hint={t('Where the TaskHat logo and login take you.')}>
        <Select
          options={LANDING()}
          value={LANDING().find((o) => o.value === value.landingPage) ?? LANDING()[0]}
          onChange={(o) => o && set({ landingPage: o.value })}
        />
      </Row>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 24 }}>
        <Button
          appearance="primary"
          isDisabled={!form}
          isLoading={updatePrefs.isPending}
          onClick={async () => {
            await updatePrefs.mutateAsync(value)
            applyTheme(value.theme as ThemeChoice)
            setForm(null)
            setSaved(true)
            setLanguage(value.language)
          }}
        >
          {t('Save')}
        </Button>
        {saved && <span style={{ fontSize: 13, color: token('color.text.success', '#216E4E') }}>{t('Saved')} ✓</span>}
      </div>
    </div>
  )
}
