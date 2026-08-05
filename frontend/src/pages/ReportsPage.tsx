import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Button from '@atlaskit/button/new'
import Modal, { ModalBody, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Select from '@atlaskit/select'
import Spinner from '@atlaskit/spinner'
import EmptyState from '@atlaskit/empty-state'
import { token } from '@atlaskit/tokens'
import { api } from '../api/client'
import SpaceHeader from '../components/SpaceHeader'
import { fmtDuration } from '../components/TimeTracking'
import { t, fmtDate } from '../i18n'

// Chart palette (dataviz-validated, light+dark). Categorical hues are
// assigned in fixed order and never cycled; gray is reserved for the
// to-do status and the "Other" slice.
const CATEGORICAL = ['#357DE8', '#22A06B', '#8F7EE7', '#E56910', '#2898BD', '#C9372C']
const GRAY = '#8590A2'
const STATUS_COLOR: Record<string, string> = { todo: GRAY, in_progress: '#357DE8', done: '#22A06B' }

type Slice = { name: string; category?: string; count: number; seconds?: number }
type Overview = {
  completed7: number; updated7: number; created7: number; dueNext7: number; total: number
  byStatus: Slice[]; byType: Slice[]; byAssignee: Slice[]
}
type Bucket = { date: string; created?: number; resolved?: number; count?: number; avg?: number }
type CFDDay = { date: string; todo: number; inProgress: number; done: number }
type CyclePoint = { key: string; summary: string; completed: string; days: number }
type Group = { name: string; total: number; todo: number; inProgress: number; done: number }

const border = () => `1px solid ${token('color.border', '#DFE1E6')}`
const surface = () => token('elevation.surface', '#FFFFFF')
const subtle = () => token('color.text.subtlest', '#626F86')

function sliceColor(i: number, name: string): string {
  if (name === 'Other' || name === t('Other')) return GRAY
  return CATEGORICAL[i % CATEGORICAL.length]
}

// ---------- shared chart pieces ----------

function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null)
  const show = (e: React.MouseEvent, lines: string[]) => setTip({ x: e.clientX, y: e.clientY, lines })
  const hide = () => setTip(null)
  const el = tip ? (
    <div style={{
      position: 'fixed', left: tip.x + 12, top: tip.y + 12, zIndex: 400, pointerEvents: 'none',
      background: token('elevation.surface.overlay', '#FFFFFF'), border: border(), borderRadius: 4,
      boxShadow: token('elevation.shadow.overlay', '0 4px 8px rgba(9,30,66,0.2)'),
      padding: '6px 10px', fontSize: 12, maxWidth: 280,
    }}>
      {tip.lines.map((l, i) => <div key={i} style={i ? { color: subtle() } : { fontWeight: 600 }}>{l}</div>)}
    </div>
  ) : null
  return { show, hide, el }
}

function Legend({ items }: { items: { name: string; color: string; value?: string }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 10 }}>
      {items.map((it) => (
        <span key={it.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: 4, background: it.color, flexShrink: 0 }} />
          <span>{it.name}</span>
          {it.value != null && <span style={{ color: subtle() }}>{it.value}</span>}
        </span>
      ))}
    </div>
  )
}

function niceMax(v: number): number {
  if (v <= 5) return Math.max(1, Math.ceil(v))
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * mag) return m * mag
  return 10 * mag
}

const CHART_W = 760
const CHART_H = 260
const PAD = { l: 44, r: 12, t: 12, b: 26 }

function Grid({ max, fmt }: { max: number; fmt?: (v: number) => string }) {
  const rows = [0, 0.25, 0.5, 0.75, 1]
  const gridColor = token('color.border', '#DFE1E6')
  return (
    <>
      {rows.map((f) => {
        const y = PAD.t + (CHART_H - PAD.t - PAD.b) * (1 - f)
        const v = max * f
        return (
          <g key={f}>
            <line x1={PAD.l} x2={CHART_W - PAD.r} y1={y} y2={y} stroke={gridColor} strokeWidth={f === 0 ? 1 : 0.5} />
            <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize={10} fill={subtle()}>
              {fmt ? fmt(v) : Math.round(v)}
            </text>
          </g>
        )
      })}
    </>
  )
}

function xLabels(dates: string[]) {
  const step = Math.max(1, Math.ceil(dates.length / 8))
  return dates.map((d, i) => ({ d, i })).filter(({ i }) => i % step === 0)
}

const plotX = (i: number, n: number) =>
  PAD.l + (n <= 1 ? 0 : (i * (CHART_W - PAD.l - PAD.r)) / (n - 1))
const plotY = (v: number, max: number) =>
  PAD.t + (CHART_H - PAD.t - PAD.b) * (1 - (max === 0 ? 0 : v / max))

// ---------- stat tiles + donut ----------

function StatTile({ value, label, tint }: { value: number; label: string; tint: string }) {
  return (
    <div style={{ flex: 1, minWidth: 180, border: border(), borderRadius: 8, padding: '14px 16px', background: surface(), display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={{ width: 32, height: 32, borderRadius: 6, background: tint, flexShrink: 0 }} />
      <div>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{t('{n} work items', { n: value })}</div>
        <div style={{ fontSize: 12, color: subtle() }}>{label}</div>
      </div>
    </div>
  )
}

function Donut({ slices, centerBig, centerSmall, getValue, fmtValue }: {
  slices: Slice[]; centerBig: string; centerSmall: string
  getValue?: (s: Slice) => number; fmtValue?: (v: number) => string
}) {
  const tip = useTip()
  const val = getValue ?? ((s: Slice) => s.count)
  const total = slices.reduce((a, s) => a + val(s), 0)
  const size = 180, r = 66, stroke = 26, c = 2 * Math.PI * r
  let offset = 0
  const colored = slices.map((s, i) => ({
    ...s, v: val(s),
    color: s.category ? (STATUS_COLOR[s.category] ?? GRAY) : sliceColor(i, s.name),
  }))
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerSmall}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {total === 0 && (
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={token('color.background.neutral', '#F1F2F4')} strokeWidth={stroke} />
            )}
            {colored.map((s) => {
              const frac = total ? s.v / total : 0
              const seg = Math.max(0, frac * c - 2) // 2px surface gap between fills
              const el = (
                <circle key={s.name} cx={size / 2} cy={size / 2} r={r} fill="none"
                  stroke={s.color} strokeWidth={stroke}
                  strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={-offset}
                  onMouseMove={(e) => tip.show(e, [s.name, `${fmtValue ? fmtValue(s.v) : s.v} · ${total ? Math.round((s.v / total) * 100) : 0}%`])}
                  onMouseLeave={tip.hide}
                />
              )
              offset += frac * c
              return el
            })}
          </g>
          <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={24} fontWeight={600} fill={token('color.text', '#172B4D')}>{centerBig}</text>
          <text x={size / 2} y={size / 2 + 16} textAnchor="middle" fontSize={11} fill={subtle()}>{centerSmall}</text>
        </svg>
      </div>
      <Legend items={colored.map((s) => ({ name: s.name, color: s.color, value: fmtValue ? fmtValue(s.v) : String(s.v) }))} />
      {tip.el}
    </div>
  )
}

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div style={{ border: border(), borderRadius: 8, padding: 16, background: surface(), flex: wide ? '1 1 100%' : '1 1 320px', minWidth: 300 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

// ---------- catalog (More reports) ----------

type ReportDef = { key: string; section: string; title: string; desc: string; thumb: React.ReactNode }

function AreaThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72" preserveAspectRatio="none">
      <path d="M0 58 L0 34 L20 30 L40 32 L60 24 L80 26 L100 18 L120 20 L120 58 Z" fill="#8590A2" opacity=".45" />
      <path d="M0 58 L0 42 L20 38 L40 40 L60 34 L80 36 L100 30 L120 32 L120 58 Z" fill="#8F7EE7" opacity=".7" />
      <path d="M0 58 L0 50 L20 46 L40 48 L60 44 L80 44 L100 40 L120 42 L120 58 Z" fill="#22A06B" opacity=".8" />
    </svg>
  )
}
function ScatterThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      <path d="M0 34 L30 26 L60 34 L90 28 L120 32" fill="none" stroke="#8590A2" strokeWidth="1.5" />
      <line x1="0" y1="30" x2="120" y2="30" stroke="#C9372C" strokeWidth="1" />
      {[[20, 20], [45, 40], [70, 16], [95, 42], [105, 26]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="4" fill={i % 2 ? '#357DE8' : 'none'} stroke="#357DE8" strokeWidth="1.5" />
      ))}
    </svg>
  )
}
function BarsThumb({ trend }: { trend?: boolean }) {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      {[46, 30, 34, 28, 40, 38, 32, 36].map((h, i) => (
        <rect key={i} x={4 + i * 15} y={58 - h} width="9" height={h} rx="2" fill="#357DE8" opacity=".85" />
      ))}
      {trend && <line x1="4" y1="18" x2="116" y2="28" stroke={token('color.text', '#172B4D')} strokeWidth="1.2" />}
    </svg>
  )
}
function StackedBarsThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      {[[40, 18], [26, 12], [30, 16], [22, 8], [44, 30], [20, 8], [22, 10]].map(([h, res], i) => (
        <g key={i}>
          <rect x={6 + i * 16} y={58 - h} width="10" height={h - res - 1} rx="2" fill="#22A06B" opacity=".85" />
          <rect x={6 + i * 16} y={58 - res} width="10" height={res} rx="2" fill="#C9372C" opacity=".85" />
        </g>
      ))}
    </svg>
  )
}
function RedGreenAreaThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72" preserveAspectRatio="none">
      <path d="M0 54 L20 50 L40 44 L60 30 L80 22 L100 14 L120 12 L120 58 L0 58 Z" fill="#22A06B" opacity=".7" />
      <path d="M0 56 L20 52 L40 48 L60 34 L80 38 L100 30 L120 30" fill="none" stroke="#C9372C" strokeWidth="2" />
    </svg>
  )
}
function PieThumb({ gray }: { gray?: boolean }) {
  const cols = gray ? [GRAY, '#B3B9C4', '#DCDFE4'] : ['#22A06B', '#C9372C', '#357DE8']
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      <circle cx="60" cy="30" r="24" fill={cols[0]} />
      <path d="M60 30 L60 6 A24 24 0 0 0 38 42 Z" fill={cols[1]} />
      <path d="M60 30 L38 42 A24 24 0 0 0 60 54 Z" fill={cols[2]} />
    </svg>
  )
}
function RowsThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      {[8, 20, 32, 44].map((y) => <rect key={y} x="6" y={y} width="56" height="7" rx="2" fill="#B3B9C4" />)}
      {[8, 32].map((y) => (
        <g key={y}>
          <rect x="72" y={y} width="26" height="7" rx="2" fill="#22A06B" />
          <rect x="98" y={y} width="16" height="7" rx="2" fill="#C9372C" />
        </g>
      ))}
    </svg>
  )
}
function DeclineThumb() {
  return (
    <svg viewBox="0 0 120 60" width="100%" height="72">
      {[48, 44, 38, 30, 16, 12, 8, 8].map((h, i) => (
        <rect key={i} x={4 + i * 13} y={58 - h} width="8" height={h} rx="2" fill="#357DE8" opacity=".85" />
      ))}
      <circle cx="98" cy="16" r="10" fill="none" stroke={subtle()} strokeWidth="2" />
      <path d="M98 10 L98 16 L103 18" fill="none" stroke={subtle()} strokeWidth="2" />
    </svg>
  )
}

function reportDefs(): ReportDef[] {
  return [
    { key: 'cumulative-flow', section: t('Agile'), title: t('Cumulative Flow Diagram'), desc: t('Shows the statuses of issues over time. This helps you identify potential bottlenecks that need to be investigated.'), thumb: <AreaThumb /> },
    { key: 'control-chart', section: t('Agile'), title: t('Control Chart'), desc: t('Shows the cycle time for your product, version or sprint. This helps you identify whether data from the current process can be used to determine future performance.'), thumb: <ScatterThumb /> },
    { key: 'cycle-time', section: t('DevOps'), title: t('Cycle Time Report'), desc: t('Understand how much time it takes to ship issues through the deployment pipeline and how to deal with outliers.'), thumb: <ScatterThumb /> },
    { key: 'deployment-frequency', section: t('DevOps'), title: t('Deployment Frequency Report'), desc: t('Understand your deployment frequency to understand risk and how often you are shipping value to your customers.'), thumb: <BarsThumb trend /> },
    { key: 'average-age', section: t('Issue analysis'), title: t('Average Age Report'), desc: t('Shows the average age of unresolved issues for a project or filter. This helps you see whether your backlog is being kept up to date.'), thumb: <BarsThumb trend /> },
    { key: 'created-vs-resolved', section: t('Issue analysis'), title: t('Created vs. Resolved Issues Report'), desc: t('Maps created issues versus resolved issues over a period of time. This can help you understand whether your overall backlog is growing or shrinking.'), thumb: <RedGreenAreaThumb /> },
    { key: 'pie', section: t('Issue analysis'), title: t('Pie Chart Report'), desc: t('Shows a pie chart of issues for a project/filter grouped by a specified field. This helps you see the breakdown of a set of issues, at a glance.'), thumb: <PieThumb /> },
    { key: 'recently-created', section: t('Issue analysis'), title: t('Recently Created Issues Report'), desc: t('Shows the number of issues created over a period of time for a project/filter, and how many were resolved. This helps you understand if your team is keeping up with incoming work.'), thumb: <StackedBarsThumb /> },
    { key: 'resolution-time', section: t('Issue analysis'), title: t('Resolution Time Report'), desc: t('Shows the length of time taken to resolve a set of issues for a project/filter. This helps you identify trends and incidents that you can investigate further.'), thumb: <BarsThumb /> },
    { key: 'groupby', section: t('Issue analysis'), title: t('Single Level Group By Report'), desc: t('Shows issues grouped by a particular field for a filter. This helps you group search results by a field and see the overall status of each group.'), thumb: <RowsThumb /> },
    { key: 'time-since', section: t('Issue analysis'), title: t('Time Since Issues Report'), desc: t('For a date field and project/filter, maps the issues against the date that the field was set. This can help you track how many issues were created, updated, etc, over a period of time.'), thumb: <DeclineThumb /> },
    { key: 'workload', section: t('Other'), title: t('Workload Pie Chart Report'), desc: t('A report showing the issues for a project or filter as a pie chart.'), thumb: <PieThumb gray /> },
  ]
}

function MoreReportsModal({ projectKey, onClose }: { projectKey: string; onClose: () => void }) {
  const navigate = useNavigate()
  const defs = reportDefs()
  const sections = [...new Set(defs.map((d) => d.section))]
  return (
    <ModalTransition>
      <Modal onClose={onClose} width="x-large" height={640}>
        <ModalHeader hasCloseButton>
          <ModalTitle>{t('More reports')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {sections.map((sec) => (
            <div key={sec} style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 20, fontWeight: 600, margin: '4px 0 12px' }}>{sec}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
                {defs.filter((d) => d.section === sec).map((d) => (
                  <div key={d.key} role="button" tabIndex={0}
                    onClick={() => { onClose(); navigate(`/projects/${projectKey}/reports/${d.key}`) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { onClose(); navigate(`/projects/${projectKey}/reports/${d.key}`) } }}
                    style={{ border: border(), borderRadius: 8, padding: 16, cursor: 'pointer', background: surface() }}>
                    <div style={{ marginBottom: 8 }}>{d.thumb}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{d.title}</div>
                    <div style={{ fontSize: 13, color: subtle() }}>{d.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </ModalBody>
      </Modal>
    </ModalTransition>
  )
}

// ---------- overview ----------

function OverviewView({ projectKey }: { projectKey: string }) {
  const [showMore, setShowMore] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['report-overview', projectKey],
    queryFn: () => api<Overview>(`/projects/${projectKey}/reports/overview`),
  })
  if (isLoading || !data) return <div style={{ padding: 40, textAlign: 'center' }}><Spinner size="large" /></div>
  const totalStr = data.total >= 1000 ? `${(data.total / 1000).toFixed(1)}K` : String(data.total)
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button onClick={() => setShowMore(true)}>{t('More reports')}</Button>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <StatTile value={data.completed7} label={t('completed in the last 7 days')} tint={token('color.background.accent.green.subtlest', '#DCFFF1')} />
        <StatTile value={data.updated7} label={t('updated in the last 7 days')} tint={token('color.background.accent.purple.subtlest', '#F3F0FF')} />
        <StatTile value={data.created7} label={t('created in the last 7 days')} tint={token('color.background.accent.blue.subtlest', '#E9F2FF')} />
        <StatTile value={data.dueNext7} label={t('due in the next 7 days')} tint={token('color.background.accent.red.subtlest', '#FFECEB')} />
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Card title={t('Work items by status')}>
          <Donut slices={data.byStatus ?? []} centerBig={totalStr} centerSmall={t('Total value')} />
        </Card>
        <Card title={t('Work items by type')}>
          <Donut slices={data.byType ?? []} centerBig={totalStr} centerSmall={t('Total value')} />
        </Card>
        <Card title={t('Work items by assignee')}>
          <Donut slices={data.byAssignee ?? []} centerBig={totalStr} centerSmall={t('Total value')} />
        </Card>
      </div>
      {showMore && <MoreReportsModal projectKey={projectKey} onClose={() => setShowMore(false)} />}
    </div>
  )
}

// ---------- shared report chrome ----------

const DAY_OPTIONS = [30, 90, 180, 365]

function DaysSelect({ value, onChange }: { value: number; onChange: (d: number) => void }) {
  const opts = DAY_OPTIONS.map((d) => ({ label: t('Last {n} days', { n: d }), value: d }))
  return (
    <div style={{ width: 180 }}>
      <Select spacing="compact" options={opts} value={opts.find((o) => o.value === value)}
        onChange={(o) => o && onChange(o.value)} />
    </div>
  )
}

function FieldSelect({ value, onChange, fields }: { value: string; onChange: (f: string) => void; fields: [string, string][] }) {
  const opts = fields.map(([v, l]) => ({ label: l, value: v }))
  return (
    <div style={{ width: 180 }}>
      <Select spacing="compact" options={opts} value={opts.find((o) => o.value === value)}
        onChange={(o) => o && onChange(o.value)} />
    </div>
  )
}

const GROUP_FIELDS = (): [string, string][] => [
  ['assignee', t('Assignee')], ['status', t('Status')], ['type', t('Work type')],
  ['priority', t('Priority')], ['reporter', t('Reporter')], ['component', t('Component')], ['label', t('Label')],
]

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div style={{ overflowX: 'auto', marginTop: 16 }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={{ textAlign: 'start', padding: '6px 10px', borderBottom: `2px solid ${token('color.border', '#DFE1E6')}`, color: subtle(), fontWeight: 600 }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} style={{ padding: '6px 10px', borderBottom: border() }}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- individual reports ----------

function CFDView({ projectKey }: { projectKey: string }) {
  const [days, setDays] = useState(90)
  const tip = useTip()
  const { data } = useQuery({
    queryKey: ['report-cfd', projectKey, days],
    queryFn: () => api<{ days: CFDDay[] }>(`/projects/${projectKey}/reports/cfd?days=${days}`),
  })
  if (!data) return <Spinner />
  const ds = data.days ?? []
  const max = niceMax(Math.max(1, ...ds.map((d) => d.todo + d.inProgress + d.done)))
  const n = ds.length
  const area = (top: (d: CFDDay) => number, bottom: (d: CFDDay) => number) => {
    const up = ds.map((d, i) => `${plotX(i, n)},${plotY(top(d), max)}`).join(' L')
    const down = [...ds].reverse().map((d, i) => `${plotX(n - 1 - i, n)},${plotY(bottom(d), max)}`).join(' L')
    return `M${up} L${down} Z`
  }
  return (
    <div>
      <DaysSelect value={days} onChange={setDays} />
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: 12 }} role="img" aria-label={t('Cumulative Flow Diagram')}>
        <Grid max={max} />
        <path d={area((d) => d.done + d.inProgress + d.todo, (d) => d.done + d.inProgress)} fill={GRAY} opacity={0.55} />
        <path d={area((d) => d.done + d.inProgress, (d) => d.done)} fill="#357DE8" opacity={0.65} />
        <path d={area((d) => d.done, () => 0)} fill="#22A06B" opacity={0.75} />
        {ds.map((d, i) => (
          <rect key={d.date} x={plotX(i, n) - (CHART_W - PAD.l - PAD.r) / (2 * n)} y={PAD.t}
            width={(CHART_W - PAD.l - PAD.r) / n} height={CHART_H - PAD.t - PAD.b} fill="transparent"
            onMouseMove={(e) => tip.show(e, [fmtDate(d.date), `${t('To Do')}: ${d.todo}`, `${t('In Progress')}: ${d.inProgress}`, `${t('Done')}: ${d.done}`])}
            onMouseLeave={tip.hide} />
        ))}
        {xLabels(ds.map((d) => d.date)).map(({ d, i }) => (
          <text key={d} x={plotX(i, n)} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill={subtle()}>{fmtDate(d)}</text>
        ))}
      </svg>
      <Legend items={[
        { name: t('To Do'), color: GRAY }, { name: t('In Progress'), color: '#357DE8' }, { name: t('Done'), color: '#22A06B' },
      ]} />
      {tip.el}
    </div>
  )
}

function CycleScatterView({ projectKey }: { projectKey: string }) {
  const [days, setDays] = useState(90)
  const tip = useTip()
  const navigate = useNavigate()
  const { data } = useQuery({
    queryKey: ['report-cycle', projectKey, days],
    queryFn: () => api<{ points: CyclePoint[] }>(`/projects/${projectKey}/reports/cycle-time?days=${days}`),
  })
  if (!data) return <Spinner />
  const pts = data.points ?? []
  if (!pts.length) return <><DaysSelect value={days} onChange={setDays} /><p style={{ color: subtle() }}>{t('No work items were resolved in this period.')}</p></>
  const avg = pts.reduce((a, p) => a + p.days, 0) / pts.length
  const sd = Math.sqrt(pts.reduce((a, p) => a + (p.days - avg) ** 2, 0) / pts.length)
  const max = niceMax(Math.max(...pts.map((p) => p.days), avg + sd))
  const dates = [...new Set(pts.map((p) => p.completed))].sort()
  const xi = (p: CyclePoint) => dates.indexOf(p.completed)
  const n = dates.length
  return (
    <div>
      <DaysSelect value={days} onChange={setDays} />
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: 12 }} role="img" aria-label={t('Cycle time')}>
        <Grid max={max} fmt={(v) => `${Math.round(v)}d`} />
        <rect x={PAD.l} width={CHART_W - PAD.l - PAD.r}
          y={plotY(Math.min(max, avg + sd), max)}
          height={Math.max(0, plotY(Math.max(0, avg - sd), max) - plotY(Math.min(max, avg + sd), max))}
          fill="#357DE8" opacity={0.1} />
        <line x1={PAD.l} x2={CHART_W - PAD.r} y1={plotY(avg, max)} y2={plotY(avg, max)} stroke="#C9372C" strokeWidth={1.5} strokeDasharray="6 4" />
        {pts.map((p, i) => (
          <circle key={`${p.key}-${i}`} cx={plotX(xi(p), n)} cy={plotY(p.days, max)} r={5}
            fill="#357DE8" stroke={surface()} strokeWidth={2} style={{ cursor: 'pointer' }}
            onMouseMove={(e) => tip.show(e, [`${p.key} · ${p.days.toFixed(1)}d`, p.summary])}
            onMouseLeave={tip.hide}
            onClick={() => navigate(`/browse/${p.key}`)} />
        ))}
        {xLabels(dates).map(({ d, i }) => (
          <text key={d} x={plotX(i, n)} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill={subtle()}>{fmtDate(d)}</text>
        ))}
      </svg>
      <Legend items={[
        { name: t('Cycle time (days)'), color: '#357DE8' },
        { name: t('Average'), color: '#C9372C', value: `${avg.toFixed(1)}d` },
      ]} />
      <DataTable head={[t('Key'), t('Summary'), t('Completed'), t('Cycle time (days)')]}
        rows={[...pts].sort((a, b) => b.days - a.days).slice(0, 20).map((p) => [p.key, p.summary, fmtDate(p.completed), p.days.toFixed(1)])} />
      {tip.el}
    </div>
  )
}

function TrendBarsView({ projectKey, trend, unit, extraSelect }: {
  projectKey: string; trend: string; unit: 'avg-days' | 'count'
  extraSelect?: { value: string; onChange: (v: string) => void; fields: [string, string][] }
}) {
  const [days, setDays] = useState(90)
  const tip = useTip()
  const field = extraSelect?.value
  const { data } = useQuery({
    queryKey: ['report-trend', projectKey, trend, days, field],
    queryFn: () => api<{ interval: string; buckets: Bucket[] }>(
      `/projects/${projectKey}/reports/trend/${trend}?days=${days}${field ? `&field=${field}` : ''}`),
  })
  if (!data) return <Spinner />
  const bs = data.buckets ?? []
  const val = (b: Bucket) => (unit === 'avg-days' ? (b.avg ?? 0) : (b.count ?? 0))
  const max = niceMax(Math.max(1, ...bs.map(val)))
  const n = Math.max(bs.length, 1)
  const bw = Math.min(40, ((CHART_W - PAD.l - PAD.r) / n) * 0.7)
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <DaysSelect value={days} onChange={setDays} />
        {extraSelect && <FieldSelect value={extraSelect.value} onChange={extraSelect.onChange} fields={extraSelect.fields} />}
      </div>
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: 12 }} role="img">
        <Grid max={max} fmt={unit === 'avg-days' ? (v) => `${Math.round(v)}d` : undefined} />
        {bs.map((b, i) => {
          const x = PAD.l + ((i + 0.5) * (CHART_W - PAD.l - PAD.r)) / n - bw / 2
          const y = plotY(val(b), max)
          return (
            <rect key={b.date} x={x} y={y} width={bw} height={CHART_H - PAD.b - y} rx={4} fill="#357DE8"
              onMouseMove={(e) => tip.show(e, [fmtDate(b.date), unit === 'avg-days' ? `${(b.avg ?? 0).toFixed(1)} ${t('days')} · ${b.count ?? 0} ${t('items')}` : `${b.count ?? 0} ${t('items')}`])}
              onMouseLeave={tip.hide} />
          )
        })}
        {xLabels(bs.map((b) => b.date)).map(({ d, i }) => (
          <text key={d} x={PAD.l + ((i + 0.5) * (CHART_W - PAD.l - PAD.r)) / n} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill={subtle()}>{fmtDate(d)}</text>
        ))}
      </svg>
      <DataTable head={[t('Period'), unit === 'avg-days' ? t('Average (days)') : t('Work items')]}
        rows={bs.map((b) => [fmtDate(b.date), unit === 'avg-days' ? (b.avg ?? 0).toFixed(1) : (b.count ?? 0)])} />
      {tip.el}
    </div>
  )
}

function CreatedVsResolvedView({ projectKey }: { projectKey: string }) {
  const [days, setDays] = useState(90)
  const tip = useTip()
  const { data } = useQuery({
    queryKey: ['report-cvr', projectKey, days],
    queryFn: () => api<{ interval: string; buckets: Bucket[] }>(`/projects/${projectKey}/reports/trend/created-vs-resolved?days=${days}`),
  })
  if (!data) return <Spinner />
  const bs = data.buckets ?? []
  const n = Math.max(bs.length, 1)
  const max = niceMax(Math.max(1, ...bs.map((b) => Math.max(b.created ?? 0, b.resolved ?? 0))))
  const line = (get: (b: Bucket) => number) => bs.map((b, i) => `${i ? 'L' : 'M'}${plotX(i, n)},${plotY(get(b), max)}`).join(' ')
  const totC = bs.reduce((a, b) => a + (b.created ?? 0), 0)
  const totR = bs.reduce((a, b) => a + (b.resolved ?? 0), 0)
  return (
    <div>
      <DaysSelect value={days} onChange={setDays} />
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: 12 }} role="img" aria-label={t('Created vs. Resolved Issues Report')}>
        <Grid max={max} />
        <path d={line((b) => b.created ?? 0)} fill="none" stroke="#C9372C" strokeWidth={2} />
        <path d={line((b) => b.resolved ?? 0)} fill="none" stroke="#22A06B" strokeWidth={2} />
        {bs.map((b, i) => (
          <rect key={b.date} x={plotX(i, n) - (CHART_W - PAD.l - PAD.r) / (2 * n)} y={PAD.t}
            width={(CHART_W - PAD.l - PAD.r) / n} height={CHART_H - PAD.t - PAD.b} fill="transparent"
            onMouseMove={(e) => tip.show(e, [fmtDate(b.date), `${t('Created')}: ${b.created ?? 0}`, `${t('Resolved')}: ${b.resolved ?? 0}`])}
            onMouseLeave={tip.hide} />
        ))}
        {xLabels(bs.map((b) => b.date)).map(({ d, i }) => (
          <text key={d} x={plotX(i, n)} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill={subtle()}>{fmtDate(d)}</text>
        ))}
      </svg>
      <Legend items={[
        { name: t('Created'), color: '#C9372C', value: String(totC) },
        { name: t('Resolved'), color: '#22A06B', value: String(totR) },
      ]} />
      <p style={{ fontSize: 13, color: subtle() }}>
        {totC > totR ? t('Your backlog grew by {n} work items in this period.', { n: totC - totR }) : t('Your backlog shrank by {n} work items in this period.', { n: totR - totC })}
      </p>
      <DataTable head={[t('Period'), t('Created'), t('Resolved')]} rows={bs.map((b) => [fmtDate(b.date), b.created ?? 0, b.resolved ?? 0])} />
      {tip.el}
    </div>
  )
}

function RecentlyCreatedView({ projectKey }: { projectKey: string }) {
  const [days, setDays] = useState(90)
  const tip = useTip()
  const { data } = useQuery({
    queryKey: ['report-recent', projectKey, days],
    queryFn: () => api<{ interval: string; buckets: Bucket[] }>(`/projects/${projectKey}/reports/trend/recently-created?days=${days}`),
  })
  if (!data) return <Spinner />
  const bs = data.buckets ?? []
  const n = Math.max(bs.length, 1)
  const max = niceMax(Math.max(1, ...bs.map((b) => b.created ?? 0)))
  const bw = Math.min(40, ((CHART_W - PAD.l - PAD.r) / n) * 0.7)
  return (
    <div>
      <DaysSelect value={days} onChange={setDays} />
      <svg width="100%" viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ marginTop: 12 }} role="img">
        <Grid max={max} />
        {bs.map((b, i) => {
          const x = PAD.l + ((i + 0.5) * (CHART_W - PAD.l - PAD.r)) / n - bw / 2
          const created = b.created ?? 0, resolved = b.resolved ?? 0
          const yTop = plotY(created, max)
          const yRes = plotY(resolved, max)
          return (
            <g key={b.date}
              onMouseMove={(e) => tip.show(e, [fmtDate(b.date), `${t('Created')}: ${created}`, `${t('Resolved')}: ${resolved}`, `${t('Unresolved')}: ${created - resolved}`])}
              onMouseLeave={tip.hide}>
              <rect x={x} y={yTop} width={bw} height={Math.max(0, yRes - yTop - (resolved ? 2 : 0))} rx={4} fill="#C9372C" />
              <rect x={x} y={yRes} width={bw} height={CHART_H - PAD.b - yRes} rx={4} fill="#22A06B" />
            </g>
          )
        })}
        {xLabels(bs.map((b) => b.date)).map(({ d, i }) => (
          <text key={d} x={PAD.l + ((i + 0.5) * (CHART_W - PAD.l - PAD.r)) / n} y={CHART_H - 8} textAnchor="middle" fontSize={10} fill={subtle()}>{fmtDate(d)}</text>
        ))}
      </svg>
      <Legend items={[{ name: t('Resolved'), color: '#22A06B' }, { name: t('Unresolved'), color: '#C9372C' }]} />
      <DataTable head={[t('Period'), t('Created'), t('Resolved'), t('Unresolved')]}
        rows={bs.map((b) => [fmtDate(b.date), b.created ?? 0, b.resolved ?? 0, (b.created ?? 0) - (b.resolved ?? 0)])} />
      {tip.el}
    </div>
  )
}

function PieView({ projectKey }: { projectKey: string }) {
  const [field, setField] = useState('assignee')
  const { data } = useQuery({
    queryKey: ['report-pie', projectKey, field],
    queryFn: () => api<{ slices: Slice[] }>(`/projects/${projectKey}/reports/pie?field=${field}`),
  })
  const slices = useMemo(() => {
    const all = data?.slices ?? []
    if (all.length <= 12) return all
    const head = all.slice(0, 12)
    return [...head, { name: t('Other'), count: all.slice(12).reduce((a, s) => a + s.count, 0) }]
  }, [data])
  if (!data) return <Spinner />
  const total = slices.reduce((a, s) => a + s.count, 0)
  return (
    <div>
      <FieldSelect value={field} onChange={setField} fields={GROUP_FIELDS()} />
      <div style={{ maxWidth: 560, marginTop: 12 }}>
        <Donut slices={slices} centerBig={String(total)} centerSmall={t('Total value')} />
      </div>
      <DataTable head={[GROUP_FIELDS().find(([v]) => v === field)?.[1] ?? field, t('Work items'), '%']}
        rows={slices.map((s) => [s.name, s.count, total ? `${Math.round((s.count / total) * 100)}%` : '0%'])} />
    </div>
  )
}

function GroupByView({ projectKey }: { projectKey: string }) {
  const [field, setField] = useState('assignee')
  const { data } = useQuery({
    queryKey: ['report-groupby', projectKey, field],
    queryFn: () => api<{ groups: Group[] }>(`/projects/${projectKey}/reports/groupby?field=${field}`),
  })
  if (!data) return <Spinner />
  const groups = data.groups ?? []
  return (
    <div>
      <FieldSelect value={field} onChange={setField} fields={GROUP_FIELDS()} />
      <div style={{ marginTop: 12 }}>
        {groups.map((g) => (
          <div key={g.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: border() }}>
            <div style={{ width: 220, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</div>
            <div style={{ flex: 1, display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, background: token('color.background.neutral', '#F1F2F4') }}>
              {g.done > 0 && <span style={{ width: `${(g.done / g.total) * 100}%`, background: '#22A06B' }} />}
              {g.inProgress > 0 && <span style={{ width: `${(g.inProgress / g.total) * 100}%`, background: '#357DE8' }} />}
              {g.todo > 0 && <span style={{ width: `${(g.todo / g.total) * 100}%`, background: GRAY }} />}
            </div>
            <div style={{ width: 200, fontSize: 12, color: subtle(), textAlign: 'end' }}>
              {t('{n} items', { n: g.total })} · {t('Done')} {g.done} · {t('In Progress')} {g.inProgress} · {t('To Do')} {g.todo}
            </div>
          </div>
        ))}
      </div>
      <Legend items={[
        { name: t('Done'), color: '#22A06B' }, { name: t('In Progress'), color: '#357DE8' }, { name: t('To Do'), color: GRAY },
      ]} />
    </div>
  )
}

function WorkloadView({ projectKey }: { projectKey: string }) {
  const [mode, setMode] = useState<'count' | 'estimate'>('count')
  const { data } = useQuery({
    queryKey: ['report-workload', projectKey],
    queryFn: () => api<{ slices: Slice[] }>(`/projects/${projectKey}/reports/workload`),
  })
  if (!data) return <Spinner />
  const raw = (data.slices ?? []).filter((s) => (mode === 'count' ? s.count : s.seconds ?? 0) > 0)
  const slices = raw.length > 12
    ? [...raw.slice(0, 12), {
        name: t('Other'),
        count: raw.slice(12).reduce((a, s) => a + s.count, 0),
        seconds: raw.slice(12).reduce((a, s) => a + (s.seconds ?? 0), 0),
      }]
    : raw
  const getValue = (s: Slice) => (mode === 'count' ? s.count : s.seconds ?? 0)
  const fmtValue = (v: number) => (mode === 'count' ? String(v) : fmtDuration(v))
  const total = slices.reduce((a, s) => a + getValue(s), 0)
  const modeOpts = [{ label: t('Work item count'), value: 'count' as const }, { label: t('Remaining estimate'), value: 'estimate' as const }]
  return (
    <div>
      <div style={{ width: 220 }}>
        <Select spacing="compact" options={modeOpts} value={modeOpts.find((o) => o.value === mode)} onChange={(o) => o && setMode(o.value)} />
      </div>
      <div style={{ maxWidth: 560, marginTop: 12 }}>
        <Donut slices={slices} centerBig={mode === 'count' ? String(total) : fmtDuration(total)} centerSmall={t('Unresolved')} getValue={getValue} fmtValue={fmtValue} />
      </div>
      <DataTable head={[t('Assignee'), t('Work items'), t('Remaining estimate')]}
        rows={(data.slices ?? []).map((s) => [s.name, s.count, s.seconds ? fmtDuration(s.seconds) : '—'])} />
    </div>
  )
}

function DeploymentFrequencyView() {
  return (
    <EmptyState
      header={t('No deployment data yet')}
      description={t('This report reads deployment events from a connected CI/CD pipeline. TaskHat does not track deployments yet — connect a pipeline integration when available.')}
    />
  )
}

// ---------- page shell ----------

export default function ReportsPage() {
  const { key = '', report } = useParams()
  const defs = reportDefs()
  const def = defs.find((d) => d.key === report)
  return (
    <div>
      <SpaceHeader projectKey={key} tab="reports" />
      <div style={{ padding: '16px 0 32px' }}>
        {!report ? (
          <OverviewView projectKey={key} />
        ) : (
          <div>
            <div style={{ marginBottom: 12 }}>
              <Link to={`/projects/${key}/reports`} style={{ fontSize: 13 }}>{t('Reports')}</Link>
              <h2 style={{ fontSize: 24, fontWeight: 600, margin: '6px 0 4px' }}>{def?.title ?? report}</h2>
              {def && <p style={{ fontSize: 13, color: subtle(), margin: 0, maxWidth: 720 }}>{def.desc}</p>}
            </div>
            {report === 'cumulative-flow' && <CFDView projectKey={key} />}
            {(report === 'control-chart' || report === 'cycle-time') && <CycleScatterView projectKey={key} />}
            {report === 'deployment-frequency' && <DeploymentFrequencyView />}
            {report === 'average-age' && <TrendBarsView projectKey={key} trend="average-age" unit="avg-days" />}
            {report === 'created-vs-resolved' && <CreatedVsResolvedView projectKey={key} />}
            {report === 'pie' && <PieView projectKey={key} />}
            {report === 'recently-created' && <RecentlyCreatedView projectKey={key} />}
            {report === 'resolution-time' && <TrendBarsView projectKey={key} trend="resolution-time" unit="avg-days" />}
            {report === 'groupby' && <GroupByView projectKey={key} />}
            {report === 'time-since' && <TimeSinceView projectKey={key} />}
            {report === 'workload' && <WorkloadView projectKey={key} />}
          </div>
        )}
      </div>
    </div>
  )
}

function TimeSinceView({ projectKey }: { projectKey: string }) {
  const [field, setField] = useState('created')
  const fields: [string, string][] = [
    ['created', t('Created')], ['updated', t('Updated')], ['resolved', t('Resolved')], ['due', t('Due date')],
  ]
  return <TrendBarsView projectKey={projectKey} trend="time-since" unit="count" extraSelect={{ value: field, onChange: setField, fields }} />
}
