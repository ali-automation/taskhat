import { useState } from 'react'
import Button from '@atlaskit/button/new'
import SectionMessage from '@atlaskit/section-message'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { useAPITokens, useCreateAPIToken, useRevokeAPIToken } from '../api/hooks'
import { t, fmtDate, fmtDateTime } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Personal API tokens, modeled on Atlassian's id.atlassian.com token page.
export default function ApiTokensPage() {
  const { data: tokens } = useAPITokens()
  const createToken = useCreateAPIToken()
  const revokeToken = useRevokeAPIToken()
  const [label, setLabel] = useState('')
  const [minted, setMinted] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('API tokens')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Use a token instead of your password for scripts and CI:')}{' '}
        <code>curl -H "Authorization: Bearer tk_…" {window.location.origin}/api/v1/me</code>
      </p>

      {minted && (
        <div style={{ marginBottom: 16 }}>
          <SectionMessage appearance="success" title={t('Copy your token now — it will not be shown again')}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{minted}</code>
              <Button
                spacing="compact"
                onClick={() => {
                  navigator.clipboard?.writeText(minted)
                  setCopied(true)
                }}
              >
                {copied ? t('Copied!') : t('Copy')}
              </Button>
            </div>
          </SectionMessage>
        </div>
      )}

      {(tokens ?? []).map((tok) => (
        <div key={tok.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, marginBottom: 6, fontSize: 14 }}>
          <span style={{ fontWeight: 500, width: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tok.label}</span>
          <code style={{ fontSize: 12, ...subtleText }}>{tok.prefix}…</code>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, ...subtleText }}>
            {t('created {date}', { date: fmtDate(tok.createdAt) })} ·{' '}
            {tok.lastUsedAt ? t('last used {date}', { date: fmtDateTime(tok.lastUsedAt) }) : t('never used')}
          </span>
          <Button appearance="subtle" spacing="compact" onClick={() => revokeToken.mutate(tok.id)}>
            {t('Revoke')}
          </Button>
        </div>
      ))}
      {(tokens ?? []).length === 0 && <p style={{ fontSize: 13, marginBottom: 8, ...subtleText }}>{t('No tokens yet.')}</p>}

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <TextField placeholder={t('Label (e.g. CI pipeline)')} value={label} onChange={(e) => setLabel(e.currentTarget.value)} />
        </div>
        <Button
          appearance="primary"
          isDisabled={!label.trim()}
          isLoading={createToken.isPending}
          onClick={() =>
            createToken.mutate(label.trim(), {
              onSuccess: (r) => {
                setMinted(r.token)
                setCopied(false)
                setLabel('')
              },
            })
          }
        >
          {t('Create token')}
        </Button>
      </div>
    </div>
  )
}
