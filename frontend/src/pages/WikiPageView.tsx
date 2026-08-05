import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button, { IconButton } from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Lozenge from '@atlaskit/lozenge'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useArchiveWikiPage, useCopyWikiPage, useCreateWikiTemplate, useDeleteWikiPage, useSetWikiWatch, useToggleWikiStar, useWikiPage, useWikiPageDraft, useWikiSpace, useWikiSpaceAction, useWikiSpaceFlags, useWikiStarState, useWikiWatch } from '../api/hooks'
import { BookIcon, EditIcon, LockLockedIcon, PageIcon, ShowMoreHorizontalIcon } from '../components/coreIcons'
import { RichTextView } from '../components/RichText'
import { WikiAttachmentsSection, WikiCommentsSection } from '../components/WikiCollab'
import { RestrictionsDialog, ShareDialog, WikiLabelsBar } from '../components/WikiAccess'
import { useWikiRestrictions } from '../api/hooks'
import WhiteboardView from './WhiteboardView'
import WikiMoveDialog from '../components/WikiMoveDialog'
import { PageViews, ReactionBar } from '../components/WikiReactions'
import { InlineComposer, InlineThreadsSummary, SelectionBubble, ThreadPopover, applyInlineHighlights, occurrenceOf } from '../components/WikiInlineComments'
import { useWikiComments } from '../api/hooks'
import { fmtDate, t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Confluence's page view: breadcrumbs, title, byline, content, child pages.
export default function WikiPageView() {
  const { key, pageId } = useParams<{ key: string; pageId: string }>()
  const spaceKey = key?.toUpperCase() ?? ''
  const navigate = useNavigate()
  const { data: page, isLoading } = useWikiPage(pageId)
  const { data: spaceData } = useWikiSpace(spaceKey)
  const deletePage = useDeleteWikiPage(spaceKey)
  const saveTemplate = useCreateWikiTemplate(spaceKey)
  const copyPage = useCopyWikiPage(spaceKey)
  const archivePage = useArchiveWikiPage(spaceKey)
  const toggleStar = useToggleWikiStar()
  const [moving, setMoving] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const { data: draft } = useWikiPageDraft(pageId)
  const { data: watch } = useWikiWatch(pageId)
  const setWatch = useSetWikiWatch(pageId ?? '')
  const attachInput = useRef<HTMLInputElement>(null)
  const [sharing, setSharing] = useState(false)
  const [restricting, setRestricting] = useState(false)
  const { data: starState } = useWikiStarState(pageId)
  const { data: spaceFlags } = useWikiSpaceFlags(spaceKey)
  const spaceWatchAction = useWikiSpaceAction(spaceKey)
  const { data: restrictions } = useWikiRestrictions(pageId)
  // Inline comments: text-anchored highlights over the rendered body.
  const contentRef = useRef<HTMLDivElement>(null)
  const { data: comments } = useWikiComments(pageId)
  const [anchored, setAnchored] = useState<Set<string>>(new Set())
  const [selection, setSelection] = useState<{ rect: DOMRect; text: string; occurrence: number } | null>(null)
  // Snapshot of the anchor once the bubble is clicked — survives the
  // selection collapsing when focus moves into the composer.
  const [composer, setComposer] = useState<{ rect: DOMRect; text: string; occurrence: number } | null>(null)
  const [thread, setThread] = useState<{ id: string; rect: DOMRect } | null>(null)
  const inlineRoots = useMemo(() => (comments ?? []).filter((c) => c.inlineText && !c.parentId), [comments])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    // Delay so smart-block hydration settles before anchoring.
    const timer = setTimeout(() => setAnchored(applyInlineHighlights(el, inlineRoots)), 400)
    return () => clearTimeout(timer)
  }, [inlineRoots, page?.bodyDoc])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onMouseUp = () => {
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.rangeCount) {
          setSelection(null)
          return
        }
        const range = sel.getRangeAt(0)
        if (!el.contains(range.commonAncestorContainer)) return
        const text = range.toString()
        if (!text.trim() || text.length > 400) {
          setSelection(null)
          return
        }
        setSelection({ rect: range.getBoundingClientRect(), text, occurrence: occurrenceOf(el, range, text) })
      }, 10)
    }
    el.addEventListener('mouseup', onMouseUp)
    return () => el.removeEventListener('mouseup', onMouseUp)
  }, [page?.id])

  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      const mark = (e.target as HTMLElement).closest?.('mark.th-inline-hl') as HTMLElement | null
      if (mark?.dataset.cid) {
        setThread({ id: mark.dataset.cid, rect: mark.getBoundingClientRect() })
      }
    }
    el.addEventListener('click', onClick)
    return () => el.removeEventListener('click', onClick)
  }, [page?.id])

  if (isLoading || !page) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  if (page.kind === 'whiteboard') return <WhiteboardView key={page.id} page={page} readOnly={(spaceData?.myRole ?? 'collaborator') === 'viewer'} />

  const children = (spaceData?.pages ?? []).filter((n) => n.parentId === page.id)
  const updated = page.updatedBy ?? page.author
  const canEdit = (spaceData?.myRole ?? 'collaborator') !== 'viewer'

  return (
    <div style={{ padding: '12px 32px 48px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link to={`/wiki/spaces/${page.spaceKey}`} style={subtleText}>{page.spaceName}</Link>
        {page.ancestors.map((a) => (
          <span key={a.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <span style={subtleText}>/</span>
            <Link to={`/wiki/spaces/${page.spaceKey}/pages/${a.id}`} style={subtleText}>{a.title}</Link>
          </span>
        ))}
        <span style={{ flex: 1 }} />
        {page.archivedAt && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Lozenge appearance="moved">{t('Archived')}</Lozenge>
            {canEdit && (
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => archivePage.mutate({ id: page.id, archived: false })}
              >
                {t('Restore')}
              </Button>
            )}
          </span>
        )}
        {page.kind === 'page' && canEdit && (
          <Button appearance="subtle" spacing="compact" iconBefore={EditIcon}
            onClick={() => navigate(`/wiki/spaces/${page.spaceKey}/pages/${page.id}/edit`)}>
            {t('Edit')}
          </Button>
        )}
        <Button
          appearance="subtle"
          spacing="compact"
          iconBefore={(restrictions ?? []).length > 0 ? LockLockedIcon : undefined}
          onClick={() => setSharing(true)}
        >
          {t('Share')}
        </Button>
        <DropdownMenu<HTMLButtonElement>
          trigger={({ triggerRef, ...props }) => (
            <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('Page options')} appearance="subtle" spacing="compact" />
          )}
          shouldRenderToParent
        >
          <DropdownItemGroup>
            <DropdownItem onClick={() => setWatch.mutate(!watch?.watching)}>
              {watch?.watching ? t('Stop watching page') : t('Watch page')}
              {watch && watch.count > 0 ? ` (${watch.count})` : ''}
            </DropdownItem>
            <DropdownItem onClick={() => spaceWatchAction.mutate({ action: '/watch' })}>
              {spaceFlags?.watching ? t('Stop watching space') : t('Watch space')}
            </DropdownItem>
            <DropdownItem onClick={() => navigate(`/wiki/spaces/${page.spaceKey}/pages/${page.id}/history`)}>
              {t('Version history')}
            </DropdownItem>
            <DropdownItem onClick={() => toggleStar.mutate(page.id)}>
              {starState?.starred ? t('Unstar') : t('Star')}
            </DropdownItem>
            {canEdit && page.kind !== 'folder' && (
              <DropdownItem
                onClick={() => copyPage.mutate(page.id, { onSuccess: (p) => navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`) })}
              >
                {t('Make a copy')}
              </DropdownItem>
            )}
            {canEdit && !page.isHome && (
              <DropdownItem onClick={() => setMoving(true)}>{t('Move…')}</DropdownItem>
            )}
            {canEdit && !page.isHome && !page.archivedAt && (
              <DropdownItem
                onClick={() => {
                  if (window.confirm(t('Archive "{title}" and everything under it?', { title: page.title })))
                    archivePage.mutate({ id: page.id, archived: true })
                }}
              >
                {t('Archive')}
              </DropdownItem>
            )}
            {(page.kind === 'page' || page.kind === 'blog') && (
              <DropdownItem onClick={() => setPresenting(true)}>{t('Present')}</DropdownItem>
            )}
            {(page.kind === 'page' || page.kind === 'blog') && (
              <DropdownItem onClick={() => exportPageToPDF(page.title, contentRef.current?.innerHTML ?? '')}>
                {t('Export to PDF')}
              </DropdownItem>
            )}
            {canEdit && !page.isHome && (page.kind === 'page' || page.kind === 'blog') && (
              <DropdownItem
                onClick={async () => {
                  const { api } = await import('../api/client')
                  await api(`/wiki/pages/${page.id}/convert`, {
                    method: 'POST',
                    body: JSON.stringify({ kind: page.kind === 'page' ? 'blog' : 'page' }),
                  })
                  window.location.reload()
                }}
              >
                {page.kind === 'page' ? t('Convert to blog post') : t('Convert to page')}
              </DropdownItem>
            )}
            {canEdit && (
              <DropdownItem onClick={() => setRestricting(true)}>
                {t('Restrictions')}
              </DropdownItem>
            )}
            {canEdit && (
              <DropdownItem onClick={() => attachInput.current?.click()}>
                {t('Attach file')}
              </DropdownItem>
            )}
            {canEdit && page.kind === 'page' && (
              <DropdownItem
                onClick={() => {
                  const name = window.prompt(t('Save as template — template name:'), page.title)
                  if (name && name.trim())
                    saveTemplate.mutate(
                      { name: name.trim(), fromPageId: page.id },
                      { onError: (e) => window.alert(e instanceof Error ? e.message : t('Something went wrong')) },
                    )
                }}
              >
                {t('Save as template')}
              </DropdownItem>
            )}
            {canEdit && page.kind !== 'blog' && (
              <DropdownItem onClick={() => navigate(`/wiki/spaces/${page.spaceKey}/new?parent=${page.id}`)}>
                {t('Create child page')}
              </DropdownItem>
            )}
            {canEdit && !page.isHome && (
              <DropdownItem
                onClick={() => {
                  if (window.confirm(t('Delete "{title}"? Its child pages move up one level.', { title: page.title })))
                    deletePage.mutate(page.id, { onSuccess: () => navigate(`/wiki/spaces/${page.spaceKey}`) })
                }}
              >
                {t('Delete')}
              </DropdownItem>
            )}
          </DropdownItemGroup>
        </DropdownMenu>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto' }}>
      {page.icon && <div style={{ textAlign: 'center', fontSize: 44, lineHeight: 1.2, marginBottom: 4 }}>{page.icon}</div>}
      <h1 style={{ fontSize: 32, fontWeight: 600, margin: '0 0 10px', textAlign: 'center', lineHeight: 1.25 }}>
        {page.title}
        {draft && (
          <span style={{ cursor: 'pointer', marginInlineStart: 10, verticalAlign: 'middle' }} onClick={() => navigate(`/wiki/spaces/${page.spaceKey}/pages/${page.id}/edit`)}>
            <Lozenge appearance="moved">{t('Unpublished changes')}</Lozenge>
          </span>
        )}
      </h1>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13, marginBottom: 32, ...subtleText }}>
        {page.author && <Avatar size="small" name={page.author.displayName} src={page.author.avatarUrl ?? undefined} />}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {page.author && <>{t('Owned by')} <strong style={{ color: token('color.text', '#172B4D') }}>{page.author.displayName}</strong></>}
          {updated && <> · {t('Last updated {date}', { date: fmtDate(page.updatedAt) })}</>}
          {page.bodyText && (
            <>
              {' · '}
              <BookIcon label="" />
              {t('{n} min', { n: Math.max(1, Math.round(page.bodyText.split(/\s+/).length / 200)) })}
            </>
          )}
          {' · '}
          <PageViews pageId={page.id} views={page.views} />
        </span>
      </div>

      <div ref={contentRef} style={{ fontSize: 16, lineHeight: 1.7 }}>
        {page.bodyDoc || page.bodyText ? (
          <RichTextView doc={page.bodyDoc ?? undefined} fallback={page.bodyText} />
        ) : (
          <p style={subtleText}>
            {t('This page is empty.')}{' '}
            <Link to={`/wiki/spaces/${page.spaceKey}/pages/${page.id}/edit`}>{t('Edit it')}</Link>
          </p>
        )}
      </div>

      {children.length > 0 && (
        <div style={{ marginTop: 40, borderTop: `1px solid ${token('color.border', '#DFE1E6')}`, paddingTop: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Child pages')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {children.map((c) => (
              <Link key={c.id} to={`/wiki/spaces/${page.spaceKey}/pages/${c.id}`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                {c.icon ? <span>{c.icon}</span> : <PageIcon label="" />} {c.title}
              </Link>
            ))}
          </div>
        </div>
      )}
      <div style={{ marginTop: 24 }}>
        <ReactionBar pageId={page.id} />
      </div>
      <WikiLabelsBar pageId={page.id} spaceKey={page.spaceKey} readOnly={!canEdit} />
      <InlineThreadsSummary pageId={page.id} comments={comments ?? []} anchored={anchored} />
      <WikiAttachmentsSection pageId={page.id} inputRef={attachInput} />
      <WikiCommentsSection pageId={page.id} readOnly={!canEdit} />
      </div>
      {canEdit && selection && !composer && (
        <SelectionBubble
          rect={selection.rect}
          onComment={() => {
            setComposer(selection)
            setSelection(null)
          }}
        />
      )}
      {composer && (
        <InlineComposer
          pageId={page.id}
          rect={composer.rect}
          inlineText={composer.text}
          occurrence={composer.occurrence}
          onDone={() => {
            setComposer(null)
            window.getSelection()?.removeAllRanges()
          }}
        />
      )}
      {thread && (() => {
        const root = inlineRoots.find((c) => c.id === thread.id)
        if (!root) return null
        return (
          <ThreadPopover
            pageId={page.id}
            root={root}
            replies={(comments ?? []).filter((c) => c.parentId === thread.id)}
            rect={thread.rect}
            onClose={() => setThread(null)}
          />
        )
      })()}
      {sharing && <ShareDialog pageId={page.id} onClose={() => setSharing(false)} />}
      {presenting && (
        <PresentMode title={page.title} icon={page.icon} onClose={() => setPresenting(false)}>
          <RichTextView doc={page.bodyDoc ?? undefined} fallback={page.bodyText} />
        </PresentMode>
      )}
      {moving && (
        <WikiMoveDialog
          pageId={page.id}
          pageTitle={page.title}
          currentSpaceKey={page.spaceKey}
          onClose={() => setMoving(false)}
          onMoved={(key) => {
            setMoving(false)
            navigate(`/wiki/spaces/${key}/pages/${page.id}`)
          }}
        />
      )}
      {restricting && <RestrictionsDialog pageId={page.id} onClose={() => setRestricting(false)} />}
    </div>
  )
}


// ---- W18: present mode + PDF export ----

// A clean full-screen reading view, like Confluence's Present.
function PresentMode({ title, icon, onClose, children }: { title: string; icon: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 700, overflowY: 'auto', background: token('elevation.surface', '#FFFFFF') }}>
      <div style={{ position: 'sticky', top: 0, display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
        <Button appearance="subtle" onClick={onClose}>✕ {t('Exit')}</Button>
      </div>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '12px 32px 120px', fontSize: 18, lineHeight: 1.8 }}>
        <h1 style={{ fontSize: 44, fontWeight: 700, marginBottom: 28, textAlign: 'center' }}>
          {icon ? icon + ' ' : ''}{title}
        </h1>
        {children}
      </div>
    </div>
  )
}

// Opens a print-optimized window with the rendered page — the browser's
// print dialog handles "Save as PDF".
function exportPageToPDF(title: string, contentHTML: string) {
  const win = window.open('', '_blank', 'width=900,height=700')
  if (!win) return
  const styles = Array.from(document.querySelectorAll('style'))
    .map((s) => s.outerHTML)
    .join('\n')
  win.document.write(`<!doctype html><html><head><title>${title.replace(/</g, '&lt;')}</title>${styles}
    <style>
      body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color: #172B4D; margin: 40px auto; max-width: 760px; padding: 0 24px; }
      h1.th-pdf-title { font-size: 32px; margin-bottom: 24px; }
      img { max-width: 100%; }
      @media print { body { margin: 0 auto; } }
    </style></head>
    <body><h1 class="th-pdf-title">${title.replace(/</g, '&lt;')}</h1><div class="th-richtext-view">${contentHTML}</div></body></html>`)
  win.document.close()
  win.focus()
  setTimeout(() => win.print(), 400)
}
