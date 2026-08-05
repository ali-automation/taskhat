import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Select from '@atlaskit/select'
import { useQueryClient } from '@tanstack/react-query'
import Button from '@atlaskit/button/new'
import Avatar from '@atlaskit/avatar'
import Spinner from '@atlaskit/spinner'
import TextField from '@atlaskit/textfield'
import Tag from '@atlaskit/tag'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Modal, { ModalBody, ModalTransition } from '@atlaskit/modal-dialog'
import { token } from '@atlaskit/tokens'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import {
  invalidatePlanning,
  useBacklog,
  useBoards,
  useCreateIssue,
  useCreateSprint,
  useDeleteSprint,
  useEpics,
  useSprintIssues,
  useSprints,
} from '../api/hooks'
import { useProjectRealtime } from '../hooks/useProjectRealtime'
import SpaceHeader from '../components/SpaceHeader'
import { StartSprintModal, CompleteSprintModal } from '../components/SprintModals'
import { IssueTypeIcon, StatusLozenge } from '../components/icons'
import IssueDetail from '../components/IssueDetail'
import { api } from '../api/client'
import { t, fmtDate } from '../i18n'
import type { Board, Issue, Sprint } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }
const BACKLOG = 'backlog'

interface DragData extends Record<string | symbol, unknown> {
  kind: 'row' | 'section'
  issueKey?: string
  container?: string // sprint id or 'backlog'
}

function PointsBadge({ value, tone }: { value: number; tone?: 'todo' | 'in_progress' | 'done' }) {
  const bg =
    tone === 'in_progress'
      ? token('color.background.information', '#E9F2FF')
      : tone === 'done'
        ? token('color.background.success', '#DCFFF1')
        : token('color.background.neutral', '#F1F2F4')
  return (
    <span
      style={{
        background: bg,
        borderRadius: 10,
        padding: '1px 8px',
        fontSize: 12,
        fontWeight: 600,
        minWidth: 24,
        textAlign: 'center',
        display: 'inline-block',
      }}
    >
      {Math.round(value * 10) / 10}
    </span>
  )
}

// One backlog row, Jira-style: type icon, key, summary, epic tag, status,
// points, assignee. Draggable within and across sections.
function BacklogRow({ issue, container, onOpen }: { issue: Issue; container: string; onOpen: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [edge, setEdge] = useState<'top' | 'bottom' | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cleanupDrag = draggable({
      element: el,
      getInitialData: (): DragData => ({ kind: 'row', issueKey: issue.key, container }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
    const cleanupDrop = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => (source.data as unknown as DragData).kind === 'row',
      getData: ({ input, element }) =>
        attachClosestEdge({ kind: 'row', issueKey: issue.key, container }, { input, element, allowedEdges: ['top', 'bottom'] }),
      onDrag: ({ self, source }) => {
        if ((source.data as unknown as DragData).issueKey === issue.key) return setEdge(null)
        setEdge(extractClosestEdge(self.data) as 'top' | 'bottom' | null)
      },
      onDragLeave: () => setEdge(null),
      onDrop: () => setEdge(null),
    })
    return () => {
      cleanupDrag()
      cleanupDrop()
    }
  }, [issue.key, container])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {edge === 'top' && <DropIndicator edge="top" />}
      <div
        onClick={() => onOpen(issue.key)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`,
          background: token('elevation.surface', '#FFFFFF'),
          cursor: 'pointer',
          opacity: dragging ? 0.4 : 1,
          minHeight: 40,
        }}
      >
        <IssueTypeIcon type={issue.type} />
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            width: 64,
            flexShrink: 0,
            ...subtleText,
            textDecoration: issue.resolution ? 'line-through' : undefined,
          }}
        >
          {issue.key}
        </span>
        <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {issue.summary}
        </span>
        {issue.parent?.type === 'epic' && (
          <span style={{ flexShrink: 0 }}>
            <Tag text={issue.parent.summary} color="purpleLight" isRemovable={false} />
          </span>
        )}
        <span style={{ flexShrink: 0 }}>
          <StatusLozenge name={issue.status.name} category={issue.status.category} />
        </span>
        <PointsBadge value={issue.storyPoints ?? 0} />
        <span style={{ flexShrink: 0 }}>
          {issue.assignee ? <Avatar size="small" name={issue.assignee.displayName} src={issue.assignee.avatarUrl ?? undefined} /> : <Avatar size="small" />}
        </span>
      </div>
      {edge === 'bottom' && <DropIndicator edge="bottom" />}
    </div>
  )
}

function QuickCreateRow({ projectKey, sprintId }: { projectKey: string; sprintId: string | null }) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const createIssue = useCreateIssue()
  const qc = useQueryClient()

  const submit = async () => {
    const trimmed = summary.trim()
    if (!trimmed) return setOpen(false)
    await createIssue.mutateAsync({
      project: { key: projectKey },
      issuetype: { name: 'task' },
      summary: trimmed,
      sprint: sprintId ? { id: sprintId } : undefined,
    })
    invalidatePlanning(qc)
    setSummary('')
  }

  if (!open) {
    return (
      <Button appearance="subtle" onClick={() => setOpen(true)}>
        {t('+ Create issue')}
      </Button>
    )
  }
  return (
    <div style={{ padding: 4 }}>
      <TextField
        autoFocus
        isCompact
        placeholder={t('What needs to be done? (Enter to create, Esc to close)')}
        value={summary}
        isDisabled={createIssue.isPending}
        onChange={(e) => setSummary(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') {
            setSummary('')
            setOpen(false)
          }
        }}
        onBlur={() => {
          if (!summary.trim()) setOpen(false)
        }}
      />
    </div>
  )
}

function categoryTotals(issues: Issue[]) {
  const totals = { todo: 0, in_progress: 0, done: 0 }
  for (const i of issues) totals[i.status.category] += i.storyPoints ?? 0
  return totals
}

function SectionShell({
  container,
  header,
  children,
}: {
  container: string
  header: React.ReactNode
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => (source.data as unknown as DragData).kind === 'row',
      getData: (): DragData => ({ kind: 'section', container }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [container])

  return (
    <div
      style={{
        background: token('elevation.surface.sunken', '#F7F8F9'),
        borderRadius: 8,
        marginBottom: 16,
        outline: isOver ? `2px solid ${token('color.border.selected', '#0C66E4')}` : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px' }}>
        {header}
      </div>
      <div ref={ref} style={{ minHeight: 48, padding: '0 4px 4px' }}>
        {children}
      </div>
    </div>
  )
}

function sprintDates(sprint: Sprint): string {
  if (!sprint.startAt || !sprint.endAt) return ''
  const fmt = (s: string) => fmtDate(s, { day: 'numeric', month: 'short' })
  return `${fmt(sprint.startAt)} – ${fmt(sprint.endAt)}`
}

function SprintSection({
  board,
  sprint,
  epicFilter,
  onOpen,
  onStart,
  onComplete,
}: {
  board: Board
  sprint: Sprint
  epicFilter: string | null
  onOpen: (key: string) => void
  onStart: (sprint: Sprint) => void
  onComplete: (sprint: Sprint) => void
}) {
  const { data } = useSprintIssues(sprint.id)
  const deleteSprint = useDeleteSprint()
  const issues = (data?.values ?? []).filter((i) => !epicFilter || i.parent?.id === epicFilter)
  const totals = categoryTotals(issues)

  return (
    <SectionShell
      container={sprint.id}
      header={
        <>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>{sprint.name}</span>
            <span style={{ fontSize: 12, ...subtleText }}>{sprintDates(sprint)}</span>
            <span style={{ fontSize: 12, ...subtleText }}>{t('({n} issues)', { n: issues.length })}</span>
            {sprint.goal && <span style={{ fontSize: 12, ...subtleText }}>— {sprint.goal}</span>}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PointsBadge value={totals.todo} tone="todo" />
            <PointsBadge value={totals.in_progress} tone="in_progress" />
            <PointsBadge value={totals.done} tone="done" />
            {sprint.state === 'active' ? (
              <Button appearance="primary" spacing="compact" onClick={() => onComplete(sprint)}>
                {t('Complete sprint')}
              </Button>
            ) : (
              <Button spacing="compact" onClick={() => onStart(sprint)}>
                {t('Start sprint')}
              </Button>
            )}
            <DropdownMenu
              trigger={({ triggerRef, ...props }) => (
                <button
                  type="button"
                  ref={triggerRef}
                  {...props}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', ...subtleText }}
                >
                  ⋯
                </button>
              )}
              shouldRenderToParent
            >
              <DropdownItemGroup>
                {sprint.state === 'future' && (
                  <DropdownItem
                    onClick={() => {
                      if (confirm(t('Delete {name}? Its issues return to the backlog.', { name: sprint.name })))
                        deleteSprint.mutate(sprint.id)
                    }}
                  >
                    {t('Delete sprint')}
                  </DropdownItem>
                )}
                <DropdownItem onClick={() => onStart(sprint)}>
                  {sprint.state === 'active' ? t('Edit sprint') : t('Start sprint')}
                </DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>
          </span>
        </>
      }
    >
      {issues.length === 0 && (
        <div style={{ padding: '12px', fontSize: 13, ...subtleText, border: `2px dashed ${token('color.border', '#DFE1E6')}`, borderRadius: 6, margin: 4, textAlign: 'center' }}>
          {t('Plan your sprint: drag issues here from the backlog.')}
        </div>
      )}
      {issues.map((i) => (
        <BacklogRow key={i.id} issue={i} container={sprint.id} onOpen={onOpen} />
      ))}
      <QuickCreateRow projectKey={board.projectKey} sprintId={sprint.id} />
    </SectionShell>
  )
}

function EpicPanel({
  projectKey,
  epicFilter,
  setEpicFilter,
}: {
  projectKey: string
  epicFilter: string | null
  setEpicFilter: (id: string | null) => void
}) {
  const { data: epics } = useEpics(projectKey)
  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: token('elevation.surface.sunken', '#F7F8F9'),
        borderRadius: 8,
        padding: 12,
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8, ...subtleText }}>
        {t('Epics')}
      </div>
      <div
        onClick={() => setEpicFilter(null)}
        style={{
          padding: '6px 8px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          background: epicFilter === null ? token('color.background.selected', '#E9F2FF') : 'transparent',
          marginBottom: 4,
        }}
      >
        {t('All issues')}
      </div>
      {(epics ?? []).map((e) => (
        <div
          key={e.id}
          onClick={() => setEpicFilter(epicFilter === e.id ? null : e.id)}
          style={{
            padding: '6px 8px',
            borderRadius: 4,
            cursor: 'pointer',
            background: epicFilter === e.id ? token('color.background.selected', '#E9F2FF') : 'transparent',
            marginBottom: 4,
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.summary}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ flex: 1, height: 4, background: token('color.background.neutral', '#F1F2F4'), borderRadius: 2 }}>
              <div
                style={{
                  width: `${e.total ? (e.done / e.total) * 100 : 0}%`,
                  height: 4,
                  background: token('color.chart.purple.bold', '#964AC0'),
                  borderRadius: 2,
                }}
              />
            </div>
            <span style={{ fontSize: 11, ...subtleText }}>
              {e.done}/{e.total}
            </span>
          </div>
        </div>
      ))}
      {(epics ?? []).length === 0 && <div style={{ fontSize: 12, ...subtleText }}>{t('No epics yet.')}</div>}
    </div>
  )
}

export default function BacklogPage() {
  const { key, boardId } = useParams<{ key: string; boardId: string }>()
  const projectKey = key?.toUpperCase()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: boards, isLoading } = useBoards(projectKey)
  // The backlog belongs to ONE board (sprints are per-board, like Jira).
  // Default to the first scrum board — that's where sprints live.
  const board = (boardId ? boards?.find((b) => b.id === boardId) : undefined)
    ?? boards?.find((b) => b.type === 'scrum')
    ?? boards?.[0]
  const { data: backlogData } = useBacklog(board?.id)
  const { data: sprints } = useSprints(board?.id)
  const createSprint = useCreateSprint(board?.id)
  const [openIssue, setOpenIssue] = useState<string | null>(null)
  const [epicFilter, setEpicFilter] = useState<string | null>(null)
  const [startFor, setStartFor] = useState<Sprint | null>(null)
  const [completeFor, setCompleteFor] = useState<Sprint | null>(null)

  useProjectRealtime(projectKey)

  const backlogIssues = useMemo(
    () => (backlogData?.values ?? []).filter((i) => !epicFilter || i.parent?.id === epicFilter),
    [backlogData, epicFilter],
  )
  const backlogTotals = categoryTotals(backlogIssues)

  // Drop orchestration: sprint move (container change) + rank (row neighbor).
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => (source.data as unknown as DragData).kind === 'row',
      onDrop: async ({ source, location }) => {
        const src = source.data as unknown as DragData
        if (!src.issueKey) return
        const targets = location.current.dropTargets
        const rowTarget = targets.find((t) => (t.data as unknown as DragData).kind === 'row')
        const sectionTarget = targets.find((t) => (t.data as unknown as DragData).kind === 'section')

        let targetContainer: string | undefined
        let refKey: string | undefined
        let placeBefore = true

        if (rowTarget) {
          const rt = rowTarget.data as unknown as DragData
          if (rt.issueKey === src.issueKey) return
          targetContainer = rt.container
          refKey = rt.issueKey
          placeBefore = extractClosestEdge(rowTarget.data) !== 'bottom'
        } else if (sectionTarget) {
          targetContainer = (sectionTarget.data as unknown as DragData).container
        }
        if (!targetContainer) return

        try {
          if (targetContainer !== src.container) {
            await api(`/issues/${src.issueKey}`, {
              method: 'PUT',
              body: JSON.stringify({
                fields: { sprint: { id: targetContainer === BACKLOG ? null : targetContainer } },
              }),
            })
          }
          if (refKey) {
            await api(`/issues/${src.issueKey}/rank`, {
              method: 'PUT',
              body: JSON.stringify(placeBefore ? { rankBeforeIssue: refKey } : { rankAfterIssue: refKey }),
            })
          }
        } finally {
          invalidatePlanning(qc)
        }
      },
    })
  }, [qc])

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }
  if (!board || !projectKey) return <div>{t('No board found for this project.')}</div>

  return (
    <div>
      <SpaceHeader projectKey={projectKey} tab="backlog" />

      {(boards?.length ?? 0) > 1 && board && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 13, color: token('color.text.subtle', '#44546F') }}>{t('Board')}</span>
          <div style={{ width: 220 }}>
            <Select
              spacing="compact"
              options={(boards ?? []).map((b) => ({ label: b.name, value: b.id }))}
              value={{ label: board.name, value: board.id }}
              onChange={(o) => o && navigate(`/projects/${projectKey}/backlog/${o.value}`)}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <EpicPanel projectKey={projectKey} epicFilter={epicFilter} setEpicFilter={setEpicFilter} />

        <div style={{ flex: 1, minWidth: 0 }}>
          {(sprints ?? []).map((sprint) => (
            <SprintSection
              key={sprint.id}
              board={board}
              sprint={sprint}
              epicFilter={epicFilter}
              onOpen={setOpenIssue}
              onStart={setStartFor}
              onComplete={setCompleteFor}
            />
          ))}

          <SectionShell
            container={BACKLOG}
            header={
              <>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{t('Backlog')}</span>
                  <span style={{ fontSize: 12, ...subtleText }}>{t('({n} issues)', { n: backlogIssues.length })}</span>
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <PointsBadge value={backlogTotals.todo} tone="todo" />
                  <PointsBadge value={backlogTotals.in_progress} tone="in_progress" />
                  <PointsBadge value={backlogTotals.done} tone="done" />
                  <Button spacing="compact" isLoading={createSprint.isPending} onClick={() => createSprint.mutate()}>
                    {t('Create sprint')}
                  </Button>
                </span>
              </>
            }
          >
            {backlogIssues.map((i) => (
              <BacklogRow key={i.id} issue={i} container={BACKLOG} onOpen={setOpenIssue} />
            ))}
            {backlogIssues.length === 0 && (
              <div style={{ padding: 12, fontSize: 13, ...subtleText, textAlign: 'center' }}>
                {t('The backlog is empty.')}
              </div>
            )}
            <QuickCreateRow projectKey={projectKey} sprintId={null} />
          </SectionShell>
        </div>
      </div>

      <ModalTransition>
        {openIssue && (
          <Modal onClose={() => setOpenIssue(null)} width="x-large" shouldScrollInViewport>
            <ModalBody>
              <div style={{ padding: '16px 8px' }}>
                <IssueDetail issueKey={openIssue} onClose={() => setOpenIssue(null)} />
              </div>
            </ModalBody>
          </Modal>
        )}
      </ModalTransition>
      <ModalTransition>{startFor && <StartSprintModal sprint={startFor} onClose={() => setStartFor(null)} />}</ModalTransition>
      <ModalTransition>
        {completeFor && <CompleteSprintModal sprint={completeFor} board={board} onClose={() => setCompleteFor(null)} />}
      </ModalTransition>
    </div>
  )
}
