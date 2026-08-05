import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Spinner from '@atlaskit/spinner'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAdminWorkflow, useMembers, useProject, useUpdateAdminWorkflow, useUpdateWorkflow,
  useUserSearch, useWorkflow,
} from '../api/hooks'
import type { WorkflowDetail, WorkflowRule, WorkflowRuleKind } from '../api/types'
import { t } from '../i18n'

// Stage 26: Jira's workflow editor — a full-screen takeover with a Diagram
// view (draggable status nodes, transition arrows, minimap + zoom) and a Text
// view, plus transition rules. Edits are local until "Update workflow".

type Category = 'todo' | 'in_progress' | 'done'

interface WfStatus {
  id: string // server id or tmp-… for unsaved
  name: string
  category: Category
  x: number | null
  y: number | null
}

interface WfTransition {
  id: string
  name: string
  fromId: string | null // null = any status
  toId: string
  rules: WorkflowRule[]
}

type Selection = { kind: 'status'; id: string } | { kind: 'transition'; id: string } | null

const CAT: Record<Category, { bg: string; fg: string; border: string; label: string }> = {
  todo: { bg: '#F1F2F4', fg: '#44546F', border: '#B3B9C4', label: t('To do') },
  in_progress: { bg: '#E9F2FF', fg: '#0055CC', border: '#85B8FF', label: t('In progress') },
  done: { bg: '#DCFFF1', fg: '#216E4E', border: '#7EE2B8', label: t('Done') },
}

const lozengeFor: Record<Category, 'default' | 'inprogress' | 'success'> = {
  todo: 'default',
  in_progress: 'inprogress',
  done: 'success',
}

const NODE_H = 26
const nodeW = (name: string) => Math.max(72, Math.round(name.length * 7.4) + 30)

const FIELD_LABELS: Record<string, string> = {
  description: t('Description'),
  assignee: t('Assignee'),
  duedate: t('Due date'),
  storypoints: t('Story points'),
}

const ROLE_LABELS: Record<string, string> = {
  lead: t('Space lead'),
  admin: t('Space admins'),
  member: t('Members'),
  assignee: t('Assignee'),
  reporter: t('Reporter'),
}

const subtleText = { color: token('color.text.subtlest', '#626F86') }
const border = token('color.border', '#DFE1E6')

let tmpSeq = 1
const tmpId = (prefix: string) => `${prefix}-${tmpSeq++}`

// Point on a node's border along the line from its centre to (tx, ty).
function anchor(cx: number, cy: number, w: number, h: number, tx: number, ty: number) {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const s = Math.min(w / 2 / Math.max(Math.abs(dx), 1e-6), h / 2 / Math.max(Math.abs(dy), 1e-6))
  return { x: cx + dx * s, y: cy + dy * s }
}

// Two entry points: a space's own workflow (/projects/KEY/workflow) and the
// admin directory (/admin/workflows/{id}/edit), which also edits inactive
// (unassigned) workflows and can rename them.
export default function WorkflowEditorPage() {
  const { key, id: adminId } = useParams()
  const adminMode = !!adminId
  const projectKey = adminMode ? undefined : key?.toUpperCase()
  const navigate = useNavigate()
  const { data: project } = useProject(projectKey)
  const { data: spaceData } = useWorkflow(projectKey)
  const { data: adminData } = useAdminWorkflow(adminId)
  const data = adminMode ? adminData : spaceData
  const { data: members } = useMembers(projectKey)
  const { data: allUsers } = useUserSearch('')
  const updateSpaceWorkflow = useUpdateWorkflow(projectKey)
  const updateAdminWorkflow = useUpdateAdminWorkflow(adminId)
  const updateWorkflow = adminMode ? updateAdminWorkflow : updateSpaceWorkflow

  const [statuses, setStatuses] = useState<WfStatus[]>([])
  const [transitions, setTransitions] = useState<WfTransition[]>([])
  const [wfName, setWfName] = useState('')
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  const [view, setView] = useState<'diagram' | 'text'>('diagram')
  const [showLabels, setShowLabels] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<'status' | 'transition' | 'rule' | null>(null)

  const markDirty = () => {
    dirtyRef.current = true
    setDirty(true)
  }

  const load = (d: WorkflowDetail) => {
    setStatuses(d.statuses.map((s) => ({ id: s.id, name: s.name, category: s.category, x: s.x, y: s.y })))
    setTransitions(
      d.transitions.map((tr) => ({ id: tr.id, name: tr.name, fromId: tr.fromStatusId, toId: tr.toStatusId, rules: tr.rules ?? [] })),
    )
    setWfName(d.name)
    dirtyRef.current = false
    setDirty(false)
  }

  useEffect(() => {
    if (data && !dirtyRef.current) load(data)
  }, [data])

  // Auto-layout for nodes that never got coordinates: one row, like Jira.
  const placed = useMemo(() => {
    let col = 0
    return statuses.map((s) => {
      if (s.x != null && s.y != null) return s as WfStatus & { x: number; y: number }
      const p = { ...s, x: 150 + col * 185, y: 280 }
      col += 1
      return p
    })
  }, [statuses])

  const byId = useMemo(() => new Map(placed.map((s) => [s.id, s])), [placed])
  const memberUsers = adminMode ? (allUsers ?? []) : (members ?? []).map((m) => m.user)
  const userName = (id: string) => memberUsers.find((u) => u.id === id)?.displayName ?? t('Unknown user')

  const describeRule = (rule: WorkflowRule): string => {
    if (rule.kind === 'restrict-who') {
      const who = [
        ...(rule.config.roles ?? []).map((r) => ROLE_LABELS[r] ?? r),
        ...(rule.config.users ?? []).map(userName),
      ]
      return t('Only {who} can make this transition', { who: who.join(', ') || '—' })
    }
    if (rule.kind === 'required-field') {
      const fields = (rule.config.fields ?? []).map((f) => FIELD_LABELS[f] ?? f)
      return t('{fields} must be filled', { fields: fields.join(', ') || '—' })
    }
    const a = rule.config.assignee ?? ''
    const target = a === 'actor' ? t('the person who moved it') : a === '' ? t('Unassigned') : userName(a)
    return t('Assigns the work item to {who}', { who: target })
  }

  const save = () => {
    setError(null)
    updateWorkflow.mutate(
      {
        ...(adminMode ? { name: wfName.trim() } : {}),
        statuses: placed.map((s) => ({ id: s.id, name: s.name, category: s.category, x: s.x, y: s.y })),
        transitions: transitions.map((tr) => ({
          name: tr.name,
          fromRef: tr.fromId,
          toRef: tr.toId,
          rules: tr.rules.map((r) => ({ kind: r.kind, config: r.config })),
        })),
      },
      {
        onSuccess: () => {
          dirtyRef.current = false
          setDirty(false)
          setSelection(null)
        },
        onError: (e) =>
          setError(e instanceof ApiError ? (Object.values(e.body.errors ?? {})[0] ?? e.message) : t('Save failed')),
      },
    )
  }

  const close = () => {
    if (dirty && !window.confirm(t('Discard unsaved workflow changes?'))) return
    navigate(adminMode ? '/admin/work-items/workflows' : `/projects/${projectKey}/settings/board`)
  }

  const patchStatus = (id: string, p: Partial<WfStatus>) => {
    setStatuses((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } : s)))
    markDirty()
  }

  const patchTransition = (id: string, p: Partial<WfTransition>) => {
    setTransitions((prev) => prev.map((tr) => (tr.id === id ? { ...tr, ...p } : tr)))
    markDirty()
  }

  const deleteStatus = (id: string) => {
    if (statuses.length <= 1) {
      setError(t('A workflow needs at least one status'))
      return
    }
    if (!window.confirm(t('Delete this status and every transition touching it?'))) return
    setStatuses((prev) => prev.filter((s) => s.id !== id))
    setTransitions((prev) => prev.filter((tr) => tr.fromId !== id && tr.toId !== id))
    setSelection(null)
    markDirty()
  }

  const deleteTransition = (id: string) => {
    setTransitions((prev) => prev.filter((tr) => tr.id !== id))
    setSelection(null)
    markDirty()
  }

  const addStatus = (name: string, category: Category) => {
    const maxX = placed.reduce((m, s) => Math.max(m, s.x), 0)
    const id = tmpId('tmp')
    setStatuses((prev) => [...prev, { id, name, category, x: maxX + 185 || 150, y: 280 }])
    setSelection({ kind: 'status', id })
    markDirty()
  }

  const addTransition = (name: string, fromId: string | null, toId: string) => {
    const id = tmpId('tr')
    setTransitions((prev) => [...prev, { id, name, fromId, toId, rules: [] }])
    setSelection({ kind: 'transition', id })
    markDirty()
  }

  const addRule = (transitionId: string, rule: WorkflowRule) => {
    setTransitions((prev) => prev.map((tr) => (tr.id === transitionId ? { ...tr, rules: [...tr.rules, rule] } : tr)))
    setSelection({ kind: 'transition', id: transitionId })
    markDirty()
  }

  const selectedStatus = selection?.kind === 'status' ? placed.find((s) => s.id === selection.id) : undefined
  const selectedTransition = selection?.kind === 'transition' ? transitions.find((tr) => tr.id === selection.id) : undefined
  const ruleCount = transitions.reduce((n, tr) => n + tr.rules.length, 0)

  if (!data) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  return (
    <div
      style={{
        margin: '-16px -40px -40px',
        height: 'calc(100vh - 48px)',
        display: 'flex',
        flexDirection: 'column',
        background: token('elevation.surface', '#FFFFFF'),
      }}
    >
      {/* header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
          borderBottom: `1px solid ${border}`, flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          {adminMode ? (
            <input
              value={wfName}
              onChange={(e) => { setWfName(e.target.value); markDirty() }}
              aria-label={t('Workflow name')}
              style={{
                fontSize: 16, fontWeight: 700, border: 'none', background: 'transparent',
                color: 'inherit', outline: 'none', width: 320, borderBottom: `1px dashed ${border}`,
              }}
            />
          ) : (
            <div style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {t('Workflow for {name}', { name: project?.name ?? projectKey ?? '' })}
            </div>
          )}
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 4, padding: '2px 8px',
              border: `1px solid ${border}`, borderRadius: 4, fontSize: 12, ...subtleText,
            }}
          >
            {(data.usedIn ?? []).length === 0
              ? t('Not used by any space')
              : (data.usedIn ?? []).length === 1
                ? t('Used in 1 space')
                : t('Used in {n} spaces', { n: (data.usedIn ?? []).length })}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <Button appearance="subtle" onClick={() => setModal('status')}>{t('Add status')}</Button>
          <Button appearance="subtle" onClick={() => setModal('transition')} isDisabled={statuses.length < 1}>
            {t('Add transition')}
          </Button>
          <Button appearance="subtle" onClick={() => setModal('rule')} isDisabled={transitions.length === 0}>
            {t('Add rule')}{ruleCount > 0 ? ` (${ruleCount})` : ''}
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button appearance="primary" onClick={save} isDisabled={!dirty} isLoading={updateWorkflow.isPending}>
            {t('Update workflow')}
          </Button>
          <Button onClick={close}>{t('Close')}</Button>
        </div>
      </div>

      {/* view toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px 0' }}>
        <div style={{ display: 'inline-flex', border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden' }}>
          {(['diagram', 'text'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: '5px 16px', fontSize: 13, cursor: 'pointer', border: 'none',
                background: view === v ? token('color.background.selected', '#E9F2FF') : 'transparent',
                color: view === v ? token('color.text.selected', '#0C66E4') : 'inherit',
                fontWeight: view === v ? 600 : 400,
              }}
            >
              {v === 'diagram' ? t('Diagram') : t('Text')}
            </button>
          ))}
        </div>
        {view === 'diagram' && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            {t('Show transition labels')}
          </label>
        )}
        <div style={{ flex: 1 }} />
        {error && <span style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 13 }}>{error}</span>}
      </div>

      {/* main */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {view === 'diagram' ? (
            <Diagram
              statuses={placed}
              transitions={transitions}
              selection={selection}
              showLabels={showLabels}
              onSelect={setSelection}
              onMove={(id, x, y) => patchStatus(id, { x, y })}
            />
          ) : (
            <TextView
              statuses={placed}
              transitions={transitions}
              byId={byId}
              selection={selection}
              onSelect={setSelection}
              onDeleteStatus={deleteStatus}
              onDeleteTransition={deleteTransition}
            />
          )}
        </div>

        {/* side panel */}
        <div style={{ width: 320, borderLeft: `1px solid ${border}`, padding: 20, overflowY: 'auto', flexShrink: 0 }}>
          {selectedStatus ? (
            <StatusPanel
              status={selectedStatus}
              isOnly={statuses.length <= 1}
              onPatch={(p) => patchStatus(selectedStatus.id, p)}
              onDelete={() => deleteStatus(selectedStatus.id)}
            />
          ) : selectedTransition ? (
            <TransitionPanel
              transition={selectedTransition}
              statuses={placed}
              describeRule={describeRule}
              onPatch={(p) => patchTransition(selectedTransition.id, p)}
              onDeleteRule={(i) =>
                patchTransition(selectedTransition.id, { rules: selectedTransition.rules.filter((_, j) => j !== i) })
              }
              onAddRule={() => setModal('rule')}
              onDelete={() => deleteTransition(selectedTransition.id)}
            />
          ) : (
            <HelpPanel />
          )}
        </div>
      </div>

      <ModalTransition>
        {modal === 'status' && (
          <AddStatusModal
            onAdd={(name, cat) => { addStatus(name, cat); setModal(null) }}
            onClose={() => setModal(null)}
            existing={statuses.map((s) => s.name.toLowerCase())}
          />
        )}
        {modal === 'transition' && (
          <AddTransitionModal
            statuses={placed}
            onAdd={(name, from, to) => { addTransition(name, from, to); setModal(null) }}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'rule' && (
          <AddRuleModal
            transitions={transitions}
            byId={byId}
            initialTransition={selectedTransition?.id}
            members={memberUsers}
            onAdd={(trId, rule) => { addRule(trId, rule); setModal(null) }}
            onClose={() => setModal(null)}
          />
        )}
      </ModalTransition>
    </div>
  )
}

// ---- diagram ----

function Diagram({
  statuses, transitions, selection, showLabels, onSelect, onMove,
}: {
  statuses: (WfStatus & { x: number; y: number })[]
  transitions: WfTransition[]
  selection: Selection
  showLabels: boolean
  onSelect: (s: Selection) => void
  onMove: (id: string, x: number, y: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 800, h: 500 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const dragRef = useRef<
    | { kind: 'node'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
    | null
  >(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const byId = useMemo(() => new Map(statuses.map((s) => [s.id, s])), [statuses])
  const specific = transitions.filter((tr) => tr.fromId != null)
  const globals = transitions.filter((tr) => tr.fromId == null)
  const globalsByTarget = new Map<string, WfTransition[]>()
  for (const g of globals) {
    globalsByTarget.set(g.toId, [...(globalsByTarget.get(g.toId) ?? []), g])
  }
  const initial = statuses[0]

  const onPointerDown = (e: React.PointerEvent) => {
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y, moved: false }
  }
  const nodePointerDown = (e: React.PointerEvent, s: WfStatus & { x: number; y: number }) => {
    e.stopPropagation()
    ;(e.currentTarget.closest('svg') as SVGSVGElement).setPointerCapture(e.pointerId)
    dragRef.current = { kind: 'node', id: s.id, sx: e.clientX, sy: e.clientY, ox: s.x, oy: s.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true
    if (d.kind === 'pan') setPan({ x: d.ox + dx, y: d.oy + dy })
    else onMove(d.id, d.ox + dx / zoom, d.oy + dy / zoom)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d || d.moved) return
    if (d.kind === 'pan') onSelect(null)
    else onSelect({ kind: 'status', id: d.id })
    e.stopPropagation()
  }

  // Minimap geometry.
  const bbox = useMemo(() => {
    if (statuses.length === 0) return { x: 0, y: 0, w: 800, h: 500 }
    const xs = statuses.map((s) => s.x)
    const ys = statuses.map((s) => s.y)
    const minX = Math.min(...xs) - 120
    const minY = Math.min(...ys) - 120
    const maxX = Math.max(...statuses.map((s) => s.x + nodeW(s.name))) + 120
    const maxY = Math.max(...ys) + 140
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }, [statuses])
  const miniScale = Math.min(200 / bbox.w, 110 / bbox.h)
  const miniClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const wx = bbox.x + (e.clientX - rect.left) / miniScale
    const wy = bbox.y + (e.clientY - rect.top) / miniScale
    setPan({ x: size.w / 2 - wx * zoom, y: size.h / 2 - wy * zoom })
  }

  const edgeColor = token('color.text.subtlest', '#758195')
  const selColor = token('color.border.selected', '#0C66E4')

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <svg
        width={size.w}
        height={size.h}
        style={{ display: 'block', cursor: 'grab', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        data-testid="workflow-canvas"
      >
        <defs>
          <marker id="wf-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0.5 L8,4.5 L0,8.5" fill="none" stroke={edgeColor} strokeWidth="1.4" />
          </marker>
          <marker id="wf-arrow-sel" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto">
            <path d="M0,0.5 L8,4.5 L0,8.5" fill="none" stroke={selColor} strokeWidth="1.6" />
          </marker>
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {/* START marker into the initial status */}
          {initial && (
            <g>
              <circle cx={initial.x - 70} cy={initial.y - 42} r={15} fill="#44546F" />
              <text x={initial.x - 70} y={initial.y - 39} textAnchor="middle" fontSize={6.5} fontWeight={700} fill="#FFFFFF">
                START
              </text>
              <path
                d={`M ${initial.x - 70} ${initial.y - 26} L ${initial.x - 70} ${initial.y + NODE_H / 2 - 13} L ${initial.x - 6} ${initial.y + NODE_H / 2 - 13}`}
                fill="none"
                stroke={edgeColor}
                strokeWidth={1.4}
                markerEnd="url(#wf-arrow)"
              />
            </g>
          )}

          {/* specific transitions */}
          {specific.map((tr) => {
            const a = byId.get(tr.fromId!)
            const b = byId.get(tr.toId)
            if (!a || !b) return null
            const aw = nodeW(a.name)
            const bw = nodeW(b.name)
            const ac = { x: a.x + aw / 2, y: a.y + NODE_H / 2 }
            const bc = { x: b.x + bw / 2, y: b.y + NODE_H / 2 }
            const hasReverse = specific.some((o) => o.fromId === tr.toId && o.toId === tr.fromId)
            const off = hasReverse ? (tr.fromId! < tr.toId ? 26 : -26) : 0
            const p1 = anchor(ac.x, ac.y, aw + 8, NODE_H + 8, bc.x, bc.y)
            const p2 = anchor(bc.x, bc.y, bw + 12, NODE_H + 12, ac.x, ac.y)
            const mx = (p1.x + p2.x) / 2
            const my = (p1.y + p2.y) / 2
            const len = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1
            const nx = -(p2.y - p1.y) / len
            const ny = (p2.x - p1.x) / len
            const cx = mx + nx * off
            const cy = my + ny * off
            const isSel = selection?.kind === 'transition' && selection.id === tr.id
            const lx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x
            const ly = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y
            return (
              <g
                key={tr.id}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'transition', id: tr.id }) }}
                style={{ cursor: 'pointer' }}
              >
                <path d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`} fill="none" stroke="transparent" strokeWidth={12} />
                <path
                  d={`M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke={isSel ? selColor : edgeColor}
                  strokeWidth={isSel ? 2 : 1.4}
                  markerEnd={isSel ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'}
                />
                {(showLabels || isSel) && (
                  <g>
                    <rect
                      x={lx - tr.name.length * 3.1 - 4}
                      y={ly - 9}
                      width={tr.name.length * 6.2 + 8}
                      height={15}
                      rx={3}
                      fill={token('elevation.surface', '#FFFFFF')}
                      stroke={isSel ? selColor : border}
                    />
                    <text x={lx} y={ly + 2.5} textAnchor="middle" fontSize={9.5} fill={isSel ? selColor : edgeColor}>
                      {tr.name}
                    </text>
                  </g>
                )}
                {tr.rules.length > 0 && (
                  <text x={lx} y={ly - (showLabels || isSel ? 13 : -3)} textAnchor="middle" fontSize={9}>⚡</text>
                )}
              </g>
            )
          })}

          {/* status nodes with their "Any" badges */}
          {statuses.map((s) => {
            const w = nodeW(s.name)
            const c = CAT[s.category]
            const isSel = selection?.kind === 'status' && selection.id === s.id
            const anys = globalsByTarget.get(s.id) ?? []
            return (
              <g key={s.id}>
                {anys.map((g, i) => {
                  const gSel = selection?.kind === 'transition' && selection.id === g.id
                  const bx = s.x + w - 20
                  const by = s.y - 30 - i * 24
                  return (
                    <g
                      key={g.id}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onSelect({ kind: 'transition', id: g.id }) }}
                      style={{ cursor: 'pointer' }}
                      data-testid="any-badge"
                    >
                      <path
                        d={`M ${bx + 8} ${by + 18} C ${bx - 6} ${by + 26}, ${bx - 6} ${by + 26}, ${bx + 2} ${s.y - 2 - i * 0}`}
                        fill="none"
                        stroke={gSel ? selColor : edgeColor}
                        strokeWidth={gSel ? 1.8 : 1.2}
                        markerEnd={gSel ? 'url(#wf-arrow-sel)' : 'url(#wf-arrow)'}
                      />
                      <rect x={bx} y={by} width={46} height={18} rx={9}
                        fill={token('elevation.surface', '#FFFFFF')}
                        stroke={gSel ? selColor : '#B3B9C4'} strokeWidth={gSel ? 1.6 : 1} />
                      <text x={bx + 23} y={by + 12.5} textAnchor="middle" fontSize={9} fontWeight={700} fill="#44546F">
                        {g.rules.length > 0 ? '⚡ ' : ''}Any
                      </text>
                    </g>
                  )
                })}
                <g
                  onPointerDown={(e) => nodePointerDown(e, s)}
                  style={{ cursor: 'move' }}
                  data-testid={`node-${s.name}`}
                >
                  <rect
                    x={s.x} y={s.y} width={w} height={NODE_H} rx={3}
                    fill={c.bg}
                    stroke={isSel ? selColor : c.border}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <text
                    x={s.x + w / 2} y={s.y + NODE_H / 2 + 3.5} textAnchor="middle"
                    fontSize={10.5} fontWeight={700} fill={c.fg} style={{ userSelect: 'none', textTransform: 'uppercase' }}
                  >
                    {s.name.toUpperCase()}
                  </text>
                </g>
              </g>
            )
          })}
        </g>
      </svg>

      {/* minimap + zoom, like Jira's bottom-right cluster */}
      <div
        style={{
          position: 'absolute', right: 16, bottom: 16, background: token('elevation.surface', '#FFFFFF'),
          border: `1px solid ${border}`, borderRadius: 6, padding: 8,
          boxShadow: token('elevation.shadow.overlay', '0 4px 8px rgba(9,30,66,0.16)'),
        }}
      >
        <svg width={200} height={110} onClick={miniClick} style={{ cursor: 'pointer', display: 'block' }}>
          <rect x={0} y={0} width={200} height={110} fill="transparent" stroke={border} />
          {statuses.map((s) => (
            <rect
              key={s.id}
              x={(s.x - bbox.x) * miniScale}
              y={(s.y - bbox.y) * miniScale}
              width={Math.max(4, nodeW(s.name) * miniScale)}
              height={Math.max(2.5, NODE_H * miniScale)}
              rx={1}
              fill={CAT[s.category].fg}
            />
          ))}
          <rect
            x={(-pan.x / zoom - bbox.x) * miniScale}
            y={(-pan.y / zoom - bbox.y) * miniScale}
            width={(size.w / zoom) * miniScale}
            height={(size.h / zoom) * miniScale}
            fill="rgba(12,102,228,0.08)"
            stroke={selColor}
          />
        </svg>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))} style={zoomBtn} aria-label={t('Zoom out')}>−</button>
          <input
            type="range" min={40} max={200} value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
            style={{ flex: 1 }}
          />
          <button type="button" onClick={() => setZoom((z) => Math.min(2, z + 0.15))} style={zoomBtn} aria-label={t('Zoom in')}>+</button>
        </div>
      </div>
    </div>
  )
}

const zoomBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 4, border: 'none', background: 'transparent',
  cursor: 'pointer', fontSize: 14, lineHeight: '20px',
}

// ---- text view ----

function TextView({
  statuses, transitions, byId, selection, onSelect, onDeleteStatus, onDeleteTransition,
}: {
  statuses: (WfStatus & { x: number; y: number })[]
  transitions: WfTransition[]
  byId: Map<string, WfStatus & { x: number; y: number }>
  selection: Selection
  onSelect: (s: Selection) => void
  onDeleteStatus: (id: string) => void
  onDeleteTransition: (id: string) => void
}) {
  const rowStyle = (sel: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', cursor: 'pointer',
    borderBottom: `1px solid ${border}`,
    background: sel ? token('color.background.selected', '#E9F2FF') : 'transparent',
  })
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '16px 20px 40px' }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0' }}>{t('Statuses')}</h3>
      <div style={{ border: `1px solid ${border}`, borderRadius: 6, marginBottom: 24 }}>
        {statuses.map((s) => (
          <div key={s.id} style={rowStyle(selection?.kind === 'status' && selection.id === s.id)} onClick={() => onSelect({ kind: 'status', id: s.id })}>
            <Lozenge appearance={lozengeFor[s.category]} isBold={s.category === 'in_progress'}>{s.name}</Lozenge>
            <span style={{ fontSize: 12, ...subtleText }}>{CAT[s.category].label}</span>
            <span style={{ flex: 1 }} />
            <Button appearance="subtle" spacing="compact" onClick={(e) => { e.stopPropagation(); onDeleteStatus(s.id) }}>
              {t('Delete')}
            </Button>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, margin: '8px 0' }}>{t('Transitions')}</h3>
      <div style={{ border: `1px solid ${border}`, borderRadius: 6 }}>
        {transitions.map((tr) => {
          const from = tr.fromId ? byId.get(tr.fromId) : null
          const to = byId.get(tr.toId)
          return (
            <div key={tr.id} style={rowStyle(selection?.kind === 'transition' && selection.id === tr.id)} onClick={() => onSelect({ kind: 'transition', id: tr.id })}>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 140 }}>{tr.name}</span>
              {from ? (
                <Lozenge appearance={lozengeFor[from.category]} isBold={from.category === 'in_progress'}>{from.name}</Lozenge>
              ) : (
                <span style={{ fontSize: 12, ...subtleText }}>{t('Any status')}</span>
              )}
              <span style={subtleText}>→</span>
              {to && <Lozenge appearance={lozengeFor[to.category]} isBold={to.category === 'in_progress'}>{to.name}</Lozenge>}
              {tr.rules.length > 0 && (
                <span style={{ fontSize: 12, ...subtleText }}>
                  ⚡ {tr.rules.length === 1 ? t('1 rule') : t('{n} rules', { n: tr.rules.length })}
                </span>
              )}
              <span style={{ flex: 1 }} />
              <Button appearance="subtle" spacing="compact" onClick={(e) => { e.stopPropagation(); onDeleteTransition(tr.id) }}>
                {t('Delete')}
              </Button>
            </div>
          )
        })}
        {transitions.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, ...subtleText }}>{t('No transitions yet.')}</div>
        )}
      </div>
    </div>
  )
}

// ---- side panels ----

const panelLabel: React.CSSProperties = { fontSize: 12, fontWeight: 600, margin: '14px 0 4px', ...subtleText }
const nativeSelect: React.CSSProperties = {
  width: '100%', padding: '7px 8px', borderRadius: 4, border: `1px solid ${border}`,
  background: 'transparent', fontSize: 14, color: 'inherit',
}

function StatusPanel({
  status, isOnly, onPatch, onDelete,
}: {
  status: WfStatus
  isOnly: boolean
  onPatch: (p: Partial<WfStatus>) => void
  onDelete: () => void
}) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('Status')}</h3>
      <div style={panelLabel}>{t('Name')}</div>
      <TextField value={status.name} onChange={(e) => onPatch({ name: (e.target as HTMLInputElement).value })} />
      <div style={panelLabel}>{t('Category')}</div>
      <select
        style={nativeSelect}
        value={status.category}
        onChange={(e) => onPatch({ category: e.target.value as Category })}
      >
        {(Object.keys(CAT) as Category[]).map((c) => (
          <option key={c} value={c}>{CAT[c].label}</option>
        ))}
      </select>
      <p style={{ fontSize: 12, margin: '10px 0 18px', ...subtleText }}>
        {t('Statuses appear as sections on the board. The category drives the status colour and resolution handling.')}
      </p>
      <Button appearance="danger" onClick={onDelete} isDisabled={isOnly}>{t('Delete status')}</Button>
    </div>
  )
}

function TransitionPanel({
  transition, statuses, describeRule, onPatch, onDeleteRule, onAddRule, onDelete,
}: {
  transition: WfTransition
  statuses: (WfStatus & { x: number; y: number })[]
  describeRule: (r: WorkflowRule) => string
  onPatch: (p: Partial<WfTransition>) => void
  onDeleteRule: (index: number) => void
  onAddRule: () => void
  onDelete: () => void
}) {
  return (
    <div>
      <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t('Transition')}</h3>
      <div style={panelLabel}>{t('Name')}</div>
      <TextField value={transition.name} onChange={(e) => onPatch({ name: (e.target as HTMLInputElement).value })} />
      <div style={panelLabel}>{t('From')}</div>
      <select
        style={nativeSelect}
        value={transition.fromId ?? ''}
        onChange={(e) => onPatch({ fromId: e.target.value || null })}
      >
        <option value="">{t('Any status')}</option>
        {statuses.filter((s) => s.id !== transition.toId).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <div style={panelLabel}>{t('To')}</div>
      <select
        style={nativeSelect}
        value={transition.toId}
        onChange={(e) => onPatch({ toId: e.target.value, fromId: transition.fromId === e.target.value ? null : transition.fromId })}
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <div style={panelLabel}>{t('Rules')}</div>
      {transition.rules.length === 0 && (
        <p style={{ fontSize: 12, margin: '2px 0 8px', ...subtleText }}>
          {t('No rules yet — restrict who can move work items, require fields, or auto-assign.')}
        </p>
      )}
      {transition.rules.map((rule, i) => (
        <div
          key={i}
          style={{
            display: 'flex', gap: 8, alignItems: 'flex-start', border: `1px solid ${border}`,
            borderRadius: 6, padding: '8px 10px', marginBottom: 8, fontSize: 12,
          }}
        >
          <span>⚡</span>
          <span style={{ flex: 1 }}>{describeRule(rule)}</span>
          <button
            type="button"
            onClick={() => onDeleteRule(i)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', ...subtleText }}
            aria-label={t('Remove rule')}
          >
            ✕
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <Button spacing="compact" onClick={onAddRule}>{t('Add rule')}</Button>
        <Button spacing="compact" appearance="danger" onClick={onDelete}>{t('Delete transition')}</Button>
      </div>
    </div>
  )
}

function HelpPanel() {
  return (
    <div>
      <div style={{ fontSize: 40, textAlign: 'center', margin: '20px 0' }}>🗺️</div>
      <h3 style={{ fontSize: 15, fontWeight: 700, textAlign: 'center', marginBottom: 10 }}>
        {t('Map work progress to team processes')}
      </h3>
      <p style={{ fontSize: 13, textAlign: 'center', ...subtleText }}>
        {t('Add statuses, which appear as sections on project boards. Create transition actions between statuses and automate repetitive actions using rules. Add, edit or delete from the workflow using the buttons above the diagram.')}
      </p>
      <ul style={{ fontSize: 12, marginTop: 16, paddingInlineStart: 18, display: 'grid', gap: 8, ...subtleText }}>
        <li>{t('Drag statuses to arrange the diagram; drag the background to pan.')}</li>
        <li>{t('Click a status or arrow to edit it in this panel.')}</li>
        <li>{t('“Any” badges are transitions available from every status.')}</li>
        <li>{t('Nothing changes until you press Update workflow.')}</li>
      </ul>
    </div>
  )
}

// ---- modals ----

function AddStatusModal({
  onAdd, onClose, existing,
}: {
  onAdd: (name: string, category: Category) => void
  onClose: () => void
  existing: string[]
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<Category>('todo')
  const dup = existing.includes(name.trim().toLowerCase())
  return (
    <Modal onClose={onClose}>
      <ModalHeader><ModalTitle>{t('Add status')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={panelLabel}>{t('Status name')}</div>
        <TextField autoFocus value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t('e.g. In review')} />
        {dup && <p style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12, marginTop: 4 }}>{t('That status already exists')}</p>}
        <div style={panelLabel}>{t('Category')}</div>
        <select style={nativeSelect} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
          {(Object.keys(CAT) as Category[]).map((c) => (
            <option key={c} value={c}>{CAT[c].label}</option>
          ))}
        </select>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button appearance="primary" isDisabled={!name.trim() || dup} onClick={() => onAdd(name.trim(), category)}>
          {t('Add')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function AddTransitionModal({
  statuses, onAdd, onClose,
}: {
  statuses: (WfStatus & { x: number; y: number })[]
  onAdd: (name: string, fromId: string | null, toId: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [fromId, setFromId] = useState<string>('')
  const [toId, setToId] = useState<string>(statuses[0]?.id ?? '')
  const invalid = fromId !== '' && fromId === toId
  return (
    <Modal onClose={onClose}>
      <ModalHeader><ModalTitle>{t('Add transition')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={panelLabel}>{t('Name')}</div>
        <TextField autoFocus value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t('e.g. Start review')} />
        <div style={panelLabel}>{t('From')}</div>
        <select style={nativeSelect} value={fromId} onChange={(e) => setFromId(e.target.value)}>
          <option value="">{t('Any status')}</option>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div style={panelLabel}>{t('To')}</div>
        <select style={nativeSelect} value={toId} onChange={(e) => setToId(e.target.value)}>
          {statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {invalid && <p style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12, marginTop: 6 }}>{t('A transition cannot point at its own source')}</p>}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button appearance="primary" isDisabled={!name.trim() || !toId || invalid} onClick={() => onAdd(name.trim(), fromId || null, toId)}>
          {t('Add')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function AddRuleModal({
  transitions, byId, initialTransition, members, onAdd, onClose,
}: {
  transitions: WfTransition[]
  byId: Map<string, WfStatus & { x: number; y: number }>
  initialTransition?: string
  members: { id: string; displayName: string }[]
  onAdd: (transitionId: string, rule: WorkflowRule) => void
  onClose: () => void
}) {
  const [trId, setTrId] = useState(initialTransition ?? transitions[0]?.id ?? '')
  const [kind, setKind] = useState<WorkflowRuleKind>('restrict-who')
  const [roles, setRoles] = useState<string[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [fields, setFields] = useState<string[]>([])
  const [assignee, setAssignee] = useState('actor')

  const toggle = (list: string[], set: (v: string[]) => void, v: string) =>
    set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const trLabel = (tr: WfTransition) => {
    const from = tr.fromId ? (byId.get(tr.fromId)?.name ?? '?') : t('Any status')
    const to = byId.get(tr.toId)?.name ?? '?'
    return `${tr.name} (${from} → ${to})`
  }

  const KINDS: { key: WorkflowRuleKind; title: string; hint: string }[] = [
    { key: 'restrict-who', title: t('Restrict who can move an item'), hint: t('Only the selected people and roles can make the transition.') },
    { key: 'required-field', title: t('Check that a field is filled'), hint: t('Block the transition until the selected fields have values.') },
    { key: 'auto-assign', title: t('Assign the work item'), hint: t('Automatically change the assignee when the transition runs.') },
  ]

  const valid =
    trId !== '' &&
    (kind === 'restrict-who' ? roles.length + users.length > 0 : kind === 'required-field' ? fields.length > 0 : true)

  const build = (): WorkflowRule => {
    if (kind === 'restrict-who') return { kind, config: { roles, users } }
    if (kind === 'required-field') return { kind, config: { fields } }
    return { kind, config: { assignee } }
  }

  const checkRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '3px 0', cursor: 'pointer' }

  return (
    <Modal onClose={onClose}>
      <ModalHeader><ModalTitle>{t('Add rule')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={panelLabel}>{t('Transition')}</div>
        <select style={nativeSelect} value={trId} onChange={(e) => setTrId(e.target.value)}>
          {transitions.map((tr) => <option key={tr.id} value={tr.id}>{trLabel(tr)}</option>)}
        </select>

        <div style={panelLabel}>{t('Rule')}</div>
        <div style={{ display: 'grid', gap: 8 }}>
          {KINDS.map((k) => (
            <label
              key={k.key}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', border: `1px solid ${kind === k.key ? token('color.border.selected', '#0C66E4') : border}`,
                borderRadius: 6, padding: '10px 12px', cursor: 'pointer',
                background: kind === k.key ? token('color.background.selected', '#E9F2FF') : 'transparent',
              }}
            >
              <input type="radio" checked={kind === k.key} onChange={() => setKind(k.key)} style={{ marginTop: 3 }} />
              <span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{k.title}</div>
                <div style={{ fontSize: 12, ...subtleText }}>{k.hint}</div>
              </span>
            </label>
          ))}
        </div>

        {kind === 'restrict-who' && (
          <div style={{ marginTop: 12 }}>
            <div style={panelLabel}>{t('Roles')}</div>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <label key={value} style={checkRow}>
                <input type="checkbox" checked={roles.includes(value)} onChange={() => toggle(roles, setRoles, value)} />
                {label}
              </label>
            ))}
            <div style={panelLabel}>{t('People')}</div>
            <div style={{ maxHeight: 140, overflowY: 'auto' }}>
              {members.map((u) => (
                <label key={u.id} style={checkRow}>
                  <input type="checkbox" checked={users.includes(u.id)} onChange={() => toggle(users, setUsers, u.id)} />
                  {u.displayName}
                </label>
              ))}
            </div>
          </div>
        )}
        {kind === 'required-field' && (
          <div style={{ marginTop: 12 }}>
            <div style={panelLabel}>{t('Required fields')}</div>
            {Object.entries(FIELD_LABELS).map(([value, label]) => (
              <label key={value} style={checkRow}>
                <input type="checkbox" checked={fields.includes(value)} onChange={() => toggle(fields, setFields, value)} />
                {label}
              </label>
            ))}
          </div>
        )}
        {kind === 'auto-assign' && (
          <div style={{ marginTop: 12 }}>
            <div style={panelLabel}>{t('Assign to')}</div>
            <select style={nativeSelect} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="actor">{t('Person who ran the transition')}</option>
              <option value="">{t('Unassigned')}</option>
              {members.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
            </select>
          </div>
        )}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button appearance="primary" isDisabled={!valid} onClick={() => onAdd(trId, build())}>{t('Add rule')}</Button>
      </ModalFooter>
    </Modal>
  )
}
