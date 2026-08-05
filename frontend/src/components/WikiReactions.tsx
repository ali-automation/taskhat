import { useEffect, useRef, useState } from 'react'
import Avatar from '@atlaskit/avatar'
import { token } from '@atlaskit/tokens'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { EmojiPicker } from './RichText'
import { EmojiIcon } from './coreIcons'
import { t, timeAgo } from '../i18n'
import type { User } from '../api/client'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

interface ReactionGroup { emoji: string; count: number; mine: boolean; users: string[] }
interface ReactionsPayload { page: ReactionGroup[]; comments: Record<string, ReactionGroup[]> }

export function useWikiReactions(pageId: string | undefined) {
  return useQuery({
    queryKey: ['wiki-reactions', pageId],
    queryFn: () => api<ReactionsPayload>(`/wiki/pages/${pageId}/reactions`),
    enabled: !!pageId,
  })
}

// Confluence's quick set, then the full picker.
const QUICK = ['👍', '❤️', '🎉', '😄', '😮']

function Chip({ g, onToggle }: { g: ReactionGroup; onToggle: () => void }) {
  const names = g.users.join(', ') + (g.count > g.users.length ? ` +${g.count - g.users.length}` : '')
  return (
    <button
      type="button"
      title={names}
      onClick={onToggle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', fontSize: 13,
        borderRadius: 12, cursor: 'pointer',
        border: `1px solid ${g.mine ? token('color.border.selected', '#0C66E4') : token('color.border', '#DFE1E6')}`,
        background: g.mine ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: g.mine ? token('color.text.selected', '#0C66E4') : 'inherit',
      }}
    >
      <span>{g.emoji}</span>
      <span style={{ fontWeight: 600 }}>{g.count}</span>
    </button>
  )
}

// The reaction row for a page (commentId absent) or one comment.
export function ReactionBar({ pageId, commentId, compact }: { pageId: string; commentId?: string; compact?: boolean }) {
  const qc = useQueryClient()
  const { data } = useWikiReactions(pageId)
  const [picking, setPicking] = useState(false)
  const groups = (commentId ? data?.comments?.[commentId] : data?.page) ?? []

  const toggle = useMutation({
    mutationFn: (emoji: string) =>
      api<ReactionsPayload>(commentId ? `/wiki/comments/${commentId}/reactions` : `/wiki/pages/${pageId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: (payload) => qc.setQueryData(['wiki-reactions', pageId], payload),
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: compact ? 4 : 0 }}>
      {groups.map((g) => (
        <Chip key={g.emoji} g={g} onToggle={() => toggle.mutate(g.emoji)} />
      ))}
      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {(!compact || groups.length === 0) &&
          QUICK.filter((e) => !groups.some((g) => g.emoji === e)).slice(0, compact ? 1 : 5).map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => toggle.mutate(e)}
              title={t('React with {emoji}', { emoji: e })}
              style={{
                border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15,
                padding: '2px 3px', borderRadius: 10, opacity: 0.55,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.opacity = '1')}
              onMouseLeave={(ev) => (ev.currentTarget.style.opacity = '0.55')}
            >
              {e}
            </button>
          ))}
        <button
          type="button"
          onClick={() => setPicking(!picking)}
          title={t('Add a reaction')}
          style={{
            display: 'inline-flex', alignItems: 'center', border: `1px dashed ${token('color.border', '#DFE1E6')}`,
            background: 'transparent', cursor: 'pointer', padding: '3px 6px', borderRadius: 12,
            color: token('color.text.subtlest', '#626F86'),
          }}
        >
          <EmojiIcon label={t('Add a reaction')} />
        </button>
        {picking && (
          <>
            <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setPicking(false)} />
            <span style={{ position: 'absolute', bottom: '100%', insetInlineStart: 0, zIndex: 401 }}>
              <EmojiPicker
                onPick={(e) => {
                  toggle.mutate(e)
                  setPicking(false)
                }}
              />
            </span>
          </>
        )}
      </span>
    </div>
  )
}

// "👁 N" in the byline; click lists who viewed. Mounts record the view.
export function PageViews({ pageId, views }: { pageId: string; views: number }) {
  const [open, setOpen] = useState(false)
  const recorded = useRef<string | null>(null)
  const qc = useQueryClient()

  useEffect(() => {
    if (recorded.current === pageId) return
    recorded.current = pageId
    api(`/wiki/pages/${pageId}/viewed`, { method: 'POST', body: '{}' })
      .then(() => qc.invalidateQueries({ queryKey: ['wiki-page', pageId] }))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId])

  const { data: viewers } = useQuery({
    queryKey: ['wiki-viewers', pageId],
    queryFn: () => api<{ user: User; lastViewedAt: string }[]>(`/wiki/pages/${pageId}/viewers`),
    enabled: open,
  })

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 }}
      >
        👁 {views}
      </button>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', insetInlineStart: '50%', transform: 'translateX(-50%)', zIndex: 401,
            width: 260, maxHeight: 280, overflowY: 'auto', padding: 8, marginTop: 6,
            background: token('elevation.surface.overlay', '#FFFFFF'),
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
            textAlign: 'start',
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{t('Viewed by')}</div>
            {(viewers ?? []).map((v) => (
              <div key={v.user.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
                <Avatar size="small" name={v.user.displayName} src={v.user.avatarUrl ?? undefined} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.user.displayName}</span>
                <span style={{ fontSize: 11, ...subtleText }}>{timeAgo(v.lastViewedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </span>
  )
}
