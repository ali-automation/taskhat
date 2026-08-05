import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button, { IconButton } from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import Avatar from '@atlaskit/avatar'
import { useDeleteWikiPage, useSaveWikiCanvas, useWikiRestrictions } from '../api/hooks'
import { getAccessToken } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { LockLockedIcon, ShowMoreHorizontalIcon } from '../components/coreIcons'
import { RestrictionsDialog, ShareDialog } from '../components/WikiAccess'
import { language, t, timeAgo } from '../i18n'
import type { WikiPage } from '../api/types'
import '@excalidraw/excalidraw/index.css'

// Excalidraw looks for its fonts here (copied into public/excalidraw/).
;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/'

// The canvas library is heavy — load it only when a whiteboard opens.
const Excalidraw = lazy(() => import('@excalidraw/excalidraw').then((m) => ({ default: m.Excalidraw })))

const subtleText = { color: token('color.text.subtlest', '#626F86') }

type Scene = { elements?: readonly unknown[]; appState?: Record<string, unknown>; files?: unknown }

type CanvasEl = { id: string; version: number; versionNonce?: number }
type Peer = { clientId: string; name: string; x?: number; y?: number; lastSeen: number }

const PEER_COLORS = ['#0C66E4', '#22A06B', '#8270DB', '#C9372C', '#E56910', '#2898BD']
const peerColor = (id: string) => PEER_COLORS[[...id].reduce((a, c) => a + c.charCodeAt(0), 0) % PEER_COLORS.length]

// Excalidraw's element reconciliation: higher version wins, ties break on
// the lower versionNonce, unknown local elements are appended.
function reconcile(local: CanvasEl[], remote: CanvasEl[]): CanvasEl[] {
  const localBy = new Map(local.map((e) => [e.id, e]))
  const seen = new Set<string>()
  const out: CanvasEl[] = []
  for (const r of remote) {
    const l = localBy.get(r.id)
    const keepLocal = l && (l.version > r.version || (l.version === r.version && (l.versionNonce ?? 0) <= (r.versionNonce ?? 0)))
    out.push(keepLocal ? l! : r)
    seen.add(r.id)
  }
  for (const l of local) if (!seen.has(l.id)) out.push(l)
  return out
}

// A Confluence-style whiteboard: an always-editable canvas that autosaves.
export default function WhiteboardView({ page, readOnly }: { page: WikiPage; readOnly?: boolean }) {
  const navigate = useNavigate()
  const [title, setTitle] = useState(page.title)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [sharing, setSharing] = useState(false)
  const [restricting, setRestricting] = useState(false)
  const { data: restrictions } = useWikiRestrictions(page.id)
  const save = useSaveWikiCanvas(page.id, page.spaceKey)
  const deletePage = useDeleteWikiPage(page.spaceKey)
  const scene = useRef<Scene | null>((page.bodyDoc as Scene | null) ?? null)
  const titleRef = useRef(page.title)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  // ---- W15: live multi-user drawing over the realtime hub ----
  const { user } = useAuth()
  const clientId = useRef(Math.random().toString(36).slice(2))
  const wsRef = useRef<WebSocket | null>(null)
  const apiRef = useRef<{ updateScene: (s: Record<string, unknown>) => void } | null>(null)
  const applyingRemote = useRef(false)
  const lastScenePush = useRef(0)
  const lastPointerPush = useRef(0)
  const peersRef = useRef<Map<string, Peer>>(new Map())
  const [peers, setPeers] = useState<Peer[]>([])

  const wsSend = (data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'publish', channel: `canvas:${page.id}`, data: { clientId: clientId.current, name: user?.displayName ?? '', ...data } }))
    }
  }

  const pushCollaborators = () => {
    const collaborators = new Map(
      [...peersRef.current.values()].map((p) => [p.clientId, {
        username: p.name,
        pointer: p.x != null ? { x: p.x, y: p.y, tool: 'pointer' } : undefined,
        color: { background: peerColor(p.clientId), stroke: peerColor(p.clientId) },
      }]),
    )
    apiRef.current?.updateScene({ collaborators })
  }

  useEffect(() => {
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      const token = getAccessToken()
      if (!token) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      const ws = new WebSocket(`${proto}://${location.host}/ws`)
      wsRef.current = ws
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }))
        ws.send(JSON.stringify({ type: 'subscribe', channel: `canvas:${page.id}` }))
      }
      ws.onmessage = (e) => {
        try {
          const frame = JSON.parse(e.data)
          const payload = frame.data?.payload
          if (!payload || payload.clientId === clientId.current) return
          const peer: Peer = peersRef.current.get(payload.clientId) ?? { clientId: payload.clientId, name: payload.name || '?', lastSeen: 0 }
          peer.name = payload.name || peer.name
          peer.lastSeen = Date.now()
          if (payload.kind === 'pointer') {
            peer.x = payload.x
            peer.y = payload.y
          }
          peersRef.current.set(payload.clientId, peer)
          setPeers([...peersRef.current.values()])
          if (payload.kind === 'pointer') pushCollaborators()
          if (payload.kind === 'scene' && Array.isArray(payload.elements)) {
            const merged = reconcile((scene.current?.elements ?? []) as CanvasEl[], payload.elements as CanvasEl[])
            scene.current = { ...(scene.current ?? {}), elements: merged }
            applyingRemote.current = true
            apiRef.current?.updateScene({ elements: merged })
            setTimeout(() => { applyingRemote.current = false }, 50)
          }
        } catch { /* ignore malformed frames */ }
      }
      ws.onclose = () => {
        if (!closed) retry = setTimeout(connect, 1500)
      }
    }
    connect()
    const prune = setInterval(() => {
      const cutoff = Date.now() - 30000
      let changed = false
      for (const [k, p] of peersRef.current) if (p.lastSeen < cutoff) { peersRef.current.delete(k); changed = true }
      if (changed) { setPeers([...peersRef.current.values()]); pushCollaborators() }
    }, 10000)
    return () => {
      closed = true
      clearTimeout(retry)
      clearInterval(prune)
      wsRef.current?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  const initialData = useMemo(() => {
    const d = page.bodyDoc as Scene | null
    return {
      elements: (d?.elements ?? []) as never[],
      appState: { ...(d?.appState ?? {}), collaborators: undefined } as Record<string, unknown>,
      files: (d?.files ?? undefined) as never,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id])

  const schedule = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      save.mutate(
        { title: titleRef.current.trim() || page.title, doc: scene.current ?? { elements: [] } },
        { onSuccess: () => setSavedAt(new Date().toISOString()) },
      )
    }, 2000)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const dark = document.documentElement.getAttribute('data-color-mode') === 'dark'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 49px)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
        <Link to={`/wiki/spaces/${page.spaceKey}`} style={{ fontSize: 12, ...subtleText }}>{page.spaceName}</Link>
        <span style={{ fontSize: 12, ...subtleText }}>/</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            titleRef.current = e.target.value
            schedule()
          }}
          aria-label={t('Whiteboard title')}
          readOnly={readOnly}
          style={{
            border: 'none', outline: 'none', background: 'transparent', color: 'inherit',
            fontSize: 14, fontWeight: 600, fontFamily: 'inherit', minWidth: 120, flex: '0 1 auto',
          }}
        />
        <span style={{ flex: 1 }} />
        {peers.length > 0 && (
          <span style={{ display: 'inline-flex', alignItems: 'center' }} title={peers.map((p) => p.name).join(', ')}>
            {peers.slice(0, 5).map((p) => (
              <span key={p.clientId} style={{ marginInlineStart: -4, border: `2px solid ${peerColor(p.clientId)}`, borderRadius: '50%', display: 'inline-flex' }}>
                <Avatar size="xsmall" name={p.name} />
              </span>
            ))}
          </span>
        )}
        <span style={{ fontSize: 12, ...subtleText }}>
          {save.isPending ? t('Saving…') : savedAt ? t('Saved {ago}', { ago: timeAgo(savedAt) }) : ''}
        </span>
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
            <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('More actions')} appearance="subtle" spacing="compact" />
          )}
          shouldRenderToParent
        >
          <DropdownItemGroup>
            <DropdownItem onClick={() => navigate(`/wiki/spaces/${page.spaceKey}/pages/${page.id}/history`)}>
              {t('Version history')}
            </DropdownItem>
            <DropdownItem onClick={() => setRestricting(true)}>{t('Restrictions')}</DropdownItem>
            <DropdownItem
              onClick={() => {
                if (window.confirm(t('Delete "{title}"? Its child pages move up one level.', { title: page.title })))
                  deletePage.mutate(page.id, { onSuccess: () => navigate(`/wiki/spaces/${page.spaceKey}`) })
              }}
            >
              {t('Delete')}
            </DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense
          fallback={
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
              <Spinner size="large" />
            </div>
          }
        >
          <Excalidraw
            initialData={initialData as never}
            theme={dark ? 'dark' : 'light'}
            langCode={language === 'ar' ? 'ar-SA' : 'en'}
            viewModeEnabled={readOnly}
            excalidrawAPI={(api) => { apiRef.current = api as never }}
            onPointerUpdate={({ pointer }) => {
              if (readOnly) return
              const now = Date.now()
              if (now - lastPointerPush.current < 100) return
              lastPointerPush.current = now
              wsSend({ kind: 'pointer', x: pointer.x, y: pointer.y })
            }}
            onChange={(elements, appState, files) => {
              if (readOnly || applyingRemote.current) return
              scene.current = {
                elements,
                appState: { viewBackgroundColor: (appState as { viewBackgroundColor?: string }).viewBackgroundColor },
                files,
              }
              schedule()
              const now = Date.now()
              if (now - lastScenePush.current > 250) {
                lastScenePush.current = now
                wsSend({ kind: 'scene', elements })
              }
            }}
          />
        </Suspense>
      </div>
      {sharing && <ShareDialog pageId={page.id} onClose={() => setSharing(false)} />}
      {restricting && <RestrictionsDialog pageId={page.id} onClose={() => setRestricting(false)} />}
    </div>
  )
}
