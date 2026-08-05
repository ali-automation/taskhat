import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import { token } from '@atlaskit/tokens'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { User } from '../api/client'
import { t, timeAgo } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

interface ForYouCard {
  id: string
  title: string
  icon: string
  kind: string
  spaceKey: string
  spaceName: string
  at: string
  action: 'visited' | 'edited'
}

interface FeedItem {
  id: string
  title: string
  icon: string
  kind: string
  spaceKey: string
  spaceName: string
  at: string
  actor: User | null
}

const kindGlyph = (kind: string, icon: string) =>
  icon || (kind === 'whiteboard' ? '🖼' : kind === 'blog' ? '✍️' : kind === 'folder' ? '📁' : '📄')

// Confluence's Home: "Pick up where you left off" + "Discover what's happening".
export default function WikiForYouPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'following' | 'popular'>('following')
  const { data } = useQuery({
    queryKey: ['wiki-foryou'],
    queryFn: () => api<{ pickUp: ForYouCard[]; following: FeedItem[]; popular: FeedItem[] }>('/wiki/foryou'),
  })

  const feed = (tab === 'following' ? data?.following : data?.popular) ?? []
  const openItem = (spaceKey: string, id: string) => navigate(`/wiki/spaces/${spaceKey}/pages/${id}`)

  const pill = (key: 'following' | 'popular', label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 14,
        borderRadius: 20, cursor: 'pointer',
        border: `1px solid ${tab === key ? token('color.border.selected', '#0C66E4') : token('color.border', '#DFE1E6')}`,
        background: tab === key ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: tab === key ? token('color.text.selected', '#0C66E4') : 'inherit',
        fontWeight: tab === key ? 600 : 400,
      }}
    >
      {label}
    </button>
  )

  return (
    <div style={{ padding: '24px 40px 64px', maxWidth: 1120 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14 }}>{t('Pick up where you left off')}</h2>
      {(data?.pickUp ?? []).length === 0 && (
        <div style={{ fontSize: 13, marginBottom: 20, ...subtleText }}>
          {t('Pages you visit or edit will show up here.')}{' '}
          <Link to="/wiki/directory">{t('Browse the spaces directory')}</Link>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 34 }}>
        {(data?.pickUp ?? []).map((c) => (
          <div
            key={c.id + c.action}
            onClick={() => openItem(c.spaceKey, c.id)}
            style={{
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 8, padding: '14px 16px', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 18,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F7F8F9'))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34, borderRadius: 6, fontSize: 18, flexShrink: 0,
                  border: `1px solid ${token('color.border', '#DFE1E6')}`,
                }}
              >
                {kindGlyph(c.kind, c.icon)}
              </span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.title}
                </div>
                <div style={{ fontSize: 12, ...subtleText }}>{c.spaceName}</div>
              </span>
            </div>
            <div style={{ fontSize: 12, ...subtleText }}>
              {c.action === 'edited' ? t('Edited {ago}', { ago: timeAgo(c.at) }) : t('Visited {ago}', { ago: timeAgo(c.at) })}
            </div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{t('Discover what’s happening')}</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {pill('following', t('Following'))}
        {pill('popular', t('Popular'))}
      </div>

      {feed.length === 0 && (
        <div style={{ fontSize: 13, padding: '18px 0', ...subtleText }}>
          {tab === 'following'
            ? t('Watch or star spaces and their activity will show up in your feed.')
            : t('Popular pages will appear here as your team reads and reacts.')}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {feed.map((it) => (
          <div
            key={it.id}
            onClick={() => openItem(it.spaceKey, it.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', cursor: 'pointer',
              borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`, borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F7F8F9'))}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 17, width: 24, textAlign: 'center', flexShrink: 0 }}>{kindGlyph(it.kind, it.icon)}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {it.title}
              </div>
              <div style={{ fontSize: 12, ...subtleText }}>{it.spaceName}</div>
            </span>
            {it.actor && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, ...subtleText }}>
                <Avatar size="xsmall" name={it.actor.displayName} src={it.actor.avatarUrl ?? undefined} />
                {it.actor.displayName}
              </span>
            )}
            <span style={{ fontSize: 12, whiteSpace: 'nowrap', ...subtleText }}>{timeAgo(it.at)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
