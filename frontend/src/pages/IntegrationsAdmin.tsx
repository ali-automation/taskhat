import { useState } from 'react'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAdminCreateWebhook, useAdminDeleteWebhook, useAdminUpdateWebhook, useAdminWebhooks,
  useProjects, useWebhookDeliveries,
} from '../api/hooks'
import type { Webhook } from '../api/types'
import { t, fmtDateTime } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const EVENT_OPTIONS = [
  { label: t('All events (*)'), value: '*' },
  { label: t('Work item created'), value: 'issue.created' },
  { label: t('Work item updated'), value: 'issue.updated' },
  { label: t('Status changed'), value: 'issue.transitioned' },
  { label: t('Work item deleted'), value: 'issue.deleted' },
  { label: t('Comment added'), value: 'comment.added' },
  { label: t('Space created'), value: 'project.created' },
  { label: t('Work item linked'), value: 'issue.linked' },
  { label: t('Sprint started'), value: 'sprint.started' },
  { label: t('Sprint completed'), value: 'sprint.completed' },
]

function DeliveriesPanel({ hookId }: { hookId: string }) {
  const { data: deliveries } = useWebhookDeliveries(hookId)
  return (
    <div style={{ padding: '8px 12px', borderTop: `1px dashed ${token('color.border', '#DFE1E6')}` }}>
      {(deliveries ?? []).length === 0 && <span style={{ fontSize: 13, ...subtleText }}>{t('No deliveries yet — trigger a matching event.')}</span>}
      {(deliveries ?? []).map((d) => (
        <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0', fontSize: 13 }}>
          <span style={{ width: 150, whiteSpace: 'nowrap', ...subtleText }}>{fmtDateTime(d.createdAt)}</span>
          <span style={{ width: 140 }}>{d.eventType}</span>
          <span style={{ width: 90 }}>{d.summary}</span>
          <Lozenge appearance={d.status >= 200 && d.status < 300 ? 'success' : 'removed'}>
            {d.status === 0 ? t('network error') : t('HTTP {status}', { status: d.status })}
          </Lozenge>
          <span style={subtleText}>
            {d.attempts === 1 ? t('{n} attempt', { n: d.attempts }) : t('{n} attempts', { n: d.attempts })}
          </span>
          {d.error && <span style={{ color: token('color.text.danger', '#AE2E24'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.error}</span>}
        </div>
      ))}
    </div>
  )
}

export function WebhooksAdmin() {
  const { data: hooks } = useAdminWebhooks()
  const { data: projects } = useProjects()
  const createHook = useAdminCreateWebhook()
  const updateHook = useAdminUpdateWebhook()
  const deleteHook = useAdminDeleteWebhook()
  const [error, setError] = useState<string | null>(null)
  const [openDeliveries, setOpenDeliveries] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<readonly { label: string; value: string }[]>([EVENT_OPTIONS[0]])
  const [scope, setScope] = useState<string | null>(null)

  const scopeOptions = [
    { label: t('All spaces'), value: '' },
    ...(projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key })),
  ]

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))

  const toggle = (h: Webhook) => {
    setError(null)
    updateHook.mutate(
      { id: h.id, name: h.name, url: h.url, events: h.events, projectKey: h.projectKey, isEnabled: !h.isEnabled, secret: null },
      { onError: fail },
    )
  }

  return (
    <div style={{ maxWidth: 960 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Webhooks')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('POST domain events to other tools as JSON. With a secret set, every request carries')}{' '}
        <code>X-TaskHat-Signature: sha256=HMAC-SHA256(secret, body)</code>. {t('Failed deliveries retry 3 times; the last 200 deliveries per webhook are kept below.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}

      {(hooks ?? []).map((h) => (
        <div key={h.id} style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', fontSize: 14 }}>
            <span style={{ fontWeight: 600, width: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
            <code style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...subtleText }}>{h.url}</code>
            <span style={{ display: 'flex', gap: 4 }}>
              {h.events.map((e) => <Lozenge key={e}>{e}</Lozenge>)}
            </span>
            <Lozenge appearance={h.projectKey ? 'default' : 'new'}>{h.projectKey ?? t('All spaces')}</Lozenge>
            {h.hasSecret && <Lozenge appearance="inprogress">{t('Signed')}</Lozenge>}
            <Toggle isChecked={h.isEnabled} onChange={() => toggle(h)} />
            <Button appearance="subtle" spacing="compact" onClick={() => setOpenDeliveries(openDeliveries === h.id ? null : h.id)}>
              {openDeliveries === h.id ? t('Hide deliveries') : t('Deliveries')}
            </Button>
            <Button appearance="subtle" spacing="compact" onClick={() => { setError(null); deleteHook.mutate(h.id, { onError: fail }) }}>
              {t('Delete')}
            </Button>
          </div>
          {openDeliveries === h.id && <DeliveriesPanel hookId={h.id} />}
        </div>
      ))}
      {(hooks ?? []).length === 0 && <p style={{ fontSize: 13, marginBottom: 8, ...subtleText }}>{t('No webhooks yet.')}</p>}

      <div style={{ marginTop: 20, borderTop: `1px solid ${token('color.border', '#DFE1E6')}`, paddingTop: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>{t('Add webhook')}</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 180 }}>
            <TextField placeholder={t('Name (e.g. Slack bridge)')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 240 }}>
            <TextField placeholder="https://example.com/hooks/taskhat" value={url} onChange={(e) => setUrl(e.currentTarget.value)} />
          </div>
          <div style={{ width: 170 }}>
            <TextField placeholder={t('Secret (optional)')} value={secret} onChange={(e) => setSecret(e.currentTarget.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <Select
              isMulti
              options={EVENT_OPTIONS}
              value={events}
              onChange={(v) => setEvents(v)}
              placeholder={t('Events')}
            />
          </div>
          <div style={{ width: 200 }}>
            <Select
              options={scopeOptions}
              value={scopeOptions.find((o) => o.value === (scope ?? '')) ?? scopeOptions[0]}
              onChange={(o) => setScope(o && o.value !== '' ? o.value : null)}
            />
          </div>
          <Button
            appearance="primary"
            isDisabled={!name.trim() || !url.trim()}
            isLoading={createHook.isPending}
            onClick={() => {
              setError(null)
              createHook.mutate(
                {
                  name: name.trim(),
                  url: url.trim(),
                  secret: secret || undefined,
                  events: events.map((e) => e.value),
                  projectKey: scope,
                },
                { onSuccess: () => { setName(''); setUrl(''); setSecret('') }, onError: fail },
              )
            }}
          >
            {t('Add webhook')}
          </Button>
        </div>
      </div>
    </div>
  )
}
