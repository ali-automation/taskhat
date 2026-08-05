import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import TextArea from '@atlaskit/textarea'
import Select from '@atlaskit/select'
import DynamicTable from '@atlaskit/dynamic-table'
import Avatar from '@atlaskit/avatar'
import SectionMessage from '@atlaskit/section-message'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import {
  useCreateFilter,
  useDeleteFilter,
  useFilters,
  useProjects,
  useSearch,
  useUserSearch,
} from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { ApiError } from '../api/client'
import { t, fmtDate } from '../i18n'
import { IssueTypeIcon, PriorityIcon, StatusLozenge, issueTypeLabel } from '../components/icons'
import type { IssueType } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

interface Option {
  label: string
  value: string
}

const typeOptions: Option[] = (Object.keys(issueTypeLabel) as IssueType[]).map((t) => ({
  label: issueTypeLabel[t],
  value: t,
}))
const statusOptions: Option[] = ['To Do', 'In Progress', 'Done'].map((s) => ({ label: t(s), value: s }))

function buildTQL(parts: {
  project: Option | null
  type: Option | null
  status: Option | null
  assignee: Option | null
  text: string
}): string {
  const clauses: string[] = []
  if (parts.project) clauses.push(`project = ${parts.project.value}`)
  if (parts.type) clauses.push(`type = ${parts.type.value}`)
  if (parts.status) clauses.push(`status = "${parts.status.value}"`)
  if (parts.assignee) clauses.push(`assignee = ${parts.assignee.value}`)
  if (parts.text.trim()) clauses.push(`text ~ "${parts.text.trim().replace(/"/g, '')}"`)
  const where = clauses.join(' AND ')
  return where ? `${where} ORDER BY updated DESC` : 'ORDER BY updated DESC'
}

function SaveFilterModal({ tql, onClose }: { tql: string; onClose: () => void }) {
  const createFilter = useCreateFilter()
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader>
        <ModalTitle>{t('Save filter')}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Name')}
            <TextField autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </label>
          <code
            style={{
              fontSize: 12,
              background: token('elevation.surface.sunken', '#F7F8F9'),
              padding: 8,
              borderRadius: 4,
              wordBreak: 'break-all',
            }}
          >
            {tql}
          </code>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <Toggle isChecked={shared} onChange={() => setShared(!shared)} />
            {t('Share with everyone')}
          </label>
          {error && <div style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12 }}>{error}</div>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button
          appearance="primary"
          isLoading={createFilter.isPending}
          onClick={async () => {
            try {
              await createFilter.mutateAsync({ name, tql, isShared: shared })
              onClose()
            } catch (err) {
              setError(err instanceof ApiError ? Object.values(err.body.errors)[0] ?? err.message : t('failed'))
            }
          }}
        >
          {t('Save')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export default function SearchPage() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [mode, setMode] = useState<'basic' | 'tql'>(params.get('tql') ? 'tql' : 'basic')

  // basic-mode state
  const { data: projects } = useProjects()
  const { data: users } = useUserSearch('')
  const [project, setProject] = useState<Option | null>(null)
  const [type, setType] = useState<Option | null>(null)
  const [status, setStatus] = useState<Option | null>(null)
  const [assignee, setAssignee] = useState<Option | null>(null)
  const [text, setText] = useState('')

  // tql-mode state
  const [tqlDraft, setTqlDraft] = useState(params.get('tql') ?? '')
  const [startAt, setStartAt] = useState(0)

  const basicTQL = useMemo(
    () => buildTQL({ project, type, status, assignee, text }),
    [project, type, status, assignee, text],
  )
  const activeTQL = mode === 'basic' ? basicTQL : (params.get('tql') ?? '')

  const { data: page, error, isFetching } = useSearch(activeTQL, startAt, mode === 'basic' || !!params.get('tql'))
  const tqlError = error instanceof ApiError ? (error.body.errors.tql ?? error.message) : null

  const { data: filters } = useFilters()
  const deleteFilter = useDeleteFilter()
  const [saveOpen, setSaveOpen] = useState(false)

  const runTQL = () => {
    setStartAt(0)
    setParams(tqlDraft.trim() ? { tql: tqlDraft.trim() } : {})
  }

  const projectOptions: Option[] = (projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))
  const userOptions: Option[] = (users ?? []).map((u) => ({ label: u.displayName, value: u.email }))

  const head = {
    cells: [
      { key: 'type', content: t('T') },
      { key: 'key', content: t('Key') },
      { key: 'summary', content: t('Summary') },
      { key: 'project', content: t('Project') },
      { key: 'assignee', content: t('Assignee') },
      { key: 'p', content: t('P') },
      { key: 'status', content: t('Status') },
      { key: 'updated', content: t('Updated') },
    ],
  }
  const rows = (page?.values ?? []).map((issue) => ({
    key: issue.id,
    cells: [
      { key: 't', content: <IssueTypeIcon type={issue.type} /> },
      {
        key: 'key',
        content: (
          <Link to={`/browse/${issue.key}`} style={{ whiteSpace: 'nowrap', textDecoration: issue.resolution ? 'line-through' : undefined }}>
            {issue.key}
          </Link>
        ),
      },
      { key: 'summary', content: <Link to={`/browse/${issue.key}`}>{issue.summary}</Link> },
      { key: 'project', content: issue.projectKey },
      {
        key: 'assignee',
        content: issue.assignee ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
            <Avatar size="xsmall" name={issue.assignee.displayName} src={issue.assignee.avatarUrl ?? undefined} />
            {issue.assignee.displayName}
          </span>
        ) : (
          <span style={subtleText}>{t('Unassigned')}</span>
        ),
      },
      { key: 'p', content: <PriorityIcon priority={issue.priority} /> },
      { key: 'status', content: <StatusLozenge name={issue.status.name} category={issue.status.category} /> },
      {
        key: 'updated',
        content: <span style={{ whiteSpace: 'nowrap', ...subtleText }}>{fmtDate(issue.updatedAt)}</span>,
      },
    ],
  }))

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* Saved filters panel */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          background: token('elevation.surface.sunken', '#F7F8F9'),
          borderRadius: 8,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8, ...subtleText }}>
          {t('Saved filters')}
        </div>
        {(filters ?? []).map((f) => (
          <div
            key={f.id}
            style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}
          >
            <button
              type="button"
              onClick={() => {
                setMode('tql')
                setTqlDraft(f.tql)
                setStartAt(0)
                setParams({ tql: f.tql })
              }}
              style={{
                flex: 1,
                textAlign: 'left',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '5px 8px',
                borderRadius: 4,
                fontSize: 13,
                color: token('color.link', '#0C66E4'),
              }}
            >
              {f.name}
              {f.isShared && f.owner.id !== user?.id && (
                <span style={{ fontSize: 11, ...subtleText }}> — {f.owner.displayName}</span>
              )}
            </button>
            {f.owner.id === user?.id && (
              <button
                type="button"
                title={t('Delete filter')}
                onClick={() => {
                  if (confirm(t('Delete filter "{name}"?', { name: f.name }))) deleteFilter.mutate(f.id)
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', ...subtleText }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {(filters ?? []).length === 0 && <div style={{ fontSize: 12, ...subtleText }}>{t('No saved filters yet.')}</div>}
      </div>

      {/* Navigator */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h1 style={{ fontSize: 24 }}>{t('All work')}</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button appearance="subtle" onClick={() => setSaveOpen(true)}>
              {t('Save filter')}
            </Button>
            <Button
              appearance={mode === 'basic' ? 'default' : 'primary'}
              onClick={() => {
                if (mode === 'basic') {
                  setTqlDraft(basicTQL)
                  setParams({ tql: basicTQL })
                  setMode('tql')
                } else {
                  setParams({})
                  setMode('basic')
                }
                setStartAt(0)
              }}
            >
              {mode === 'basic' ? t('Switch to TQL') : t('Switch to basic')}
            </Button>
          </div>
        </div>

        {mode === 'basic' ? (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 200 }}>
              <TextField placeholder={t('Search work')} isCompact value={text} onChange={(e) => { setText(e.currentTarget.value); setStartAt(0) }} />
            </div>
            <div style={{ minWidth: 170 }}>
              <Select<Option> placeholder={t('Project')} spacing="compact" options={projectOptions} value={project} onChange={(v) => { setProject(v); setStartAt(0) }} isClearable />
            </div>
            <div style={{ minWidth: 130 }}>
              <Select<Option> placeholder={t('Type')} spacing="compact" options={typeOptions} value={type} onChange={(v) => { setType(v); setStartAt(0) }} isClearable />
            </div>
            <div style={{ minWidth: 150 }}>
              <Select<Option> placeholder={t('Status')} spacing="compact" options={statusOptions} value={status} onChange={(v) => { setStatus(v); setStartAt(0) }} isClearable />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select<Option> placeholder={t('Assignee')} spacing="compact" options={userOptions} value={assignee} onChange={(v) => { setAssignee(v); setStartAt(0) }} isClearable />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 8 }}>
            <TextArea
              value={tqlDraft}
              onChange={(e) => setTqlDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  runTQL()
                }
              }}
              minimumRows={2}
              placeholder={`project = TH AND status != Done AND assignee = ${user?.email ?? 'me@example.com'} ORDER BY priority DESC`}
            />
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button appearance="primary" spacing="compact" onClick={runTQL} isLoading={isFetching}>
                {t('Search')}
              </Button>
              <span style={{ fontSize: 11, ...subtleText }}>
                Fields: project, type, status, assignee, reporter, priority, label, sprint, parent, text, created, updated, due, points · Ops: = != ~ IN NOT IN &gt; &lt; &gt;= &lt;= · EMPTY · ORDER BY
              </span>
            </div>
          </div>
        )}

        {mode === 'basic' && (
          <code style={{ display: 'block', fontSize: 11, marginBottom: 12, ...subtleText }}>{basicTQL}</code>
        )}

        {tqlError ? (
          <SectionMessage appearance="error" title={t('Invalid TQL')}>
            {tqlError}
          </SectionMessage>
        ) : (
          <>
            <div style={{ fontSize: 12, marginBottom: 4, ...subtleText }}>
              {page ? (page.total === 1 ? t('{n} work item', { n: page.total }) : t('{n} work items', { n: page.total })) : ''}
            </div>
            <DynamicTable head={head} rows={rows} isLoading={isFetching && !page} />
            {page && (
              <div style={{ textAlign: 'center', fontSize: 13, margin: '10px 0 4px', ...subtleText }}>
                {t('{shown} of {total}', { shown: Math.min(startAt + 50, page.total), total: page.total })} ↻
              </div>
            )}
            {page && page.total > page.maxResults && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <Button isDisabled={startAt === 0} onClick={() => setStartAt(Math.max(0, startAt - 50))}>
                  {t('Previous')}
                </Button>
                <span style={subtleText}>
                  {t('{from}–{to} of {total}', { from: startAt + 1, to: Math.min(startAt + 50, page.total), total: page.total })}
                </span>
                <Button isDisabled={page.isLast} onClick={() => setStartAt(startAt + 50)}>
                  {t('Next')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <ModalTransition>
        {saveOpen && <SaveFilterModal tql={mode === 'basic' ? basicTQL : tqlDraft || activeTQL} onClose={() => setSaveOpen(false)} />}
      </ModalTransition>
    </div>
  )
}
