import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { token } from '@atlaskit/tokens'
import {
  AddIcon, ArrowRightIcon, ChevronRightIcon, CopyIcon, FeedbackIcon, LibraryIcon,
  NotificationIcon, PeopleGroupIcon, PersonAvatarIcon, ScreenIcon, SearchIcon,
} from './coreIcons'
import { useAuth } from '../auth/AuthContext'
import { useQuickSearch } from '../api/hooks'
import { IssueTypeIcon } from './icons'
import type { IssueType } from '../api/types'
import { t } from '../i18n'

export const isMac = /mac/i.test(navigator.platform)

interface Action {
  section: string
  label: string
  icon: React.ComponentType<{ label: string }>
  kbd?: string
  run: () => void
  adminOnly?: boolean
  keywords?: string
}

const subtle = { color: token('color.text.subtlest', '#626F86') }

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 22,
        padding: '0 5px',
        borderRadius: 4,
        fontSize: 12,
        background: token('color.background.neutral', '#F1F2F4'),
        color: token('color.text.subtle', '#44546F'),
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
      }}
    >
      {children}
    </span>
  )
}

// Jira's ⌘K command palette: search actions & settings, or "/" to search work.
export default function CommandPalette({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const navigate = useNavigate()
  const { user, isAdmin } = useAuth()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  const workMode = query.startsWith('/')
  const workQuery = workMode ? query.slice(1).trim() : ''
  const { data: workResults } = useQuickSearch(workQuery.length >= 2 ? workQuery : '')

  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  const myOpenTQL = `assignee = ${user?.email ?? ''} AND resolution = EMPTY ORDER BY updated DESC`

  const actions: Action[] = useMemo(
    () => [
      {
        section: 'Quick actions',
        label: t('Create work item'),
        icon: AddIcon,
        kbd: 'C',
        run: () => {
          onClose()
          onCreate()
        },
      },
      {
        section: 'Quick actions',
        label: copied ? t('Copied!') : t('Copy current page URL'),
        icon: CopyIcon,
        run: () => {
          navigator.clipboard?.writeText(window.location.href)
          setCopied(true)
          setTimeout(onClose, 450)
        },
      },
      {
        section: 'Quick actions',
        label: t('Check notifications'),
        icon: NotificationIcon,
        run: () => {
          onClose()
          ;(document.querySelector('#th-notifications button') as HTMLButtonElement | null)?.click()
        },
      },
      {
        section: 'Site navigation',
        label: t('View my open work items'),
        icon: ArrowRightIcon,
        run: () => go(`/issues?tql=${encodeURIComponent(myOpenTQL)}`),
      },
      { section: 'Settings', label: t('General settings'), icon: PersonAvatarIcon, keywords: 'personal preferences language timezone theme', run: () => go('/settings/general') },
      { section: 'Settings', label: t('Notification settings'), icon: NotificationIcon, keywords: 'email in-app notifications', run: () => go('/settings/notifications') },
      { section: 'Settings', label: t('System settings'), icon: ScreenIcon, keywords: 'admin general configuration', adminOnly: true, run: () => go('/admin/system/general') },
      { section: 'Settings', label: t('Manage spaces'), icon: LibraryIcon, keywords: 'admin projects spaces', adminOnly: true, run: () => go('/admin/spaces') },
      { section: 'Settings', label: t('Work items'), icon: ScreenIcon, keywords: 'admin work types workflows custom fields transitions', adminOnly: true, run: () => go('/admin/work-items/types') },
      { section: 'Settings', label: t('Integrations'), icon: LibraryIcon, keywords: 'admin webhooks api tokens', adminOnly: true, run: () => go('/admin/integrations/webhooks') },
      { section: 'Settings', label: t('Global automation'), icon: ScreenIcon, keywords: 'admin automation rules flows triggers', adminOnly: true, run: () => go('/admin/automation') },
      { section: 'Settings', label: t('API tokens'), icon: PersonAvatarIcon, keywords: 'personal access token scripts ci bearer', run: () => go('/settings/api-tokens') },
      { section: 'Settings', label: t('User management'), icon: PeopleGroupIcon, keywords: 'admin users invites', adminOnly: true, run: () => go('/admin/users') },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [copied, isAdmin, user?.email],
  )

  const q = query.trim().toLowerCase()
  const visibleActions = actions.filter((a) => {
    if (a.adminOnly && !isAdmin) return false
    if (workMode) return false
    if (!q) return a.section !== 'Settings' // default view mirrors Jira: settings appear on search
    return (a.label + ' ' + (a.keywords ?? '')).toLowerCase().includes(q)
  })

  // Flat list for keyboard selection: work-search row first, then actions/results.
  const rows: { kind: 'work-entry' | 'action' | 'issue'; action?: Action; issue?: { key: string; summary: string; type: string } }[] = []
  if (!workMode) rows.push({ kind: 'work-entry' })
  if (workMode) {
    for (const i of workResults?.values ?? []) rows.push({ kind: 'issue', issue: i })
  } else {
    for (const a of visibleActions) rows.push({ kind: 'action', action: a })
  }

  useEffect(() => setSelected(0), [query, workResults?.values?.length])
  useEffect(() => inputRef.current?.focus(), [])

  const runRow = (row: (typeof rows)[number]) => {
    if (row.kind === 'work-entry') {
      setQuery('/')
      inputRef.current?.focus()
      return
    }
    if (row.kind === 'issue' && row.issue) go(`/browse/${row.issue.key}`)
    if (row.kind === 'action' && row.action) row.action.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && rows[selected]) {
      runRow(rows[selected])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '11px 20px',
    border: 'none',
    textAlign: 'left',
    fontSize: 15,
    cursor: 'pointer',
    background: active ? token('color.background.selected', '#E9F2FF') : 'transparent',
    color: 'inherit',
  })

  let rowIndex = -1
  const nextIndex = () => ++rowIndex

  const sectionsInOrder = ['Quick actions', 'Site navigation', 'Settings']

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(9,30,66,0.35)', display: 'flex', justifyContent: 'center' }}
    >
      <div
        style={{
          marginTop: 64,
          width: 'min(720px, calc(100vw - 48px))',
          maxHeight: 'min(560px, calc(100vh - 128px))',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 16,
          overflow: 'hidden',
          background: token('elevation.surface.overlay', '#FFFFFF'),
          boxShadow: token('elevation.shadow.overlay', '0 8px 28px rgba(9,30,66,0.35)'),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
          <span style={{ display: 'inline-flex', ...subtle }}>
            <SearchIcon label="" />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Search actions, settings, or type "/" to search work')}
            style={{ flex: 1, border: 'none', outline: 'none', fontSize: 17, background: 'transparent', color: 'inherit' }}
          />
        </div>

        <div style={{ overflowY: 'auto', padding: '8px 0 0' }}>
          {!workMode && (
            <>
              <div style={{ padding: '10px 20px 4px', fontSize: 14, fontWeight: 600, ...subtle }}>{t('Search work')}</div>
              {(() => {
                const i = nextIndex()
                return (
                  <button type="button" style={rowStyle(selected === i)} onMouseEnter={() => setSelected(i)} onClick={() => runRow({ kind: 'work-entry' })}>
                    <span style={{ display: 'inline-flex', ...subtle }}><SearchIcon label="" /></span>
                    <Kbd>/</Kbd>
                    <span style={{ flex: 1 }}>{t('Search work items, spaces, and more')}</span>
                    <ChevronRightIcon label="" />
                  </button>
                )
              })()}
              {sectionsInOrder.map((section) => {
                const sectionActions = visibleActions.filter((a) => a.section === section)
                if (sectionActions.length === 0) return null
                return (
                  <div key={section}>
                    <div style={{ padding: '14px 20px 4px', fontSize: 14, fontWeight: 600, ...subtle }}>{t(section)}</div>
                    {sectionActions.map((a) => {
                      const i = nextIndex()
                      const Icon = a.icon
                      return (
                        <button key={a.label} type="button" style={rowStyle(selected === i)} onMouseEnter={() => setSelected(i)} onClick={a.run}>
                          <span style={{ display: 'inline-flex', ...subtle }}><Icon label="" /></span>
                          <span style={{ flex: 1 }}>{a.label}</span>
                          {a.kbd && <Kbd>{a.kbd}</Kbd>}
                        </button>
                      )
                    })}
                  </div>
                )
              })}
              {q && visibleActions.length === 0 && (
                <div style={{ padding: '16px 20px', fontSize: 14, ...subtle }}>{t('No matching actions or settings.')}</div>
              )}
            </>
          )}

          {workMode && (
            <>
              <div style={{ padding: '10px 20px 4px', fontSize: 14, fontWeight: 600, ...subtle }}>
                {workQuery.length >= 2 ? t('Work items') : t('Keep typing to search work items…')}
              </div>
              {(workResults?.values ?? []).map((issue) => {
                const i = nextIndex()
                return (
                  <button key={issue.id} type="button" style={rowStyle(selected === i)} onMouseEnter={() => setSelected(i)} onClick={() => go(`/browse/${issue.key}`)}>
                    <IssueTypeIcon type={issue.type as IssueType} />
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{issue.key}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.summary}</span>
                  </button>
                )
              })}
              {workQuery.length >= 2 && (workResults?.values ?? []).length === 0 && (
                <div style={{ padding: '16px 20px', fontSize: 14, ...subtle }}>{t('No work items match “{query}”.', { query: workQuery })}</div>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onClose()
            window.open('https://github.com/ali-automation/taskhat/issues/new', '_blank')
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '13px 20px',
            border: 'none',
            borderTop: `1px solid ${token('color.border', '#DFE1E6')}`,
            background: 'transparent',
            fontSize: 15,
            cursor: 'pointer',
            color: 'inherit',
            textAlign: 'left',
          }}
        >
          <span style={{ display: 'inline-flex', ...subtle }}><FeedbackIcon label="" /></span>
          {t('Give feedback')}
        </button>
      </div>
    </div>
  )
}
