import { useEffect, useState } from 'react'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import TextField from '@atlaskit/textfield'
import { Field, HelperMessage } from '@atlaskit/form'
import { token } from '@atlaskit/tokens'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiBlob, ApiError } from '../api/client'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function useTwoFA() {
  return useQuery({ queryKey: ['2fa'], queryFn: () => api<{ enabled: boolean; required: boolean }>('/account/2fa') })
}

// The enrollment QR is behind auth, so fetch it as a blob.
function QRImage() {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let obj: string | null = null
    apiBlob('/account/2fa/qr').then((blob) => {
      obj = URL.createObjectURL(blob)
      setUrl(obj)
    })
    return () => {
      if (obj) URL.revokeObjectURL(obj)
    }
  }, [])
  return url ? <img src={url} width={200} height={200} alt={t('Scan with your authenticator app')} /> : <div style={{ width: 200, height: 200 }} />
}

function SetupModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)

  useEffect(() => {
    api<{ secret: string }>('/account/2fa/setup', { method: 'POST', body: '{}' }).then((r) => setSecret(r.secret))
  }, [])

  const enable = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/account/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
    onSuccess: (r) => {
      setRecoveryCodes(r.recoveryCodes)
      qc.invalidateQueries({ queryKey: ['2fa'] })
    },
    onError: (e) => setError(e instanceof ApiError ? (e.body.errors.code ?? e.message) : t('Something went wrong')),
  })

  return (
    <ModalTransition>
      <Modal onClose={recoveryCodes ? undefined : onClose} width="small">
        <ModalHeader>
          <ModalTitle>{recoveryCodes ? t('Save your recovery codes') : t('Set up two-step verification')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {recoveryCodes ? (
            <>
              <SectionMessage appearance="warning" title={t('These are shown only once')}>
                <p>{t('Each code signs you in once if you lose your authenticator. Store them somewhere safe.')}</p>
              </SectionMessage>
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '14px 0',
                fontFamily: 'monospace', fontSize: 14,
              }}>
                {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
              </div>
              <Button onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>{t('Copy codes')}</Button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 14 }}>{t('Scan the QR code with any authenticator app (Google Authenticator, 1Password, Authy…), then enter the 6-digit code it shows.')}</p>
              {secret && (
                <div style={{ textAlign: 'center', margin: '8px 0' }}>
                  <QRImage />
                  <div style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', ...subtleText }}>{secret}</div>
                </div>
              )}
              <Field name="code" label={t('Verification code')} isRequired>
                {() => (
                  <>
                    <TextField value={code} onChange={(e) => setCode((e.target as HTMLInputElement).value)} placeholder="123456" autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && enable.mutate()} />
                    {error && <HelperMessage>{error}</HelperMessage>}
                  </>
                )}
              </Field>
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {recoveryCodes ? (
            <Button appearance="primary" onClick={onClose}>{t('Done')}</Button>
          ) : (
            <>
              <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
              <Button appearance="primary" isLoading={enable.isPending} isDisabled={code.trim().length < 6} onClick={() => enable.mutate()}>
                {t('Turn on')}
              </Button>
            </>
          )}
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

function DisableModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const disable = useMutation({
    mutationFn: () => api('/account/2fa/disable', { method: 'POST', body: JSON.stringify({ password, code }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['2fa'] })
      onClose()
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Something went wrong')),
  })
  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader><ModalTitle>{t('Turn off two-step verification')}</ModalTitle></ModalHeader>
        <ModalBody>
          <Field name="password" label={t('Password')} isRequired>
            {() => <TextField type="password" value={password} onChange={(e) => setPassword((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field name="code" label={t('Authenticator or recovery code')} isRequired>
            {() => <TextField value={code} onChange={(e) => setCode((e.target as HTMLInputElement).value)} />}
          </Field>
          {error && <p style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 13 }}>{error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button appearance="danger" isLoading={disable.isPending} onClick={() => disable.mutate()}>{t('Turn off')}</Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// The "Two-step verification" block on the account Security tab.
export function TwoFactorSection() {
  const { data } = useTwoFA()
  const [setup, setSetup] = useState(false)
  const [disabling, setDisabling] = useState(false)
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 16, marginBottom: 4 }}>
        {t('Two-step verification')}{' '}
        {data?.enabled ? <Lozenge appearance="success">{t('On')}</Lozenge> : <Lozenge>{t('Off')}</Lozenge>}
      </h3>
      <p style={{ fontSize: 13, marginBottom: 10, ...subtleText }}>
        {t('A 6-digit code from your authenticator app is required when signing in.')}
        {data?.required && !data.enabled && (
          <> <Lozenge appearance="moved">{t('Required by your administrator')}</Lozenge></>
        )}
      </p>
      {data?.enabled ? (
        <Button onClick={() => setDisabling(true)}>{t('Turn off')}</Button>
      ) : (
        <Button appearance="primary" onClick={() => setSetup(true)}>{t('Set up')}</Button>
      )}
      {setup && <SetupModal onClose={() => setSetup(false)} />}
      {disabling && <DisableModal onClose={() => setDisabling(false)} />}
    </div>
  )
}
