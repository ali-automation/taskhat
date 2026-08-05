import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import TextField from '@atlaskit/textfield'
import Avatar from '@atlaskit/avatar'
import Spinner from '@atlaskit/spinner'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Modal, { ModalBody, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import EmptyState from '@atlaskit/empty-state'
import { token } from '@atlaskit/tokens'
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box'
import {
  useBoardIssues,
  useBoards,
  useStatuses,
  useCreateIssue,
  useMembers,
  useRankIssue,
  useUpdateColumns,
} from '../api/hooks'
import { useProjectRealtime } from '../hooks/useProjectRealtime'
import SpaceHeader from '../components/SpaceHeader'
import { CompleteSprintModal } from '../components/SprintModals'
import BurndownChart from '../components/BurndownChart'
import { IssueTypeIcon, PriorityIcon } from '../components/icons'
import IssueDetail from '../components/IssueDetail'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { t } from '../i18n'
import type { Board, BoardColumn, Issue } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

type Edge = 'top' | 'bottom' | null

interface DragData extends Record<string | symbol, unknown> {
  kind: 'card' | 'column-area'
  issueKey?: string
  columnId?: string
}

// A board card, Jira-style: summary, then type icon + key on the left,
// priority + assignee on the right. Draggable.
function BoardCard({ issue, onOpen }: { issue: Issue; onOpen: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [edge, setEdge] = useState<Edge>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const cleanupDrag = draggable({
      element: el,
      getInitialData: (): DragData => ({ kind: 'card', issueKey: issue.key }),
      onDragStart: () => setDragging(true),
      onDrop: () => setDragging(false),
    })
    const cleanupDrop = dropTargetForElements({
      element: el,
      canDrop: ({ source }) => (source.data as DragData).kind === 'card',
      getData: ({ input, element }) =>
        attachClosestEdge({ kind: 'card', issueKey: issue.key }, { input, element, allowedEdges: ['top', 'bottom'] }),
      onDrag: ({ self, source }) => {
        if ((source.data as DragData).issueKey === issue.key) return setEdge(null)
        setEdge(extractClosestEdge(self.data) as Edge)
      },
      onDragLeave: () => setEdge(null),
      onDrop: () => setEdge(null),
    })
    return () => {
      cleanupDrag()
      cleanupDrop()
    }
  }, [issue.key])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {edge === 'top' && <DropIndicator edge="top" gap="8px" />}
      <div
        onClick={() => onOpen(issue.key)}
        style={{
          background: token('elevation.surface.raised', '#FFFFFF'),
          borderRadius: 8,
          boxShadow: token('elevation.shadow.raised', '0 1px 1px rgba(9,30,66,0.25), 0 0 1px rgba(9,30,66,0.31)'),
          padding: '10px 12px',
          cursor: 'pointer',
          opacity: dragging ? 0.4 : 1,
        }}
      >
        <div style={{ fontSize: 14, marginBottom: 10, wordBreak: 'break-word' }}>{issue.summary}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <IssueTypeIcon type={issue.type} />
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                ...subtleText,
                textDecoration: issue.resolution ? 'line-through' : undefined,
              }}
            >
              {issue.key}
            </span>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <PriorityIcon priority={issue.priority} />
            {issue.assignee ? (
              <Avatar size="small" name={issue.assignee.displayName} src={issue.assignee.avatarUrl ?? undefined} />
            ) : (
              <Avatar size="small" />
            )}
          </span>
        </div>
      </div>
      {edge === 'bottom' && <DropIndicator edge="bottom" gap="8px" />}
    </div>
  )
}

function QuickCreate({ projectKey, statusId, firstStatusId }: { projectKey: string; statusId: string; firstStatusId: string }) {
  const [open, setOpen] = useState(false)
  const [summary, setSummary] = useState('')
  const createIssue = useCreateIssue()
  const qc = useQueryClient()

  const submit = async () => {
    const trimmed = summary.trim()
    if (!trimmed) return setOpen(false)
    const issue = await createIssue.mutateAsync({
      project: { key: projectKey },
      issuetype: { name: 'task' },
      summary: trimmed,
    })
    // Issues are born in the first status; move it if created in another column.
    if (statusId !== firstStatusId) {
      await api(`/issues/${issue.key}/transitions`, {
        method: 'POST',
        body: JSON.stringify({ transition: { id: statusId } }),
      })
    }
    qc.invalidateQueries({ queryKey: ['board-issues'] })
    setSummary('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button appearance="subtle" shouldFitContainer onClick={() => setOpen(true)}>
        {t('+ Create')}
      </Button>
    )
  }
  return (
    <TextField
      autoFocus
      placeholder={t('What needs to be done?')}
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
      onBlur={submit}
    />
  )
}

function Column({
  board,
  column,
  issues,
  firstStatusId,
  hiddenDone,
  onOpen,
}: {
  board: Board
  column: BoardColumn
  issues: Issue[]
  firstStatusId: string
  hiddenDone?: number
  onOpen: (key: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [isOver, setIsOver] = useState(false)
  const navigate = useNavigate()
  const updateColumns = useUpdateColumns(board.id, board.projectKey)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => (source.data as DragData).kind === 'card',
      getData: (): DragData => ({ kind: 'column-area', columnId: column.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [column.id])

  const overLimit = column.maxIssues != null && issues.length > column.maxIssues

  const setWip = () => {
    const input = window.prompt(t('Maximum issues in this column (empty to clear):'), column.maxIssues?.toString() ?? '')
    if (input === null) return
    const max = input.trim() === '' ? null : Math.max(1, parseInt(input, 10) || 1)
    updateColumns.mutate(
      board.columns.map((c) => ({
        id: c.id,
        name: c.name,
        minIssues: c.minIssues,
        maxIssues: c.id === column.id ? max : c.maxIssues,
      })),
    )
  }

  return (
    <div
      style={{
        width: 282,
        flexShrink: 0,
        background: overLimit
          ? token('color.background.danger', '#FFECEB')
          : token('elevation.surface.sunken', '#F7F8F9'),
        borderRadius: 8,
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100vh - 210px)',
        outline: isOver ? `2px solid ${token('color.border.selected', '#0C66E4')}` : 'none',
      }}
    >
      <div
        style={{
          padding: '10px 12px 6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, ...subtleText, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {column.name}
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              background: token('color.background.neutral', '#F1F2F4'),
              borderRadius: 8,
              padding: '0 6px',
              minWidth: 16,
              textAlign: 'center',
            }}
          >
            {issues.length}
            {column.maxIssues != null && ` / ${column.maxIssues}`}
          </span>
        </span>
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
            <DropdownItem onClick={setWip}>{t('Set column limit…')}</DropdownItem>
            <DropdownItem onClick={() => navigate(`/projects/${board.projectKey}/settings/board`)}>
              {t('Board settings')}
            </DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>
      </div>
      <div ref={ref} style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flex: 1 }}>
        {issues.map((issue) => (
          <BoardCard key={issue.id} issue={issue} onOpen={onOpen} />
        ))}
        {(hiddenDone ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => navigate(`/issues?tql=${encodeURIComponent(`project = ${board.projectKey} AND resolution != EMPTY ORDER BY updated DESC`)}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px', fontSize: 13,
              background: 'none', border: 'none', cursor: 'pointer', borderRadius: 6, textAlign: 'start', ...subtleText,
            }}
          >
            🔍 {t('See older work items')}
          </button>
        )}
        <QuickCreate projectKey={board.projectKey} statusId={column.statusIds[0]} firstStatusId={firstStatusId} />
      </div>
    </div>
  )
}

export default function BoardPage() {
  const { key, boardId } = useParams<{ key: string; boardId?: string }>()
  const projectKey = key?.toUpperCase()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data: members } = useMembers(projectKey)
  const { data: boards, isLoading: boardsLoading } = useBoards(projectKey)
  const board = (boardId ? boards?.find((b) => b.id === boardId) : undefined) ?? boards?.[0]
  const { data: issuesData, isLoading: issuesLoading } = useBoardIssues(board?.id)
  const { data: allStatuses } = useStatuses(board?.projectKey)
  const doneColumnIds = useMemo(() => {
    const doneStatusIds = new Set((allStatuses ?? []).filter((s) => s.category === 'done').map((s) => s.id))
    return new Set((board?.columns ?? []).filter((c) => c.statusIds.some((id) => doneStatusIds.has(id))).map((c) => c.id))
  }, [allStatuses, board])
  const rankIssue = useRankIssue(board?.id)
  const [search, setSearch] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [openIssue, setOpenIssue] = useState<string | null>(null)
  const [completeOpen, setCompleteOpen] = useState(false)
  const [burndownOpen, setBurndownOpen] = useState(false)
  const { user } = useAuth()

  useProjectRealtime(projectKey)

  const activeSprint = issuesData?.sprint ?? null

  const issues = useMemo(() => {
    let all = issuesData?.values ?? []
    if (onlyMine) all = all.filter((i) => i.assignee?.id === user?.id)
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter((i) => i.summary.toLowerCase().includes(q) || i.key.toLowerCase().includes(q))
  }, [issuesData, search, onlyMine, user])

  const byColumn = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const col of board?.columns ?? []) {
      map.set(
        col.id,
        issues.filter((i) => col.statusIds.includes(i.status.id)),
      )
    }
    return map
  }, [board, issues])

  const firstStatusId = board?.columns[0]?.statusIds[0] ?? ''

  // Drag & drop orchestration: compute target column + neighbor, apply
  // optimistic cache update, then persist (rank + transition).
  useEffect(() => {
    if (!board) return
    return monitorForElements({
      canMonitor: ({ source }) => (source.data as DragData).kind === 'card',
      onDrop: async ({ source, location }) => {
        const src = source.data as unknown as DragData
        const issueKey = src.issueKey
        if (!issueKey) return
        const all = issuesData?.values ?? []
        const moving = all.find((i) => i.key === issueKey)
        if (!moving) return

        const targets = location.current.dropTargets
        const cardTarget = targets.find((t) => (t.data as unknown as DragData).kind === 'card')
        const columnTarget = targets.find((t) => (t.data as unknown as DragData).kind === 'column-area')
        if (!cardTarget && !columnTarget) return

        let targetColumn: BoardColumn | undefined
        let refIssue: Issue | undefined
        let placeBefore = true

        if (cardTarget) {
          const refKey = (cardTarget.data as unknown as DragData).issueKey
          refIssue = all.find((i) => i.key === refKey)
          if (!refIssue || refIssue.key === issueKey) return
          const edge = extractClosestEdge(cardTarget.data)
          placeBefore = edge !== 'bottom'
          targetColumn = board.columns.find((c) => c.statusIds.includes(refIssue!.status.id))
        } else if (columnTarget) {
          const colId = (columnTarget.data as unknown as DragData).columnId
          targetColumn = board.columns.find((c) => c.id === colId)
          const colIssues = (byColumn.get(colId ?? '') ?? []).filter((i) => i.key !== issueKey)
          refIssue = colIssues[colIssues.length - 1] // drop at end of column
          placeBefore = false
        }
        if (!targetColumn) return

        const needsTransition = !targetColumn.statusIds.includes(moving.status.id)
        const targetStatusId = targetColumn.statusIds[0]

        // Optimistic: reorder + retag status in the board cache.
        qc.setQueryData(['board-issues', board.id], (old: { total: number; values: Issue[] } | undefined) => {
          if (!old) return old
          let values = old.values.filter((i) => i.key !== issueKey)
          const optimistic: Issue = needsTransition
            ? { ...moving, status: { ...moving.status, id: targetStatusId } }
            : moving
          if (refIssue) {
            const idx = values.findIndex((i) => i.key === refIssue!.key)
            const at = placeBefore ? idx : idx + 1
            values = [...values.slice(0, at), optimistic, ...values.slice(at)]
          } else {
            values = [...values, optimistic]
          }
          return { ...old, values }
        })

        try {
          if (refIssue) {
            await rankIssue.mutateAsync({
              issueKey,
              before: placeBefore ? refIssue.key : undefined,
              after: placeBefore ? undefined : refIssue.key,
            })
          }
          if (needsTransition) {
            await api(`/issues/${issueKey}/transitions`, {
              method: 'POST',
              body: JSON.stringify({ transition: { id: targetStatusId } }),
            })
          }
        } finally {
          qc.invalidateQueries({ queryKey: ['board-issues', board.id] })
          qc.invalidateQueries({ queryKey: ['issues', board.projectKey] })
        }
      },
    })
  }, [board, issuesData, byColumn, qc, rankIssue])

  if (boardsLoading || issuesLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }
  if (!board) return <div>{t('No board found for this project.')}</div>

  if (board.type === 'scrum' && !activeSprint) {
    return (
      <EmptyState
        header={t('No active sprint')}
        description={t('Plan and start a sprint from the backlog to populate this board.')}
        primaryAction={
          <Button appearance="primary" onClick={() => navigate(`/projects/${board.projectKey}/backlog/${board.id}`)}>
            {t('Go to Backlog')}
          </Button>
        }
      />
    )
  }

  const daysRemaining =
    activeSprint?.endAt != null
      ? Math.max(0, Math.ceil((new Date(activeSprint.endAt).getTime() - Date.now()) / 86400000))
      : null

  return (
    <div>
      <SpaceHeader projectKey={board.projectKey} tab="board" />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 16px', flexWrap: 'wrap' }}>
        <div style={{ width: 200 }}>
          <TextField
            placeholder={t('Search board')}
            isCompact
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <div style={{ display: 'flex' }}>
          {(members ?? []).slice(0, 5).map((m, i) => (
            <span key={m.user.id} style={{ marginInlineStart: i === 0 ? 0 : -6 }} title={m.user.displayName}>
              <Avatar size="small" name={m.user.displayName} src={m.user.avatarUrl ?? undefined} />
            </span>
          ))}
        </div>
        <DropdownMenu
          trigger={({ triggerRef, ...props }) => (
            <Button ref={triggerRef} {...props} appearance="subtle">
              {t('Quick filters')}
            </Button>
          )}
          shouldRenderToParent
        >
          <DropdownItemGroup>
            <DropdownItem isSelected={onlyMine} onClick={() => setOnlyMine(!onlyMine)}>
              {onlyMine ? '✓ ' : ''}{t('Only my work items')}
            </DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>
        <span style={{ flex: 1 }} />
        {activeSprint && (
          <>
            {daysRemaining != null && (
              <span style={{ fontSize: 12, ...subtleText, whiteSpace: 'nowrap' }}>
                {activeSprint.name} ·{' '}
                {daysRemaining === 1
                  ? t('{n} day remaining', { n: daysRemaining })
                  : t('{n} days remaining', { n: daysRemaining })}
              </span>
            )}
            <Button onClick={() => setBurndownOpen(true)}>{t('Burndown')}</Button>
            <Button appearance="primary" onClick={() => setCompleteOpen(true)}>
              {t('Complete sprint')}
            </Button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 16 }}>
        {board.columns.map((col) => (
          <Column
            key={col.id}
            board={board}
            column={col}
            issues={byColumn.get(col.id) ?? []}
            firstStatusId={firstStatusId}
            hiddenDone={doneColumnIds.has(col.id) ? issuesData?.hiddenDone : 0}
            onOpen={setOpenIssue}
          />
        ))}
      </div>

      <ModalTransition>
        {completeOpen && activeSprint && (
          <CompleteSprintModal sprint={activeSprint} board={board} onClose={() => setCompleteOpen(false)} />
        )}
      </ModalTransition>
      <ModalTransition>
        {burndownOpen && activeSprint && (
          <Modal onClose={() => setBurndownOpen(false)} width="large">
            <ModalHeader>
              <ModalTitle>{t('{name} burndown', { name: activeSprint.name })}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <div style={{ paddingBottom: 24 }}>
                <BurndownChart sprintId={activeSprint.id} />
              </div>
            </ModalBody>
          </Modal>
        )}
      </ModalTransition>
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
    </div>
  )
}
