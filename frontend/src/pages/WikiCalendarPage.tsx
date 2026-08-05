import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Button, { IconButton } from '@atlaskit/button/new'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useCreateWikiCalendarEvent, useDeleteWikiCalendarEvent, useUpdateWikiCalendarEvent,
  useWikiCalendar, useWikiSpace,
} from '../api/hooks'
import type { WikiCalendarEvent } from '../api/types'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/coreIcons'
import { IssueTypeIcon } from '../components/icons'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const COLORS: Record<string, string> = {
  blue: token('color.background.accent.blue.subtle', '#579DFF'),
  green: token('color.background.accent.green.subtle', '#4BCE97'),
  purple: token('color.background.accent.purple.subtle', '#9F8FEF'),
  red: token('color.background.accent.red.subtle', '#F87168'),
  orange: token('color.background.accent.orange.subtle', '#FEA362'),
  teal: token('color.background.accent.teal.subtle', '#6CC3E0'),
  gray: token('color.background.accent.gray.subtle', '#8590A2'),
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function EventModal({ spaceKey, initial, date, onClose }: {
  spaceKey: string
  initial?: WikiCalendarEvent
  date?: string
  onClose: () => void
}) {
  const create = useCreateWikiCalendarEvent(spaceKey)
  const update = useUpdateWikiCalendarEvent(spaceKey)
  const del = useDeleteWikiCalendarEvent(spaceKey)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [start, setStart] = useState(initial ? initial.startDate.slice(0, 10) : (date ?? ''))
  const [end, setEnd] = useState(initial ? initial.endDate.slice(0, 10) : (date ?? ''))
  const [color, setColor] = useState(initial?.color ?? 'blue')

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))
  const body = { title, description, startDate: start, endDate: end, color }

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader><ModalTitle>{initial ? t('Edit event') : t('Add event')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && <SectionMessage appearance="error">{error}</SectionMessage>}
          <TextField autoFocus placeholder={t('Event title')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <TextField placeholder={t('Description (optional)')} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={start} onChange={(e) => setStart(e.currentTarget.value)} style={dateInput} />
            <span style={subtleText}>→</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.currentTarget.value)} style={dateInput} />
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {Object.entries(COLORS).map(([name, bg]) => (
              <span
                key={name}
                onClick={() => setColor(name)}
                title={name}
                style={{
                  width: 20, height: 20, borderRadius: 10, background: bg, cursor: 'pointer',
                  border: color === name ? `2px solid ${token('color.border.selected', '#0C66E4')}` : '2px solid transparent',
                }}
              />
            ))}
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        {initial && (
          <Button
            appearance="danger"
            isLoading={del.isPending}
            onClick={() => del.mutate(initial.id, { onSuccess: onClose, onError: fail })}
          >
            {t('Delete')}
          </Button>
        )}
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button
          appearance="primary"
          isDisabled={!title.trim() || !start}
          isLoading={create.isPending || update.isPending}
          onClick={() => {
            setError(null)
            if (initial) update.mutate({ id: initial.id, ...body }, { onSuccess: onClose, onError: fail })
            else create.mutate(body, { onSuccess: onClose, onError: fail })
          }}
        >
          {t('Save')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

const dateInput: React.CSSProperties = {
  padding: '6px 8px', borderRadius: 4, fontFamily: 'inherit', fontSize: 13,
  border: `1px solid ${token('color.border.input', '#8590A2')}`,
  background: 'transparent', color: 'inherit',
}

// Confluence's team calendar: a month grid with all-day colored events
// plus the TaskHat feed (due work items, sprint starts/ends).
export default function WikiCalendarPage() {
  const { key = '' } = useParams()
  const spaceKey = key.toUpperCase()
  const { data: spaceData } = useWikiSpace(spaceKey)
  const canEdit = (spaceData?.myRole ?? 'collaborator') !== 'viewer'

  const today = new Date()
  const [cursor, setCursor] = useState({ y: today.getFullYear(), m: today.getMonth() })
  const [show, setShow] = useState({ events: true, due: true, sprints: true })
  const [modal, setModal] = useState<{ initial?: WikiCalendarEvent; date?: string } | null>(null)

  // Monday-aligned 6-week grid around the month.
  const gridStart = useMemo(() => {
    const first = new Date(cursor.y, cursor.m, 1)
    const day = (first.getDay() + 6) % 7
    const d = new Date(first)
    d.setDate(first.getDate() - day)
    return d
  }, [cursor])
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  }), [gridStart])

  const { data } = useWikiCalendar(spaceKey, ymd(days[0]), ymd(days[41]))

  const byDay = useMemo(() => {
    const map = new Map<string, { events: WikiCalendarEvent[]; due: NonNullable<typeof data>['dueItems']; sprints: { label: string; key: string }[] }>()
    const at = (k: string) => {
      if (!map.has(k)) map.set(k, { events: [], due: [], sprints: [] })
      return map.get(k)!
    }
    for (const e of data?.events ?? []) {
      const s = new Date(e.startDate.slice(0, 10) + 'T00:00:00')
      const end = new Date(e.endDate.slice(0, 10) + 'T00:00:00')
      for (let d = new Date(s); d <= end; d.setDate(d.getDate() + 1)) at(ymd(d)).events.push(e)
    }
    for (const it of data?.dueItems ?? []) at(it.dueDate.slice(0, 10)).due.push(it)
    for (const sp of data?.sprints ?? []) {
      if (sp.startAt) at(sp.startAt.slice(0, 10)).sprints.push({ label: t('{name} starts', { name: sp.name }), key: sp.projectKey })
      if (sp.endAt) at(sp.endAt.slice(0, 10)).sprints.push({ label: t('{name} ends', { name: sp.name }), key: sp.projectKey })
    }
    return map
  }, [data])

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
  const weekdays = days.slice(0, 7).map((d) => d.toLocaleDateString(undefined, { weekday: 'short' }))
  const todayKey = ymd(today)

  const Toggle = ({ id, label }: { id: 'events' | 'due' | 'sprints'; label: string }) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={show[id]} onChange={() => setShow({ ...show, [id]: !show[id] })} />
      {label}
    </label>
  )

  return (
    <div style={{ padding: '20px 28px 40px' }}>
      <div style={{ fontSize: 12, marginBottom: 2, ...subtleText }}>{spaceData?.space.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Calendar')}</h1>
        <span style={{ flex: 1 }} />
        <Toggle id="events" label={t('Events')} />
        <Toggle id="due" label={t('Work item due dates')} />
        <Toggle id="sprints" label={t('Sprints')} />
        <span style={{ width: 8 }} />
        <IconButton icon={ChevronLeftIcon} label={t('Previous month')} appearance="subtle"
          onClick={() => setCursor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))} />
        <Button appearance="subtle" onClick={() => setCursor({ y: today.getFullYear(), m: today.getMonth() })}>{t('Today')}</Button>
        <IconButton icon={ChevronRightIcon} label={t('Next month')} appearance="subtle"
          onClick={() => setCursor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))} />
        <span style={{ fontSize: 16, fontWeight: 600, minWidth: 130, textAlign: 'center' }}>{monthLabel}</span>
        {canEdit && (
          <Button appearance="primary" onClick={() => setModal({ date: todayKey })}>{t('Add event')}</Button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', direction: 'ltr', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, overflow: 'hidden' }}>
        {weekdays.map((w) => (
          <div key={w} style={{ padding: '6px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', background: token('color.background.neutral', '#F1F2F4'), ...subtleText }}>
            {w}
          </div>
        ))}
        {days.map((d) => {
          const k = ymd(d)
          const inMonth = d.getMonth() === cursor.m
          const cell = byDay.get(k)
          return (
            <div
              key={k}
              onClick={(e) => {
                if (canEdit && e.target === e.currentTarget) setModal({ date: k })
              }}
              style={{
                minHeight: 104, padding: 4, fontSize: 12, cursor: canEdit ? 'pointer' : 'default',
                borderTop: `1px solid ${token('color.border', '#DFE1E6')}`,
                borderInlineStart: `1px solid ${token('color.border', '#DFE1E6')}`,
                background: inMonth ? 'transparent' : token('color.background.neutral.subtle.hovered', '#F7F8F9'),
                opacity: inMonth ? 1 : 0.6, overflow: 'hidden',
              }}
            >
              <div style={{ marginBottom: 3, pointerEvents: 'none' }}>
                <span style={{
                  display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center',
                  borderRadius: 11, fontWeight: 600,
                  background: k === todayKey ? token('color.background.brand.bold', '#0C66E4') : 'transparent',
                  color: k === todayKey ? token('color.text.inverse', '#FFFFFF') : 'inherit',
                }}>
                  {d.getDate()}
                </span>
              </div>
              {show.events && (cell?.events ?? []).map((e) => (
                <div
                  key={e.id + k}
                  onClick={() => canEdit && setModal({ initial: e })}
                  title={e.description || e.title}
                  style={{
                    background: COLORS[e.color] ?? COLORS.blue, color: token('color.text', '#172B4D'),
                    borderRadius: 4, padding: '1px 6px', marginBottom: 2, fontWeight: 500,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: canEdit ? 'pointer' : 'default',
                    borderStartStartRadius: e.startDate.slice(0, 10) === k ? 4 : 0,
                    borderEndStartRadius: e.startDate.slice(0, 10) === k ? 4 : 0,
                    borderStartEndRadius: e.endDate.slice(0, 10) === k ? 4 : 0,
                    borderEndEndRadius: e.endDate.slice(0, 10) === k ? 4 : 0,
                  }}
                >
                  {e.title}
                </div>
              ))}
              {show.due && (cell?.due ?? []).map((it) => (
                <Link
                  key={it.key}
                  to={`/browse/${it.key}`}
                  title={it.summary}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '1px 4px', marginBottom: 2,
                    borderRadius: 4, border: `1px solid ${token('color.border', '#DFE1E6')}`,
                    color: 'inherit', textDecoration: it.resolved ? 'line-through' : 'none',
                    whiteSpace: 'nowrap', overflow: 'hidden',
                  }}
                >
                  <IssueTypeIcon type={it.type} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.key} {it.summary}</span>
                </Link>
              ))}
              {show.sprints && (cell?.sprints ?? []).map((sp, i) => (
                <div
                  key={i}
                  style={{
                    padding: '1px 6px', marginBottom: 2, borderRadius: 4, fontWeight: 500,
                    background: token('color.background.accent.purple.subtlest', '#F3F0FF'),
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  ⚑ {sp.label}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      <ModalTransition>
        {modal && <EventModal spaceKey={spaceKey} initial={modal.initial} date={modal.date} onClose={() => setModal(null)} />}
      </ModalTransition>
    </div>
  )
}
