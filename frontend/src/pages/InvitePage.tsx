import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import SectionMessage from '@atlaskit/section-message'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { api, ApiError, setAccessToken } from '../api/client'
import type { AuthResponse } from '../api/client'
import { t } from '../i18n'

// Public invite-acceptance page: set a password, claim the account, land in the app.
export default function InvitePage() {
  const { token: inviteToken } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [info, setInfo] = useState<{ email: string; existingUser: boolean; displayName: string } | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!inviteToken) return
    api<{ email: string; existingUser: boolean; displayName: string }>(`/auth/invite/${inviteToken}`)
      .then((i) => {
        setInfo(i)
        setDisplayName(i.displayName)
      })
      .catch(() => setInvalid(true))
  }, [inviteToken])

  const accept = async () => {
    setError(null)
    setBusy(true)
    try {
      const auth = await api<AuthResponse>('/auth/accept-invite', {
        method: 'POST',
        body: JSON.stringify({ token: inviteToken, displayName, password }),
      })
      setAccessToken(auth.accessToken)
      window.location.href = '/' // full reload so AuthProvider bootstraps from the cookie
    } catch (err) {
      setError(err instanceof ApiError ? Object.values(err.body.errors)[0] ?? err.message : t('failed to accept invite'))
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token('color.background.neutral.subtle', '#FAFBFC'),
      }}
    >
      <div
        style={{
          width: 400,
          padding: 48,
          borderRadius: 8,
          background: token('elevation.surface.raised', '#FFFFFF'),
          boxShadow: token('elevation.shadow.raised', 'rgba(0,0,0,0.1) 0 0 10px'),
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>🎩 TaskHat</h1>
        {invalid ? (
          <SectionMessage appearance="warning" title={t('Invalid invite')}>
            {t('This invite link is invalid or has expired. Ask your administrator for a new one.')}
          </SectionMessage>
        ) : !info ? (
          <Spinner size="large" />
        ) : (
          <>
            <p style={{ color: token('color.text.subtlest', '#626F86'), marginBottom: 20 }}>
              {t("You've been invited as")} <strong>{info.email}</strong>
              {info.existingUser && t(' — set a password to take over this account.')}
            </p>
            <div style={{ textAlign: 'left' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: token('color.text.subtlest', '#626F86') }}>
                {t('Full name')}
              </label>
              <TextField value={displayName} onChange={(e) => setDisplayName(e.currentTarget.value)} placeholder={t('Your name')} />
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, margin: '14px 0 4px', color: token('color.text.subtlest', '#626F86') }}>
                {t('Choose a password (min 8 characters)')}
              </label>
              <TextField
                type="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && accept()}
              />
              {error && (
                <div style={{ marginTop: 12 }}>
                  <SectionMessage appearance="error">{error}</SectionMessage>
                </div>
              )}
              <div style={{ marginTop: 18 }}>
                <Button appearance="primary" shouldFitContainer isLoading={busy} onClick={accept}>
                  {t('Accept invite')}
                </Button>
              </div>
              <div style={{ marginTop: 12, textAlign: 'center' }}>
                <Button appearance="subtle" onClick={() => navigate('/login')}>
                  {t('Already have an account? Log in')}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
