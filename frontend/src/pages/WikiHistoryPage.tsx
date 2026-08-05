import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Spinner from '@atlaskit/spinner'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { useRestoreWikiVersion, useWikiPage, useWikiVersion, useWikiVersions } from '../api/hooks'
import { RichTextView } from '../components/RichText'
import { fmtDateTime, t } from '../i18n'
import { wordDiff } from '../lib/diff'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Confluence's version history: list of revisions; open one to view it,
// toggle a diff against the previous version, or restore it.
export default function WikiHistoryPage() {
  const { key, pageId, n } = useParams<{ key: string; pageId: string; n?: string }>()
  const spaceKey = key?.toUpperCase() ?? ''
  const navigate = useNavigate()
  const version = n ? parseInt(n, 10) : undefined
  const { data: page } = useWikiPage(pageId)
  const { data: versions, isLoading } = useWikiVersions(pageId)
  const { data: current } = useWikiVersion(pageId, version)
  const { data: previous } = useWikiVersion(pageId, version && version > 1 ? version - 1 : undefined)
  const restore = useRestoreWikiVersion(pageId ?? '')
  const [showDiff, setShowDiff] = useState(false)

  const diff = useMemo(() => {
    if (!showDiff || !current) return null
    return wordDiff(previous?.bodyText ?? '', current.bodyText)
  }, [showDiff, current, previous])

  if (isLoading || !page) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px 40px 40px' }}>
      <div style={{ fontSize: 12, marginBottom: 12, display: 'flex', gap: 4 }}>
        <Link to={`/wiki/spaces/${spaceKey}`} style={subtleText}>{page.spaceName}</Link>
        <span style={subtleText}>/</span>
        <Link to={`/wiki/spaces/${spaceKey}/pages/${page.id}`} style={subtleText}>{page.title}</Link>
        <span style={subtleText}>/ {t('Version history')}</span>
      </div>

      {!version && (
        <>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: '0 0 16px' }}>{t('Version history')}</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(versions ?? []).map((v) => (
              <div
                key={v.version}
                onClick={() => navigate(`/wiki/spaces/${spaceKey}/pages/${page.id}/history/${v.version}`)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer',
                  border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6,
                  background: token('elevation.surface', '#FFFFFF'),
                }}
              >
                <span style={{ fontWeight: 600, width: 44 }}>v. {v.version}</span>
                {v.editedBy && <Avatar size="small" name={v.editedBy.displayName} src={v.editedBy.avatarUrl ?? undefined} />}
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {v.editedBy?.displayName ?? t('Unknown')}
                  <span style={subtleText}> · {fmtDateTime(v.createdAt)}</span>
                </span>
                {v.version === page.version && <Lozenge appearance="inprogress">{t('Current')}</Lozenge>}
              </div>
            ))}
          </div>
        </>
      )}

      {version && current && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 20, borderRadius: 6, background: token('color.background.information', '#E9F2FF') }}>
            <span style={{ fontSize: 14 }}>
              {t('Viewing version {n} of {total}', { n: version, total: page.version })}
              {current.editedBy && <span style={subtleText}> · {current.editedBy.displayName} · {fmtDateTime(current.createdAt)}</span>}
            </span>
            <span style={{ flex: 1 }} />
            {version > 1 && page.kind !== 'whiteboard' && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                <Toggle isChecked={showDiff} onChange={() => setShowDiff(!showDiff)} />
                {t('Show changes')}
              </label>
            )}
            {version !== page.version && (
              <Button
                appearance="primary"
                spacing="compact"
                isLoading={restore.isPending}
                onClick={() =>
                  restore.mutate(version, {
                    onSuccess: () => navigate(`/wiki/spaces/${spaceKey}/pages/${page.id}`),
                  })
                }
              >
                {t('Restore this version')}
              </Button>
            )}
            <Button appearance="subtle" spacing="compact" onClick={() => navigate(`/wiki/spaces/${spaceKey}/pages/${page.id}/history`)}>
              {t('Back')}
            </Button>
          </div>

          {current.icon && <div style={{ textAlign: 'center', fontSize: 44, marginBottom: 4 }}>{current.icon}</div>}
          <h1 style={{ fontSize: 29, fontWeight: 600, margin: '0 0 20px', textAlign: 'center' }}>{current.title}</h1>

          {page.kind === 'whiteboard' ? (
            <WhiteboardVersionPreview doc={current.bodyDoc} />
          ) : showDiff && diff ? (
            <div style={{ fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {diff.map((op, i) =>
                op.kind === 'same' ? (
                  <span key={i}>{op.text}</span>
                ) : op.kind === 'add' ? (
                  <span key={i} style={{ background: token('color.background.success', '#DCFFF1'), color: token('color.text.success', '#216E4E'), borderRadius: 2 }}>{op.text}</span>
                ) : (
                  <span key={i} style={{ background: token('color.background.danger', '#FFECEB'), color: token('color.text.danger', '#AE2E24'), textDecoration: 'line-through', borderRadius: 2 }}>{op.text}</span>
                ),
              )}
            </div>
          ) : (
            <div style={{ fontSize: 15, lineHeight: 1.6 }}>
              <RichTextView doc={current.bodyDoc ?? undefined} fallback={current.bodyText} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// A static Excalidraw snapshot of a whiteboard revision.
function WhiteboardVersionPreview({ doc }: { doc: unknown }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let alive = true
    const scene = (doc ?? {}) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: unknown }
    import('@excalidraw/excalidraw').then(async (m) => {
      const svg = await m.exportToSvg({
        elements: m.restoreElements((scene.elements ?? []) as never, null),
        appState: {
          ...(scene.appState ?? {}),
          exportWithDarkMode: document.documentElement.getAttribute('data-color-mode') === 'dark',
        } as never,
        files: (scene.files ?? null) as never,
      })
      if (!alive || !host.current) return
      svg.style.maxWidth = '100%'
      svg.style.height = 'auto'
      host.current.replaceChildren(svg)
    })
    return () => { alive = false }
  }, [doc])
  return (
    <div
      ref={host}
      style={{
        border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8,
        padding: 12, minHeight: 200, display: 'flex', justifyContent: 'center',
      }}
    />
  )
}
