import { useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { api } from '../api/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import SpaceHeader from '../components/SpaceHeader'
import { IssueTypeIcon } from '../components/icons'
import { ChevronDownIcon, ChevronRightIcon } from '../components/coreIcons'
import { t } from '../i18n'

// ---- data ----

interface TimelineItem {
  id: string
  key: string
  summary: string
  type: string
  statusName: string
  statusCategory: 'todo' | 'in_progress' | 'done'
  parentKey: string | null
  startDate: string | null
  dueDate: string | null
}
interface TimelineLink { from: string; to: string }

function useTimeline(key: string | undefined) {
  return useQuery({
    queryKey: ['timeline', key],
    queryFn: () => api<{ items: TimelineItem[]; links: TimelineLink[] }>(`/projects/${key}/timeline`),
    enabled: !!key,
  })
}

// ---- date math (all day-based) ----

const DAY = 24 * 60 * 60 * 1000
const dayFloor = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY)
const daysBetween = (a: Date, b: Date) => Math.round((dayFloor(b).getTime() - dayFloor(a).getTime()) / DAY)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type Zoom = 'weeks' | 'months' | 'quarters'
const PX: Record<Zoom, number> = { weeks: 18, months: 5.5, quarters: 2.2 } // px per day

const ROW_H = 40
const LEFT_W = 300

// Bar colors: epics purple like Jira; others by status category.
function barColor(item: TimelineItem): string {
  if (item.type === 'epic') return token('color.background.accent.purple.subtle', '#9F8FEF')
  if (item.statusCategory === 'done') return token('color.background.accent.green.subtle', '#4BCE97')
  if (item.statusCategory === 'in_progress') return token('color.background.accent.blue.subtle', '#579DFF')
  return token('color.background.accent.gray.subtle', '#8590A2')
}

// ---- page ----

export default function TimelinePage() {
  const { key } = useParams<{ key: string }>()
  const projectKey = key?.toUpperCase() ?? ''
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { data, isLoading } = useTimeline(projectKey)
  const [zoom, setZoom] = useState<Zoom>('months')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  // Local drag preview: key → {start, due} while dragging.
  const [preview, setPreview] = useState<Record<string, { start: Date; due: Date }>>({})

  const items = useMemo(() => data?.items ?? [], [data])

  // Rows: epics first (with their children when expanded), then parentless non-epics.
  const rows = useMemo(() => {
    const epics = items.filter((i) => i.type === 'epic')
    const byParent = new Map<string, TimelineItem[]>()
    for (const i of items) {
      if (i.parentKey) {
        const arr = byParent.get(i.parentKey) ?? []
        arr.push(i)
        byParent.set(i.parentKey, arr)
      }
    }
    const out: { item: TimelineItem; depth: number; children: TimelineItem[] }[] = []
    for (const e of epics) {
      const kids = byParent.get(e.key) ?? []
      out.push({ item: e, depth: 0, children: kids })
      if (!collapsed[e.key]) for (const k of kids) out.push({ item: k, depth: 1, children: [] })
    }
    for (const i of items) {
      if (i.type !== 'epic' && !i.parentKey) out.push({ item: i, depth: 0, children: [] })
    }
    return out
  }, [items, collapsed])

  // Visible date range: span all dates, padded; always includes today.
  const range = useMemo(() => {
    const today = dayFloor(new Date())
    let min = addDays(today, -21)
    let max = addDays(today, 90)
    for (const i of items) {
      if (i.startDate && new Date(i.startDate) < min) min = dayFloor(new Date(i.startDate))
      if (i.dueDate && new Date(i.dueDate) > max) max = dayFloor(new Date(i.dueDate))
    }
    return { start: addDays(min, -14), end: addDays(max, 30) }
  }, [items])

  const px = PX[zoom]
  const totalDays = daysBetween(range.start, range.end)
  const width = totalDays * px
  const xOf = (d: Date) => daysBetween(range.start, d) * px
  const today = dayFloor(new Date())

  // Effective dates for a bar: drag preview → real dates → epic rollup.
  const datesOf = (item: TimelineItem, children: TimelineItem[]): { start: Date; due: Date; rollup: boolean } | null => {
    const p = preview[item.key]
    if (p) return { ...p, rollup: false }
    if (item.startDate || item.dueDate) {
      const start = dayFloor(new Date(item.startDate ?? item.dueDate!))
      const due = dayFloor(new Date(item.dueDate ?? item.startDate!))
      return { start, due: due < start ? start : due, rollup: false }
    }
    if (item.type === 'epic' && children.length) {
      const dates = children.flatMap((c) => [c.startDate, c.dueDate].filter(Boolean).map((d) => dayFloor(new Date(d!))))
      if (dates.length) {
        return {
          start: new Date(Math.min(...dates.map((d) => d.getTime()))),
          due: new Date(Math.max(...dates.map((d) => d.getTime()))),
          rollup: true,
        }
      }
    }
    return null
  }

  const saveDates = (item: TimelineItem, start: Date, due: Date) => {
    api(`/issues/${item.key}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { startDate: iso(start), duedate: iso(due) } }),
    })
      .then(() => qc.invalidateQueries({ queryKey: ['timeline', projectKey] }))
      .finally(() => setPreview((p) => {
        const n = { ...p }
        delete n[item.key]
        return n
      }))
  }

  // Drag to move / resize. mode: 'move' | 'left' | 'right'.
  const startDrag = (e: React.PointerEvent, item: TimelineItem, start: Date, due: Date, mode: 'move' | 'left' | 'right') => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let moved = false
    let cur = { start, due }
    const onMove = (ev: PointerEvent) => {
      const delta = Math.round((ev.clientX - startX) / px)
      if (delta !== 0) moved = true
      let s = start, d = due
      if (mode === 'move') { s = addDays(start, delta); d = addDays(due, delta) }
      if (mode === 'left') { s = addDays(start, delta); if (s > d) s = d }
      if (mode === 'right') { d = addDays(due, delta); if (d < s) d = s }
      cur = { start: s, due: d }
      setPreview((p) => ({ ...p, [item.key]: cur }))
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (moved) saveDates(item, cur.start, cur.due)
      else {
        setPreview((p) => { const n = { ...p }; delete n[item.key]; return n })
        navigate(`/browse/${item.key}`)
      }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
  }

  // Header cells per zoom.
  const headerCells = useMemo(() => {
    const cells: { label: string; x: number; w: number }[] = []
    if (zoom === 'weeks') {
      let d = addDays(range.start, -((range.start.getDay() + 6) % 7)) // monday
      while (d < range.end) {
        const next = addDays(d, 7)
        cells.push({ label: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), x: xOf(d), w: 7 * px })
        d = next
      }
    } else {
      let d = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
      while (d < range.end) {
        const next = new Date(d.getFullYear(), d.getMonth() + (zoom === 'quarters' ? 3 : 1), 1)
        const label = zoom === 'quarters'
          ? `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
          : d.toLocaleDateString(undefined, { month: 'short', year: d.getMonth() === 0 ? 'numeric' : undefined })
        cells.push({ label, x: xOf(d), w: daysBetween(d, next) * px })
        d = next
      }
    }
    return cells
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, range, px])

  // Bar geometry per row key for the dependency overlay.
  const barGeo = new Map<string, { x1: number; x2: number; y: number }>()
  rows.forEach((r, idx) => {
    const d = datesOf(r.item, r.children)
    if (d) barGeo.set(r.item.key, { x1: xOf(d.start), x2: xOf(addDays(d.due, 1)), y: idx * ROW_H + ROW_H / 2 })
  })

  const scrollToToday = () => {
    scrollRef.current?.scrollTo({ left: Math.max(0, xOf(today) - 300), behavior: 'smooth' })
  }

  if (isLoading || !data) {
    return (
      <div>
        <SpaceHeader projectKey={projectKey} tab="timeline" />
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><Spinner size="large" /></div>
      </div>
    )
  }

  const gridH = rows.length * ROW_H
  const border = token('color.border', '#DFE1E6')

  return (
    <div>
      <SpaceHeader projectKey={projectKey} tab="timeline" />
      <div style={{ display: 'flex', border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden', marginTop: 8, direction: 'ltr' }}>
        {/* Left: item list */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderInlineEnd: `1px solid ${border}` }}>
          <div style={{ height: 41, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: 12, fontWeight: 700, borderBottom: `1px solid ${border}`, color: token('color.text.subtlest', '#626F86') }}>
            {t('Work items')}
          </div>
          {rows.map(({ item, depth, children }) => (
            <div
              key={item.key}
              onClick={() => navigate(`/browse/${item.key}`)}
              style={{
                height: ROW_H, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                paddingInlineStart: 10 + depth * 22, paddingInlineEnd: 8, fontSize: 13,
                borderBottom: `1px solid ${border}`, whiteSpace: 'nowrap',
              }}
            >
              {item.type === 'epic' && children.length > 0 ? (
                <span
                  onClick={(e) => { e.stopPropagation(); setCollapsed((c) => ({ ...c, [item.key]: !c[item.key] })) }}
                  style={{ display: 'inline-flex', cursor: 'pointer' }}
                >
                  {collapsed[item.key] ? <ChevronRightIcon label="" /> : <ChevronDownIcon label="" />}
                </span>
              ) : (
                <span style={{ width: 16 }} />
              )}
              <IssueTypeIcon type={item.type} />
              <span style={{ color: token('color.text.subtlest', '#626F86'), fontSize: 12 }}>{item.key}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.summary}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: 16, fontSize: 13, color: token('color.text.subtlest', '#626F86') }}>
              {t('No work items yet.')}
            </div>
          )}
        </div>

        {/* Right: time grid */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: 'auto', position: 'relative' }}>
          <div style={{ width, position: 'relative' }}>
            {/* header */}
            <div style={{ height: 41, position: 'relative', borderBottom: `1px solid ${border}` }}>
              {headerCells.map((c, i) => (
                <div key={i} style={{
                  position: 'absolute', left: c.x, width: c.w, top: 0, bottom: 0,
                  display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 600,
                  color: token('color.text.subtlest', '#626F86'),
                  borderLeft: `1px solid ${border}`,
                }}>{c.label}</div>
              ))}
            </div>
            {/* grid rows + column lines */}
            <div style={{ position: 'relative', height: gridH }}>
              {headerCells.map((c, i) => (
                <div key={i} style={{ position: 'absolute', left: c.x, top: 0, bottom: 0, borderLeft: `1px solid ${token('color.border', '#F1F2F4')}`, opacity: 0.5 }} />
              ))}
              {rows.map((_, idx) => (
                <div key={idx} style={{ position: 'absolute', left: 0, right: 0, top: (idx + 1) * ROW_H - 1, borderTop: `1px solid ${border}` }} />
              ))}
              {/* today marker */}
              <div style={{ position: 'absolute', left: xOf(today), top: 0, bottom: 0, width: 2, background: token('color.background.accent.orange.bolder', '#F38A3F'), zIndex: 3 }} />

              {/* dependency lines */}
              <svg style={{ position: 'absolute', inset: 0, width: '100%', height: gridH, pointerEvents: 'none', zIndex: 2 }}>
                {(data.links ?? []).map((l, i) => {
                  const a = barGeo.get(l.from)
                  const b = barGeo.get(l.to)
                  if (!a || !b) return null
                  const midX = Math.max(a.x2 + 8, b.x1 - 8)
                  const path = `M ${a.x2} ${a.y} L ${a.x2 + 8} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x1 - 4} ${b.y}`
                  return (
                    <g key={i} stroke={token('color.border.bold', '#758195')} fill="none" strokeWidth={1.5}>
                      <path d={path} />
                      <path d={`M ${b.x1 - 4} ${b.y} l -5 -4 M ${b.x1 - 4} ${b.y} l -5 4`} />
                    </g>
                  )
                })}
              </svg>

              {/* bars */}
              {rows.map(({ item, children }, idx) => {
                const d = datesOf(item, children)
                const y = idx * ROW_H + 8
                if (!d) {
                  return (
                    <div
                      key={item.key}
                      onClick={() => saveDates(item, today, addDays(today, 6))}
                      title={t('Add dates')}
                      style={{
                        position: 'absolute', left: xOf(today) + 8, top: y, height: ROW_H - 16, width: 90,
                        border: `1px dashed ${border}`, borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: token('color.text.subtlest', '#626F86'), zIndex: 1, background: token('elevation.surface', '#FFF'),
                      }}
                    >
                      {t('Add dates')}
                    </div>
                  )
                }
                const x = xOf(d.start)
                const w = Math.max(px, (daysBetween(d.start, d.due) + 1) * px)
                return (
                  <div
                    key={item.key}
                    onPointerDown={(e) => !d.rollup && startDrag(e, item, d.start, d.due, 'move')}
                    title={`${item.key} · ${iso(d.start)} → ${iso(d.due)}`}
                    style={{
                      position: 'absolute', left: x, top: y, width: w, height: ROW_H - 16,
                      background: barColor(item), borderRadius: 5, cursor: d.rollup ? 'default' : 'grab',
                      opacity: d.rollup ? 0.45 : 1, zIndex: 1,
                      display: 'flex', alignItems: 'center', overflow: 'visible',
                    }}
                  >
                    {!d.rollup && (
                      <>
                        <span
                          onPointerDown={(e) => startDrag(e, item, d.start, d.due, 'left')}
                          style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }}
                        />
                        <span
                          onPointerDown={(e) => startDrag(e, item, d.start, d.due, 'right')}
                          style={{ position: 'absolute', right: -3, top: 0, bottom: 0, width: 8, cursor: 'ew-resize' }}
                        />
                      </>
                    )}
                    <span style={{
                      position: 'absolute', left: w + 6, fontSize: 11, whiteSpace: 'nowrap',
                      color: token('color.text.subtlest', '#626F86'), pointerEvents: 'none',
                    }}>
                      {item.summary.length > 40 ? item.summary.slice(0, 40) + '…' : item.summary}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* zoom controls — bottom corner like Jira */}
          <div style={{
            position: 'sticky', bottom: 8, insetInlineStart: 0, display: 'flex', justifyContent: 'flex-end',
            gap: 8, padding: '8px 12px', pointerEvents: 'none',
          }}>
            <span style={{ pointerEvents: 'auto', display: 'inline-flex', gap: 4, background: token('elevation.surface.raised', '#FFF'), border: `1px solid ${border}`, borderRadius: 6, padding: 3 }}>
              <Button appearance="subtle" spacing="compact" onClick={scrollToToday}>{t('Today')}</Button>
              {(['weeks', 'months', 'quarters'] as Zoom[]).map((z) => (
                <Button key={z} appearance={zoom === z ? 'primary' : 'subtle'} spacing="compact" onClick={() => setZoom(z)}>
                  {t(z === 'weeks' ? 'Weeks' : z === 'months' ? 'Months' : 'Quarters')}
                </Button>
              ))}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
