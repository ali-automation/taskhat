import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Lozenge from '@atlaskit/lozenge'
import { token } from '@atlaskit/tokens'
import { SearchIcon } from './coreIcons'
import { useQuery } from '@tanstack/react-query'
import { useQuickSearch, useWikiSpaces } from '../api/hooks'
import { api } from '../api/client'
import type { User } from '../api/client'
import { IssueTypeIcon, StatusLozenge } from './icons'
import { t, timeAgo } from '../i18n'

interface RecentItem {
  key: string
  summary: string
}

export function recordRecentItem(item: RecentItem) {
  try {
    const list: RecentItem[] = JSON.parse(localStorage.getItem('taskhat-recent') ?? '[]')
    const next = [item, ...list.filter((i) => i.key !== item.key)].slice(0, 5)
    localStorage.setItem('taskhat-recent', JSON.stringify(next))
  } catch {
    // ignore
  }
}

function recentItems(): RecentItem[] {
  try {
    return JSON.parse(localStorage.getItem('taskhat-recent') ?? '[]')
  } catch {
    return []
  }
}

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Top-nav quick search with live results, like Jira's global search.
export default function QuickSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const inWiki = useLocation().pathname.startsWith('/wiki')
  const [filterSpace, setFilterSpace] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const { data } = useQuickSearch(q, {
    space: inWiki ? filterSpace : '',
    contributor: inWiki ? filterUser : '',
    withRecents: inWiki && open,
  })
  const { data: wikiSpaces } = useWikiSpaces()
  const { data: contributors } = useQuery({
    queryKey: ['wiki-contributors', filterSpace],
    queryFn: () => api<User[]>(`/wiki/contributors?space=${encodeURIComponent(filterSpace)}`),
    enabled: inWiki && open,
  })
  const navigate = useNavigate()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const results = data?.values ?? []
  const wikiPages = data?.wikiPages ?? []
  const recentWiki = data?.recentWiki ?? []

  const wikiFilterActive = inWiki && (filterSpace !== '' || filterUser !== '')

  const pagesSection = wikiPages.length > 0 ? (
    <>
      <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
        {t('Pages')}
      </div>
      {wikiPages.map((p) => (
        <div
          key={p.id}
          onClick={() => {
            setOpen(false)
            setQ('')
            navigate(`/wiki/spaces/${p.spaceKey}/pages/${p.id}`)
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{p.icon || '📄'}</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
              {p.draft && <Lozenge appearance="inprogress">{t('Draft')}</Lozenge>}
            </span>
            <span style={{ fontSize: 11, ...subtleText }}>{p.spaceName}</span>
          </span>
        </div>
      ))}
    </>
  ) : inWiki ? (
    <div style={{ padding: '10px 12px', fontSize: 13, ...subtleText }}>{t('No matching pages.')}</div>
  ) : null

  const filtersRow = inWiki ? (
    <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: `1px solid ${token('color.border', '#F1F2F4')}` }}>
      <select
        value={filterSpace}
        onChange={(e) => {
          setFilterSpace(e.currentTarget.value)
          setFilterUser('')
        }}
        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: `1px solid ${token('color.border', '#DFE1E6')}`, background: 'transparent', color: 'inherit', maxWidth: 160 }}
      >
        <option value="">{t('Space')}</option>
        {(wikiSpaces ?? []).map((s) => (
          <option key={s.id} value={s.key}>{s.name}</option>
        ))}
      </select>
      <select
        value={filterUser}
        onChange={(e) => setFilterUser(e.currentTarget.value)}
        style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: `1px solid ${token('color.border', '#DFE1E6')}`, background: 'transparent', color: 'inherit', maxWidth: 160 }}
      >
        <option value="">{t('Contributor')}</option>
        {(contributors ?? []).map((u: User) => (
          <option key={u.id} value={u.id}>{u.displayName}</option>
        ))}
      </select>
    </div>
  ) : null

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}>
      <span style={{ position: 'absolute', insetInlineStart: 10, top: 7, color: token('color.text.subtlest', '#626F86') }}>
        <SearchIcon label="" />
      </span>
      <input
        type="search"
        placeholder={t('Search')}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.currentTarget.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim()) {
            setOpen(false)
            navigate(`/issues?tql=${encodeURIComponent(`text ~ "${q.trim().replace(/"/g, '')}" ORDER BY updated DESC`)}`)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        style={{
          width: '100%',
          paddingBlock: 6, paddingInline: '34px 12px',
          borderRadius: 8,
          border: `2px solid ${token('color.border', '#DFE1E6')}`,
          background: token('elevation.surface', '#FFFFFF'),
          fontSize: 13,
          fontFamily: 'inherit',
          color: 'inherit',
        }}
      />
      {open && q.trim().length < 2 && inWiki && (
        <div
          style={{
            position: 'absolute', top: 38, insetInlineStart: 0, width: '100%', minWidth: 460,
            background: token('elevation.surface.overlay', '#FFFFFF'),
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8, boxShadow: token('elevation.shadow.overlay', '0 8px 12px rgba(9,30,66,0.15)'),
            zIndex: 500,
          }}
        >
          {filtersRow}
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
            {t('Recent')}
          </div>
          {recentWiki.length === 0 && (
            <div style={{ padding: '4px 12px 10px', fontSize: 13, ...subtleText }}>{t('Nothing viewed yet.')}</div>
          )}
          {recentWiki.map((p) => (
            <div
              key={p.id}
              onClick={() => {
                setOpen(false)
                navigate(`/wiki/spaces/${p.spaceKey}/pages/${p.id}`)
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', cursor: 'pointer' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ width: 16, display: 'inline-flex', justifyContent: 'center' }}>{p.icon || (p.kind === 'whiteboard' ? '🖼' : '📄')}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
                  {p.draft && <Lozenge appearance="inprogress">{t('Draft')}</Lozenge>}
                </span>
                <span style={{ fontSize: 11, ...subtleText }}>{p.spaceName}</span>
              </span>
              <span style={{ fontSize: 11, whiteSpace: 'nowrap', ...subtleText }}>{t('You viewed {ago}', { ago: timeAgo(p.viewedAt) })}</span>
            </div>
          ))}
        </div>
      )}
      {open && q.trim().length < 2 && !inWiki && recentItems().length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 38,
            insetInlineStart: 0,
            width: '100%',
            minWidth: 420,
            background: token('elevation.surface.overlay', '#FFFFFF'),
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8,
            boxShadow: token('elevation.shadow.overlay', '0 8px 12px rgba(9,30,66,0.15)'),
            zIndex: 500,
          }}
        >
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
            {t('Recent')}
          </div>
          {recentItems().map((r) => (
            <div
              key={r.key}
              onClick={() => {
                setOpen(false)
                navigate(`/browse/${r.key}`)
              }}
              style={{ display: 'flex', gap: 8, padding: '7px 12px', cursor: 'pointer', fontSize: 13, alignItems: 'baseline' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.summary}</span>
              <span style={{ fontSize: 11, ...subtleText }}>{r.key}</span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderTop: `1px solid ${token('color.border', '#F1F2F4')}` }}>
            {(
              [
                [t('Work items (TQL)'), '/issues'],
                [t('Spaces'), '/projects'],
                [t('Filters'), '/issues'],
              ] as [string, string][]
            ).map(([label, path]) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setOpen(false)
                  navigate(path)
                }}
                style={{
                  border: `1px solid ${token('color.border', '#DFE1E6')}`,
                  background: 'transparent',
                  borderRadius: 12,
                  padding: '3px 10px',
                  fontSize: 12,
                  cursor: 'pointer',
                  color: 'inherit',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {open && q.trim().length >= 2 && (
        <div
          style={{
            position: 'absolute',
            top: 38,
            insetInlineStart: 0,
            width: '100%',
            minWidth: 420,
            maxHeight: 380,
            overflowY: 'auto',
            background: token('elevation.surface.overlay', '#FFFFFF'),
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8,
            boxShadow: token('elevation.shadow.overlay', '0 8px 12px rgba(9,30,66,0.15), 0 0 1px rgba(9,30,66,0.31)'),
            zIndex: 500,
          }}
        >
          {filtersRow}
          {inWiki && pagesSection}
          {!wikiFilterActive && (
            <>
          <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
            {t('Work items')}
          </div>
          {results.map((issue) => (
            <div
              key={issue.id}
              onClick={() => {
                setOpen(false)
                setQ('')
                navigate(`/browse/${issue.key}`)
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 12px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <IssueTypeIcon type={issue.type} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {issue.summary}
                </span>
                <span style={{ fontSize: 11, ...subtleText }}>{issue.key}</span>
              </span>
              <StatusLozenge name={issue.status.name} category={issue.status.category} />
            </div>
          ))}
          {results.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 13, ...subtleText }}>{t('No matching issues.')}</div>
          )}
            </>
          )}
          {!inWiki && pagesSection}
          {!wikiFilterActive && (
            <div
              onClick={() => {
                setOpen(false)
                navigate(`/issues?tql=${encodeURIComponent(`text ~ "${q.trim().replace(/"/g, '')}" ORDER BY updated DESC`)}`)
              }}
              style={{
                padding: '8px 12px',
                fontSize: 12,
                cursor: 'pointer',
                borderTop: `1px solid ${token('color.border', '#F1F2F4')}`,
                color: token('color.link', '#0C66E4'),
              }}
            >
              {t('View all results in issue navigator →')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
