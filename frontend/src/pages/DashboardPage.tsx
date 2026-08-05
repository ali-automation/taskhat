import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button, { IconButton } from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Lozenge from '@atlaskit/lozenge'
import Select from '@atlaskit/select'
import Spinner from '@atlaskit/spinner'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAddGadget, useDashboard, useDeleteDashboard, useDeleteGadget, useGadgetActivity,
  useGadgetBurndown, useGadgetPie, useProjects, useProjectSummary, useSaveLayout,
  useSearch, useUpdateGadget,
} from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { t, timeAgo } from '../i18n'
import BurndownChart from '../components/BurndownChart'
import { ShowMoreHorizontalIcon } from '../components/coreIcons'
import { IssueTypeIcon } from '../components/icons'
import { DashboardModal } from './DashboardsPage'
import type { Dashboard, DashboardGadget, GadgetType, StatusCategory } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }
const STATUS_APPEARANCE: Record<StatusCategory, 'default' | 'inprogress' | 'success'> = {
  todo: 'default',
  in_progress: 'inprogress',
  done: 'success',
}
const categoryColor: Record<string, string> = { todo: '#8590A2', in_progress: '#357DE8', done: '#22A06B' }
const piePalette = ['#357DE8', '#22A06B', '#E2483D', '#F5CD47', '#9F8FEF', '#8590A2', '#579DFF', '#FCA700']

// The gadget catalog shown in the "Add a gadget" panel, like Jira's directory.
const CATALOG: { type: GadgetType; name: string; desc: string; config: Record<string, unknown> }[] = [
  { type: 'tql_list', name: t('Work items (TQL)'), desc: t('A list of work items from a TQL query — use currentUser() for the viewer.'), config: { tql: '' } },
  { type: 'pie_chart', name: t('Pie chart'), desc: t('Work items grouped by status, type, priority or assignee.'), config: { tql: '', by: 'status' } },
  { type: 'activity', name: t('Activity stream'), desc: t('Recent activity across your spaces, or a single space.'), config: {} },
  { type: 'workload', name: t('Workload'), desc: t('Open work items per assignee in a space.'), config: {} },
  { type: 'burndown', name: t('Sprint burndown'), desc: t('The burndown chart of a space’s active sprint.'), config: {} },
  { type: 'quick_links', name: t('Quick links'), desc: t('A list of handy links for your team.'), config: { links: [] } },
  { type: 'text', name: t('Text'), desc: t('A block of text — introductions, notices, instructions.'), config: { text: '' } },
]

function describeActivity(field: string, newValue: string): string {
  const clean = newValue.replaceAll('"', '')
  switch (field) {
    case 'created': return t('created')
    case 'status': return t('moved to {status}', { status: clean })
    case 'comment': return t('commented on')
    case 'attachment': return t('attached a file to')
    default: return t('updated {field} on', { field })
  }
}

// ---- gadget bodies ----

function TextGadget({ config }: { config: Record<string, unknown> }) {
  return <div style={{ fontSize: 14, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{String(config.text ?? '')}</div>
}

function TqlListGadget({ config }: { config: Record<string, unknown> }) {
  const tql = String(config.tql ?? '')
  const { data, isLoading, error } = useSearch(tql, 0, !!tql)
  if (isLoading) return <Spinner />
  if (error) return <span style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error instanceof ApiError ? (Object.values(error.body.errors)[0] ?? error.message) : t('Query failed')}</span>
  const issues = data?.values ?? []
  return (
    <div>
      <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {issues.map((i) => (
          <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', fontSize: 14 }}>
            <IssueTypeIcon type={i.type} />
            <Link to={`/browse/${i.key}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{i.key}</Link>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
            <Lozenge appearance={STATUS_APPEARANCE[i.status.category] ?? 'default'}>{i.status.name}</Lozenge>
          </div>
        ))}
        {issues.length === 0 && <span style={{ fontSize: 13, ...subtleText }}>{t('No matching work items.')}</span>}
      </div>
      {data && data.total > issues.length && (
        <div style={{ marginTop: 6, fontSize: 12, ...subtleText }}>
          {t('Showing {shown} of {total}', { shown: issues.length, total: data.total })} — <Link to={`/issues?tql=${encodeURIComponent(tql)}`}>{t('view all')}</Link>
        </div>
      )}
    </div>
  )
}

function PieGadget({ config }: { config: Record<string, unknown> }) {
  const by = String(config.by ?? 'status')
  const { data, isLoading, error } = useGadgetPie(String(config.tql ?? ''), by, true)
  if (isLoading) return <Spinner />
  if (error) return <span style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{t('Query failed')}</span>
  const slices = data?.values ?? []
  const total = slices.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) return <span style={{ fontSize: 13, ...subtleText }}>{t('No matching work items.')}</span>

  const size = 150, r = 56, stroke = 22, c = 2 * Math.PI * r
  const gap = slices.length > 1 ? 2 : 0
  let offset = 0
  const segments = slices.map((s, i) => {
    const frac = s.count / total
    const len = Math.max(frac * c - gap, 1)
    const color = by === 'status' ? (categoryColor[s.category] ?? piePalette[i % piePalette.length]) : piePalette[i % piePalette.length]
    const seg = { color, dash: `${len} ${c - len}`, offset }
    offset -= frac * c
    return seg
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('Work items by {by}', { by })}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={token('color.background.neutral', '#F1F2F4')} strokeWidth={stroke} />
        {segments.map((s, i) => (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={stroke}
            strokeDasharray={s.dash} strokeDashoffset={s.offset} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        ))}
        <text x="50%" y="52%" textAnchor="middle" fontSize="24" fontWeight="600" fill="currentColor">{total}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {slices.map((s, i) => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, flexShrink: 0, background: segments[i].color }} />
            <span style={{ minWidth: 90 }}>{s.label}</span>
            <span style={{ fontWeight: 600 }}>{s.count}</span>
            <span style={subtleText}>({Math.round((s.count / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function BurndownGadget({ config }: { config: Record<string, unknown> }) {
  const project = String(config.project ?? '')
  const { data, isLoading } = useGadgetBurndown(project, !!project)
  if (!project) return <span style={{ fontSize: 13, ...subtleText }}>{t('Choose a space in the gadget settings.')}</span>
  if (isLoading) return <Spinner />
  if (!data?.sprint) return <span style={{ fontSize: 13, ...subtleText }}>{t('No active sprint in {project}.', { project })}</span>
  return (
    <div>
      <div style={{ fontSize: 12, marginBottom: 6, ...subtleText }}>{data.sprint.name}</div>
      <BurndownChart sprintId={data.sprint.id} />
    </div>
  )
}

function WorkloadGadget({ config }: { config: Record<string, unknown> }) {
  const project = String(config.project ?? '')
  const { data, isLoading } = useProjectSummary(project || undefined)
  if (!project) return <span style={{ fontSize: 13, ...subtleText }}>{t('Choose a space in the gadget settings.')}</span>
  if (isLoading || !data) return <Spinner />
  const workload = data.workload ?? []
  const maxLoad = Math.max(1, ...workload.map((w) => w.openCount))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {workload.map((w, i) => (
        <div key={w.user?.id ?? `unassigned-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {w.user ? <Avatar size="small" name={w.user.displayName} src={w.user.avatarUrl ?? undefined} /> : <Avatar size="small" />}
          <span style={{ width: 120, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {w.user?.displayName ?? <span style={subtleText}>{t('Unassigned')}</span>}
          </span>
          <div style={{ flex: 1, height: 8, background: token('color.background.neutral', '#F1F2F4'), borderRadius: 4 }}>
            <div style={{ width: `${(w.openCount / maxLoad) * 100}%`, height: 8, borderRadius: 4, background: '#357DE8' }} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, width: 24, textAlign: 'end' }}>{w.openCount}</span>
        </div>
      ))}
      {workload.length === 0 && <span style={{ fontSize: 13, ...subtleText }}>{t('No open work items.')}</span>}
    </div>
  )
}

function ActivityGadget({ config }: { config: Record<string, unknown> }) {
  const { data, isLoading } = useGadgetActivity(String(config.project ?? ''))
  if (isLoading) return <Spinner />
  const entries = data?.values ?? []
  return (
    <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {entries.map((a, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <Avatar size="xsmall" name={a.actor.displayName} src={a.actor.avatarUrl ?? undefined} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{a.actor.displayName}</strong> {describeActivity(a.field, a.newValue)}{' '}
            <Link to={`/browse/${a.issueKey}`}>{a.issueKey}</Link>
            <span style={subtleText}> — {a.issueSummary}</span>
          </span>
          <span style={{ marginInlineStart: 'auto', flexShrink: 0, fontSize: 11, ...subtleText }}>{timeAgo(a.createdAt)}</span>
        </div>
      ))}
      {entries.length === 0 && <span style={{ fontSize: 13, ...subtleText }}>{t('No activity yet.')}</span>}
    </div>
  )
}

function QuickLinksGadget({ config }: { config: Record<string, unknown> }) {
  const links = (config.links as { label: string; url: string }[] | undefined) ?? []
  if (links.length === 0) return <span style={{ fontSize: 13, ...subtleText }}>{t('Add links in the gadget settings.')}</span>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {links.map((l, i) => (
        <a key={i} href={l.url} target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
          {l.label || l.url}
        </a>
      ))}
    </div>
  )
}

function GadgetBody({ gadget }: { gadget: DashboardGadget }) {
  switch (gadget.type) {
    case 'text': return <TextGadget config={gadget.config} />
    case 'tql_list': return <TqlListGadget config={gadget.config} />
    case 'pie_chart': return <PieGadget config={gadget.config} />
    case 'burndown': return <BurndownGadget config={gadget.config} />
    case 'workload': return <WorkloadGadget config={gadget.config} />
    case 'activity': return <ActivityGadget config={gadget.config} />
    case 'quick_links': return <QuickLinksGadget config={gadget.config} />
  }
}

// A gadget with empty required settings opens its settings form automatically.
function needsConfig(g: DashboardGadget): boolean {
  switch (g.type) {
    case 'text': return !g.config.text
    case 'tql_list': return !g.config.tql
    case 'burndown':
    case 'workload': return !g.config.project
    case 'quick_links': return !(g.config.links as unknown[] | undefined)?.length
    default: return false
  }
}

const PIE_BY_OPTIONS = [
  { label: t('Status'), value: 'status' },
  { label: t('Type'), value: 'type' },
  { label: t('Priority'), value: 'priority' },
  { label: t('Assignee'), value: 'assignee' },
]

// ---- gadget settings form ----

function GadgetSettings({
  dashboardId,
  gadget,
  onDone,
}: {
  dashboardId: string
  gadget: DashboardGadget
  onDone: () => void
}) {
  const update = useUpdateGadget(dashboardId)
  const { data: projects } = useProjects()
  const [title, setTitle] = useState(gadget.title)
  const [config, setConfig] = useState<Record<string, unknown>>(gadget.config)
  const [error, setError] = useState<string | null>(null)
  const set = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }))

  const spaceOptions = (projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))
  const links = (config.links as { label: string; url: string }[] | undefined) ?? []

  const save = () => {
    setError(null)
    update.mutate(
      { gadgetId: gadget.id, type: gadget.type, title: title.trim() || gadget.title, config },
      {
        onSuccess: onDone,
        onError: (e) => setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Save failed')),
      },
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Title')}</div>
        <TextField value={title} onChange={(e) => setTitle((e.target as HTMLInputElement).value)} />
      </div>

      {gadget.type === 'text' && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Text')}</div>
          <TextArea value={String(config.text ?? '')} onChange={(e) => set('text', e.target.value)} minimumRows={4} />
        </div>
      )}

      {(gadget.type === 'tql_list' || gadget.type === 'pie_chart') && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
            {t('TQL query')}{gadget.type === 'pie_chart' ? t(' (optional — empty means all your work items)') : ''}
          </div>
          <TextField
            value={String(config.tql ?? '')}
            onChange={(e) => set('tql', (e.target as HTMLInputElement).value)}
            placeholder="project = TH AND resolution = EMPTY ORDER BY updated DESC"
          />
        </div>
      )}

      {gadget.type === 'pie_chart' && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Group by')}</div>
          <Select
            spacing="compact"
            options={PIE_BY_OPTIONS}
            value={PIE_BY_OPTIONS.find((o) => o.value === (config.by ?? 'status'))}
            onChange={(o) => set('by', o?.value ?? 'status')}
          />
        </div>
      )}

      {(gadget.type === 'burndown' || gadget.type === 'workload' || gadget.type === 'activity') && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Space')}</div>
          <Select
            spacing="compact"
            isClearable={gadget.type === 'activity'}
            placeholder={gadget.type === 'activity' ? t('All spaces') : t('Choose a space')}
            options={spaceOptions}
            value={spaceOptions.find((o) => o.value === config.project) ?? null}
            onChange={(o) => set('project', o?.value ?? '')}
          />
        </div>
      )}

      {gadget.type === 'quick_links' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{t('Links')}</div>
          {links.map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 6 }}>
              <TextField value={l.label} placeholder={t('Label')}
                onChange={(e) => set('links', links.map((x, j) => (j === i ? { ...x, label: (e.target as HTMLInputElement).value } : x)))} />
              <TextField value={l.url} placeholder="https://…"
                onChange={(e) => set('links', links.map((x, j) => (j === i ? { ...x, url: (e.target as HTMLInputElement).value } : x)))} />
              <Button appearance="subtle" spacing="compact" onClick={() => set('links', links.filter((_, j) => j !== i))}>✕</Button>
            </div>
          ))}
          <div>
            <Button spacing="compact" onClick={() => set('links', [...links, { label: '', url: '' }])}>{t('Add link')}</Button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button appearance="primary" spacing="compact" onClick={save} isLoading={update.isPending}>{t('Save')}</Button>
        <Button appearance="subtle" spacing="compact" onClick={onDone}>{t('Cancel')}</Button>
      </div>
    </div>
  )
}

// ---- gadget frame + layout ----

function GadgetFrame({
  dashboard,
  gadget,
  canEdit,
  onMove,
}: {
  dashboard: Dashboard
  gadget: DashboardGadget
  canEdit: boolean
  onMove: (gadget: DashboardGadget, action: 'up' | 'down' | 'across') => void
}) {
  const deleteGadget = useDeleteGadget(dashboard.id)
  const [editing, setEditing] = useState(canEdit && needsConfig(gadget))

  return (
    <div
      style={{
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 8,
        background: token('elevation.surface.raised', '#FFFFFF'),
        boxShadow: token('elevation.shadow.raised', '0 1px 1px rgba(9,30,66,0.25)'),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 8px 6px 16px' }}>
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{gadget.title}</span>
        {canEdit && (
          <DropdownMenu<HTMLButtonElement>
            trigger={({ triggerRef, ...props }) => (
              <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('Gadget options')} appearance="subtle" spacing="compact" />
            )}
            shouldRenderToParent
          >
            <DropdownItemGroup>
              <DropdownItem onClick={() => setEditing(true)}>{t('Edit settings')}</DropdownItem>
              <DropdownItem onClick={() => onMove(gadget, 'up')}>{t('Move up')}</DropdownItem>
              <DropdownItem onClick={() => onMove(gadget, 'down')}>{t('Move down')}</DropdownItem>
              <DropdownItem onClick={() => onMove(gadget, 'across')}>
                {gadget.col === 0 ? t('Move right') : t('Move left')}
              </DropdownItem>
            </DropdownItemGroup>
            <DropdownItemGroup hasSeparator>
              <DropdownItem onClick={() => deleteGadget.mutate(gadget.id)}>{t('Remove')}</DropdownItem>
            </DropdownItemGroup>
          </DropdownMenu>
        )}
      </div>
      <div style={{ padding: '4px 16px 14px' }}>
        {editing ? (
          <GadgetSettings dashboardId={dashboard.id} gadget={gadget} onDone={() => setEditing(false)} />
        ) : (
          <GadgetBody gadget={gadget} />
        )}
      </div>
    </div>
  )
}

function AddGadgetPanel({ dashboardId, onClose }: { dashboardId: string; onClose: () => void }) {
  const addGadget = useAddGadget(dashboardId)
  return (
    <div
      style={{
        width: 340,
        flexShrink: 0,
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 8,
        background: token('elevation.surface', '#FFFFFF'),
        padding: 16,
        alignSelf: 'flex-start',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>{t('Add a gadget')}</span>
        <Button appearance="subtle" spacing="compact" onClick={onClose}>{t('Close')}</Button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {CATALOG.map((c) => (
          <div key={c.type} style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{c.name}</span>
              <Button
                spacing="compact"
                isLoading={addGadget.isPending && addGadget.variables?.type === c.type}
                onClick={() => addGadget.mutate({ type: c.type, title: c.type === 'tql_list' ? t('Work items') : c.name, config: c.config })}
              >
                {t('Add')}
              </Button>
            </div>
            <div style={{ fontSize: 12, marginTop: 2, ...subtleText }}>{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const { data: dashboard, isLoading } = useDashboard(id)
  const saveLayout = useSaveLayout(dashboard?.id ?? '')
  const deleteDashboard = useDeleteDashboard()
  const [adding, setAdding] = useState(false)
  const [editingDetails, setEditingDetails] = useState(false)

  const columns = useMemo(() => {
    const cols: DashboardGadget[][] = [[], []]
    for (const g of dashboard?.gadgets ?? []) cols[g.col === 0 ? 0 : 1].push(g)
    return cols
  }, [dashboard])

  if (isLoading || !dashboard) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  const canEdit = dashboard.owner ? dashboard.owner.id === user?.id : isAdmin

  // Moves recompute the full layout and persist it in one call.
  const move = (gadget: DashboardGadget, action: 'up' | 'down' | 'across') => {
    const cols = columns.map((c) => [...c])
    const from = gadget.col === 0 ? 0 : 1
    const idx = cols[from].findIndex((g) => g.id === gadget.id)
    if (action === 'across') {
      cols[from].splice(idx, 1)
      cols[1 - from].push(gadget)
    } else {
      const swap = action === 'up' ? idx - 1 : idx + 1
      if (swap < 0 || swap >= cols[from].length) return
      ;[cols[from][idx], cols[from][swap]] = [cols[from][swap], cols[from][idx]]
    }
    saveLayout.mutate(cols.flatMap((col, c) => col.map((g, i) => ({ id: g.id, col: c, position: i }))))
  }

  return (
    <div style={{ maxWidth: adding ? 1400 : 1100 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        <Link to="/dashboards" style={subtleText}>{t('Dashboards')}</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {dashboard.name}
            {dashboard.isDefault && <Lozenge appearance="inprogress">{t('Default')}</Lozenge>}
          </h1>
          {dashboard.description && <div style={{ fontSize: 13, marginTop: 4, ...subtleText }}>{dashboard.description}</div>}
        </div>
        {canEdit && (
          <>
            <Button appearance="primary" onClick={() => setAdding(!adding)}>{t('Add gadget')}</Button>
            <DropdownMenu<HTMLButtonElement>
              trigger={({ triggerRef, ...props }) => (
                <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('Dashboard options')} appearance="subtle" />
              )}
              shouldRenderToParent
            >
              <DropdownItemGroup>
                <DropdownItem onClick={() => setEditingDetails(true)}>{t('Edit details')}</DropdownItem>
                {!dashboard.isDefault && (
                  <DropdownItem
                    onClick={() => {
                      if (window.confirm(t('Delete dashboard "{name}"?', { name: dashboard.name })))
                        deleteDashboard.mutate(dashboard.id, { onSuccess: () => navigate('/dashboards') })
                    }}
                  >
                    {t('Delete dashboard')}
                  </DropdownItem>
                )}
              </DropdownItemGroup>
            </DropdownMenu>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
          {columns.map((col, c) => (
            <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
              {col.map((g) => (
                <GadgetFrame key={g.id} dashboard={dashboard} gadget={g} canEdit={canEdit} onMove={move} />
              ))}
              {col.length === 0 && (
                <div
                  style={{
                    border: `2px dashed ${token('color.border', '#DFE1E6')}`,
                    borderRadius: 8, padding: 24, textAlign: 'center', fontSize: 13, ...subtleText,
                  }}
                >
                  {canEdit ? t('Add a gadget to this column.') : t('Nothing here yet.')}
                </div>
              )}
            </div>
          ))}
        </div>
        {adding && <AddGadgetPanel dashboardId={dashboard.id} onClose={() => setAdding(false)} />}
      </div>

      {editingDetails && <DashboardModal dashboard={dashboard} onClose={() => setEditingDetails(false)} />}
    </div>
  )
}
