import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Button, { IconButton } from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import {
  deleteWikiDraft, saveWikiDraft, useCreateWikiPage, useUpdateWikiPage, useWikiPage, useWikiPageDraft, useWikiTemplates,
} from '../api/hooks'
import { EmojiPicker, RichTextEditor } from '../components/RichText'
import { CopyIcon, PageIcon, ShowMoreHorizontalIcon } from '../components/coreIcons'

// Built-in templates, like Confluence's template gallery.
const heading = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] })
const para = (text?: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] })
const bullets = (...items: string[]) => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [para(i)] })) })
const tasks = (...items: string[]) => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [para(i)] })) })
const TEMPLATES: { key: string; icon: string; name: string; desc: string; title: string; doc: () => unknown }[] = [
  { key: 'meeting', icon: '🗓️', name: 'Meeting notes', desc: 'Agenda, notes, action items', title: 'Meeting notes', doc: () => ({ type: 'doc', content: [
      heading(2, 'Attendees'), para('@mention who was there'),
      heading(2, 'Agenda'), bullets('Topic one', 'Topic two'),
      heading(2, 'Notes'), para(),
      heading(2, 'Action items'), tasks('First follow-up', 'Second follow-up')] }) },
  { key: 'howto', icon: '🧭', name: 'How-to guide', desc: 'Step-by-step instructions', title: 'How to …', doc: () => ({ type: 'doc', content: [
      { type: 'panel', attrs: { panelType: 'info' }, content: [para('What this guide covers and who it is for.')] },
      heading(2, 'Before you start'), bullets('Prerequisite one', 'Prerequisite two'),
      heading(2, 'Steps'), { type: 'orderedList', content: [ { type: 'listItem', content: [para('First step')] }, { type: 'listItem', content: [para('Second step')] } ] },
      heading(2, 'Troubleshooting'), para()] }) },
  { key: 'project', icon: '📦', name: 'Project plan', desc: 'Goals, scope, milestones', title: 'Project plan', doc: () => ({ type: 'doc', content: [
      heading(2, 'Overview'), para('What are we building and why?'),
      heading(2, 'Goals'), bullets('Goal one', 'Goal two'),
      heading(2, 'Out of scope'), bullets('Not this'),
      heading(2, 'Milestones'), { type: 'table', content: [
        { type: 'tableRow', content: [ { type: 'tableHeader', content: [para('Milestone')] }, { type: 'tableHeader', content: [para('Owner')] }, { type: 'tableHeader', content: [para('Date')] } ] },
        { type: 'tableRow', content: [ { type: 'tableCell', content: [para('Kickoff')] }, { type: 'tableCell', content: [para()] }, { type: 'tableCell', content: [para()] } ] } ] }] }) },
  { key: 'retro', icon: '🔁', name: 'Retrospective', desc: 'What went well, what didn’t', title: 'Retrospective', doc: () => ({ type: 'doc', content: [
      heading(2, 'What went well'), bullets(' '),
      heading(2, 'What could be better'), bullets(' '),
      heading(2, 'Action items'), tasks('Improvement to try')] }) },
  { key: 'decision', icon: '⚖️', name: 'Decision', desc: 'Context, options, outcome', title: 'Decision: …', doc: () => ({ type: 'doc', content: [
      { type: 'panel', attrs: { panelType: 'note' }, content: [para('Status: DRAFT — update when decided.')] },
      heading(2, 'Background'), para(),
      heading(2, 'Options considered'), bullets('Option A', 'Option B'),
      heading(2, 'Decision'), para(),
      heading(2, 'Consequences'), para()] }) },
]
import { t, timeAgo } from '../i18n'

// Confluence's full-page editor: borderless title, rich text body with
// tables/images/slash-menu, continuous draft autosave, Publish/Update + Close.
function Editor({
  spaceKey,
  page,
  draft,
  parentId,
  kind,
}: {
  spaceKey: string
  page?: { id: string; title: string; icon: string; bodyDoc: unknown | null; bodyText: string }
  draft: { id: string; title: string; bodyDoc: unknown | null } | null
  parentId: string | null
  kind?: string | null
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const create = useCreateWikiPage(spaceKey)
  const update = useUpdateWikiPage(spaceKey)
  const { data: customTemplates } = useWikiTemplates(spaceKey)
  const [title, setTitle] = useState(draft?.title || page?.title || '')
  const [icon, setIcon] = useState(page?.icon ?? '')
  const [iconOpen, setIconOpen] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  // Template gallery for brand-new pages (hidden once there is a draft/content).
  const [showTemplates, setShowTemplates] = useState(!page && !draft)
  const [doc, setDoc] = useState<unknown>(draft?.bodyDoc ?? page?.bodyDoc ?? null)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [restored] = useState(!!draft)
  const draftId = useRef<string | undefined>(draft?.id)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const latest = useRef({ title, doc })
  latest.current = { title, doc }
  const pending = create.isPending || update.isPending

  // Confluence-style autosave: persist the draft after ~1.5s of idle.
  const scheduleAutosave = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        const saved = await saveWikiDraft({
          draftId: draftId.current,
          pageId: page?.id ?? null,
          spaceKey,
          parentId,
          title: latest.current.title,
          bodyDoc: latest.current.doc,
        })
        draftId.current = saved.id
        setSavedAt(saved.updatedAt)
      } catch {
        // autosave is best-effort; publishing still saves explicitly
      }
    }, 1500)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  const discardDraft = () => {
    if (draftId.current) deleteWikiDraft(draftId.current).catch(() => {})
    if (page) qc.invalidateQueries({ queryKey: ['wiki-draft', page.id] })
  }

  const close = () => {
    // Confluence keeps the draft on close; it resumes next time you edit.
    if (page) navigate(`/wiki/spaces/${spaceKey}/pages/${page.id}`)
    else navigate(`/wiki/spaces/${spaceKey}`)
  }

  const publish = () => {
    setError(null)
    clearTimeout(timer.current)
    const onError = (e: unknown) =>
      setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Something went wrong'))
    const onSuccess = (p: { id: string }) => {
      discardDraft()
      navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`)
    }
    if (page) {
      update.mutate({ id: page.id, title: title.trim(), icon, bodyDoc: doc }, { onSuccess, onError })
    } else {
      create.mutate({ title: title.trim(), icon, parentId, bodyDoc: doc, kind: kind ?? undefined }, { onSuccess, onError })
    }
  }

  // Confluence's centered page icon + title + template gallery, rendered
  // inside the editor canvas column.
  const canvasHeader = (
    <>
      <div style={{ textAlign: 'center', marginBottom: 4, position: 'relative' }}>
        <button
          type="button"
          onClick={() => setIconOpen(!iconOpen)}
          title={icon ? t('Change icon') : t('Add icon')}
          style={{
            border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 8,
            fontSize: icon ? 42 : 13, padding: icon ? '0 8px' : '4px 10px',
            color: token('color.text.subtlest', '#626F86'),
          }}
        >
          {icon || `😀 ${t('Add icon')}`}
        </button>
        {iconOpen && (
          <>
            <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setIconOpen(false)} />
            <span style={{ position: 'absolute', top: '100%', insetInlineStart: '50%', transform: 'translateX(-50%)', zIndex: 401 }}>
              <EmojiPicker
                onPick={(ch) => {
                  setIcon(ch)
                  setIconOpen(false)
                }}
              />
            </span>
          </>
        )}
      </div>
      <input
        value={title}
        autoFocus={!page}
        onChange={(e) => {
          setTitle(e.target.value)
          scheduleAutosave()
        }}
        placeholder={t('Give this page a title')}
        style={{
          width: '100%',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          fontSize: 32,
          fontWeight: 600,
          color: 'inherit',
          marginBottom: 12,
          fontFamily: 'inherit',
          textAlign: 'center',
        }}
      />
      {showTemplates && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, justifyContent: 'center' }}>
          {(customTemplates ?? []).map((tpl) => (
            <div
              key={tpl.id}
              onClick={() => {
                setTitle((cur) => cur.trim() ? cur : tpl.name)
                setDoc(tpl.bodyDoc)
                setEditorKey((k) => k + 1)
                setShowTemplates(false)
                scheduleAutosave()
              }}
              style={{
                cursor: 'pointer', border: `1px solid ${token('color.border.selected', '#0C66E4')}`,
                borderRadius: 6, padding: '8px 12px', width: 168,
                background: token('elevation.surface.raised', '#FFFFFF'),
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{tpl.icon || '📄'} {tpl.name}</div>
              <div style={{ fontSize: 12, color: token('color.text.subtlest', '#626F86') }}>
                {tpl.description || t('Space template')}
              </div>
            </div>
          ))}
          {TEMPLATES.map((tpl) => (
            <div
              key={tpl.key}
              onClick={() => {
                setTitle((cur) => cur.trim() ? cur : tpl.title)
                setDoc(tpl.doc())
                setEditorKey((k) => k + 1)
                setShowTemplates(false)
                scheduleAutosave()
              }}
              style={{
                cursor: 'pointer', border: `1px solid ${token('color.border', '#DFE1E6')}`,
                borderRadius: 6, padding: '8px 12px', width: 168,
                background: token('elevation.surface.raised', '#FFFFFF'),
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{tpl.icon} {t(tpl.name)}</div>
              <div style={{ fontSize: 12, color: token('color.text.subtlest', '#626F86') }}>{t(tpl.desc)}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )

  return (
    <div>
      {/* Confluence's editor header: page identity left; status + actions right. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
        <PageIcon label="" />
        <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
          {title.trim() || (page ? page.title : kind === 'blog' ? t('New blog post') : t('New page'))}
        </span>
        <span style={{ flex: 1 }} />
        {error && <span style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error}</span>}
        <span style={{ fontSize: 13, color: token('color.text.subtlest', '#626F86') }}>
          {savedAt ? t('Draft saved {ago}', { ago: timeAgo(savedAt) }) : restored ? t('Draft restored') : page ? t('Editing') : ''}
        </span>
        <Button appearance="primary" isDisabled={!title.trim()} isLoading={pending} onClick={publish}>
          {page ? t('Update') : t('Publish')}
        </Button>
        <Button appearance="subtle" onClick={close}>{t('Close')}</Button>
        {page && (
          <IconButton
            icon={CopyIcon}
            label={t('Copy page link')}
            appearance="subtle"
            onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/wiki/spaces/${spaceKey}/pages/${page.id}`)}
          />
        )}
        <DropdownMenu<HTMLButtonElement>
          trigger={({ triggerRef, ...props }) => (
            <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('More actions')} appearance="subtle" />
          )}
          shouldRenderToParent
        >
          <DropdownItemGroup>
            <DropdownItem
              onClick={() => {
                discardDraft()
                close()
              }}
            >
              {t('Discard draft')}
            </DropdownItem>
          </DropdownItemGroup>
        </DropdownMenu>
      </div>

      <div className="th-wiki-editor">
        <RichTextEditor
          key={editorKey}
          initialDoc={(editorKey > 0 ? (doc as object | null) : (draft?.bodyDoc ?? page?.bodyDoc)) ?? undefined}
          initialText={draft ? '' : page?.bodyText}
          placeholder={t('Type / for content, or just start writing…')}
          autoFocus={!!page}
          chromeless
          canvasHeader={canvasHeader}
          onChange={(d) => {
            setDoc(d)
            scheduleAutosave()
          }}
        />
      </div>
      <style>{`.th-wiki-editor .ProseMirror { min-height: 55vh; padding: 0; font-size: 16px; line-height: 1.7; }`}</style>
    </div>
  )
}

export default function WikiEditorPage() {
  const { key, pageId } = useParams<{ key: string; pageId?: string }>()
  const spaceKey = key?.toUpperCase() ?? ''
  const [params] = useSearchParams()
  const { data: page, isLoading } = useWikiPage(pageId)
  const { data: draft, isLoading: draftLoading } = useWikiPageDraft(pageId)

  if (pageId && (isLoading || draftLoading || !page)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }
  return (
    <Editor
      spaceKey={spaceKey}
      page={pageId ? page : undefined}
      draft={pageId ? (draft ?? null) : null}
      parentId={pageId ? (page?.parentId ?? null) : params.get('parent')}
      kind={pageId ? undefined : params.get('kind')}
    />
  )
}
