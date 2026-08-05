import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import TextField from '@atlaskit/textfield'
import Select from '@atlaskit/select'
import DynamicTable from '@atlaskit/dynamic-table'
import Avatar from '@atlaskit/avatar'
import EmptyState from '@atlaskit/empty-state'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import { token } from '@atlaskit/tokens'
import { useMembers, useProjectIssues, useStatuses, useTransitionIssue } from '../api/hooks'
import SpaceHeader from '../components/SpaceHeader'
import { apiBlob } from '../api/client'
import { IssueTypeIcon, PriorityIcon, StatusLozenge, issueTypeLabel, priorityLabel } from '../components/icons'
import { t, fmtDate } from '../i18n'
import type { Issue, IssueType } from '../api/types'

interface Option {
  label: string
  value: string
}

// Inline status chip with dropdown, like the status control in Jira's list views.
function StatusCell({ issue }: { issue: Issue }) {
  const { data: statuses } = useStatuses(issue.projectKey)
  const transition = useTransitionIssue(issue.key)
  return (
    <DropdownMenu
      trigger={({ triggerRef, ...props }) => (
        <button
          type="button"
          ref={triggerRef}
          {...props}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
        >
          <StatusLozenge name={issue.status.name} category={issue.status.category} />
        </button>
      )}
      shouldRenderToParent
    >
      <DropdownItemGroup>
        {(statuses ?? [])
          .filter((s) => s.id !== issue.status.id)
          .map((s) => (
            <DropdownItem key={s.id} onClick={() => transition.mutate(s.id)}>
              <StatusLozenge name={s.name} category={s.category} />
            </DropdownItem>
          ))}
      </DropdownItemGroup>
    </DropdownMenu>
  )
}

const typeFilterOptions: Option[] = (Object.keys(issueTypeLabel) as IssueType[]).map((t) => ({
  label: issueTypeLabel[t],
  value: t,
}))

export default function ProjectIssuesPage() {
  const { key } = useParams<{ key: string }>()
  const projectKey = key?.toUpperCase()
  const { data: statuses } = useStatuses(projectKey)
  const { data: members } = useMembers(projectKey)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Option | null>(null)
  const [typeFilter, setTypeFilter] = useState<Option | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<Option | null>(null)
  const [startAt, setStartAt] = useState(0)

  const { data: page, isLoading } = useProjectIssues(projectKey, {
    query: query || undefined,
    status: statusFilter?.value,
    type: typeFilter?.value,
    assignee: assigneeFilter?.value,
    startAt,
  })

  const statusOptions: Option[] = (statuses ?? []).map((s) => ({ label: s.name, value: s.id }))
  const assigneeOptions: Option[] = (members ?? []).map((m) => ({ label: m.user.displayName, value: m.user.id }))

  const head = {
    cells: [
      { key: 'type', content: t('T'), width: 3 },
      { key: 'key', content: t('Key'), width: 8 },
      { key: 'summary', content: t('Summary') },
      { key: 'assignee', content: t('Assignee'), width: 14 },
      { key: 'priority', content: t('P'), width: 3 },
      { key: 'status', content: t('Status'), width: 12 },
      { key: 'created', content: t('Created'), width: 10 },
    ],
  }

  const rows = (page?.values ?? []).map((issue) => ({
    key: issue.id,
    cells: [
      { key: 'type', content: <IssueTypeIcon type={issue.type} /> },
      {
        key: 'key',
        content: (
          <Link
            to={`/browse/${issue.key}`}
            style={{
              whiteSpace: 'nowrap',
              textDecoration: issue.resolution ? 'line-through' : undefined,
              color: token('color.text.subtle', '#44546F'),
            }}
          >
            {issue.key}
          </Link>
        ),
      },
      {
        key: 'summary',
        content: <Link to={`/browse/${issue.key}`}>{issue.summary}</Link>,
      },
      {
        key: 'assignee',
        content: issue.assignee ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Avatar size="xsmall" name={issue.assignee.displayName} src={issue.assignee.avatarUrl ?? undefined} />
            <span style={{ whiteSpace: 'nowrap' }}>{issue.assignee.displayName}</span>
          </span>
        ) : (
          <span style={{ color: token('color.text.subtlest', '#626F86') }}>{t('Unassigned')}</span>
        ),
      },
      {
        key: 'priority',
        content: <span title={priorityLabel[issue.priority]}><PriorityIcon priority={issue.priority} /></span>,
      },
      { key: 'status', content: <StatusCell issue={issue} /> },
      {
        key: 'created',
        content: (
          <span style={{ whiteSpace: 'nowrap', color: token('color.text.subtlest', '#626F86') }}>
            {fmtDate(issue.createdAt)}
          </span>
        ),
      },
    ],
  }))

  const total = page?.total ?? 0
  const pageSize = page?.maxResults ?? 50

  return (
    <div>
      <SpaceHeader projectKey={projectKey ?? ''} tab="list" />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginTop: -56, marginBottom: 24 }}>
        <Button
          appearance="subtle"
          onClick={async () => {
            const blob = await apiBlob(`/projects/${projectKey}/export.csv`)
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = `${projectKey}-export.csv`
            a.click()
            URL.revokeObjectURL(url)
          }}
        >
          {t('Export CSV')}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ width: 240 }}>
          <TextField
            placeholder={t('Search issues')}
            isCompact
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value)
              setStartAt(0)
            }}
          />
        </div>
        <div style={{ minWidth: 140 }}>
          <Select<Option>
            placeholder={t('Type')}
            options={typeFilterOptions}
            value={typeFilter}
            onChange={(v) => { setTypeFilter(v); setStartAt(0) }}
            isClearable
            spacing="compact"
          />
        </div>
        <div style={{ minWidth: 150 }}>
          <Select<Option>
            placeholder={t('Status')}
            options={statusOptions}
            value={statusFilter}
            onChange={(v) => { setStatusFilter(v); setStartAt(0) }}
            isClearable
            spacing="compact"
          />
        </div>
        <div style={{ minWidth: 170 }}>
          <Select<Option>
            placeholder={t('Assignee')}
            options={assigneeOptions}
            value={assigneeFilter}
            onChange={(v) => { setAssigneeFilter(v); setStartAt(0) }}
            isClearable
            spacing="compact"
          />
        </div>
      </div>

      {!isLoading && total === 0 ? (
        <EmptyState
          header={t('No issues found')}
          description={t('Create an issue with the Create button in the navigation bar, or adjust your filters.')}
        />
      ) : (
        <>
          <DynamicTable head={head} rows={rows} isLoading={isLoading} />
          {total > pageSize && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <Button isDisabled={startAt === 0} onClick={() => setStartAt(Math.max(0, startAt - pageSize))}>
                {t('Previous')}
              </Button>
              <span style={{ color: token('color.text.subtlest', '#626F86') }}>
                {t('{from}–{to} of {total}', { from: startAt + 1, to: Math.min(startAt + pageSize, total), total })}
              </span>
              <Button isDisabled={page?.isLast} onClick={() => setStartAt(startAt + pageSize)}>
                {t('Next')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
