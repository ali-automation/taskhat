import Spinner from '@atlaskit/spinner'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { useUserNotifyPrefs, useUpdateUserNotifyPrefs } from '../api/hooks'
import { t } from '../i18n'
import type { UserNotifyPrefs } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const KINDS: { key: string; label: string; hint: string }[] = [
  { key: 'created', label: t('Work item created'), hint: t('A work item you watch is created (e.g. in a space you follow).') },
  { key: 'transitioned', label: t('Status changes'), hint: t('A work item you watch moves between statuses.') },
  { key: 'updated', label: t('Field updates'), hint: t('Fields change on a work item you watch.') },
  { key: 'comment', label: t('Comments'), hint: t('Someone comments on a work item you watch.') },
  { key: 'mention', label: t('Mentions'), hint: t('Someone @mentions you. Recommended to keep on.') },
]

// Jira's personal "Notification settings": per-event in-app and email switches.
export default function NotificationSettingsPage() {
  const { data: prefs } = useUserNotifyPrefs()
  const update = useUpdateUserNotifyPrefs()

  if (!prefs) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>
  }

  const emailEnabled = prefs.emailEnabled ?? true
  const kindValue = (kind: string, channel: 'inapp' | 'email') => prefs.kinds?.[kind]?.[channel] ?? true

  const save = (next: UserNotifyPrefs) => update.mutate(next)

  const setGlobalEmail = (on: boolean) => save({ ...prefs, emailEnabled: on })

  const setKind = (kind: string, channel: 'inapp' | 'email', on: boolean) => {
    const kinds = { ...(prefs.kinds ?? {}) }
    kinds[kind] = { ...(kinds[kind] ?? {}), [channel]: on }
    save({ ...prefs, kinds })
  }

  const cell = { width: 90, display: 'flex', justifyContent: 'center' } as const

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Notification settings')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 24 }}>
        {t('Manage email and in-app notifications from TaskHat. Space admins can additionally mute email per event for their space — the strictest setting wins.')}
      </p>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          borderRadius: 8,
          marginBottom: 24,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{t('Email notifications')}</div>
          <div style={{ fontSize: 13, ...subtleText }}>
            {t('Master switch — turn off to stop all notification email, including mentions.')}
          </div>
        </div>
        <Toggle size="large" isChecked={emailEnabled} onChange={() => setGlobalEmail(!emailEnabled)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', padding: '0 16px 8px' }}>
        <div style={{ flex: 1, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, ...subtleText }}>
          {t("You're watching")}
        </div>
        <div style={{ ...cell, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, ...subtleText }}>
          {t('In-app')}
        </div>
        <div style={{ ...cell, fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, ...subtleText }}>
          {t('Email')}
        </div>
      </div>

      <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8 }}>
        {KINDS.map(({ key, label, hint }, i) => (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : `1px solid ${token('color.border', '#DFE1E6')}`,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
              <div style={{ fontSize: 13, ...subtleText }}>{hint}</div>
            </div>
            <div style={cell}>
              <Toggle isChecked={kindValue(key, 'inapp')} onChange={() => setKind(key, 'inapp', !kindValue(key, 'inapp'))} />
            </div>
            <div style={cell}>
              <Toggle
                isChecked={emailEnabled && kindValue(key, 'email')}
                isDisabled={!emailEnabled}
                onChange={() => setKind(key, 'email', !kindValue(key, 'email'))}
              />
            </div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 12, ...subtleText, marginTop: 12 }}>
        {t('Turning off “In-app” for an event also stops its email — no notification is produced at all.')}
      </p>
    </div>
  )
}
