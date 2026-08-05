import { useEffect, useRef, useState } from 'react'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import { token } from '@atlaskit/tokens'
import { useAddWikiComment, useResolveWikiComment } from '../api/hooks'
import { CommentIcon } from './coreIcons'
import { t, timeAgo } from '../i18n'
import type { WikiComment } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// ---- text anchoring ----

// Finds the Nth occurrence of `text` inside the container's text content and
// returns the covered [node, offset] range boundaries.
function findOccurrence(container: HTMLElement, text: string, occurrence: number): Range | null {
  if (!text) return null
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let full = ''
  const starts: number[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text)
    starts.push(full.length)
    full += n.textContent ?? ''
  }
  let idx = -1
  for (let i = 0; i <= occurrence; i++) {
    idx = full.indexOf(text, idx + 1)
    if (idx === -1) return null
  }
  const end = idx + text.length
  const locate = (pos: number, forEnd: boolean): [Text, number] | null => {
    for (let i = 0; i < nodes.length; i++) {
      const s = starts[i]
      const e = s + (nodes[i].textContent?.length ?? 0)
      if (pos < e || (forEnd && pos === e)) return [nodes[i], pos - s]
      if (!forEnd && pos === s) return [nodes[i], 0]
    }
    return null
  }
  const start = locate(idx, false)
  const stop = locate(end, true)
  if (!start || !stop) return null
  const range = document.createRange()
  range.setStart(start[0], start[1])
  range.setEnd(stop[0], stop[1])
  return range
}

// Wraps every text segment inside the range with <mark data-cid>.
function wrapRange(range: Range, cid: string) {
  const root = range.commonAncestorContainer
  const walker = document.createTreeWalker(
    root.nodeType === Node.TEXT_NODE ? root.parentNode! : root,
    NodeFilter.SHOW_TEXT,
  )
  const targets: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (range.intersectsNode(n)) targets.push(n as Text)
  }
  for (const node of targets) {
    let seg = node
    let from = 0
    let to = seg.textContent?.length ?? 0
    if (node === range.startContainer) from = range.startOffset
    if (node === range.endContainer) to = range.endOffset
    if (from >= to) continue
    if (from > 0) seg = seg.splitText(from)
    if (to - from < (seg.textContent?.length ?? 0)) seg.splitText(to - from)
    const mark = document.createElement('mark')
    mark.className = 'th-inline-hl'
    mark.dataset.cid = cid
    seg.parentNode?.insertBefore(mark, seg)
    mark.appendChild(seg)
  }
}

// Applies highlights for unresolved inline roots; returns ids it anchored.
export function applyInlineHighlights(container: HTMLElement, roots: WikiComment[]): Set<string> {
  container.querySelectorAll('mark.th-inline-hl').forEach((m) => {
    const parent = m.parentNode
    while (m.firstChild) parent?.insertBefore(m.firstChild, m)
    parent?.removeChild(m)
  })
  container.normalize()
  const anchored = new Set<string>()
  for (const c of roots) {
    if (!c.inlineText || c.resolvedAt) continue
    const range = findOccurrence(container, c.inlineText, c.inlineOccurrence)
    if (range) {
      wrapRange(range, c.id)
      anchored.add(c.id)
    }
  }
  return anchored
}

// Counts occurrences of `text` before the selection start (anchoring index).
export function occurrenceOf(container: HTMLElement, range: Range, text: string): number {
  const pre = document.createRange()
  pre.selectNodeContents(container)
  pre.setEnd(range.startContainer, range.startOffset)
  const before = pre.toString()
  let count = 0
  let idx = before.indexOf(text)
  while (idx !== -1) {
    count++
    idx = before.indexOf(text, idx + 1)
  }
  return count
}

// ---- UI ----

export function SelectionBubble({ rect, onComment }: { rect: DOMRect; onComment: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault()
        onComment()
      }}
      style={{
        position: 'fixed', left: rect.left + rect.width / 2 - 40, top: rect.top - 40, zIndex: 500,
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 13,
        border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, cursor: 'pointer',
        background: token('elevation.surface.overlay', '#FFFFFF'),
        boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
        color: 'inherit',
      }}
    >
      <CommentIcon label="" /> {t('Comment')}
    </button>
  )
}

// Composer for a new inline comment, anchored near the selection.
export function InlineComposer({
  pageId, rect, inlineText, occurrence, onDone,
}: {
  pageId: string
  rect: DOMRect
  inlineText: string
  occurrence: number
  onDone: () => void
}) {
  const add = useAddWikiComment(pageId)
  const [text, setText] = useState('')
  return (
    <div style={{
      position: 'fixed', left: Math.min(rect.left, window.innerWidth - 360), top: Math.min(rect.bottom + 8, window.innerHeight - 220),
      zIndex: 500, width: 340, padding: 12, borderRadius: 8,
      border: `1px solid ${token('color.border', '#DFE1E6')}`,
      background: token('elevation.surface.overlay', '#FFFFFF'),
      boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
    }}>
      <div style={{
        fontSize: 12, marginBottom: 8, padding: '4px 8px', borderInlineStart: `3px solid ${token('color.background.accent.yellow.subtle', '#F5CD47')}`,
        background: token('color.background.neutral', '#F1F2F4'), borderRadius: 4,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {inlineText}
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('Add a comment…')}
        rows={3}
        style={{
          width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', fontSize: 14,
          border: `1px solid ${token('color.border.input', '#8590A2')}`, borderRadius: 4, padding: '6px 8px',
          background: 'transparent', color: 'inherit', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <Button appearance="subtle" spacing="compact" onClick={onDone}>{t('Cancel')}</Button>
        <Button
          appearance="primary"
          spacing="compact"
          isDisabled={!text.trim()}
          isLoading={add.isPending}
          onClick={() =>
            add.mutate(
              { body: text.trim(), bodyDoc: null, inlineText, inlineOccurrence: occurrence },
              { onSuccess: onDone },
            )
          }
        >
          {t('Save')}
        </Button>
      </div>
    </div>
  )
}

// The thread popover for an anchored highlight: root + replies + resolve.
export function ThreadPopover({
  pageId, root, replies, rect, onClose,
}: {
  pageId: string
  root: WikiComment
  replies: WikiComment[]
  rect: DOMRect
  onClose: () => void
}) {
  const add = useAddWikiComment(pageId)
  const resolve = useResolveWikiComment(pageId)
  const [reply, setReply] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const row = (c: WikiComment) => (
    <div key={c.id} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
      <Avatar size="small" name={c.author.displayName} src={c.author.avatarUrl ?? undefined} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>
          <strong>{c.author.displayName}</strong>{' '}
          <span style={subtleText}>{timeAgo(c.createdAt)}</span>
        </div>
        <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{c.body}</div>
      </div>
    </div>
  )

  return (
    <>
      <span style={{ position: 'fixed', inset: 0, zIndex: 490 }} onMouseDown={onClose} />
      <div ref={boxRef} style={{
        position: 'fixed', left: Math.min(rect.left, window.innerWidth - 380), top: Math.min(rect.bottom + 8, window.innerHeight - 320),
        zIndex: 500, width: 360, maxHeight: 380, overflowY: 'auto', padding: 12, borderRadius: 8,
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        background: token('elevation.surface.overlay', '#FFFFFF'),
        boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, ...subtleText }}>{t('Inline comment')}</span>
          <Button appearance="subtle" spacing="compact" isLoading={resolve.isPending}
            onClick={() => resolve.mutate({ id: root.id, resolved: true }, { onSuccess: onClose })}>
            {t('Resolve')}
          </Button>
        </div>
        {row(root)}
        {replies.map(row)}
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={t('Reply…')}
            rows={1}
            style={{
              flex: 1, resize: 'none', fontFamily: 'inherit', fontSize: 13,
              border: `1px solid ${token('color.border.input', '#8590A2')}`, borderRadius: 4, padding: '5px 8px',
              background: 'transparent', color: 'inherit', outline: 'none',
            }}
          />
          <Button appearance="primary" spacing="compact" isDisabled={!reply.trim()} isLoading={add.isPending}
            onClick={() => add.mutate({ body: reply.trim(), bodyDoc: null, parentId: root.id }, { onSuccess: () => setReply('') })}>
            {t('Reply')}
          </Button>
        </div>
      </div>
    </>
  )
}

// Footer summary of inline threads (resolved + orphaned live here).
export function InlineThreadsSummary({ pageId, comments, anchored }: { pageId: string; comments: WikiComment[]; anchored: Set<string> }) {
  const resolveComment = useResolveWikiComment(pageId)
  const roots = comments.filter((c) => c.inlineText && !c.parentId)
  if (roots.length === 0) return null
  const replies = (id: string) => comments.filter((c) => c.parentId === id).length
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>{t('Inline comments')} ({roots.length})</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {roots.map((c) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{
              padding: '1px 6px', borderRadius: 3, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              background: c.resolvedAt ? token('color.background.neutral', '#F1F2F4') : token('color.background.accent.yellow.subtlest', '#FFF7D6'),
            }}>
              {c.inlineText}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...subtleText }}>
              {c.author.displayName}: {c.body} {replies(c.id) > 0 ? `(+${replies(c.id)})` : ''}
            </span>
            {c.resolvedAt ? (
              <>
                <Lozenge>{t('Resolved')}</Lozenge>
                <Button appearance="subtle" spacing="compact" onClick={() => resolveComment.mutate({ id: c.id, resolved: false })}>
                  {t('Reopen')}
                </Button>
              </>
            ) : !anchored.has(c.id) ? (
              <Lozenge appearance="moved">{t('Text changed')}</Lozenge>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
