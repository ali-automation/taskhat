import { useEffect, useMemo, useState, type ReactNode, useRef } from 'react'
import { LogWorkModal, OriginalEstimateField, TimeTrackingBar, WorklogSection } from './TimeTracking'
import { useNavigate } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import Avatar from '@atlaskit/avatar'
import Spinner from '@atlaskit/spinner'
import TextField from '@atlaskit/textfield'
import InlineEdit from '@atlaskit/inline-edit'
import Select from '@atlaskit/select'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Tag from '@atlaskit/tag'
import TagGroup from '@atlaskit/tag-group'
import SectionMessage from '@atlaskit/section-message'
import { token } from '@atlaskit/tokens'
import { EyeOpenIcon, ChevronDownIcon, ArrowRightIcon } from './coreIcons'
import { Link } from 'react-router-dom'
import {
  useBoards,
  useChangelog,
  useToggleWatch,
  useWatchers,
  useChildren,
  useCreateIssue,
  useEpics,
  useIssue,
  useMembers,
  useSprints,
  useProjectFields,
  useManualFlows,
  useRunManualFlow,
  useTransitionIssue,
  useTransitions,
  useUpdateIssue,
  useVersions,
} from '../api/hooks'
import { IssueTypeIcon, PriorityIcon, StatusLozenge, priorityLabel } from '../components/icons'
import CustomFieldInput from './CustomFieldInput'
import { RichTextEditor, RichTextView } from './RichText'
import LinksSection from './LinksSection'
import MentionedOnSection from './MentionedOnSection'
import CommentsSection from './CommentsSection'
import { recordRecentItem } from './QuickSearch'
import AttachmentsSection from './AttachmentsSection'
import type { Issue } from '../api/types'
import type { Priority } from '../api/types'
import { t, fmtDateTime } from '../i18n'

interface Option {
  label: string
  value: string
}

// Jira's Fix versions field: multi-select over the space's versions.
function FixVersionsField({ issue }: { issue: Issue }) {
  const { data: versions } = useVersions(issue.projectKey)
  const update = useUpdateIssue(issue.key)
  const options = (versions ?? [])
    .filter((v) => v.status !== 'archived')
    .map((v) => ({ label: v.name, value: v.id }))
  return (
    <div style={{ minWidth: 180 }}>
      <Select
        isMulti
        spacing="compact"
        options={options}
        value={issue.fixVersions.map((v) => ({ label: v.name, value: v.id }))}
        placeholder={t('None')}
        onChange={(vals) => update.mutate({ fixVersions: (vals ?? []).map((o) => ({ id: o.value })) })}
      />
    </div>
  )
}

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 32, gap: 8 }}>
      <div style={{ width: '40%', fontSize: 12, fontWeight: 600, ...subtleText }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}

// ⚡ manual automation flows for this work item (Jira's "manual trigger").
function AutomationMenu({ issueKey }: { issueKey: string }) {
  const { data: flows } = useManualFlows(issueKey)
  const runFlow = useRunManualFlow(issueKey)
  const [ranId, setRanId] = useState<string | null>(null)
  if (!flows || flows.length === 0) return null
  return (
    <DropdownMenu
      trigger={({ triggerRef, ...props }) => (
        <button
          type="button"
          ref={triggerRef as React.Ref<HTMLButtonElement>}
          {...props}
          title={t('Run automation')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
            border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4,
            background: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'inherit',
          }}
        >
          ⚡
        </button>
      )}
      shouldRenderToParent
    >
      <DropdownItemGroup title={t('Automation')}>
        {flows.map((f) => (
          <DropdownItem
            key={f.id}
            onClick={() => {
              setRanId(f.id)
              runFlow.mutate(f.id, { onSettled: () => setTimeout(() => setRanId(null), 1500) })
            }}
          >
            {ranId === f.id ? t('✓ Queued — {name}', { name: f.name }) : f.name}
          </DropdownItem>
        ))}
      </DropdownItemGroup>
    </DropdownMenu>
  )
}

function WatchChip({ issueKey }: { issueKey: string }) {
  const { data } = useWatchers(issueKey)
  const toggle = useToggleWatch(issueKey)
  const watching = data?.isWatching ?? false
  const count = data?.values.length ?? 0
  return (
    <button
      type="button"
      title={watching ? t('Stop watching') : t('Watch')}
      onClick={() => toggle.mutate(!watching)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: 13,
        fontWeight: 600,
        border: `1px solid ${watching ? token('color.border.selected', '#0C66E4') : token('color.border', '#DFE1E6')}`,
        background: watching ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: watching ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
      }}
    >
      <EyeOpenIcon label="" /> {count}
    </button>
  )
}

// Status control, Jira 2025 style: gray button + action rows "Start work → IN PROGRESS".
function transitionLabel(category: string, name: string): string {
  if (category === 'in_progress') return t('Start work')
  if (category === 'done') return t('Done')
  return t('Transition to {name}', { name })
}

function StatusButton({ issueKey }: { issueKey: string }) {
  const { data: issue } = useIssue(issueKey)
  const { data: transitionData } = useTransitions(issueKey)
  const transition = useTransitionIssue(issueKey)
  if (!issue) return null
  return (
    <DropdownMenu
      trigger={({ triggerRef, ...props }) => (
        <Button ref={triggerRef} {...props} isLoading={transition.isPending} iconAfter={ChevronDownIcon}>
          {issue.status.name}
        </Button>
      )}
      shouldRenderToParent
    >
      <DropdownItemGroup>
        {(transitionData?.transitions ?? []).map((t) => (
          <DropdownItem key={t.id} onClick={() => transition.mutate(t.id)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 230, justifyContent: 'space-between' }}>
              <span>{transitionLabel(t.to.category, t.to.name)}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <ArrowRightIcon label="" />
                <StatusLozenge name={t.to.name} category={t.to.category} />
              </span>
            </span>
          </DropdownItem>
        ))}
      </DropdownItemGroup>
    </DropdownMenu>
  )
}

const eventValue = (v: unknown): string =>
  v == null || v === '' ? '' : typeof v === 'string' ? v : JSON.stringify(v)

function History({ issueKey }: { issueKey: string }) {
  const { data } = useChangelog(issueKey)
  const chip: React.CSSProperties = {
    display: 'inline-block', padding: '1px 6px', borderRadius: 3, fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', background: token('color.background.neutral', '#F1F2F4'),
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {(data?.values ?? []).map((e) => {
        const from = eventValue(e.oldValue)
        const to = eventValue(e.newValue)
        const fieldName = e.field.charAt(0).toUpperCase() + e.field.slice(1)
        return (
          <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Avatar size="small" name={e.actor.displayName} src={e.actor.avatarUrl ?? undefined} />
            <div style={{ fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{e.actor.displayName}</span>{' '}
              {e.field === 'created'
                ? t('created the work item')
                : e.field === 'description'
                  ? t('updated the Description')
                  : from === ''
                    ? <>{t('updated the')} <b>{t(fieldName)}</b></>
                    : <>{t('changed the')} <b>{t(fieldName)}</b></>}
              <div style={{ fontSize: 11, margin: '2px 0 4px', ...subtleText }}>{fmtDateTime(e.createdAt)}</div>
              {e.field !== 'created' && e.field !== 'description' && (from !== '' || to !== '') && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={chip}>{from === '' ? t('None') : from}</span>
                  <span style={subtleText}>→</span>
                  <span style={e.field === 'status'
                    ? { ...chip, background: token('color.background.success', '#DCFFF1'), color: token('color.text.success', '#216E4E') }
                    : chip}>
                    {to === '' ? t('None') : to}
                  </span>
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Child issues (epic children or sub-tasks) with a quick-add row.
function ChildrenSection({ issue }: { issue: Issue }) {
  const { data } = useChildren(issue.key)
  const createIssue = useCreateIssue()
  const [adding, setAdding] = useState(false)
  const [summary, setSummary] = useState('')
  const children = data?.values ?? []
  const isEpic = issue.type === 'epic'
  const childType = isEpic ? 'task' : 'subtask'

  if (issue.type === 'subtask') return null

  const add = async () => {
    const trimmed = summary.trim()
    if (!trimmed) return setAdding(false)
    await createIssue.mutateAsync({
      project: { key: issue.projectKey },
      issuetype: { name: childType },
      summary: trimmed,
      parent: { key: issue.key },
    })
    setSummary('')
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{isEpic ? t('Work items in this epic') : t('Subtasks')}</span>
        <Button appearance="subtle" spacing="compact" onClick={() => setAdding(true)}>
          {t('+ Add')}
        </Button>
      </div>
      <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4 }}>
        {children.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`,
            }}
          >
            <IssueTypeIcon type={c.type} />
            <Link to={`/browse/${c.key}`} style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
              {c.key}
            </Link>
            <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.summary}
            </span>
            {c.assignee && <Avatar size="xsmall" name={c.assignee.displayName} src={c.assignee.avatarUrl ?? undefined} />}
            <StatusLozenge name={c.status.name} category={c.status.category} />
          </div>
        ))}
        {children.length === 0 && !adding && (
          <div style={{ padding: 10, fontSize: 13, ...subtleText }}>{t('None yet.')}</div>
        )}
        {adding && (
          <div style={{ padding: 6 }}>
            <TextField
              autoFocus
              isCompact
              placeholder={t('What needs to be done? (Enter to add)')}
              value={summary}
              isDisabled={createIssue.isPending}
              onChange={(e) => setSummary(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') add()
                if (e.key === 'Escape') {
                  setSummary('')
                  setAdding(false)
                }
              }}
              onBlur={() => {
                if (!summary.trim()) setAdding(false)
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function IssueDetail({ issueKey, onClose }: { issueKey: string; onClose?: () => void }) {
  const key = issueKey.toUpperCase()
  const { data: issue, isLoading, error } = useIssue(key)
  const { data: members } = useMembers(issue?.projectKey)
  const { data: boards } = useBoards(issue?.projectKey)
  const { data: sprints } = useSprints(boards?.[0]?.id)
  const { data: epics } = useEpics(issue?.projectKey)
  const update = useUpdateIssue(key ?? '')
  const navigate = useNavigate()
  const { data: projectFields } = useProjectFields(issue?.projectKey)
  const [customDraft, setCustomDraft] = useState<Record<string, unknown>>({})
  const [showAllFields, setShowAllFields] = useState(false)
  const [editingDescr, setEditingDescr] = useState(false)
  const [descrDraft, setDescrDraft] = useState<{ doc: unknown; text: string } | null>(null)
  const [labelsDraft, setLabelsDraft] = useState<string | null>(null)
  const [pointsDraft, setPointsDraft] = useState<string | null>(null)
  const [activityTab, setActivityTab] = useState<'all' | 'comments' | 'history' | 'worklog'>('comments')
  const [loggingWork, setLoggingWork] = useState(false)

  // Feed the For-you Viewed tab: record each open once per mount.
  const viewedKey = useRef<string | null>(null)
  useEffect(() => {
    if (!issue || viewedKey.current === key) return
    viewedKey.current = key
    void import('../api/client').then(({ api }) => api(`/issues/${key}/viewed`, { method: 'POST' }).catch(() => {}))
  }, [issue, key])

  const memberOptions: Option[] = useMemo(
    () => (members ?? []).map((m) => ({ label: m.user.displayName, value: m.user.id })),
    [members],
  )
  const priorityOptions: Option[] = (['highest', 'high', 'medium', 'low', 'lowest'] as Priority[]).map((p) => ({
    label: priorityLabel[p],
    value: p,
  }))

  useEffect(() => {
    if (issue) recordRecentItem({ key: issue.key, summary: issue.summary })
  }, [issue?.key])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }
  if (error || !issue) {
    return <SectionMessage appearance="warning" title={t('Issue not found')}>{t('The issue does not exist or you do not have access to it.')}</SectionMessage>
  }

  return (
    <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start', maxWidth: 1100 }}>
      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 4 }}>
          {issue.parent ? (
            <Link to={`/browse/${issue.parent.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: token('color.text.subtle', '#44546F') }}>
              <IssueTypeIcon type={issue.parent.type} /> {issue.parent.key}
            </Link>
          ) : (
            <span style={{ ...subtleText }} title={t('Set the Epic in the Details panel')}>{t('Add parent')}</span>
          )}
          <span style={subtleText}>/</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: token('color.text.subtle', '#44546F'), fontWeight: 600 }}>
            <IssueTypeIcon type={issue.type} /> {issue.key}
          </span>
        </div>

        <InlineEdit
          defaultValue={issue.summary}
          editView={({ errorMessage, ...fieldProps }) => <TextField {...fieldProps} autoFocus />}
          readView={() => (
            <h1 style={{ fontSize: 24, fontWeight: 500, margin: '4px 0', cursor: 'pointer' }}>{issue.summary}</h1>
          )}
          onConfirm={(value) => {
            if (value.trim() && value !== issue.summary) update.mutate({ summary: value })
          }}
        />

        <div style={{ margin: '16px 0 8px', fontSize: 14, fontWeight: 600 }}>{t('Description')}</div>
        {editingDescr ? (
          <div>
            <RichTextEditor
              initialDoc={issue.descriptionDoc}
              initialText={issue.description}
              autoFocus
              placeholder={t('Add a description…')}
              onChange={(doc, text) => setDescrDraft({ doc, text })}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <Button
                appearance="primary"
                spacing="compact"
                onClick={() => {
                  if (descrDraft) update.mutate({ description: descrDraft.text, descriptionDoc: descrDraft.doc })
                  setEditingDescr(false)
                }}
              >
                {t('Save')}
              </Button>
              <Button appearance="subtle" spacing="compact" onClick={() => setEditingDescr(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div onClick={() => { setDescrDraft(null); setEditingDescr(true) }} style={{ cursor: 'pointer', padding: '4px 0' }}>
            {issue.description || issue.descriptionDoc ? (
              <RichTextView doc={issue.descriptionDoc} fallback={issue.description} />
            ) : (
              <div style={subtleText}>{t('Add a description…')}</div>
            )}
          </div>
        )}

        <AttachmentsSection issueKey={key} />

        <ChildrenSection issue={issue} />

        <LinksSection issueKey={key} />
        <MentionedOnSection issueKey={key} />

        <div style={{ margin: '32px 0 8px', fontSize: 14, fontWeight: 600 }}>{t('Activity')}</div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 12, fontSize: 12 }}>
          <span style={subtleText}>{t('Show:')}</span>
          {(['all', 'comments', 'history', 'worklog'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActivityTab(tab)}
              style={{
                border: 'none',
                cursor: 'pointer',
                borderRadius: 3,
                padding: '3px 8px',
                fontSize: 12,
                fontWeight: 600,
                background:
                  activityTab === tab
                    ? token('color.background.selected', '#E9F2FF')
                    : token('color.background.neutral', '#F1F2F4'),
                color: activityTab === tab ? token('color.text.selected', '#0C66E4') : 'inherit',
              }}
            >
              {tab === 'all' ? t('All') : tab === 'comments' ? t('Comments') : tab === 'history' ? t('History') : t('Worklog')}
            </button>
          ))}
        </div>
        {activityTab !== 'history' && activityTab !== 'worklog' && <CommentsSection issueKey={key} />}
        {activityTab === 'all' && (
          <div style={{ margin: '20px 0 8px', fontSize: 12, ...subtleText }}>{t('History')}</div>
        )}
        {(activityTab === 'all' || activityTab === 'history') && <History issueKey={key} />}
        {activityTab === 'worklog' && <WorklogSection issue={issue} />}
      </div>

      {/* Right column: status + details panel, Jira issue-view style */}
      <div style={{ width: 320, flexShrink: 0 }}>
        <div style={{ marginBottom: 12, display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'space-between' }}>
          <StatusButton issueKey={key} />
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <AutomationMenu issueKey={key} />
            <WatchChip issueKey={key} />
          </span>
        </div>

        <div
          style={{
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8,
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              fontWeight: 600,
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
            }}
          >
            {t('Details')}
            <ChevronDownIcon label="" />
          </div>
          <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <FieldRow label={t('Assignee')}>
              <Select<Option>
                spacing="compact"
                appearance="subtle"
                options={memberOptions}
                isClearable
                placeholder={t('Unassigned')}
                value={issue.assignee ? { label: issue.assignee.displayName, value: issue.assignee.id } : null}
                onChange={(v) => update.mutate({ assignee: { id: v ? v.value : null } })}
                formatOptionLabel={(o) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Avatar size="xsmall" name={o.label} />
                    {o.label}
                  </span>
                )}
              />
            </FieldRow>
            <FieldRow label={t('Reporter')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
                <Avatar size="xsmall" name={issue.reporter.displayName} src={issue.reporter.avatarUrl ?? undefined} />
                {issue.reporter.displayName}
              </span>
            </FieldRow>
            <FieldRow label={t('Priority')}>
              <Select<Option>
                spacing="compact"
                appearance="subtle"
                options={priorityOptions}
                value={{ label: priorityLabel[issue.priority], value: issue.priority }}
                onChange={(v) => v && update.mutate({ priority: { name: v.value } })}
                formatOptionLabel={(o) => (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <PriorityIcon priority={o.value as Priority} />
                    {o.label}
                  </span>
                )}
              />
            </FieldRow>
            <FieldRow label={t('Labels')}>
              {labelsDraft === null ? (
                <div onClick={() => setLabelsDraft(issue.labels.join(', '))} style={{ cursor: 'pointer', padding: '4px 8px' }}>
                  {issue.labels.length > 0 ? (
                    <TagGroup>
                      {issue.labels.map((l) => (
                        <Tag key={l} text={l} />
                      ))}
                    </TagGroup>
                  ) : (
                    <span style={subtleText}>{t('None')}</span>
                  )}
                </div>
              ) : (
                <TextField
                  isCompact
                  autoFocus
                  value={labelsDraft}
                  onChange={(e) => setLabelsDraft(e.currentTarget.value)}
                  onBlur={() => {
                    update.mutate({ labels: labelsDraft.split(',').map((l) => l.trim()).filter(Boolean) })
                    setLabelsDraft(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setLabelsDraft(null)
                  }}
                  placeholder={t('comma, separated, labels')}
                />
              )}
            </FieldRow>
            <FieldRow label={t('Sprint')}>
              <Select<Option>
                spacing="compact"
                appearance="subtle"
                isClearable
                placeholder={t('Backlog')}
                options={(sprints ?? []).map((sp) => ({ label: sp.name, value: sp.id }))}
                value={issue.sprint ? { label: issue.sprint.name, value: issue.sprint.id } : null}
                onChange={(v) => update.mutate({ sprint: { id: v ? v.value : null } })}
              />
            </FieldRow>
            {issue.type !== 'epic' && (
              <FieldRow label={issue.type === 'subtask' ? t('Parent') : t('Epic')}>
                {issue.type === 'subtask' ? (
                  <span style={{ padding: '4px 8px', fontSize: 14 }}>
                    {issue.parent ? `${issue.parent.key} — ${issue.parent.summary}` : t('None')}
                  </span>
                ) : (
                  <Select<Option>
                    spacing="compact"
                    appearance="subtle"
                    isClearable
                    placeholder={t('None')}
                    options={(epics ?? []).filter((e) => e.key !== issue.key).map((e) => ({ label: e.summary, value: e.key }))}
                    value={issue.parent ? { label: issue.parent.summary, value: issue.parent.key } : null}
                    onChange={(v) => update.mutate({ parent: { key: v ? v.value : null } })}
                  />
                )}
              </FieldRow>
            )}
            <FieldRow label={t('Story points')}>
              {pointsDraft === null ? (
                <div
                  onClick={() => setPointsDraft(issue.storyPoints?.toString() ?? '')}
                  style={{ cursor: 'pointer', padding: '4px 8px' }}
                >
                  {issue.storyPoints ?? <span style={subtleText}>{t('None')}</span>}
                </div>
              ) : (
                <TextField
                  isCompact
                  autoFocus
                  type="number"
                  value={pointsDraft}
                  onChange={(e) => setPointsDraft(e.currentTarget.value)}
                  onBlur={() => {
                    const v = pointsDraft.trim()
                    update.mutate({ storyPoints: v === '' ? null : Math.max(0, parseFloat(v) || 0) })
                    setPointsDraft(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setPointsDraft(null)
                  }}
                />
              )}
            </FieldRow>
            <FieldRow label={t('Original estimate')}>
              <OriginalEstimateField issue={issue} />
            </FieldRow>
            <FieldRow label={t('Time tracking')}>
              <TimeTrackingBar issue={issue} onLogWork={() => setLoggingWork(true)} />
              {loggingWork && <LogWorkModal issue={issue} onClose={() => setLoggingWork(false)} />}
            </FieldRow>
            <FieldRow label={t('Fix versions')}>
              <FixVersionsField issue={issue} />
            </FieldRow>
            <FieldRow label={t('Start date')}>
              <input
                type="date"
                value={issue.startDate ? issue.startDate.slice(0, 10) : ''}
                onChange={(e) => update.mutate({ startDate: e.currentTarget.value })}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  padding: '4px 8px',
                  color: 'inherit',
                }}
              />
            </FieldRow>
            <FieldRow label={t('Due date')}>
              <input
                type="date"
                value={issue.dueDate ? issue.dueDate.slice(0, 10) : ''}
                onChange={(e) => update.mutate({ duedate: e.currentTarget.value })}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontFamily: 'inherit',
                  fontSize: 14,
                  padding: '4px 8px',
                  color: 'inherit',
                }}
              />
            </FieldRow>
            {(() => {
              const hasValue = (f: { id: string }) => {
                const v = customDraft[f.id] !== undefined ? customDraft[f.id] : issue.custom?.[f.id]
                return v !== undefined && v !== null && v !== ''
              }
              const renderCustomField = (f: NonNullable<typeof projectFields>[number]) => (

              <FieldRow key={f.id} label={f.name}>
                <CustomFieldInput
                  isCompact
                  field={f}
                  value={customDraft[f.id] !== undefined ? customDraft[f.id] : issue.custom?.[f.id]}
                  onChange={(v) => {
                    if (f.type === 'select' || f.type === 'date') {
                      update.mutate({ custom: { [f.id]: v } })
                      setCustomDraft((d) => ({ ...d, [f.id]: undefined }))
                    } else {
                      setCustomDraft((d) => ({ ...d, [f.id]: v }))
                    }
                  }}
                />
                {customDraft[f.id] !== undefined && (
                  <div style={{ marginTop: 4 }}>
                    <Button
                      spacing="compact"
                      appearance="primary"
                      onClick={() => {
                        update.mutate({ custom: { [f.id]: customDraft[f.id] === '' ? null : customDraft[f.id] } })
                        setCustomDraft((d) => {
                          const next = { ...d }
                          delete next[f.id]
                          return next
                        })
                      }}
                    >
                      {t('Save')}
                    </Button>
                  </div>
                )}
              </FieldRow>
              )
              const filled = (projectFields ?? []).filter(hasValue)
              const empty = (projectFields ?? []).filter((f) => !hasValue(f))
              return (
                <>
                  {(showAllFields ? [...filled, ...empty] : filled).map(renderCustomField)}
                  {empty.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAllFields((v) => !v)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: '6px 0', textAlign: 'start', color: token('color.link', '#0C66E4') }}
                    >
                      {showAllFields ? t('Hide empty fields') : t('Show {n} more fields', { n: empty.length })}
                    </button>
                  )}
                </>
              )
            })()}
            
          </div>
        </div>

        <div style={{ marginTop: 8, fontSize: 11, ...subtleText }}>
          {t('Created')} {fmtDateTime(issue.createdAt)}
          <br />
          {t('Updated')} {fmtDateTime(issue.updatedAt)}
        </div>

        <div style={{ marginTop: 16 }}>
          <Button
            appearance="subtle"
            onClick={async () => {
              if (confirm(t('Delete {key}? This cannot be undone.', { key: issue.key }))) {
                const { api } = await import('../api/client')
                await api(`/issues/${issue.key}`, { method: 'DELETE' })
                if (onClose) onClose()
                else navigate(`/projects/${issue.projectKey}/issues`)
              }
            }}
          >
            {t('Delete work item')}
          </Button>
        </div>
      </div>
    </div>
  )
}
