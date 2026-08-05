import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import { token } from '@atlaskit/tokens'
import { combine } from '@atlaskit/pragmatic-drag-and-drop/combine'
import { draggable, dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import { useArchiveWikiPage, useCopyWikiPage, useCreateWikiShortcut, useDeleteWikiPage, useDeleteWikiShortcut, useMoveWikiPage, useRecentWikiPages, useRenameWikiPage, useToggleWikiStar, useWikiShortcuts, useWikiSpace, useWikiSpaceAction, useWikiSpaceFlags, useWikiSpaces, useWikiStarred } from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { language, t, timeAgo } from '../i18n'
import WikiMoveDialog from './WikiMoveDialog'
import { AddIcon, CalendarIcon, ChevronDownIcon, ChevronRightIcon, ClockIcon, FolderClosedIcon, HatLogo, HomeIcon, LibraryIcon, LinkExternalIcon, PageIcon, PagesIcon, PersonAvatarIcon, QuotationMarkIcon, SearchIcon, SettingsIcon, ShortcutIcon, StarUnstarredIcon, WhiteboardIcon } from './coreIcons'
import { useCreateWikiPage } from '../api/hooks'
import type { WikiPageNode } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function Item({
  icon,
  label,
  onClick,
  active,
  indent = 0,
  trailing,
  trailingAlways,
}: {
  icon?: ReactNode
  label: ReactNode
  onClick?: () => void
  active?: boolean
  indent?: number
  trailing?: ReactNode
  // Chevrons and lozenges stay visible; hover-only actions (like +) don't.
  trailingAlways?: boolean
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 36,
        paddingInline: `${10 + indent * 16}px 8px`,
        margin: '0 8px',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 14,
        background: active
          ? token('color.background.selected', '#E9F2FF')
          : hover
            ? token('color.background.neutral.subtle.hovered', '#F1F2F4')
            : 'transparent',
        color: active ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
        boxShadow: active ? `inset ${language === 'ar' ? -2 : 2}px 0 0 ${token('color.border.selected', '#0C66E4')}` : 'none',
        fontWeight: active ? 600 : 400,
      }}
    >
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {(hover || trailingAlways) && trailing}
    </div>
  )
}

// Tree glyph per content kind, like Confluence's page/whiteboard/folder icons.
function NodeKindIcon({ kind }: { kind?: string }) {
  if (kind === 'whiteboard') return <WhiteboardIcon label="" />
  if (kind === 'folder') return <FolderClosedIcon label="" />
  return <PageIcon label="" />
}

type DropZone = 'before' | 'after' | 'child' | null

// One page row plus its children — Confluence's expandable content tree,
// draggable to reorder or nest (top/bottom = sibling, middle = child).
function TreeNode({
  node,
  childrenOf,
  depth,
  spaceKey,
  activeId,
  onMove,
  readOnly,
  renamingId,
  setRenamingId,
  onOpenMove,
}: {
  node: WikiPageNode
  childrenOf: Map<string | null, WikiPageNode[]>
  depth: number
  spaceKey: string
  activeId?: string
  onMove: (sourceId: string, target: WikiPageNode, zone: Exclude<DropZone, null>) => void
  readOnly?: boolean
  renamingId: string | null
  setRenamingId: (id: string | null) => void
  onOpenMove: (node: WikiPageNode) => void
}) {
  const navigate = useNavigate()
  const kids = childrenOf.get(node.id) ?? []
  const [open, setOpen] = useState(true)
  const [dragging, setDragging] = useState(false)
  const [zone, setZone] = useState<DropZone>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const toggleStar = useToggleWikiStar()
  const copyPage = useCopyWikiPage(spaceKey)
  const archivePage = useArchiveWikiPage(spaceKey)
  const deletePage = useDeleteWikiPage(spaceKey)
  const renamePage = useRenameWikiPage(spaceKey)

  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const zoneFor = (clientY: number): Exclude<DropZone, null> => {
      const rect = el.getBoundingClientRect()
      const y = (clientY - rect.top) / rect.height
      return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'child'
    }
    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ kind: 'wiki-page', id: node.id }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.kind === 'wiki-page' && source.data.id !== node.id,
        onDrag: ({ location }) => setZone(zoneFor(location.current.input.clientY)),
        onDragLeave: () => setZone(null),
        onDrop: ({ source, location }) => {
          setZone(null)
          if (location.current.dropTargets[0]?.element !== el) return
          onMove(source.data.id as string, node, zoneFor(location.current.input.clientY))
        },
      }),
    )
  }, [node.id, node.parentId, node.position, onMove]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoneLine = (edge: 'before' | 'after') =>
    zone === edge ? { boxShadow: `inset 0 ${edge === 'before' ? 2 : -2}px 0 ${token('color.border.selected', '#0C66E4')}` } : {}

  if (renamingId === node.id) {
    return (
      <>
        <div style={{ padding: '2px 8px 2px ' + (18 + depth * 16) + 'px' }}>
          <input
            autoFocus
            defaultValue={node.title}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenamingId(null)
            }}
            onBlur={(e) => {
              const title = e.currentTarget.value.trim()
              if (title && title !== node.title) renamePage.mutate({ id: node.id, title })
              setRenamingId(null)
            }}
            style={{
              width: '100%', fontSize: 14, padding: '4px 6px', borderRadius: 4,
              border: `1px solid ${token('color.border.selected', '#0C66E4')}`,
              background: 'transparent', color: 'inherit', fontFamily: 'inherit',
            }}
          />
        </div>
        {open && kids.map((k) => (
          <TreeNode key={k.id} node={k} childrenOf={childrenOf} depth={depth + 1} spaceKey={spaceKey} activeId={activeId} onMove={onMove} readOnly={readOnly} renamingId={renamingId} setRenamingId={setRenamingId} onOpenMove={onOpenMove} />
        ))}
      </>
    )
  }

  return (
    <>
      <div
        ref={rowRef}
        style={{
          position: 'relative',
          opacity: dragging ? 0.4 : 1,
          borderRadius: 6,
          background: zone === 'child' ? token('color.background.selected', '#E9F2FF') : 'transparent',
          ...zoneLine('before'),
          ...zoneLine('after'),
        }}
      >
      <Item
        indent={depth}
        active={node.id === activeId}
        icon={
          kids.length > 0 ? (
            <span
              onClick={(e) => {
                e.stopPropagation()
                setOpen(!open)
              }}
              style={{ display: 'inline-flex', cursor: 'pointer' }}
            >
              {open ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
            </span>
          ) : node.icon ? (
            <span style={{ fontSize: 14 }}>{node.icon}</span>
          ) : (
            <NodeKindIcon kind={node.kind} />
          )
        }
        label={node.icon && kids.length > 0 ? `${node.icon} ${node.title}` : node.title}
        onClick={() => (node.kind === 'folder' ? setOpen(!open) : navigate(`/wiki/spaces/${spaceKey}/pages/${node.id}`))}
        trailing={
          <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {!readOnly && (
              <span
                title={t('Create child page')}
                onClick={(e) => {
                  e.stopPropagation()
                  navigate(`/wiki/spaces/${spaceKey}/new?parent=${node.id}`)
                }}
                style={{ display: 'inline-flex', color: token('color.text.subtle', '#44546F') }}
              >
                <AddIcon label="" />
              </span>
            )}
            <span
              title={t('More actions')}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(!menuOpen)
              }}
              style={{ display: 'inline-flex', color: token('color.text.subtle', '#44546F'), fontWeight: 700 }}
            >
              ⋯
            </span>
          </span>
        }
      />
      {menuOpen && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setMenuOpen(false)} />
          <div
            style={{
              position: 'absolute', insetInlineEnd: 8, zIndex: 401, width: 190,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
              padding: 4, display: 'flex', flexDirection: 'column',
            }}
            onClick={() => setMenuOpen(false)}
          >
            {!readOnly && node.kind !== 'folder' && node.kind !== 'whiteboard' && (
              <MenuRow icon={null} label={t('Edit')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/pages/${node.id}/edit`)} />
            )}
            {!readOnly && <MenuRow icon={null} label={t('Rename')} onClick={() => setRenamingId(node.id)} />}
            <MenuRow icon={null} label={t('Star / unstar')} onClick={() => toggleStar.mutate(node.id)} />
            <MenuRow
              icon={null}
              label={t('Copy link')}
              onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/wiki/spaces/${spaceKey}/pages/${node.id}`)}
            />
            {!readOnly && node.kind !== 'folder' && (
              <MenuRow
                icon={null}
                label={t('Make a copy')}
                onClick={() =>
                  copyPage.mutate(node.id, { onSuccess: (p) => navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`) })
                }
              />
            )}
            {!readOnly && <MenuRow icon={null} label={t('Move…')} onClick={() => onOpenMove(node)} />}
            {!readOnly && (
              <MenuRow
                icon={null}
                label={t('Archive')}
                onClick={() => {
                  if (window.confirm(t('Archive "{title}" and everything under it?', { title: node.title })))
                    archivePage.mutate({ id: node.id, archived: true })
                }}
              />
            )}
            {!readOnly && (
              <MenuRow
                icon={null}
                label={t('Delete')}
                onClick={() => {
                  if (window.confirm(t('Delete "{title}"? Its child pages move up one level.', { title: node.title })))
                    deletePage.mutate(node.id)
                }}
              />
            )}
          </div>
        </>
      )}
      </div>
      {open && kids.map((k) => (
        <TreeNode key={k.id} node={k} childrenOf={childrenOf} depth={depth + 1} spaceKey={spaceKey} activeId={activeId} onMove={onMove} readOnly={readOnly} renamingId={renamingId} setRenamingId={setRenamingId} onOpenMove={onOpenMove} />
      ))}
    </>
  )
}

// Confluence's + menu: choose what to create in the space.
function CreateMenu({ spaceKey, onFolderCreated }: { spaceKey: string; onFolderCreated: (id: string) => void }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const create = useCreateWikiPage(spaceKey)
  const newWhiteboard = () => {
    setOpen(false)
    create.mutate(
      { title: t('Untitled whiteboard'), icon: '', parentId: null, bodyDoc: null, kind: 'whiteboard' },
      { onSuccess: (p) => navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`) },
    )
  }
  return (
    <div style={{ position: 'relative' }}>
      <Item icon={<AddIcon label="" />} label={t('Create')} onClick={() => setOpen(!open)} />
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', insetInlineStart: 16, top: '100%', zIndex: 401, width: 200,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
              padding: 4, display: 'flex', flexDirection: 'column',
            }}
          >
            <MenuRow icon={<PageIcon label="" />} label={t('Page')} onClick={() => { setOpen(false); navigate(`/wiki/spaces/${spaceKey}/new`) }} />
            <MenuRow icon={<QuotationMarkIcon label="" />} label={t('Blog post')} onClick={() => { setOpen(false); navigate(`/wiki/spaces/${spaceKey}/new?kind=blog`) }} />
            <MenuRow icon={<WhiteboardIcon label="" />} label={t('Whiteboard')} onClick={newWhiteboard} />
            <MenuRow
              icon={<FolderClosedIcon label="" />}
              label={t('Folder')}
              onClick={() => {
                setOpen(false)
                create.mutate(
                  { title: t('New folder'), icon: '', parentId: null, bodyDoc: null, kind: 'folder' },
                  { onSuccess: (p) => onFolderCreated(p.id) },
                )
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

// Confluence's space Shortcuts: pinned links at the top of the space rail.
function ShortcutsSection({ spaceKey, canEdit }: { spaceKey: string; canEdit: boolean }) {
  const navigate = useNavigate()
  const { data: shortcuts } = useWikiShortcuts(spaceKey)
  const createShortcut = useCreateWikiShortcut(spaceKey)
  const deleteShortcut = useDeleteWikiShortcut(spaceKey)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')

  const openShortcut = (u: string) => {
    if (u.startsWith('/')) navigate(u)
    else window.open(u, '_blank', 'noopener')
  }

  return (
    <>
      <Item
        icon={<ShortcutIcon label="" />}
        label={t('Shortcuts')}
        trailing={
          canEdit ? (
            <span
              title={t('Add shortcut')}
              onClick={(e) => {
                e.stopPropagation()
                setAdding(!adding)
              }}
              style={{ display: 'inline-flex', color: token('color.text.subtle', '#44546F') }}
            >
              <AddIcon label="" />
            </span>
          ) : undefined
        }
      />
      {adding && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 18px 8px 40px' }}>
          <input
            autoFocus
            placeholder={t('Shortcut title')}
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            style={{ fontSize: 13, padding: '4px 6px', borderRadius: 4, border: `1px solid ${token('color.border.input', '#8590A2')}`, background: 'transparent', color: 'inherit' }}
          />
          <input
            placeholder="https://… / /wiki/…"
            value={url}
            onChange={(e) => setUrl(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim() && url.trim()) {
                createShortcut.mutate(
                  { title: title.trim(), url: url.trim() },
                  { onSuccess: () => { setAdding(false); setTitle(''); setUrl('') } },
                )
              }
              if (e.key === 'Escape') setAdding(false)
            }}
            style={{ fontSize: 13, padding: '4px 6px', borderRadius: 4, border: `1px solid ${token('color.border.input', '#8590A2')}`, background: 'transparent', color: 'inherit' }}
          />
        </div>
      )}
      {(shortcuts ?? []).map((sc) => (
        <Item
          key={sc.id}
          indent={1}
          icon={<LinkExternalIcon label="" />}
          label={sc.title}
          onClick={() => openShortcut(sc.url)}
          trailing={
            canEdit ? (
              <span
                title={t('Remove shortcut')}
                onClick={(e) => {
                  e.stopPropagation()
                  deleteShortcut.mutate(sc.id)
                }}
                style={{ display: 'inline-flex', color: token('color.text.subtle', '#44546F') }}
              >
                ✕
              </span>
            ) : undefined
          }
        />
      ))}
    </>
  )
}

// Confluence's space ••• menu: star, watch, space tools, archive, delete.
function SpaceMenu({ spaceKey, isSpaceAdmin, archived }: { spaceKey: string; isSpaceAdmin: boolean; archived: boolean }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { data: flags } = useWikiSpaceFlags(open ? spaceKey : undefined)
  const act = useWikiSpaceAction(spaceKey)

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <span
        title={t('Space actions')}
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', fontWeight: 700, color: token('color.text.subtle', '#44546F'), padding: '0 4px' }}
      >
        ⋯
      </span>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', insetInlineEnd: 0, top: '100%', zIndex: 401, width: 210,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
              padding: 4, display: 'flex', flexDirection: 'column',
            }}
            onClick={() => setOpen(false)}
          >
            <MenuRow icon={<StarUnstarredIcon label="" />} label={flags?.starred ? t('Unstar space') : t('Star space')} onClick={() => act.mutate({ action: '/star' })} />
            <MenuRow icon={null} label={flags?.watching ? t('Stop watching space') : t('Watch space')} onClick={() => act.mutate({ action: '/watch' })} />
            {isSpaceAdmin && (
              <>
                <div style={{ padding: '6px 10px 2px', fontSize: 11, fontWeight: 700, ...subtleText }}>{t('Space tools')}</div>
                <MenuRow icon={<PersonAvatarIcon label="" />} label={t('Users')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/settings/access`)} />
                <MenuRow icon={<SettingsIcon label="" />} label={t('Space settings')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/settings`)} />
                <div style={{ margin: '4px 0', borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }} />
                <MenuRow
                  icon={null}
                  label={archived ? t('Restore space') : t('Archive space')}
                  onClick={() => act.mutate({ action: '/archive', body: { archived: !archived } })}
                />
                <MenuRow
                  icon={null}
                  label={t('Delete space')}
                  onClick={() => {
                    const typed = window.prompt(t('This permanently deletes the space and ALL its content. Type the space key ({key}) to confirm:', { key: spaceKey }))
                    if (typed === spaceKey)
                      act.mutate({ action: '', method: 'DELETE' }, { onSuccess: () => navigate('/wiki') })
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
    </span>
  )
}

function MenuRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 14,
        border: 'none', borderRadius: 4, cursor: 'pointer', textAlign: 'start', color: 'inherit',
        background: hover ? token('color.background.neutral.subtle.hovered', '#F1F2F4') : 'transparent',
      }}
    >
      {icon} {label}
    </button>
  )
}

// The DocHat sidebar: space list at /wiki, Confluence's space sidebar
// (Overview + Content tree) inside a space.
export default function WikiSideNav() {
  const navigate = useNavigate()
  const location = useLocation()
  const spaceMatch = useMatch('/wiki/spaces/:key/*')
  const spaceKey = spaceMatch?.params.key?.toUpperCase()
  const pageMatch = useMatch('/wiki/spaces/:key/pages/:pageId')
  const activePageId = pageMatch?.params.pageId

  const { isAdmin } = useAuth()
  const [recentOpen, setRecentOpen] = useState(false)
  const [starredOpen, setStarredOpen] = useState(false)
  const [spacesOpen, setSpacesOpen] = useState(true)
  const [filter, setFilter] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [moveNode, setMoveNode] = useState<WikiPageNode | null>(null)
  const { data: starredData } = useWikiStarred()
  const { data: spaces } = useWikiSpaces()
  const { data: spaceData } = useWikiSpace(spaceKey)
  const { data: recent } = useRecentWikiPages(recentOpen)
  const movePage = useMoveWikiPage(spaceKey ?? '')

  const filtered = (spaceData?.pages ?? []).filter(
    (n) => n.id !== spaceData?.space.homePageId && n.title.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, WikiPageNode[]>()
    for (const n of spaceData?.pages ?? []) {
      if (n.id === spaceData?.space.homePageId) continue // Overview renders separately
      const key = n.parentId === spaceData?.space.homePageId ? null : n.parentId
      const arr = map.get(key) ?? []
      arr.push(n)
      map.set(key, arr)
    }
    return map
  }, [spaceData])

  return (
    <nav
      style={{
        width: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderInlineEnd: `1px solid ${token('color.border', '#DFE1E6')}`,
        // Confluence's new nav: sidebar and canvas share one surface.
        background: token('elevation.surface', '#FFFFFF'),
      }}
    >
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0 12px' }}>
        {/* Global section — Confluence's unified nav. */}
        <Item icon={<PersonAvatarIcon label="" />} label={t('For you')} active={location.pathname === '/wiki'} onClick={() => navigate('/wiki')} />
        <Item
          icon={<ClockIcon label="" />}
          label={t('Recent')}
          onClick={() => setRecentOpen(!recentOpen)}
          trailingAlways
          trailing={recentOpen ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
        />
        {recentOpen &&
          (recent ?? []).map((p) => (
            <Item
              key={p.id}
              indent={1}
              icon={<PageIcon label="" />}
              label={
                <span title={`${p.title} — ${p.spaceName}`}>
                  {p.title} <span style={{ fontSize: 11, ...subtleText }}>· {timeAgo(p.updatedAt)}</span>
                </span>
              }
              onClick={() => navigate(`/wiki/spaces/${p.spaceKey}/pages/${p.id}`)}
            />
          ))}
        <Item
          icon={<StarUnstarredIcon label="" />}
          label={t('Starred')}
          onClick={() => setStarredOpen(!starredOpen)}
          trailingAlways
          trailing={starredOpen ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
        />
        {starredOpen && (
          (starredData?.pages ?? []).length + (starredData?.spaces ?? []).length === 0 ? (
            <div style={{ padding: '2px 18px 6px 40px', fontSize: 12, ...subtleText }}>{t('Nothing starred yet.')}</div>
          ) : (
            <>
              {(starredData?.spaces ?? []).map((s) => (
                <Item
                  key={s.id}
                  indent={1}
                  icon={s.icon ? <span style={{ fontSize: 14 }}>{s.icon}</span> : <Avatar appearance="square" size="xsmall" name={s.name} />}
                  label={s.name}
                  onClick={() => navigate(`/wiki/spaces/${s.key}`)}
                />
              ))}
              {(starredData?.pages ?? []).map((p) => (
                <Item
                  key={p.id}
                  indent={1}
                  icon={p.icon ? <span style={{ fontSize: 14 }}>{p.icon}</span> : <NodeKindIcon kind={p.kind} />}
                  label={p.title}
                  onClick={() => navigate(`/wiki/spaces/${p.spaceKey}/pages/${p.id}`)}
                />
              ))}
            </>
          )
        )}
        <Item
          icon={<LibraryIcon label="" />}
          label={t('Spaces')}
          onClick={() => setSpacesOpen(!spacesOpen)}
          trailingAlways
          trailing={spacesOpen ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />}
        />
        {spacesOpen && (
          <>
            {(spaces ?? []).map((s) => (
              <Item
                key={s.id}
                indent={1}
                icon={<Avatar appearance="square" size="xsmall" name={s.name} />}
                label={s.name}
                active={s.key === spaceKey && !activePageId}
                onClick={() => navigate(`/wiki/spaces/${s.key}`)}
              />
            ))}
            {(spaces ?? []).length === 0 && (
              <div style={{ padding: '2px 18px 6px 40px', fontSize: 12, ...subtleText }}>{t('No spaces yet.')}</div>
            )}
            <Item
              indent={1}
              icon={<LibraryIcon label="" />}
              label={t('View all spaces')}
              onClick={() => navigate('/wiki/directory')}
            />
          </>
        )}

        {/* Current space section, like Confluence's space rail. */}
        {spaceKey && spaceData && (
          <>
            <div style={{ margin: '10px 16px', borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 16px 8px', position: 'relative' }}>
              <span onClick={() => navigate(`/wiki/spaces/${spaceKey}`)} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1, minWidth: 0 }}>
                {spaceData.space.icon ? (
                  <span style={{ fontSize: 18 }}>{spaceData.space.icon}</span>
                ) : (
                  <Avatar appearance="square" size="small" name={spaceData.space.name} />
                )}
                <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {spaceData.space.name}
                </span>
                {spaceData.space.archivedAt && <Lozenge appearance="moved">{t('Archived')}</Lozenge>}
              </span>
              <SpaceMenu spaceKey={spaceKey} isSpaceAdmin={spaceData.myRole === 'admin'} archived={!!spaceData.space.archivedAt} />
            </div>
            <ShortcutsSection spaceKey={spaceKey} canEdit={spaceData.myRole !== 'viewer'} />
            {/* Confluence's "Content" nav row: sentence case, hover +. */}
            <Item
              icon={<PagesIcon label="" />}
              label={t('Content')}
              trailing={
                <span
                  title={t('Create page')}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate(`/wiki/spaces/${spaceKey}/new`)
                  }}
                  style={{ display: 'inline-flex', cursor: 'pointer', color: token('color.text.subtle', '#44546F') }}
                >
                  <AddIcon label="" />
                </span>
              }
            />
            {/* Search by title, filtering the tree like Confluence. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 16px 6px', padding: '4px 8px', borderRadius: 6, border: `1px solid ${token('color.border', '#DFE1E6')}`, background: token('color.background.input', '#FFFFFF') }}>
              <SearchIcon label="" />
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={t('Search by title')}
                style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: '100%', color: 'inherit' }}
              />
            </div>
            <Item
              icon={<HomeIcon label="" />}
              label={t('Overview')}
              active={activePageId === spaceData.space.homePageId}
              onClick={() =>
                spaceData.space.homePageId &&
                navigate(`/wiki/spaces/${spaceKey}/pages/${spaceData.space.homePageId}`)
              }
            />
            {filter.trim() ? (
              <>
                {filtered.map((n) => (
                  <Item
                    key={n.id}
                    indent={1}
                    icon={n.icon ? <span style={{ fontSize: 14 }}>{n.icon}</span> : <PageIcon label="" />}
                    label={n.title}
                    active={n.id === activePageId}
                    onClick={() => navigate(`/wiki/spaces/${spaceKey}/pages/${n.id}`)}
                  />
                ))}
                {filtered.length === 0 && (
                  <div style={{ padding: '2px 18px 6px', fontSize: 12, ...subtleText }}>{t('No matches')}</div>
                )}
              </>
            ) : (
              (childrenOf.get(null) ?? []).map((n) => (
                <TreeNode
                  key={n.id}
                  node={n}
                  childrenOf={childrenOf}
                  depth={0}
                  spaceKey={spaceKey}
                  activeId={activePageId}
                  readOnly={spaceData.myRole === 'viewer'}
                  renamingId={renamingId}
                  setRenamingId={setRenamingId}
                  onOpenMove={setMoveNode}
                  onMove={(sourceId, target, zone) => {
                    if (zone === 'child') {
                      movePage.mutate({ id: sourceId, parentId: target.id, position: (childrenOf.get(target.id)?.length ?? 0) })
                    } else {
                      const parentId = target.parentId === spaceData.space.homePageId ? null : target.parentId
                      movePage.mutate({ id: sourceId, parentId, position: zone === 'before' ? target.position : target.position + 1 })
                    }
                  }}
                />
              ))
            )}
            {spaceData.myRole !== 'viewer' && <CreateMenu spaceKey={spaceKey} onFolderCreated={setRenamingId} />}
            <Item icon={<QuotationMarkIcon label="" />} label={t('Blogs')} active={location.pathname.endsWith('/blog')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/blog`)} />
            <Item icon={<CalendarIcon label="" />} label={t('Calendars')} active={location.pathname.endsWith('/calendar')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/calendar`)} />
            {spaceData.myRole === 'admin' && (
              <Item icon={<SettingsIcon label="" />} label={t('Space settings')} onClick={() => navigate(`/wiki/spaces/${spaceKey}/settings`)} />
            )}
          </>
        )}

        <div style={{ margin: '10px 16px', borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }} />
        <Item icon={<HatLogo />} label={t('TaskHat')} trailingAlways trailing={<LinkExternalIcon label="" />} onClick={() => navigate('/')} />
      </div>

      {isAdmin && (
        <div style={{ padding: 12, borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }}>
          <Button shouldFitContainer onClick={() => navigate('/admin/users')}>{t('Invite people')}</Button>
        </div>
      )}
      {moveNode && (
        <WikiMoveDialog
          pageId={moveNode.id}
          pageTitle={moveNode.title}
          currentSpaceKey={spaceKey ?? ''}
          onClose={() => setMoveNode(null)}
          onMoved={(key) => {
            setMoveNode(null)
            navigate(`/wiki/spaces/${key}`)
          }}
        />
      )}
    </nav>
  )
}
