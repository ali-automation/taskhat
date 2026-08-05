import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import DemoRobot from '../components/DemoRobot'
import TextField from '@atlaskit/textfield'
import Form, { ErrorMessage, Field, FormFooter } from '@atlaskit/form'
import SectionMessage from '@atlaskit/section-message'
import { token } from '@atlaskit/tokens'
import HatLogo from '../components/HatLogo'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useSiteInfo } from '../api/hooks'
import { setLanguage, t } from '../i18n'

interface FormValues {
  email: string
  password: string
  displayName?: string
}

// Login/signup card styled after Jira's (id.atlassian.com) sign-in screen.
export default function LoginPage() {
  const { login, login2FA, demoLogin, register } = useAuth()
  const { data: site } = useSiteInfo()
  const navigate = useNavigate()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [topError, setTopError] = useState<string | null>(null)
  const [mfaToken, setMfaToken] = useState<string | null>(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaPending, setMfaPending] = useState(false)

  // SSO errors come back as ?error=… from the OIDC redirect flow.
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get('error')
    if (err) setTopError(t('Single sign-on failed ({reason}). Try again or use your password.', { reason: err }))
  }, [])

  const submitMfa = async () => {
    if (!mfaToken || !mfaCode.trim()) return
    setMfaPending(true)
    setTopError(null)
    try {
      await login2FA(mfaToken, mfaCode.trim())
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !err.body.errors.code) {
        setMfaToken(null)
        setTopError(err.message)
      } else {
        setTopError(err instanceof ApiError ? (err.body.errors.code ?? err.message) : t('Something went wrong. Please try again.'))
      }
    } finally {
      setMfaPending(false)
    }
  }

  // Signed-out pages follow the site's default language.
  useEffect(() => {
    if (site?.language) setLanguage(site.language)
  }, [site?.language])

  const onSubmit = async (values: FormValues) => {
    setTopError(null)
    try {
      if (mode === 'login') {
        const result = await login(values.email, values.password)
        if (result?.requires2fa) {
          setMfaToken(result.mfaToken)
          return undefined
        }
      } else {
        await register(values.email, values.password, values.displayName ?? '')
      }
      navigate('/', { replace: true })
      return undefined
    } catch (err) {
      if (err instanceof ApiError) {
        if (Object.keys(err.body.errors).length > 0) return err.body.errors
        setTopError(err.message)
        return undefined
      }
      setTopError(t('Something went wrong. Please try again.'))
      return undefined
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
          borderRadius: 3,
          background: token('elevation.surface.raised', '#FFFFFF'),
          boxShadow: token(
            'elevation.shadow.raised',
            'rgba(0, 0, 0, 0.1) 0px 0px 10px',
          ),
          textAlign: 'center',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
          <HatLogo size={48} />
        </div>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>{site?.siteName ?? 'TaskHat'}</h1>
        <p style={{ color: token('color.text.subtlest', '#6B778C'), marginBottom: site?.introduction ? 8 : 24 }}>
          {mode === 'login' ? t('Log in to continue') : t('Sign up to continue')}
        </p>
        {site?.introduction && (
          <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F'), marginBottom: 24 }}>
            {site.introduction}
          </p>
        )}

        {topError && (
          <div style={{ marginBottom: 16, textAlign: 'left' }}>
            <SectionMessage appearance="error">{topError}</SectionMessage>
          </div>
        )}

        {mfaToken ? (
          <div style={{ textAlign: 'left' }}>
            <p style={{ fontSize: 14, marginBottom: 12 }}>{t('Enter the 6-digit code from your authenticator app, or a recovery code.')}</p>
            <TextField
              value={mfaCode}
              onChange={(e) => setMfaCode((e.target as HTMLInputElement).value)}
              placeholder="123456"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && submitMfa()}
            />
            <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
              <Button appearance="primary" shouldFitContainer isLoading={mfaPending} onClick={submitMfa}>
                {t('Verify')}
              </Button>
            </div>
            <Button appearance="subtle" spacing="compact" onClick={() => { setMfaToken(null); setMfaCode('') }}>
              ← {t('Back to password')}
            </Button>
          </div>
        ) : (
        <Form<FormValues> onSubmit={onSubmit}>
          {({ formProps, submitting }) => (
            <form {...formProps} style={{ textAlign: 'left' }}>
              <Field name="email" label={t('Email')} isRequired defaultValue="">
                {({ fieldProps, error }) => (
                  <>
                    <TextField {...fieldProps} type="email" placeholder="you@company.com" />
                    {error && <ErrorMessage>{error}</ErrorMessage>}
                  </>
                )}
              </Field>
              {mode === 'register' && (
                <Field name="displayName" label={t('Full name')} isRequired defaultValue="">
                  {({ fieldProps, error }) => (
                    <>
                      <TextField {...fieldProps} placeholder="Ada Lovelace" />
                      {error && <ErrorMessage>{error}</ErrorMessage>}
                    </>
                  )}
                </Field>
              )}
              <Field name="password" label={t('Password')} isRequired defaultValue="">
                {({ fieldProps, error }) => (
                  <>
                    <TextField {...fieldProps} type="password" placeholder="••••••••" />
                    {error && <ErrorMessage>{error}</ErrorMessage>}
                  </>
                )}
              </Field>
              <FormFooter>
                <Button type="submit" appearance="primary" isLoading={submitting} shouldFitContainer>
                  {mode === 'login' ? t('Log in') : t('Sign up')}
                </Button>
              </FormFooter>
            </form>
          )}
        </Form>
        )}

        {!mfaToken && site?.demoMode && (
          <div style={{ marginTop: 16 }}>
            <Button
              shouldFitContainer
              onClick={() => {
                setTopError(null)
                demoLogin()
                  .then(() => navigate('/', { replace: true }))
                  .catch(() => setTopError(t('Could not start the demo — try again in a minute.')))
              }}
            >
              {t('Explore the live demo')}
            </Button>
            <p style={{ fontSize: 12, color: token('color.text.subtlest', '#6B778C'), marginTop: 6, textAlign: 'center' }}>
              {t('Instant read-only access with sample data — no signup.')}
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
              <DemoRobot height={64} width={304} stack />
            </div>
          </div>
        )}

        {!mfaToken && site?.ssoEnabled && (
          <div style={{ marginTop: 16 }}>
            <Button shouldFitContainer onClick={() => { window.location.href = '/api/v1/auth/oidc/start' }}>
              {site.ssoLabel || t('Continue with SSO')}
            </Button>
          </div>
        )}

        {!mfaToken && site?.registrationMode !== 'invite-only' && (
          <div style={{ marginTop: 24, borderTop: `1px solid ${token('color.border', '#DFE1E6')}`, paddingTop: 16 }}>
            <Button
              appearance="subtle"
              onClick={() => {
                setTopError(null)
                setMode(mode === 'login' ? 'register' : 'login')
              }}
            >
              {mode === 'login' ? t('Create an account') : t('Already have an account? Log in')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
