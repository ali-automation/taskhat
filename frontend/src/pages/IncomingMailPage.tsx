import { useState } from 'react'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAdminCreateMailHandler, useAdminDeleteMailHandler, useAdminMailHandlers,
  useAdminUpdateMailHandler, useAdminWorkTypes, useProjects,
} from '../api/hooks'
import type { MailHandler } from '../api/types'
import { t, timeAgo } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function HandlerModal({ initial, onClose }: { initial?: MailHandler; onClose: () => void }) {
  const { data: projects } = useProjects()
  const { data: workTypes } = useAdminWorkTypes()
  const create = useAdminCreateMailHandler()
  const update = useAdminUpdateMailHandler()
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(initial?.name ?? '')
  const [projectKey, setProjectKey] = useState(initial?.projectKey ?? '')
  const [issueType, setIssueType] = useState(initial?.issueType ?? 'task')
  const [mode, setMode] = useState(initial?.mode ?? 'webhook')
  const [imap, setImap] = useState({
    host: initial?.imap.host ?? '', port: initial?.imap.port ?? 0, tls: initial?.imap.tls ?? true,
    username: initial?.imap.username ?? '', password: '', folder: initial?.imap.folder ?? '',
  })
  const [allowReplies, setAllowReplies] = useState(initial?.allowReplies ?? true)

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))
  const projectOptions = (projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))
  const typeOptions = (workTypes ?? []).filter((wt) => wt.isEnabled).map((wt) => ({ label: wt.name, value: wt.key }))
  const modeOptions = [
    { label: t('Inbound webhook (mail provider POSTs here)'), value: 'webhook' },
    { label: t('IMAP mailbox (polled every minute)'), value: 'imap' },
  ]

  const submit = () => {
    setError(null)
    const body = { name, projectKey, issueType, mode, imap, allowReplies, isEnabled: initial?.isEnabled ?? true }
    if (initial) update.mutate({ id: initial.id, ...body }, { onSuccess: onClose, onError: fail })
    else create.mutate(body, { onSuccess: onClose, onError: fail })
  }

  return (
    <Modal onClose={onClose} width="medium">
      <ModalHeader><ModalTitle>{initial ? t('Edit mail handler') : t('Add incoming mail handler')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <SectionMessage appearance="error">{error}</SectionMessage>}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Name')}</div>
            <TextField autoFocus placeholder={t('e.g. Support inbox')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Create work items in')}</div>
              <Select
                options={projectOptions}
                value={projectOptions.find((o) => o.value === projectKey) ?? null}
                placeholder={t('Choose a space')}
                onChange={(o) => o && setProjectKey(o.value)}
              />
            </div>
            <div style={{ width: 170 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Work type')}</div>
              <Select
                options={typeOptions}
                value={typeOptions.find((o) => o.value === issueType) ?? null}
                onChange={(o) => o && setIssueType(o.value)}
              />
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Mail source')}</div>
            <Select
              isDisabled={!!initial}
              options={modeOptions}
              value={modeOptions.find((o) => o.value === mode)}
              onChange={(o) => o && setMode(o.value)}
            />
          </div>
          {mode === 'imap' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 6, border: `1px solid ${token('color.border', '#DFE1E6')}` }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <TextField placeholder={t('IMAP host (imap.example.com)')} value={imap.host} onChange={(e) => setImap({ ...imap, host: e.currentTarget.value })} />
                </div>
                <div style={{ width: 90 }}>
                  <TextField placeholder={t('Port')} value={imap.port ? String(imap.port) : ''} onChange={(e) => setImap({ ...imap, port: parseInt(e.currentTarget.value, 10) || 0 })} />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <Toggle isChecked={imap.tls} onChange={() => setImap({ ...imap, tls: !imap.tls })} /> TLS
                </label>
              </div>
              <TextField placeholder={t('Username')} value={imap.username} onChange={(e) => setImap({ ...imap, username: e.currentTarget.value })} />
              <TextField type="password" placeholder={initial ? t('Password (blank keeps the current one)') : t('Password')} value={imap.password} onChange={(e) => setImap({ ...imap, password: e.currentTarget.value })} />
              <TextField placeholder={t('Folder (default INBOX)')} value={imap.folder} onChange={(e) => setImap({ ...imap, folder: e.currentTarget.value })} />
            </div>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Toggle isChecked={allowReplies} onChange={() => setAllowReplies(!allowReplies)} />
            {t('A work item key in the subject adds a comment instead of a new item')}
          </label>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button
          appearance="primary"
          isDisabled={!name.trim() || !projectKey || (mode === 'imap' && !imap.host.trim())}
          isLoading={create.isPending || update.isPending}
          onClick={submit}
        >
          {t('Save')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// Jira's System > Mail > Incoming mail: handlers that turn email into work items.
export default function IncomingMailPage() {
  const { data: handlers } = useAdminMailHandlers()
  const update = useAdminUpdateMailHandler()
  const del = useAdminDeleteMailHandler()
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ initial?: MailHandler } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))

  const rows = (handlers ?? []).map((h) => ({
    key: h.id,
    cells: [
      {
        key: 'name',
        content: (
          <div>
            <div style={{ fontWeight: 500, display: 'flex', gap: 6, alignItems: 'center' }}>
              {h.name}
              {!h.isEnabled && <Lozenge appearance="moved">{t('Disabled')}</Lozenge>}
            </div>
            {h.mode === 'webhook' && h.token && (
              <div style={{ fontSize: 11, display: 'flex', gap: 6, alignItems: 'center', ...subtleText }}>
                <code style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }}>
                  {`${window.location.origin}/api/v1/mail/incoming/${h.token}`}
                </code>
                <span
                  style={{ cursor: 'pointer', color: token('color.link', '#0C66E4') }}
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/api/v1/mail/incoming/${h.token}`)
                    setCopied(h.id)
                    setTimeout(() => setCopied(null), 1500)
                  }}
                >
                  {copied === h.id ? t('Copied') : t('Copy')}
                </span>
              </div>
            )}
            {h.mode === 'imap' && (
              <div style={{ fontSize: 11, ...subtleText }}>{h.imap.username}@{h.imap.host}</div>
            )}
          </div>
        ),
      },
      { key: 'space', content: <span>{h.projectName} <span style={subtleText}>({h.projectKey})</span></span> },
      { key: 'mode', content: <Lozenge appearance={h.mode === 'imap' ? 'new' : 'inprogress'}>{h.mode === 'imap' ? 'IMAP' : t('Webhook')}</Lozenge> },
      { key: 'processed', content: h.processedCount },
      {
        key: 'status',
        content: h.lastError
          ? <span title={h.lastError} style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12 }}>{t('Error')}: {h.lastError.slice(0, 40)}</span>
          : h.lastPolledAt
            ? <span style={{ fontSize: 12, ...subtleText }}>{t('Last activity {ago}', { ago: timeAgo(h.lastPolledAt) })}</span>
            : <span style={{ fontSize: 12, ...subtleText }}>{t('No mail yet')}</span>,
      },
      {
        key: 'enabled',
        content: (
          <Toggle
            isChecked={h.isEnabled}
            onChange={() => {
              setError(null)
              update.mutate({
                id: h.id, name: h.name, projectKey: h.projectKey, issueType: h.issueType,
                mode: h.mode, imap: { ...h.imap, password: '' }, allowReplies: h.allowReplies, isEnabled: !h.isEnabled,
              }, { onError: fail })
            }}
          />
        ),
      },
      {
        key: 'actions',
        content: (
          <span style={{ display: 'flex', gap: 4 }}>
            <Button appearance="subtle" spacing="compact" onClick={() => setModal({ initial: h })}>{t('Edit')}</Button>
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => {
                setError(null)
                if (confirm(t('Delete mail handler “{name}”?', { name: h.name }))) del.mutate(h.id, { onError: fail })
              }}
            >
              {t('Delete')}
            </Button>
          </span>
        ),
      },
    ],
  }))

  return (
    <div style={{ maxWidth: 1020 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Incoming mail')}</h1>
        <Button appearance="primary" onClick={() => setModal({})}>{t('Add incoming mail handler')}</Button>
      </div>
      <p style={{ fontSize: 13, marginBottom: 16, ...subtleText }}>
        {t('Email becomes work: the subject is the summary, the body the description, attachments carry over, and replies that keep the work item key in the subject become comments. Senders matching a TaskHat account are set as the reporter.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
      <DynamicTable
        head={{ cells: [
          { key: 'n', content: t('Handler') }, { key: 's', content: t('Space') }, { key: 'm', content: t('Source') },
          { key: 'p', content: t('Processed') }, { key: 'st', content: t('Status') }, { key: 'e', content: t('Enabled') }, { key: 'a', content: '' },
        ] }}
        rows={rows}
        emptyView={<div style={{ padding: 24, ...subtleText }}>{t('No mail handlers yet. Add one to start turning email into work items.')}</div>}
      />
      <ModalTransition>
        {modal && <HandlerModal initial={modal.initial} onClose={() => setModal(null)} />}
      </ModalTransition>
    </div>
  )
}
