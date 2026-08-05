import { useState } from 'react'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Select from '@atlaskit/select'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import { Field, HelperMessage } from '@atlaskit/form'
import { token } from '@atlaskit/tokens'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { fmtDate, t, timeAgo } from '../i18n'
import type { Issue, Worklog } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Jira's clock: 1w = 5d, 1d = 8h.
export function fmtDuration(sec: number): string {
  if (sec <= 0) return '0m'
  const units: [number, string][] = [[5 * 8 * 3600, 'w'], [8 * 3600, 'd'], [3600, 'h'], [60, 'm']]
  const parts: string[] = []
  for (const [size, name] of units) {
    const n = Math.floor(sec / size)
    if (n > 0) {
      parts.push(`${n}${name}`)
      sec -= n * size
    }
  }
  return parts.join(' ') || '0m'
}

export function useWorklogs(issueKey: string | undefined) {
  return useQuery({
    queryKey: ['worklogs', issueKey],
    queryFn: () => api<Worklog[]>(`/issues/${issueKey}/worklogs`),
    enabled: !!issueKey,
  })
}

function invalidate(qc: ReturnType<typeof useQueryClient>, issueKey: string) {
  qc.invalidateQueries({ queryKey: ['worklogs', issueKey] })
  qc.invalidateQueries({ queryKey: ['issue', issueKey] })
  qc.invalidateQueries({ queryKey: ['changelog', issueKey] })
}

// Jira's time tracking bar: blue logged, gray track, remaining label.
export function TimeTrackingBar({ issue, onLogWork }: { issue: Issue; onLogWork: () => void }) {
  const spent = issue.timeSpentSeconds
  const remaining = issue.remainingEstimateSeconds ?? 0
  const total = spent + remaining
  const pct = total > 0 ? Math.round((spent / total) * 100) : 0
  return (
    <div style={{ minWidth: 180, cursor: 'pointer' }} onClick={onLogWork} title={t('Log work')}>
      {spent > 0 || remaining > 0 ? (
        <>
          <div style={{ height: 6, borderRadius: 3, background: token('color.background.neutral', '#F1F2F4'), overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: token('color.background.accent.blue.bolder', '#0C66E4') }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginTop: 3, ...subtleText }}>
            <span>{spent > 0 ? t('{d} logged', { d: fmtDuration(spent) }) : ''}</span>
            <span>{issue.remainingEstimateSeconds != null ? t('{d} remaining', { d: fmtDuration(remaining) }) : ''}</span>
          </div>
        </>
      ) : (
        <span style={{ fontSize: 13, ...subtleText }}>{t('No time logged')}</span>
      )}
    </div>
  )
}

// Jira's Log work dialog.
export function LogWorkModal({ issue, onClose }: { issue: Issue; onClose: () => void }) {
  const qc = useQueryClient()
  const [timeSpent, setTimeSpent] = useState('')
  const [startedAt, setStartedAt] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [adjust, setAdjust] = useState<'auto' | 'leave' | 'set'>('auto')
  const [newRemaining, setNewRemaining] = useState('')
  const [error, setError] = useState('')

  const add = useMutation({
    mutationFn: () =>
      api<Worklog>(`/issues/${issue.key}/worklogs`, {
        method: 'POST',
        body: JSON.stringify({ timeSpent, startedAt, comment, adjust, newRemaining: adjust === 'set' ? newRemaining : undefined }),
      }),
    onSuccess: () => {
      invalidate(qc, issue.key)
      onClose()
    },
    onError: (e) => setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Something went wrong')),
  })

  const adjustOptions = [
    { value: 'auto', label: t('Adjust remaining automatically') },
    { value: 'leave', label: t('Leave remaining estimate as is') },
    { value: 'set', label: t('Set new remaining estimate') },
  ]

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{t('Log work on {key}', { key: issue.key })}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Field name="timeSpent" label={t('Time spent')} isRequired>
            {() => (
              <>
                <TextField value={timeSpent} onChange={(e) => setTimeSpent((e.target as HTMLInputElement).value)} placeholder={t('e.g. 2h 30m')} autoFocus />
                <HelperMessage>{t('Use w, d, h, m — a week is 5 days, a day is 8 hours.')}</HelperMessage>
              </>
            )}
          </Field>
          <Field name="startedAt" label={t('Date started')}>
            {() => <TextField type="date" value={startedAt} onChange={(e) => setStartedAt((e.target as HTMLInputElement).value)} />}
          </Field>
          <Field name="adjust" label={t('Remaining estimate')}>
            {() => (
              <Select
                options={adjustOptions}
                value={adjustOptions.find((o) => o.value === adjust)}
                onChange={(o) => setAdjust((o?.value as typeof adjust) ?? 'auto')}
              />
            )}
          </Field>
          {adjust === 'set' && (
            <Field name="newRemaining" label={t('New remaining estimate')}>
              {() => <TextField value={newRemaining} onChange={(e) => setNewRemaining((e.target as HTMLInputElement).value)} placeholder={t('e.g. 1d 4h')} />}
            </Field>
          )}
          <Field name="comment" label={t('Description')}>
            {() => <TextArea value={comment} onChange={(e) => setComment(e.currentTarget.value)} minimumRows={2} />}
          </Field>
          {error && <p style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 13 }}>{error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button appearance="primary" isLoading={add.isPending} isDisabled={!timeSpent.trim()} onClick={() => add.mutate()}>
            {t('Log')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// The Worklog activity tab: entries newest first, delete your own.
export function WorklogSection({ issue }: { issue: Issue }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: logs } = useWorklogs(issue.key)
  const [logging, setLogging] = useState(false)
  const del = useMutation({
    mutationFn: (id: string) => api<void>(`/issues/${issue.key}/worklogs/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(qc, issue.key),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <Button spacing="compact" onClick={() => setLogging(true)}>{t('Log work')}</Button>
      </div>
      {(logs ?? []).map((wl) => (
        <div key={wl.id} style={{ display: 'flex', gap: 10 }}>
          <Avatar size="small" name={wl.author.displayName} src={wl.author.avatarUrl ?? undefined} />
          <div style={{ fontSize: 13 }}>
            <div>
              <strong>{wl.author.displayName}</strong>{' '}
              {t('logged {d}', { d: fmtDuration(wl.seconds) })}{' '}
              <span style={subtleText}>· {fmtDate(wl.startedAt)} · {timeAgo(wl.createdAt)}</span>
            </div>
            {wl.comment && <div style={{ marginTop: 2 }}>{wl.comment}</div>}
            {user?.id === wl.author.id && (
              <button
                type="button"
                onClick={() => del.mutate(wl.id)}
                style={{ border: 'none', background: 'none', padding: 0, marginTop: 2, fontSize: 12, cursor: 'pointer', color: token('color.text.subtlest', '#626F86') }}
              >
                {t('Delete')}
              </button>
            )}
          </div>
        </div>
      ))}
      {(logs ?? []).length === 0 && <span style={{ fontSize: 13, ...subtleText }}>{t('No work logged yet.')}</span>}
      {logging && <LogWorkModal issue={issue} onClose={() => setLogging(false)} />}
    </div>
  )
}

// Inline "Original estimate" editor for the Details panel.
export function OriginalEstimateField({ issue }: { issue: Issue }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const save = useMutation({
    mutationFn: (value: string) =>
      api<Issue>(`/issues/${issue.key}`, { method: 'PUT', body: JSON.stringify({ fields: { originalEstimate: value } }) }),
    onSuccess: () => {
      invalidate(qc, issue.key)
      setDraft(null)
      setError(false)
    },
    onError: () => setError(true),
  })
  const shown = draft ?? (issue.originalEstimateSeconds != null ? fmtDuration(issue.originalEstimateSeconds) : '')
  return (
    <input
      value={shown}
      placeholder={t('e.g. 2d 4h')}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft != null && save.mutate(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft != null) save.mutate(draft.trim())
        if (e.key === 'Escape') { setDraft(null); setError(false) }
      }}
      style={{
        border: error ? `1px solid ${token('color.border.danger', '#E2483D')}` : 'none',
        background: 'transparent', fontFamily: 'inherit', fontSize: 14,
        padding: '4px 8px', color: 'inherit', borderRadius: 3, width: 120,
      }}
    />
  )
}
