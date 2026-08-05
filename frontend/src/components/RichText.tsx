import { useEffect, useMemo, useRef } from 'react'
import { EditorContent, NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, ReactRenderer, useEditor, type Editor, type JSONContent, type NodeViewProps } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableHeader from '@tiptap/extension-table-header'
import TableCell from '@tiptap/extension-table-cell'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Extension, Node, generateHTML, mergeAttributes, type Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import tippy, { type Instance } from 'tippy.js'
import { forwardRef, useImperativeHandle, useState } from 'react'
import Avatar from '@atlaskit/avatar'
import { token } from '@atlaskit/tokens'
import { api } from '../api/client'
import type { User } from '../api/client'
import { fmtDate, t } from '../i18n'
import { ALL_EMOJI, EMOJI_GROUPS } from './emojiData'
import {
  AlignTextLeftIcon, ChevronDownIcon, EmojiIcon, ImageIcon, LinkIcon, ListBulletedIcon, ListChecklistIcon,
  ListNumberedIcon, MentionIcon, RedoIcon, TableIcon, TextBoldIcon, TextItalicIcon, TextStyleIcon,
  TextUnderlineIcon, UndoIcon, AddIcon,
} from './coreIcons'

// Confluence-style resizable image: drag the side handles to set the width.
function ImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const startDrag = (e: React.MouseEvent, dir: 1 | -1) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = imgRef.current?.offsetWidth ?? 200
    const rtl = document.documentElement.dir === 'rtl' ? -1 : 1
    const onMove = (ev: MouseEvent) => {
      const w = Math.round(Math.min(1200, Math.max(80, startW + dir * rtl * (ev.clientX - startX))))
      updateAttributes({ width: w })
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <NodeViewWrapper as="span" className={`th-image-wrap${selected ? ' th-image-selected' : ''}`} data-drag-handle>
      <img
        ref={imgRef}
        src={node.attrs.src}
        alt={node.attrs.alt ?? ''}
        className="th-image"
        style={node.attrs.width ? { width: node.attrs.width } : undefined}
      />
      {selected && (
        <>
          <span className="th-image-handle" style={{ insetInlineStart: -5 }} onMouseDown={(e) => startDrag(e, -1)} />
          <span className="th-image-handle" style={{ insetInlineEnd: -5 }} onMouseDown={(e) => startDrag(e, 1)} />
        </>
      )}
    </NodeViewWrapper>
  )
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = (el as HTMLElement).style?.width
          return w ? parseInt(w, 10) : null
        },
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}px` } : {}),
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView)
  },
})

// Confluence's panel element: info / note / success / warning / error,
// each with its emoji and tinted background.
export const PANEL_TYPES: { type: string; emoji: string; label: string }[] = [
  { type: 'info', emoji: 'ℹ️', label: 'Info panel' },
  { type: 'note', emoji: '📝', label: 'Note panel' },
  { type: 'success', emoji: '✅', label: 'Success panel' },
  { type: 'warning', emoji: '⚠️', label: 'Warning panel' },
  { type: 'error', emoji: '⛔', label: 'Error panel' },
]

function PanelView({ node }: NodeViewProps) {
  const meta = PANEL_TYPES.find((p) => p.type === node.attrs.panelType) ?? PANEL_TYPES[0]
  return (
    <NodeViewWrapper className={`th-panel th-panel-${meta.type}`}>
      <span className="th-panel-emoji" contentEditable={false}>{meta.emoji}</span>
      <NodeViewContent className="th-panel-body" />
    </NodeViewWrapper>
  )
}

const Panel = Node.create({
  name: 'panel',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      panelType: {
        default: 'info',
        parseHTML: (el) => el.getAttribute('data-panel-type') || 'info',
        renderHTML: (attrs) => ({ 'data-panel-type': attrs.panelType }),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-panel-type]' }]
  },
  renderHTML({ node, HTMLAttributes }) {
    const meta = PANEL_TYPES.find((p) => p.type === node.attrs.panelType) ?? PANEL_TYPES[0]
    return ['div', mergeAttributes(HTMLAttributes, { class: `th-panel th-panel-${meta.type}` }),
      ['span', { class: 'th-panel-emoji' }, meta.emoji],
      ['div', { class: 'th-panel-body' }, 0]]
  },
  addNodeView() {
    return ReactNodeViewRenderer(PanelView)
  },
})

// ---- W18: status / date / decision macros ----

export const STATUS_COLORS: { name: string; bg: string; fg: string }[] = [
  { name: 'neutral', bg: '#DCDFE4', fg: '#44546F' },
  { name: 'blue', bg: '#CCE0FF', fg: '#0055CC' },
  { name: 'green', bg: '#DCFFF1', fg: '#216E4E' },
  { name: 'yellow', bg: '#F8E6A0', fg: '#7F5F01' },
  { name: 'red', bg: '#FFD5D2', fg: '#AE2E24' },
  { name: 'purple', bg: '#DFD8FD', fg: '#5E4DB2' },
]

function StatusView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string>(node.attrs.text)
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline', position: 'relative' }}>
      <span
        className={`th-status th-status-${node.attrs.color}`}
        onClick={() => editor.isEditable && setOpen(!open)}
        style={{ cursor: editor.isEditable ? 'pointer' : 'default' }}
      >
        {node.attrs.text}
      </span>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <span
            style={{
              position: 'absolute', top: '100%', insetInlineStart: 0, zIndex: 401, marginTop: 4,
              display: 'flex', flexDirection: 'column', gap: 6, padding: 8, width: 200,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
            }}
          >
            <input
              autoFocus
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  updateAttributes({ text: text.trim().toUpperCase() || 'STATUS' })
                  setOpen(false)
                }
              }}
              onBlur={() => updateAttributes({ text: text.trim().toUpperCase() || 'STATUS' })}
              style={{ fontSize: 13, padding: '4px 6px', borderRadius: 4, border: `1px solid ${token('color.border.input', '#8590A2')}`, background: 'transparent', color: 'inherit' }}
            />
            <span style={{ display: 'flex', gap: 5 }}>
              {STATUS_COLORS.map((c) => (
                <span
                  key={c.name}
                  onClick={() => { updateAttributes({ color: c.name }); setOpen(false) }}
                  title={c.name}
                  style={{
                    width: 18, height: 18, borderRadius: 4, background: c.bg, cursor: 'pointer',
                    border: node.attrs.color === c.name ? `2px solid ${token('color.border.selected', '#0C66E4')}` : '2px solid transparent',
                  }}
                />
              ))}
            </span>
          </span>
        </>
      )}
    </NodeViewWrapper>
  )
}

// Confluence's status lozenge: [ ON TRACK ] with a color, editable in place.
const StatusChip = Node.create({
  name: 'statusChip',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return {
      text: { default: 'STATUS', parseHTML: (el) => el.getAttribute('data-status') || el.textContent || 'STATUS' },
      color: { default: 'neutral', parseHTML: (el) => el.getAttribute('data-status-color') || 'neutral' },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-status]' }]
  },
  renderHTML({ node }) {
    return ['span', {
      'data-status': node.attrs.text,
      'data-status-color': node.attrs.color,
      class: `th-status th-status-${node.attrs.color}`,
    }, node.attrs.text]
  },
  addNodeView() {
    return ReactNodeViewRenderer(StatusView)
  },
})

function DateChipView({ node, updateAttributes, editor }: NodeViewProps) {
  const [open, setOpen] = useState(false)
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline', position: 'relative' }}>
      <span
        className="th-date-chip"
        onClick={() => editor.isEditable && setOpen(!open)}
        style={{ cursor: editor.isEditable ? 'pointer' : 'default' }}
      >
        📅 {fmtDate(node.attrs.date)}
      </span>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <span
            style={{
              position: 'absolute', top: '100%', insetInlineStart: 0, zIndex: 401, marginTop: 4, padding: 8,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
            }}
          >
            <input
              type="date"
              autoFocus
              value={node.attrs.date}
              onChange={(e) => {
                if (e.currentTarget.value) updateAttributes({ date: e.currentTarget.value })
                setOpen(false)
              }}
              style={{ fontSize: 13, padding: '4px 6px', borderRadius: 4, border: `1px solid ${token('color.border.input', '#8590A2')}`, background: 'transparent', color: 'inherit', fontFamily: 'inherit' }}
            />
          </span>
        </>
      )}
    </NodeViewWrapper>
  )
}

// Confluence's inline date: a calendar chip with a picker.
const DateChip = Node.create({
  name: 'dateChip',
  inline: true,
  group: 'inline',
  atom: true,
  addAttributes() {
    return {
      date: {
        default: new Date().toISOString().slice(0, 10),
        parseHTML: (el) => el.getAttribute('data-date') || new Date().toISOString().slice(0, 10),
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-date]' }]
  },
  renderHTML({ node }) {
    return ['span', { 'data-date': node.attrs.date, class: 'th-date-chip' }, '📅 ' + fmtDate(node.attrs.date)]
  },
  addNodeView() {
    return ReactNodeViewRenderer(DateChipView)
  },
})

// Confluence's decision list: green-diamond decision rows.
const DecisionList = Node.create({
  name: 'decisionList',
  group: 'block',
  content: 'decisionItem+',
  parseHTML() {
    return [{ tag: 'div[data-decision-list]' }]
  },
  renderHTML() {
    return ['div', { 'data-decision-list': '', class: 'th-decisions' }, 0]
  },
})

const DecisionItem = Node.create({
  name: 'decisionItem',
  content: 'paragraph+',
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-decision-item]' }]
  },
  renderHTML() {
    return ['div', { 'data-decision-item': '', class: 'th-decision' },
      ['span', { class: 'th-decision-marker', contenteditable: 'false' }, '◆'],
      ['div', { class: 'th-decision-body' }, 0]]
  },
})

// ---- W10: block drag handles (⠿) ----

// A hover handle beside each top-level block; dragging it moves the block
// (ProseMirror's native node-selection drag handles the drop).
const DragHandle = Extension.create({
  name: 'dragHandle',
  addProseMirrorPlugins() {
    let handle: HTMLElement | null = null
    let targetPos: number | null = null

    const hide = () => {
      if (handle) handle.style.display = 'none'
      targetPos = null
    }

    return [
      new Plugin({
        key: new PluginKey('thDragHandle'),
        view: (view) => {
          handle = document.createElement('div')
          handle.className = 'th-drag-handle'
          handle.textContent = '⠿'
          handle.draggable = true
          handle.style.display = 'none'
          const host = view.dom.parentElement
          if (host) {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
            host.appendChild(handle)
          }
          handle.addEventListener('mousedown', () => {
            if (targetPos == null) return
            const { state, dispatch } = view
            dispatch(state.tr.setSelection(NodeSelection.create(state.doc, targetPos)))
          })
          handle.addEventListener('dragstart', (e) => {
            if (targetPos == null || !e.dataTransfer) return
            const sel = view.state.selection
            if (!(sel instanceof NodeSelection)) return
            const slice = sel.content()
            // Hand the slice to ProseMirror so the drop moves the block.
            ;(view as unknown as { dragging: unknown }).dragging = { slice, move: true }
            const dom = (view.nodeDOM(targetPos) as HTMLElement) ?? handle!
            e.dataTransfer.setDragImage(dom, 0, 0)
            e.dataTransfer.setData('text/plain', '⠿')
          })
          handle.addEventListener('dragend', hide)
          return {
            destroy() {
              handle?.remove()
              handle = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              if (!handle || !view.editable) return false
              const host = view.dom.parentElement
              if (!host) return false
              const coords = { left: event.clientX + 1, top: event.clientY }
              const found = view.posAtCoords(coords)
              if (!found) {
                hide()
                return false
              }
              const $pos = view.state.doc.resolve(found.pos)
              if ($pos.depth < 1 && !$pos.nodeAfter) {
                hide()
                return false
              }
              const before = $pos.depth >= 1 ? $pos.before(1) : found.pos
              const node = view.state.doc.nodeAt(before)
              if (!node || node.isText) {
                hide()
                return false
              }
              const dom = view.nodeDOM(before) as HTMLElement | null
              if (!dom || !dom.getBoundingClientRect) {
                hide()
                return false
              }
              const rect = dom.getBoundingClientRect()
              const hostRect = host.getBoundingClientRect()
              targetPos = before
              handle.style.display = 'flex'
              handle.style.top = `${rect.top - hostRect.top + 2}px`
              handle.style.left = `${Math.max(0, rect.left - hostRect.left - 22)}px`
              return false
            },
            mouseleave() {
              // Keep it visible briefly so the user can reach the handle.
              setTimeout(() => {
                if (handle && !handle.matches(':hover')) hide()
              }, 300)
              return false
            },
          },
        },
      }),
    ]
  },
})

// ---- W10: column layouts + expand ----

const LayoutColumn = Node.create({
  name: 'layoutColumn',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      width: {
        default: null,
        parseHTML: (el) => {
          const w = (el as HTMLElement).style.flexBasis
          return w ? parseFloat(w) : null
        },
        renderHTML: (attrs) => (attrs.width ? { style: `flex: 0 0 ${attrs.width}%` } : {}),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-layout-col]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-layout-col': '', class: 'th-layout-col' }), 0]
  },
})

const LayoutSection = Node.create({
  name: 'layoutSection',
  group: 'block',
  content: 'layoutColumn{2,3}',
  defining: true,
  isolating: true,
  parseHTML() { return [{ tag: 'div[data-layout]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-layout': '', class: 'th-layout' }), 0]
  },
})

const emptyColumn = () => ({ type: 'layoutColumn', content: [{ type: 'paragraph' }] })

// Confluence's expand element — a native <details> so published pages
// collapse without any JS.
function ExpandView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="th-expand">
      <div className="th-expand-head" contentEditable={false}>
        <span className="th-expand-chevron">▸</span>
        <input
          value={node.attrs.title}
          placeholder={t('Give this expand a title…')}
          onChange={(e) => updateAttributes({ title: e.target.value })}
        />
      </div>
      <NodeViewContent className="th-expand-body" />
    </NodeViewWrapper>
  )
}

const Expand = Node.create({
  name: 'expand',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      title: {
        default: '',
        parseHTML: (el) => el.querySelector(':scope > summary')?.textContent ?? el.getAttribute('data-title') ?? '',
        renderHTML: () => ({}),
      },
    }
  },
  parseHTML() { return [{ tag: 'details[data-expand]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { 'data-expand': '', class: 'th-expand' }),
      ['summary', { class: 'th-expand-summary' }, node.attrs.title || t('Click to expand')],
      ['div', { class: 'th-expand-body' }, 0]]
  },
  addNodeView() { return ReactNodeViewRenderer(ExpandView) },
})

// ---- Stage W5: smart links between TaskHat and DocHat ----

type ChipIssue = { key: string; summary: string; status: { name: string; category: string }; type: string }

function IssueChipView({ node }: NodeViewProps) {
  const [issue, setIssue] = useState<ChipIssue | null | undefined>(null)
  useEffect(() => {
    let live = true
    api<ChipIssue>(`/issues/${node.attrs.key}`).then((i) => live && setIssue(i)).catch(() => live && setIssue(undefined))
    return () => { live = false }
  }, [node.attrs.key])
  return (
    <NodeViewWrapper as="span" className="th-issue-chip" data-issue-key={node.attrs.key}>
      <a href={`/browse/${node.attrs.key}`} onClick={(e) => e.preventDefault()} contentEditable={false}>
        <b>{node.attrs.key}</b>
        {issue ? <> {issue.summary} <span className={`th-chip-status th-chip-${issue.status.category}`}>{issue.status.name}</span></> : issue === undefined ? ` ${t('(not found)')}` : ' …'}
      </a>
    </NodeViewWrapper>
  )
}

const IssueChip = Node.create({
  name: 'issueChip',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return { key: { default: '', parseHTML: (el) => el.getAttribute('data-issue-key'), renderHTML: (a) => ({ 'data-issue-key': a.key }) } }
  },
  parseHTML() { return [{ tag: 'a[data-issue-key]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { class: 'th-issue-chip', href: `/browse/${node.attrs.key}` }), node.attrs.key]
  },
  addNodeView() { return ReactNodeViewRenderer(IssueChipView) },
})

function PageChipView({ node, updateAttributes }: NodeViewProps) {
  useEffect(() => {
    if (node.attrs.title) return
    api<{ title: string; icon: string }>(`/wiki/pages/${node.attrs.pageId}`)
      .then((p) => updateAttributes({ title: p.title, icon: p.icon }))
      .catch(() => updateAttributes({ title: t('(page unavailable)') }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.pageId])
  return (
    <NodeViewWrapper as="span" className="th-page-chip">
      <a href={`/wiki/spaces/${node.attrs.spaceKey}/pages/${node.attrs.pageId}`} onClick={(e) => e.preventDefault()} contentEditable={false}>
        {node.attrs.icon || '📄'} {node.attrs.title || '…'}
      </a>
    </NodeViewWrapper>
  )
}

const PageChip = Node.create({
  name: 'pageChip',
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes() {
    return {
      pageId: { default: '', parseHTML: (el) => el.getAttribute('data-wiki-page'), renderHTML: (a) => ({ 'data-wiki-page': a.pageId }) },
      spaceKey: { default: '', parseHTML: (el) => el.getAttribute('data-wiki-space'), renderHTML: (a) => ({ 'data-wiki-space': a.spaceKey }) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-wiki-title'), renderHTML: (a) => ({ 'data-wiki-title': a.title }) },
      icon: { default: '', parseHTML: (el) => el.getAttribute('data-wiki-icon'), renderHTML: (a) => ({ 'data-wiki-icon': a.icon }) },
    }
  },
  parseHTML() { return [{ tag: 'a[data-wiki-page]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, {
      class: 'th-page-chip',
      href: `/wiki/spaces/${node.attrs.spaceKey}/pages/${node.attrs.pageId}`,
    }), `${node.attrs.icon || '📄'} ${node.attrs.title || t('page')}`]
  },
  addNodeView() { return ReactNodeViewRenderer(PageChipView) },
})

// Renders a whiteboard scene into a host element as a static SVG snapshot
// (the canvas library loads lazily; previews are read-only, click to open).
async function renderWhiteboardPreview(host: HTMLElement, pageId: string) {
  try {
    const page = await api<{ title: string; kind: string; bodyDoc: unknown }>(`/wiki/pages/${pageId}`)
    const d = page.bodyDoc as { elements?: unknown[]; appState?: Record<string, unknown>; files?: unknown } | null
    if (!d?.elements?.length) {
      host.textContent = t('Empty whiteboard')
      return page.title
    }
    const { exportToSvg, restoreElements } = await import('@excalidraw/excalidraw')
    const svg = await exportToSvg({
      elements: restoreElements((d.elements ?? []) as never, null),
      appState: {
        ...(d.appState ?? {}),
        exportBackground: true,
        exportWithDarkMode: document.documentElement.getAttribute('data-color-mode') === 'dark',
      } as never,
      files: (d.files ?? null) as never,
    })
    svg.style.maxWidth = '100%'
    svg.style.height = 'auto'
    svg.style.maxHeight = '360px'
    host.replaceChildren(svg)
    return page.title
  } catch {
    host.textContent = t('(whiteboard unavailable)')
    return null
  }
}

// W15: swap a snapshot embed for a live read-only canvas (pan/zoom, always
// showing the board's current content).
async function mountInteractiveWhiteboard(host: HTMLElement, pageId: string) {
  try {
    ;(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/'
    const page = await api<{ bodyDoc: unknown }>(`/wiki/pages/${pageId}`)
    const d = (page.bodyDoc ?? {}) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: unknown }
    const [{ Excalidraw }, React, { createRoot }] = await Promise.all([
      import('@excalidraw/excalidraw'),
      import('react'),
      import('react-dom/client'),
    ])
    const mount = document.createElement('div')
    mount.style.height = '360px'
    host.replaceChildren(mount)
    createRoot(mount).render(
      React.createElement(Excalidraw, {
        initialData: {
          elements: (d.elements ?? []) as never,
          appState: { ...(d.appState ?? {}), collaborators: undefined } as never,
          files: (d.files ?? undefined) as never,
        },
        viewModeEnabled: true,
        theme: document.documentElement.getAttribute('data-color-mode') === 'dark' ? 'dark' : 'light',
      } as never),
    )
  } catch {
    host.textContent = t('(whiteboard unavailable)')
  }
}

// A whiteboard embedded in a document — Confluence's board smart-link embed.
function WhiteboardEmbedView({ node, updateAttributes }: NodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hostRef.current) return
    renderWhiteboardPreview(hostRef.current, node.attrs.pageId).then((title) => {
      if (title && title !== node.attrs.title) updateAttributes({ title })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.pageId])
  return (
    <NodeViewWrapper className="th-wb-embed" contentEditable={false}>
      <div className="th-wb-embed-head">
        <span>{node.attrs.title || t('Whiteboard')}</span>
        <span style={{ display: 'inline-flex', gap: 10 }}>
          <a
            href="#interactive"
            onClick={(e) => {
              e.preventDefault()
              if (hostRef.current) void mountInteractiveWhiteboard(hostRef.current, node.attrs.pageId)
            }}
          >
            {t('Interactive')}
          </a>
          <a href={`/wiki/spaces/${node.attrs.spaceKey}/pages/${node.attrs.pageId}`}>{t('Open')}</a>
        </span>
      </div>
      <div ref={hostRef} className="th-wb-embed-body" />
    </NodeViewWrapper>
  )
}

const WhiteboardEmbed = Node.create({
  name: 'whiteboardEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      pageId: { default: '', parseHTML: (el) => el.getAttribute('data-wb-page'), renderHTML: (a) => ({ 'data-wb-page': a.pageId }) },
      spaceKey: { default: '', parseHTML: (el) => el.getAttribute('data-wb-space'), renderHTML: (a) => ({ 'data-wb-space': a.spaceKey }) },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-wb-title'), renderHTML: (a) => ({ 'data-wb-title': a.title }) },
    }
  },
  parseHTML() { return [{ tag: 'div[data-wb-page]' }] },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'th-wb-embed' }), node.attrs.title || t('Whiteboard')]
  },
  addNodeView() { return ReactNodeViewRenderer(WhiteboardEmbedView) },
})

// The Confluence "Jira issues" macro: a live TQL result list on the page.
function TqlEmbedView({ node, updateAttributes }: NodeViewProps) {
  const [draft, setDraft] = useState<string>(node.attrs.tql)
  const [rows, setRows] = useState<ChipIssue[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!node.attrs.tql.trim()) { setRows([]); return }
    let live = true
    api<{ values: ChipIssue[]; total: number }>(`/search?tql=${encodeURIComponent(node.attrs.tql)}&maxResults=10`)
      .then((r) => { if (live) { setRows(r.values); setError('') } })
      .catch(() => { if (live) { setRows([]); setError(t('Invalid TQL')) } })
    return () => { live = false }
  }, [node.attrs.tql])
  return (
    <NodeViewWrapper className="th-tql-embed-editor" contentEditable={false}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{t('Work items (TQL)')}</span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => updateAttributes({ tql: draft })}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); updateAttributes({ tql: draft }) } }}
          placeholder="project = TH AND resolution = EMPTY"
          style={{ flex: 1, fontSize: 12, padding: '3px 8px', borderRadius: 4, border: `1px solid ${token('color.border.input', '#8590A2')}`, background: token('elevation.surface', '#FFFFFF'), color: 'inherit', outline: 'none' }}
        />
      </div>
      {error && <div style={{ fontSize: 12, color: token('color.text.danger', '#AE2E24') }}>{error}</div>}
      {(rows ?? []).map((i) => (
        <div key={i.key} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0', alignItems: 'center' }}>
          <b style={{ whiteSpace: 'nowrap' }}>{i.key}</b>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
          <span className={`th-chip-status th-chip-${i.status.category}`}>{i.status.name}</span>
        </div>
      ))}
      {rows !== null && rows.length === 0 && !error && (
        <div style={{ fontSize: 12, color: token('color.text.subtlest', '#626F86') }}>{t('No matching work items.')}</div>
      )}
    </NodeViewWrapper>
  )
}

const TqlEmbed = Node.create({
  name: 'tqlEmbed',
  group: 'block',
  atom: true,
  addAttributes() {
    return { tql: { default: '', parseHTML: (el) => el.getAttribute('data-tql'), renderHTML: (a) => ({ 'data-tql': a.tql }) } }
  },
  parseHTML() { return [{ tag: 'div[data-tql]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'th-tql-embed' })]
  },
  addNodeView() { return ReactNodeViewRenderer(TqlEmbedView) },
})

// ---- shared extension set (schema must match between edit + render) ----

function extensions(placeholder?: string) {
  return [
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    Link.configure({ openOnClick: false, autolink: true }),
    Placeholder.configure({ placeholder: placeholder ?? '' }),
    Mention.configure({
      HTMLAttributes: { class: 'th-mention' },
      suggestion: mentionSuggestion,
      renderLabel({ node }) {
        return `@${node.attrs.label ?? node.attrs.id}`
      },
    }),
    Table.configure({ resizable: false, HTMLAttributes: { class: 'th-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    ResizableImage.configure({ HTMLAttributes: { class: 'th-image' } }),
    Underline,
    TaskList.configure({ HTMLAttributes: { class: 'th-tasklist' } }),
    TaskItem.configure({ nested: true }),
    TextStyle,
    Color,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Panel,
    StatusChip,
    DateChip,
    DecisionList,
    DecisionItem,
    LayoutSection,
    LayoutColumn,
    Expand,
    DragHandle,
    IssueChip,
    PageChip,
    WhiteboardEmbed,
    TqlEmbed,
    SlashCommand,
    EmojiShortcut,
    IssueShortcut,
  ]
}

// ---- image upload (stored like avatars: unguessable public keys) ----

export async function uploadEditorImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await api<{ url: string }>('/wiki/images', { method: 'POST', body: form })
  return res.url
}

function pickAndInsertImage(editor: Editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const url = await uploadEditorImage(file)
      editor.chain().focus().setImage({ src: url, alt: file.name }).run()
    } catch {
      window.alert(t('Image upload failed'))
    }
  }
  input.click()
}

// Insert pasted/dropped image files inline, like Confluence.
function insertImageFiles(editor: Editor, files: FileList | File[]): boolean {
  const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return false
  for (const file of images) {
    uploadEditorImage(file)
      .then((url) => editor.chain().focus().setImage({ src: url, alt: file.name }).run())
      .catch(() => window.alert(t('Image upload failed')))
  }
  return true
}

// ---- slash command menu (Confluence's "/" insert menu) ----

interface SlashItem {
  label: string
  hint: string
  glyph: string
  run: (editor: Editor, range: Range) => void
}

const SLASH_ITEMS: SlashItem[] = [
  { label: 'Heading 1', hint: 'Large section heading', glyph: 'H1', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run() },
  { label: 'Heading 2', hint: 'Medium section heading', glyph: 'H2', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run() },
  { label: 'Heading 3', hint: 'Small section heading', glyph: 'H3', run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run() },
  { label: 'Bullet list', hint: 'Plain list of items', glyph: '•', run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { label: 'Numbered list', hint: 'Ordered list of items', glyph: '1.', run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { label: 'Action item', hint: 'Checkbox task list', glyph: '☑', run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { label: 'Table', hint: 'Insert a 3×3 table', glyph: '⊞', run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { label: 'Image', hint: 'Upload and insert an image', glyph: '🖼', run: (e, r) => { e.chain().focus().deleteRange(r).run(); pickAndInsertImage(e) } },
  { label: 'Quote', hint: 'Highlight a quotation', glyph: '❝', run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { label: 'Code block', hint: 'Preformatted code', glyph: '{}', run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { label: 'Divider', hint: 'Horizontal rule', glyph: '—', run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
  { label: 'Info panel', hint: 'Highlight information in a colored panel', glyph: 'ℹ️', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('panel', { panelType: 'info' }).run() },
  { label: 'Note panel', hint: 'A purple note callout', glyph: '📝', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('panel', { panelType: 'note' }).run() },
  { label: 'Success panel', hint: 'A green success callout', glyph: '✅', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('panel', { panelType: 'success' }).run() },
  { label: 'Warning panel', hint: 'A yellow warning callout', glyph: '⚠️', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('panel', { panelType: 'warning' }).run() },
  { label: 'Error panel', hint: 'A red error callout', glyph: '⛔', run: (e, r) => e.chain().focus().deleteRange(r).wrapIn('panel', { panelType: 'error' }).run() },
  // Cursor lands in the first column / the body, like Confluence.
  { label: '2 columns', hint: 'Two-column layout section', glyph: '▥', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'layoutSection', content: [emptyColumn(), emptyColumn()] }).setTextSelection(r.from + 3).run() },
  { label: '3 columns', hint: 'Three-column layout section', glyph: '▦', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'layoutSection', content: [emptyColumn(), emptyColumn(), emptyColumn()] }).setTextSelection(r.from + 3).run() },
  { label: 'Expand', hint: 'Collapsible section with a title', glyph: '▸', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'expand', attrs: { title: '' }, content: [{ type: 'paragraph' }] }).setTextSelection(r.from + 2).run() },
  { label: 'Mention', hint: 'Mention a teammate', glyph: '@', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('@').run() },
  { label: 'Work item', hint: 'Link a TaskHat work item as a chip', glyph: '#', run: (e, r) => e.chain().focus().deleteRange(r).insertContent('#').run() },
  { label: 'Work items from TQL', hint: 'Embed a live TQL result list', glyph: '⊟', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'tqlEmbed', attrs: { tql: '' } }).run() },
  { label: 'Status', hint: 'A colored status lozenge', glyph: '▣', run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: 'statusChip', attrs: { text: 'STATUS', color: 'neutral' } }, { type: 'text', text: ' ' }]).run() },
  { label: 'Date', hint: 'Add a date using a calendar', glyph: '📅', run: (e, r) => e.chain().focus().deleteRange(r).insertContent([{ type: 'dateChip' }, { type: 'text', text: ' ' }]).run() },
  { label: 'Decision', hint: 'Capture decisions so they’re easy to track', glyph: '◆', run: (e, r) => e.chain().focus().deleteRange(r).insertContent({ type: 'decisionList', content: [{ type: 'decisionItem', content: [{ type: 'paragraph' }] }] }).setTextSelection(r.from + 2).run() },
]

// Browse-modal grouping, Confluence's insert catalog categories.
const SLASH_CATEGORY: Record<string, string> = {
  'Heading 1': 'Formatting', 'Heading 2': 'Formatting', 'Heading 3': 'Formatting',
  'Bullet list': 'Formatting', 'Numbered list': 'Formatting', 'Quote': 'Formatting',
  'Code block': 'Formatting', 'Divider': 'Formatting', '2 columns': 'Formatting',
  '3 columns': 'Formatting', 'Expand': 'Formatting',
  'Action item': 'Content', 'Table': 'Content', 'Status': 'Content', 'Date': 'Content',
  'Decision': 'Content', 'Info panel': 'Content', 'Note panel': 'Content',
  'Success panel': 'Content', 'Warning panel': 'Content', 'Error panel': 'Content',
  'Image': 'Media',
  'Mention': 'Navigation', 'Work item': 'Navigation', 'Work items from TQL': 'Navigation',
}
const BROWSE_CATEGORIES = ['All', 'Formatting', 'Content', 'Media', 'Navigation']

// The searchable "Browse all" insert catalog behind the + menu.
function BrowseModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('All')
  const items = SLASH_ITEMS.filter((i) => {
    const c = SLASH_CATEGORY[i.label] ?? 'Content'
    if (cat !== 'All' && c !== cat) return false
    const q = query.trim().toLowerCase()
    return !q || t(i.label).toLowerCase().includes(q) || t(i.hint).toLowerCase().includes(q)
  })
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(9,30,66,0.54)' }} onClick={onClose} />
      <div
        style={{
          position: 'relative', width: 760, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          background: token('elevation.surface.overlay', '#FFFFFF'), borderRadius: 8,
          boxShadow: token('elevation.shadow.overlay', '0 8px 28px rgba(9,30,66,0.35)'), padding: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <span style={{ fontSize: 20, fontWeight: 700 }}>{t('Browse')}</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder={t('Search')}
            style={{
              flex: 1, fontSize: 14, padding: '8px 12px', borderRadius: 6,
              border: `1px solid ${token('color.border.input', '#8590A2')}`, background: 'transparent', color: 'inherit',
            }}
          />
          <span onClick={onClose} style={{ cursor: 'pointer', fontSize: 18, ...({ color: token('color.text.subtlest', '#626F86') }) }}>✕</span>
        </div>
        <div style={{ display: 'flex', gap: 16, minHeight: 0, flex: 1 }}>
          <div style={{ width: 150, flexShrink: 0 }}>
            {BROWSE_CATEGORIES.map((c) => (
              <div
                key={c}
                onClick={() => setCat(c)}
                style={{
                  padding: '7px 10px', fontSize: 14, borderRadius: 6, cursor: 'pointer',
                  background: cat === c ? token('color.background.selected', '#E9F2FF') : 'transparent',
                  color: cat === c ? token('color.text.selected', '#0C66E4') : 'inherit',
                  fontWeight: cat === c ? 600 : 400,
                }}
              >
                {t(c)}
              </div>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8, alignContent: 'start' }}>
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  const pos = editor.state.selection.from
                  item.run(editor, { from: pos, to: pos })
                  onClose()
                }}
                style={{
                  display: 'flex', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 6, cursor: 'pointer',
                  border: `1px solid ${token('color.border', '#DFE1E6')}`, background: 'transparent', textAlign: 'start', color: 'inherit',
                }}
              >
                <span style={{ fontSize: 16, width: 24, flexShrink: 0 }}>{item.glyph}</span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{t(item.label)}</div>
                  <div style={{ fontSize: 12, color: token('color.text.subtlest', '#626F86') }}>{t(item.hint)}</div>
                </span>
              </button>
            ))}
            {items.length === 0 && <div style={{ fontSize: 13, color: token('color.text.subtlest', '#626F86') }}>{t('No matches')}</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

interface SlashListProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
}

const SlashList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, SlashListProps>(
  function SlashList({ items, command }, ref) {
    const [index, setIndex] = useState(0)
    useEffect(() => setIndex(0), [items])
    useImperativeHandle(ref, () => ({
      onKeyDown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % Math.max(items.length, 1)); return true }
        if (e.key === 'ArrowUp') { setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1)); return true }
        if (e.key === 'Enter') { if (items[index]) command(items[index]); return true }
        return false
      },
    }))
    return (
      <div
        style={{
          background: token('elevation.surface.overlay', '#FFFFFF'),
          borderRadius: 6,
          boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          padding: 4,
          minWidth: 260,
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {items.length === 0 && (
          <div style={{ padding: '6px 10px', fontSize: 13, color: token('color.text.subtlest', '#626F86') }}>{t('No matches')}</div>
        )}
        {items.map((item, i) => (
          <button
            key={item.label}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setIndex(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 8px',
              border: 'none', borderRadius: 4, textAlign: 'start', fontSize: 14, cursor: 'pointer', color: 'inherit',
              background: i === index ? token('color.background.selected', '#E9F2FF') : 'transparent',
            }}
          >
            <span
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
                borderRadius: 4, flexShrink: 0, fontSize: 13, fontWeight: 700,
                border: `1px solid ${token('color.border', '#DFE1E6')}`,
                background: token('elevation.surface', '#FFFFFF'),
              }}
            >
              {item.glyph}
            </span>
            <span style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{t(item.label)}</div>
              <div style={{ fontSize: 12, color: token('color.text.subtlest', '#626F86') }}>{t(item.hint)}</div>
            </span>
          </button>
        ))}
      </div>
    )
  },
)

interface EmojiItem { ch: string; name: string }

const EmojiList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, { items: EmojiItem[]; command: (i: EmojiItem) => void }>(
  function EmojiList({ items, command }, ref) {
    const [index, setIndex] = useState(0)
    useEffect(() => setIndex(0), [items])
    useImperativeHandle(ref, () => ({
      onKeyDown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { setIndex((i) => (i + 1) % Math.max(items.length, 1)); return true }
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1)); return true }
        if (e.key === 'Enter') { if (items[index]) command(items[index]); return true }
        return false
      },
    }))
    if (items.length === 0) return null
    return (
      <div
        style={{
          background: token('elevation.surface.overlay', '#FFFFFF'),
          borderRadius: 6,
          boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          padding: 4, minWidth: 220, maxHeight: 260, overflowY: 'auto',
        }}
      >
        {items.map((item, i) => (
          <button
            key={item.name}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setIndex(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
              border: 'none', borderRadius: 4, textAlign: 'start', fontSize: 14, cursor: 'pointer', color: 'inherit',
              background: i === index ? token('color.background.selected', '#E9F2FF') : 'transparent',
            }}
          >
            <span style={{ fontSize: 18 }}>{item.ch}</span>
            <span style={{ color: token('color.text.subtlest', '#626F86'), fontSize: 13 }}>:{item.name}:</span>
          </button>
        ))}
      </div>
    )
  },
)

const IssueList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, { items: ChipIssue[]; command: (i: ChipIssue) => void }>(
  function IssueList({ items, command }, ref) {
    const [index, setIndex] = useState(0)
    useEffect(() => setIndex(0), [items])
    useImperativeHandle(ref, () => ({
      onKeyDown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') { setIndex((i) => (i + 1) % Math.max(items.length, 1)); return true }
        if (e.key === 'ArrowUp') { setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1)); return true }
        if (e.key === 'Enter') { if (items[index]) command(items[index]); return true }
        return false
      },
    }))
    if (items.length === 0) return null
    return (
      <div
        style={{
          background: token('elevation.surface.overlay', '#FFFFFF'),
          borderRadius: 6,
          boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          padding: 4, minWidth: 300, maxHeight: 260, overflowY: 'auto',
        }}
      >
        {items.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onClick={() => command(item)}
            onMouseEnter={() => setIndex(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
              border: 'none', borderRadius: 4, textAlign: 'start', fontSize: 13, cursor: 'pointer', color: 'inherit',
              background: i === index ? token('color.background.selected', '#E9F2FF') : 'transparent',
            }}
          >
            <b style={{ whiteSpace: 'nowrap' }}>{item.key}</b>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.summary}</span>
          </button>
        ))}
      </div>
    )
  },
)

// Type "#" then a key or words to link a work item inline, chip-style.
const IssueShortcut = Extension.create({
  name: 'issueShortcut',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: '#',
        pluginKey: new PluginKey('issueSuggestion'),
        allowSpaces: true,
        items: async ({ query }) => {
          if (query.length < 2) return []
          try {
            const res = await api<{ values: ChipIssue[] }>(`/quicksearch?q=${encodeURIComponent(query)}`)
            return res.values.slice(0, 8)
          } catch {
            return []
          }
        },
        command: ({ editor, range, props }) => {
          const issue = props as ChipIssue
          editor.chain().focus().deleteRange(range)
            .insertContent([{ type: 'issueChip', attrs: { key: issue.key } }, { type: 'text', text: ' ' }]).run()
        },
        render: () => {
          let component: ReactRenderer | null = null
          let popup: Instance[] = []
          return {
            onStart(props) {
              component = new ReactRenderer(IssueList, { props, editor: props.editor })
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate(props) {
              component?.updateProps(props)
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') { popup[0]?.hide(); return true }
              return (component?.ref as { onKeyDown: (e: KeyboardEvent) => boolean } | null)?.onKeyDown(props.event) ?? false
            },
            onExit() {
              popup[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

// Type ":" then two letters to search emoji inline, like Confluence.
const EmojiShortcut = Extension.create({
  name: 'emojiShortcut',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: ':',
        pluginKey: new PluginKey('emojiSuggestion'),
        allowSpaces: false,
        items: ({ query }) => {
          if (query.length < 2) return []
          const q = query.toLowerCase()
          return ALL_EMOJI.filter((e) => e.name.includes(q)).slice(0, 8)
        },
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).insertContent((props as EmojiItem).ch + ' ').run()
        },
        render: () => {
          let component: ReactRenderer | null = null
          let popup: Instance[] = []
          return {
            onStart(props) {
              component = new ReactRenderer(EmojiList, { props, editor: props.editor })
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate(props) {
              component?.updateProps(props)
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect as () => DOMRect })
            },
            onKeyDown(props) {
              if (props.event.key === 'Escape') {
                popup[0]?.hide()
                return true
              }
              return (component?.ref as { onKeyDown: (e: KeyboardEvent) => boolean } | null)?.onKeyDown(props.event) ?? false
            },
            onExit() {
              popup[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        pluginKey: new PluginKey('slashSuggestion'),
        char: '/',
        allowSpaces: true,
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: SlashItem }) => props.run(editor, range),
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase()
          return SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(q) || t(i.label).toLowerCase().includes(q)).slice(0, 10)
        },
        render: () => {
          let component: ReactRenderer<{ onKeyDown: (e: KeyboardEvent) => boolean }> | null = null
          let popup: Instance[] = []
          return {
            onStart: (props: any) => {
              component = new ReactRenderer(SlashList, { props, editor: props.editor })
              popup = tippy('body', {
                getReferenceClientRect: props.clientRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: 'manual',
                placement: 'bottom-start',
              })
            },
            onUpdate: (props: any) => {
              component?.updateProps(props)
              popup[0]?.setProps({ getReferenceClientRect: props.clientRect })
            },
            onKeyDown: (props: any) => {
              if (props.event.key === 'Escape') {
                popup[0]?.hide()
                return true
              }
              return component?.ref?.onKeyDown(props.event) ?? false
            },
            onExit: () => {
              popup[0]?.destroy()
              component?.destroy()
            },
          }
        },
      }),
    ]
  },
})

// ---- mention picker (Jira-style user popup) ----

interface MentionListProps {
  items: User[]
  command: (item: { id: string; label: string }) => void
}

const MentionList = forwardRef<{ onKeyDown: (e: KeyboardEvent) => boolean }, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [index, setIndex] = useState(0)
    useEffect(() => setIndex(0), [items])
    const select = (i: number) => {
      const u = items[i]
      if (u) command({ id: u.id, label: u.displayName })
    }
    useImperativeHandle(ref, () => ({
      onKeyDown(e: KeyboardEvent) {
        if (e.key === 'ArrowDown') {
          setIndex((i) => (i + 1) % Math.max(items.length, 1))
          return true
        }
        if (e.key === 'ArrowUp') {
          setIndex((i) => (i - 1 + items.length) % Math.max(items.length, 1))
          return true
        }
        if (e.key === 'Enter') {
          select(index)
          return true
        }
        return false
      },
    }))
    return (
      <div
        style={{
          background: token('elevation.surface.overlay', '#FFFFFF'),
          borderRadius: 6,
          boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
          border: `1px solid ${token('color.border', '#DFE1E6')}`,
          padding: 4,
          minWidth: 220,
        }}
      >
        {items.length === 0 && (
          <div style={{ padding: '6px 10px', fontSize: 13, color: token('color.text.subtlest', '#626F86') }}>{t('No people found')}</div>
        )}
        {items.map((u, i) => (
          <button
            key={u.id}
            type="button"
            onClick={() => select(i)}
            onMouseEnter={() => setIndex(i)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
              border: 'none', borderRadius: 4, textAlign: 'left', fontSize: 14, cursor: 'pointer', color: 'inherit',
              background: i === index ? token('color.background.selected', '#E9F2FF') : 'transparent',
            }}
          >
            <Avatar size="xsmall" name={u.displayName} src={u.avatarUrl ?? undefined} />
            {u.displayName}
          </button>
        ))}
      </div>
    )
  },
)

const mentionSuggestion = {
  items: async ({ query }: { query: string }) => {
    try {
      const users = await api<User[]>(`/users?query=${encodeURIComponent(query)}`)
      return users.slice(0, 6)
    } catch {
      return []
    }
  },
  render: () => {
    let component: ReactRenderer<{ onKeyDown: (e: KeyboardEvent) => boolean }> | null = null
    let popup: Instance[] = []
    return {
      onStart: (props: any) => {
        component = new ReactRenderer(MentionList, { props, editor: props.editor })
        popup = tippy('body', {
          getReferenceClientRect: props.clientRect,
          appendTo: () => document.body,
          content: component.element,
          showOnCreate: true,
          interactive: true,
          trigger: 'manual',
          placement: 'bottom-start',
        })
      },
      onUpdate: (props: any) => {
        component?.updateProps(props)
        popup[0]?.setProps({ getReferenceClientRect: props.clientRect })
      },
      onKeyDown: (props: any) => {
        if (props.event.key === 'Escape') {
          popup[0]?.hide()
          return true
        }
        return component?.ref?.onKeyDown(props.event) ?? false
      },
      onExit: () => {
        popup[0]?.destroy()
        component?.destroy()
      },
    }
  },
}

// ---- shared content styles (edit + read views) ----

export function RichTextStyles() {
  return (
    <style>{`
      .th-richtext { font-size: 14px; line-height: 1.5; }
      .th-richtext p { margin: 0 0 8px; }
      .th-richtext p:last-child { margin-bottom: 0; }
      .th-richtext h1 { font-size: 20px; margin: 12px 0 6px; }
      .th-richtext h2 { font-size: 17px; margin: 12px 0 6px; }
      .th-richtext h3 { font-size: 15px; margin: 10px 0 4px; }
      .th-richtext ul, .th-richtext ol { padding-left: 22px; margin: 0 0 8px; }
      .th-richtext blockquote { border-left: 3px solid ${token('color.border', '#DFE1E6')}; margin: 0 0 8px; padding: 2px 12px; color: ${token('color.text.subtle', '#44546F')}; }
      .th-richtext code { background: ${token('color.background.neutral', '#F1F2F4')}; border-radius: 3px; padding: 1px 4px; font-size: 12px; }
      .th-richtext pre { background: ${token('color.background.neutral', '#F1F2F4')}; border-radius: 6px; padding: 10px 12px; margin: 0 0 8px; overflow-x: auto; }
      .th-richtext pre code { background: none; padding: 0; }
      .th-richtext a { color: ${token('color.link', '#0C66E4')}; }
      .th-richtext .th-mention { background: ${token('color.background.selected', '#E9F2FF')}; color: ${token('color.text.selected', '#0C66E4')}; border-radius: 10px; padding: 1px 6px; font-weight: 500; white-space: nowrap; }
      .th-richtext .ProseMirror { outline: none; min-height: 80px; padding: 10px 12px; }
      .th-issue-chip a, .th-issue-chip, .th-page-chip a, .th-page-chip { text-decoration: none; }
      .th-richtext a.th-issue-chip, .th-richtext .th-issue-chip > a, .th-richtext a.th-page-chip, .th-richtext .th-page-chip > a {
        display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: 4px;
        border: 1px solid ${token('color.border', '#DFE1E6')}; background: ${token('elevation.surface.raised', '#FFFFFF')};
        color: ${token('color.link', '#0C66E4')}; font-size: 13px; line-height: 20px; white-space: nowrap;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;
      }
      .th-chip-status { font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 0 4px; border-radius: 3px; }
      .th-chip-todo { background: ${token('color.background.neutral', '#F1F2F4')}; color: ${token('color.text.subtle', '#44546F')}; }
      .th-chip-in_progress { background: ${token('color.background.information', '#E9F2FF')}; color: ${token('color.text.information', '#0055CC')}; }
      .th-chip-done { background: ${token('color.background.success', '#DCFFF1')}; color: ${token('color.text.success', '#216E4E')}; }
      .th-tql-embed, .th-tql-embed-editor { border: 1px solid ${token('color.border', '#DFE1E6')}; border-radius: 6px; padding: 10px 12px; margin: 8px 0; }
      mark.th-inline-hl { background: ${token('color.background.accent.yellow.subtlest', '#FFF7D6')}; border-bottom: 2px solid ${token('color.background.accent.yellow.subtle', '#F5CD47')}; cursor: pointer; color: inherit; }
      mark.th-inline-hl:hover { background: ${token('color.background.accent.yellow.subtler', '#F8E6A0')}; }
      .th-layout { display: flex; gap: 16px; margin: 8px 0; }
      .th-layout-col { flex: 1 1 0; min-width: 0; }
      .ProseMirror .th-layout-col { border: 1px dashed ${token('color.border', '#DFE1E6')}; border-radius: 4px; padding: 8px; }
      .th-expand { border: 1px solid ${token('color.border', '#DFE1E6')}; border-radius: 6px; margin: 8px 0; }
      .th-expand-summary { cursor: pointer; padding: 8px 12px; font-weight: 600; font-size: 14px; }
      .th-expand-body { padding: 4px 12px 8px; }
      .th-expand-head { display: flex; align-items: center; gap: 6px; padding: 8px 12px 0; }
      .th-expand-chevron { color: ${token('color.text.subtlest', '#626F86')}; }
      .th-expand-head input { border: none; outline: none; background: transparent; font-weight: 600; font-size: 14px; color: inherit; width: 100%; font-family: inherit; }
      .th-drag-handle { position: absolute; width: 18px; height: 22px; display: flex; align-items: center; justify-content: center;
        cursor: grab; color: ${token('color.text.subtlest', '#626F86')}; border-radius: 4px; z-index: 50; font-size: 13px; letter-spacing: -1px; user-select: none; }
      .th-drag-handle:hover { background: ${token('color.background.neutral.subtle.hovered', '#F1F2F4')}; }
      .th-wb-embed { border: 1px solid ${token('color.border', '#DFE1E6')}; border-radius: 8px; margin: 8px 0; overflow: hidden; }
      .th-wb-embed-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; font-size: 12px; font-weight: 600; border-bottom: 1px solid ${token('color.border', '#DFE1E6')}; background: ${token('color.background.neutral.subtle', '#F7F8F9')}; }
      .th-wb-embed-body { padding: 8px; text-align: center; min-height: 60px; color: ${token('color.text.subtlest', '#626F86')}; font-size: 13px; }
      .th-wb-embed-body svg { display: inline-block; }
      .th-tql-head { font-size: 12px; font-weight: 700; margin-bottom: 6px; color: ${token('color.text.subtlest', '#626F86')}; }
      .th-tql-row { display: flex; gap: 8px; align-items: center; font-size: 13px; padding: 3px 0; }
      .th-tql-row > span:nth-child(2) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .th-status { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; line-height: 1.6; vertical-align: middle; }
.th-status-neutral { background: #DCDFE4; color: #44546F; }
.th-status-blue { background: #CCE0FF; color: #0055CC; }
.th-status-green { background: #DCFFF1; color: #216E4E; }
.th-status-yellow { background: #F8E6A0; color: #7F5F01; }
.th-status-red { background: #FFD5D2; color: #AE2E24; }
.th-status-purple { background: #DFD8FD; color: #5E4DB2; }
.th-date-chip { display: inline-block; padding: 1px 8px; border-radius: 12px; font-size: 13px; background: var(--th-chip-bg, rgba(9,30,66,0.06)); white-space: nowrap; }
.th-decisions { margin: 8px 0; display: flex; flex-direction: column; gap: 6px; }
.th-decision { display: flex; gap: 10px; align-items: flex-start; padding: 8px 12px; border-radius: 6px; background: rgba(34,160,107,0.08); border-left: 3px solid #22A06B; }
.th-decision-marker { color: #22A06B; font-size: 13px; line-height: 1.9; user-select: none; }
.th-decision-body { flex: 1; min-width: 0; }
.th-decision-body p { margin: 0; }
.th-panel { display: flex; gap: 10px; padding: 12px 14px; border-radius: 6px; margin: 8px 0; }
      .th-panel-emoji { flex-shrink: 0; font-size: 16px; line-height: 24px; user-select: none; }
      .th-panel-body { flex: 1; min-width: 0; }
      .th-panel-body > p:first-child { margin-top: 0; }
      .th-panel-body > p:last-child { margin-bottom: 0; }
      .th-panel-info { background: ${token('color.background.information', '#E9F2FF')}; }
      .th-panel-note { background: ${token('color.background.discovery', '#F3F0FF')}; }
      .th-panel-success { background: ${token('color.background.success', '#DCFFF1')}; }
      .th-panel-warning { background: ${token('color.background.warning', '#FFF7D6')}; }
      .th-panel-error { background: ${token('color.background.danger', '#FFECEB')}; }
      .th-image-wrap { position: relative; display: inline-block; max-width: 100%; }
      .th-image-selected .th-image { outline: 2px solid ${token('color.border.selected', '#0C66E4')}; border-radius: 2px; }
      .th-image-handle { position: absolute; top: 50%; transform: translateY(-50%); width: 8px; height: 56px; max-height: 70%; border-radius: 4px; background: ${token('color.border.selected', '#0C66E4')}; cursor: ew-resize; z-index: 5; }
      .th-richtext ul.th-tasklist { list-style: none; padding-inline-start: 6px; }
      .th-richtext ul.th-tasklist li { display: flex; gap: 8px; align-items: flex-start; margin: 2px 0; }
      .th-richtext ul.th-tasklist li > label { margin-top: 3px; }
      .th-richtext ul.th-tasklist li > div { flex: 1; min-width: 0; }
      .th-richtext ul.th-tasklist li[data-checked="true"] > div { color: ${token('color.text.subtlest', '#626F86')}; text-decoration: line-through; }
      .th-richtext-view input[type="checkbox"] { pointer-events: none; }
      .th-richtext .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: ${token('color.text.subtlest', '#626F86')}; float: left; height: 0; pointer-events: none; }
      .th-richtext table.th-table { border-collapse: collapse; margin: 0 0 12px; width: 100%; table-layout: fixed; }
      .th-richtext table.th-table td, .th-richtext table.th-table th { border: 1px solid ${token('color.border', '#DFE1E6')}; padding: 6px 10px; vertical-align: top; min-width: 48px; position: relative; }
      .th-richtext table.th-table th { background: ${token('color.background.neutral', '#F1F2F4')}; font-weight: 600; text-align: start; }
      .th-richtext table.th-table p { margin: 0; }
      .th-richtext .selectedCell::after { content: ''; position: absolute; inset: 0; background: ${token('color.background.selected', '#E9F2FF')}; opacity: 0.45; pointer-events: none; }
      .th-richtext img.th-image { max-width: 100%; height: auto; border-radius: 4px; display: block; margin: 4px 0 12px; }
      .th-richtext img.ProseMirror-selectednode { outline: 2px solid ${token('color.border.selected', '#0C66E4')}; }
      .th-richtext hr { border: none; border-top: 2px solid ${token('color.border', '#DFE1E6')}; margin: 16px 0; }
    `}</style>
  )
}

// ---- read-only renderer ----

export function RichTextView({ doc, fallback }: { doc?: unknown; fallback: string }) {
  const html = useMemo(() => {
    if (doc && typeof doc === 'object') {
      try {
        return generateHTML(doc as JSONContent, extensions())
      } catch {
        return null
      }
    }
    return null
  }, [doc])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) hydrateSmartBlocks(ref.current)
  }, [html])
  if (html) {
    return <div ref={ref} className="th-richtext th-richtext-view" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <div className="th-richtext th-richtext-view" style={{ whiteSpace: 'pre-wrap' }}>{fallback}</div>
}

// hydrateSmartBlocks makes chips and TQL embeds live inside statically
// rendered documents (page views, comments): fetch and fill in place.
function esc(t2: string): string {
  const d = document.createElement('span')
  d.textContent = t2
  return d.innerHTML
}

export function hydrateSmartBlocks(container: HTMLElement) {
  container.querySelectorAll<HTMLAnchorElement>('a.th-issue-chip[data-issue-key]').forEach((el) => {
    if (el.dataset.hydrated) return
    el.dataset.hydrated = '1'
    const key = el.dataset.issueKey ?? ''
    api<{ key: string; summary: string; status: { name: string; category: string } }>(`/issues/${key}`)
      .then((i) => {
        el.innerHTML = `<b>${esc(i.key)}</b> ${esc(i.summary)} <span class="th-chip-status th-chip-${esc(i.status.category)}">${esc(i.status.name)}</span>`
      })
      .catch(() => {
        el.innerHTML = `<b>${esc(key)}</b> ${esc(t('(not found)'))}`
      })
  })
  container.querySelectorAll<HTMLDivElement>('div.th-wb-embed[data-wb-page]').forEach((el) => {
    if (el.dataset.hydrated) return
    el.dataset.hydrated = '1'
    const pageId = el.dataset.wbPage ?? ''
    const spaceKey = el.dataset.wbSpace ?? ''
    const title = el.dataset.wbTitle || t('Whiteboard')
    el.innerHTML = `<div class="th-wb-embed-head"><span>${esc(title)}</span><span style="display:inline-flex;gap:10px"><a href="#interactive" class="th-wb-live">${esc(t('Interactive'))}</a><a href="/wiki/spaces/${esc(spaceKey)}/pages/${esc(pageId)}">${esc(t('Open'))}</a></span></div><div class="th-wb-embed-body"></div>`
    const body = el.querySelector<HTMLElement>('.th-wb-embed-body')
    if (body) {
      void renderWhiteboardPreview(body, pageId)
      el.querySelector<HTMLAnchorElement>('.th-wb-live')?.addEventListener('click', (ev) => {
        ev.preventDefault()
        void mountInteractiveWhiteboard(body, pageId)
      })
    }
  })
  container.querySelectorAll<HTMLDivElement>('div.th-tql-embed[data-tql]').forEach((el) => {
    if (el.dataset.hydrated) return
    el.dataset.hydrated = '1'
    const tql = el.dataset.tql ?? ''
    if (!tql.trim()) {
      el.textContent = t('No matching work items.')
      return
    }
    api<{ values: { key: string; summary: string; status: { name: string; category: string } }[]; total: number }>(
      `/search?tql=${encodeURIComponent(tql)}&maxResults=10`,
    )
      .then((r) => {
        const rows = r.values
          .map(
            (i) =>
              `<div class="th-tql-row"><a href="/browse/${esc(i.key)}"><b>${esc(i.key)}</b></a><span>${esc(i.summary)}</span><span class="th-chip-status th-chip-${esc(i.status.category)}">${esc(i.status.name)}</span></div>`,
          )
          .join('')
        el.innerHTML =
          `<div class="th-tql-head">${esc(t('Work items (TQL)'))} · ${r.total}</div>` +
          (rows || `<div class="th-tql-row">${esc(t('No matching work items.'))}</div>`)
      })
      .catch(() => {
        el.textContent = t('Invalid TQL')
      })
  })
}

// Layout preset / column controls, shown while the cursor is in a layout.
function LayoutControls({ editor }: { editor: Editor }) {
  const withSection = (fn: (args: { tr: import('@tiptap/pm/state').Transaction; pos: number; node: import('@tiptap/pm/model').Node }) => boolean) =>
    editor.commands.command(({ tr, state }) => {
      const { $from } = state.selection
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'layoutSection') {
          return fn({ tr, pos: $from.before(d), node: $from.node(d) })
        }
      }
      return false
    })

  const setWidths = (widths: number[]) =>
    withSection(({ tr, pos, node }) => {
      if (node.childCount !== widths.length) return false
      let offset = pos + 1
      node.forEach((col, colOffset, i) => {
        tr.setNodeMarkup(offset + colOffset, undefined, { ...col.attrs, width: widths[i] })
      })
      return true
    })

  const addColumn = () =>
    withSection(({ tr, pos, node }) => {
      if (node.childCount >= 3) return false
      const colType = editor.schema.nodes.layoutColumn
      const para = editor.schema.nodes.paragraph.create()
      tr.insert(pos + node.nodeSize - 1, colType.create(null, para))
      return true
    })

  const removeColumn = () =>
    withSection(({ tr, pos, node }) => {
      if (node.childCount <= 2) return false
      const last = node.child(node.childCount - 1)
      let lastStart = pos + 1
      for (let i = 0; i < node.childCount - 1; i++) lastStart += node.child(i).nodeSize
      const prevEnd = lastStart - 1
      tr.delete(lastStart, lastStart + last.nodeSize)
      tr.insert(prevEnd, last.content)
      return true
    })

  const unwrap = () =>
    withSection(({ tr, pos, node }) => {
      const blocks: import('@tiptap/pm/model').Node[] = []
      node.forEach((col) => col.forEach((b) => blocks.push(b)))
      tr.replaceWith(pos, pos + node.nodeSize, blocks)
      return true
    })

  const count = (() => {
    const { $from } = editor.state.selection
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'layoutSection') return $from.node(d).childCount
    }
    return 2
  })()

  return (
    <div
      style={{
        display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', padding: '3px 6px',
        borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
        background: token('color.background.neutral.subtle', '#F7F8F9'),
        fontSize: 12,
      }}
    >
      <ToolbarButton editor={editor} label={t('Equal widths')} onClick={() => setWidths(count === 3 ? [33.33, 33.33, 33.33] : [50, 50])}>{count === 3 ? '⅓ ⅓ ⅓' : '½ ½'}</ToolbarButton>
      {count === 2 && (
        <>
          <ToolbarButton editor={editor} label={t('Wide start')} onClick={() => setWidths([66.66, 33.33])}>⅔ ⅓</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Wide end')} onClick={() => setWidths([33.33, 66.66])}>⅓ ⅔</ToolbarButton>
        </>
      )}
      <span style={{ width: 1, height: 18, background: token('color.border', '#DFE1E6'), margin: '0 4px' }} />
      <ToolbarButton editor={editor} label={t('Add column')} onClick={addColumn}>+ {t('Column')}</ToolbarButton>
      <ToolbarButton editor={editor} label={t('Remove column')} onClick={removeColumn}>− {t('Column')}</ToolbarButton>
      <ToolbarButton editor={editor} label={t('Remove layout')} onClick={unwrap}>✕ {t('Layout')}</ToolbarButton>
    </div>
  )
}

// ---- toolbar + editor ----

function ToolbarButton({ editor, active, label, onClick, children }: { editor: Editor; active?: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  void editor
  return (
    <button
      type="button"
      title={label}
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      style={{
        minWidth: 28, height: 26, padding: '0 6px', border: 'none', borderRadius: 4, cursor: 'pointer',
        fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: active ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: active ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
      }}
    >
      {children}
    </button>
  )
}

// Confluence's text color palette.
const TEXT_COLORS: { label: string; value: string | null }[] = [
  { label: 'Default', value: null },
  { label: 'Gray', value: '#626F86' },
  { label: 'Purple', value: '#964AC0' },
  { label: 'Blue', value: '#1868DB' },
  { label: 'Teal', value: '#227D9B' },
  { label: 'Green', value: '#22A06B' },
  { label: 'Orange', value: '#E56910' },
  { label: 'Red', value: '#C9372C' },
]

function EmojiToolbarButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <ToolbarButton editor={editor} label={t('Emoji')} active={open} onClick={() => setOpen(!open)}><EmojiIcon label="" /></ToolbarButton>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <span style={{ position: 'absolute', top: 28, insetInlineStart: 0, zIndex: 401 }}>
            <EmojiPicker
              onPick={(ch) => {
                editor.chain().focus().insertContent(ch + ' ').run()
                setOpen(false)
              }}
            />
          </span>
        </>
      )}
    </span>
  )
}

// Confluence's emoji browser: category tabs, search, grid.
export function EmojiPicker({ onPick }: { onPick: (ch: string) => void }) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const groups = q
    ? [{ group: t('Search results'), items: ALL_EMOJI.filter((e) => e.name.includes(q)) }]
    : EMOJI_GROUPS
  return (
    <div
      style={{
        width: 320, maxHeight: 340, overflowY: 'auto',
        background: token('elevation.surface.overlay', '#FFFFFF'),
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
        padding: 8,
      }}
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('Search…')}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: 6, padding: '6px 8px', fontSize: 13,
          border: `1px solid ${token('color.border.input', '#8590A2')}`, borderRadius: 4,
          background: token('elevation.surface', '#FFFFFF'), color: 'inherit', outline: 'none',
        }}
      />
      {groups.map((g) => (
        <div key={g.group}>
          <div style={{ fontSize: 12, fontWeight: 700, padding: '6px 2px 2px', color: token('color.text.subtlest', '#626F86') }}>
            {t(g.group)}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            {g.items.map((e) => (
              <button
                key={e.name}
                type="button"
                title={`:${e.name}:`}
                onMouseDown={(ev) => {
                  ev.preventDefault()
                  onPick(e.ch)
                }}
                style={{ width: 32, height: 32, fontSize: 20, border: 'none', background: 'transparent', cursor: 'pointer', borderRadius: 4 }}
              >
                {e.ch}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// A compact toolbar dropdown, like Confluence's text-style / insert menus.
function ToolbarMenu({
  label,
  items,
  compact,
  width = 220,
}: {
  label: React.ReactNode
  items: { label: string; active?: boolean; color?: string; onClick: () => void }[]
  compact?: boolean
  width?: number
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        onMouseDown={(e) => {
          e.preventDefault()
          setOpen(!open)
        }}
        style={{
          height: 26, padding: compact ? '0 4px' : '0 8px', border: 'none', borderRadius: 4, cursor: 'pointer',
          fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4,
          background: open ? token('color.background.selected', '#E9F2FF') : 'transparent',
          color: token('color.text.subtle', '#44546F'),
        }}
      >
        {label}
        {!compact && <ChevronDownIcon label="" />}
      </button>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <span
            style={{
              position: 'absolute', top: 28, insetInlineStart: 0, zIndex: 401, width,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
              padding: 4, display: 'flex', flexDirection: 'column',
            }}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  item.onClick()
                  setOpen(false)
                }}
                style={{
                  border: 'none', borderRadius: 4, padding: '6px 10px', textAlign: 'start', cursor: 'pointer',
                  fontSize: 14, whiteSpace: 'pre',
                  background: item.active ? token('color.background.selected', '#E9F2FF') : 'transparent',
                  color: item.color ?? (item.active ? token('color.text.selected', '#0C66E4') : 'inherit'),
                }}
              >
                {item.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  )
}

export function RichTextEditor({
  initialDoc,
  initialText,
  placeholder,
  autoFocus,
  onChange,
  chromeless,
  canvasHeader,
}: {
  initialDoc?: unknown
  initialText?: string
  placeholder?: string
  autoFocus?: boolean
  onChange: (doc: JSONContent, text: string) => void
  // Confluence's full-page editor: borderless canvas, full-width sticky
  // toolbar, content centered in a reading-width column.
  chromeless?: boolean
  canvasHeader?: React.ReactNode
}) {
  const content = useMemo<JSONContent | string>(() => {
    if (initialDoc && typeof initialDoc === 'object') return initialDoc as JSONContent
    // Seed legacy plain text as paragraphs.
    const text = initialText ?? ''
    return {
      type: 'doc',
      content: text
        ? text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
        : [{ type: 'paragraph' }],
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const editorHolder = useRef<Editor | null>(null)
  const editor = useEditor({
    extensions: extensions(placeholder),
    content,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      handlePaste(_view, event) {
        const files = event.clipboardData?.files
        if (files?.length && editorHolder.current && insertImageFiles(editorHolder.current, files)) {
          event.preventDefault()
          return true
        }
        // Pasted TaskHat/DocHat links become smart chips, like Confluence.
        const text = event.clipboardData?.getData('text/plain')?.trim() ?? ''
        const ed = editorHolder.current
        if (ed && text.startsWith(window.location.origin)) {
          const issueMatch = text.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)$/)
          if (issueMatch) {
            ed.chain().focus().insertContent([{ type: 'issueChip', attrs: { key: issueMatch[1] } }, { type: 'text', text: ' ' }]).run()
            event.preventDefault()
            return true
          }
          const pageMatch = text.match(/\/wiki\/spaces\/([A-Z0-9]+)\/pages\/([0-9a-f-]{36})/)
          if (pageMatch) {
            const [, spaceKey, pageId] = pageMatch
            // Whiteboards embed as a board preview; pages become a chip.
            api<{ kind: string; title: string }>(`/wiki/pages/${pageId}`)
              .then((p) => {
                const cur = editorHolder.current
                if (!cur) return
                if (p.kind === 'whiteboard') {
                  cur.chain().focus().insertContent([{ type: 'whiteboardEmbed', attrs: { spaceKey, pageId, title: p.title } }]).run()
                } else {
                  cur.chain().focus().insertContent([{ type: 'pageChip', attrs: { spaceKey, pageId } }, { type: 'text', text: ' ' }]).run()
                }
              })
              .catch(() => {
                editorHolder.current?.chain().focus().insertContent([{ type: 'pageChip', attrs: { spaceKey, pageId } }, { type: 'text', text: ' ' }]).run()
              })
            event.preventDefault()
            return true
          }
        }
        return false
      },
      handleDrop(_view, event) {
        const files = event.dataTransfer?.files
        if (files?.length && editorHolder.current && insertImageFiles(editorHolder.current, files)) {
          event.preventDefault()
          return true
        }
        return false
      },
    },
    onUpdate({ editor }) {
      onChange(editor.getJSON(), editor.getText({ blockSeparator: '\n' }))
    },
  })
  editorHolder.current = editor

  useEffect(() => () => editor?.destroy(), [editor])
  if (!editor) return null

  const [browseOpen, setBrowseOpen] = useState(false)

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt(t('Link URL'), prev ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  return (
    <div
      className="th-richtext"
      style={
        chromeless
          ? { background: token('elevation.surface', '#FFFFFF') }
          : {
              border: `2px solid ${token('color.border.input', '#8590A2')}`,
              borderRadius: 4,
              background: token('elevation.surface', '#FFFFFF'),
            }
      }
    >
      <div
        style={{
          display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center',
          borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
          ...(chromeless
            ? {
                padding: '6px 16px',
                position: 'sticky', top: 0, zIndex: 60,
                background: token('elevation.surface', '#FFFFFF'),
              }
            : { padding: '4px 6px' }),
        }}
      >
        <ToolbarMenu
          label={
            editor.isActive('heading', { level: 1 }) ? t('Heading 1')
            : editor.isActive('heading', { level: 2 }) ? t('Heading 2')
            : editor.isActive('heading', { level: 3 }) ? t('Heading 3')
            : t('Normal text')
          }
          width={170}
          items={[
            { label: t('Normal text'), active: editor.isActive('paragraph'), onClick: () => editor.chain().focus().setParagraph().run() },
            { label: t('Heading 1'), active: editor.isActive('heading', { level: 1 }), onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
            { label: t('Heading 2'), active: editor.isActive('heading', { level: 2 }), onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
            { label: t('Heading 3'), active: editor.isActive('heading', { level: 3 }), onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
          ]}
        />
        <span style={{ width: 1, height: 18, background: token('color.border', '#DFE1E6'), margin: '0 4px' }} />
        <ToolbarButton editor={editor} label={t('Bold')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><TextBoldIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Underline')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><TextUnderlineIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Italic')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><TextItalicIcon label="" /></ToolbarButton>
        <ToolbarMenu
          label={<ChevronDownIcon label="" />}
          compact
          items={[
            { label: t('Strikethrough'), active: editor.isActive('strike'), onClick: () => editor.chain().focus().toggleStrike().run() },
            { label: t('Inline code'), active: editor.isActive('code'), onClick: () => editor.chain().focus().toggleCode().run() },
          ]}
        />
        <ToolbarMenu
          label={<AlignTextLeftIcon label="" />}
          compact
          width={160}
          items={[
            { label: t('Align start'), active: editor.isActive({ textAlign: 'left' }), onClick: () => editor.chain().focus().setTextAlign('left').run() },
            { label: t('Align center'), active: editor.isActive({ textAlign: 'center' }), onClick: () => editor.chain().focus().setTextAlign('center').run() },
            { label: t('Align end'), active: editor.isActive({ textAlign: 'right' }), onClick: () => editor.chain().focus().setTextAlign('right').run() },
          ]}
        />
        <ToolbarMenu
          label={<TextStyleIcon label="" />}
          compact
          width={170}
          items={TEXT_COLORS.map((c) => ({
            label: c.value ? `● ${t(c.label)}` : t(c.label),
            active: c.value ? editor.isActive('textStyle', { color: c.value }) : false,
            color: c.value || undefined,
            onClick: () => (c.value ? editor.chain().focus().setColor(c.value).run() : editor.chain().focus().unsetColor().run()),
          }))}
        />
        <span style={{ width: 1, height: 18, background: token('color.border', '#DFE1E6'), margin: '0 4px' }} />
        <ToolbarButton editor={editor} label={t('Bullet list')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><ListBulletedIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Numbered list')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListNumberedIcon label="" /></ToolbarButton>
        <span style={{ width: 1, height: 18, background: token('color.border', '#DFE1E6'), margin: '0 4px' }} />
        <ToolbarButton editor={editor} label={t('Action item')} active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecklistIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Insert image')} onClick={() => pickAndInsertImage(editor)}><ImageIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Mention someone (@)')} onClick={() => editor.chain().focus().insertContent('@').run()}><MentionIcon label="" /></ToolbarButton>
        <EmojiToolbarButton editor={editor} />
        <span style={{ width: 1, height: 18, background: token('color.border', '#DFE1E6'), margin: '0 4px' }} />
        <ToolbarButton editor={editor} label={t('Insert table')} active={editor.isActive('table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon label="" /></ToolbarButton>
        <ToolbarMenu
          label={<AddIcon label="" />}
          compact
          width={280}
          items={[
            ...SLASH_ITEMS.slice(0, 10).map((item) => ({
              label: `${item.glyph}  ${t(item.label)}`,
              onClick: () => {
                const pos = editor.state.selection.from
                item.run(editor, { from: pos, to: pos })
              },
            })),
            { label: `…  ${t('View more')}`, onClick: () => setBrowseOpen(true) },
          ]}
        />
        <span style={{ flex: 1 }} />
        <ToolbarButton editor={editor} label={t('Link')} active={editor.isActive('link')} onClick={setLink}><LinkIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Undo')} onClick={() => editor.chain().focus().undo().run()}><UndoIcon label="" /></ToolbarButton>
        <ToolbarButton editor={editor} label={t('Redo')} onClick={() => editor.chain().focus().redo().run()}><RedoIcon label="" /></ToolbarButton>
      </div>
      {browseOpen && <BrowseModal editor={editor} onClose={() => setBrowseOpen(false)} />}
      {editor.isActive('layoutSection') && (
        <LayoutControls editor={editor} />
      )}
      {editor.isActive('table') && (
        <div
          style={{
            display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', padding: '3px 6px',
            borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
            background: token('color.background.neutral.subtle', '#F7F8F9'),
            fontSize: 12,
          }}
        >
          <ToolbarButton editor={editor} label={t('Add row below')} onClick={() => editor.chain().focus().addRowAfter().run()}>+ {t('Row')}</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Add column after')} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ {t('Column')}</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Delete row')} onClick={() => editor.chain().focus().deleteRow().run()}>− {t('Row')}</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Delete column')} onClick={() => editor.chain().focus().deleteColumn().run()}>− {t('Column')}</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Toggle header row')} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>{t('Header')}</ToolbarButton>
          <ToolbarButton editor={editor} label={t('Delete table')} onClick={() => editor.chain().focus().deleteTable().run()}>✕ {t('Table')}</ToolbarButton>
        </div>
      )}
      {chromeless ? (
        <div style={{ maxWidth: 760, margin: '0 auto', width: '100%', padding: '28px 24px 96px', boxSizing: 'content-box' }}>
          {canvasHeader}
          <EditorContent editor={editor} />
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  )
}
