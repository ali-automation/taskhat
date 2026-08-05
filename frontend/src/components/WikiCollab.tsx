import { useRef, useState } from 'react'
import { ReactionBar } from './WikiReactions'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import { token } from '@atlaskit/tokens'
import {
  useAddWikiComment, useDeleteWikiAttachment, useDeleteWikiComment, useUpdateWikiComment,
  useUploadWikiAttachment, useWikiAttachments, useWikiComments,
} from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { apiBlob } from '../api/client'
import { t, timeAgo } from '../i18n'
import { RichTextEditor, RichTextView } from './RichText'
import { AttachmentIcon } from './coreIcons'
import type { Comment } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function CommentRow({ comment, pageId }: { comment: Comment; pageId: string }) {
  const { user, isAdmin } = useAuth()
  const update = useUpdateWikiComment(pageId)
  const del = useDeleteWikiComment(pageId)
  const [editing, setEditing] = useState(false)
  const doc = useRef<unknown>(comment.bodyDoc)
  const text = useRef(comment.body)
  const mine = comment.author.id === user?.id

  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
      <Avatar size="small" name={comment.author.displayName} src={comment.author.avatarUrl ?? undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, marginBottom: 2 }}>
          <strong>{comment.author.displayName}</strong>{' '}
          <span style={subtleText}>
            {timeAgo(comment.createdAt)}
            {comment.editedAt && <> · {t('Edited')}</>}
          </span>
        </div>
        {editing ? (
          <>
            <RichTextEditor
              initialDoc={comment.bodyDoc ?? undefined}
              initialText={comment.body}
              autoFocus
              onChange={(d, txt) => {
                doc.current = d
                text.current = txt
              }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Button
                appearance="primary"
                spacing="compact"
                isLoading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: comment.id, body: text.current, bodyDoc: doc.current },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                {t('Save')}
              </Button>
              <Button appearance="subtle" spacing="compact" onClick={() => setEditing(false)}>{t('Cancel')}</Button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 14 }}>
              <RichTextView doc={comment.bodyDoc ?? undefined} fallback={comment.body} />
            </div>
            <ReactionBar pageId={pageId} commentId={comment.id} compact />
            {(mine || isAdmin) && (
              <div style={{ display: 'flex', gap: 10, marginTop: 2, fontSize: 12 }}>
                {mine && (
                  <span style={{ cursor: 'pointer', ...subtleText }} onClick={() => setEditing(true)}>{t('Edit')}</span>
                )}
                <span
                  style={{ cursor: 'pointer', ...subtleText }}
                  onClick={() => {
                    if (window.confirm(t('Delete this comment?'))) del.mutate(comment.id)
                  }}
                >
                  {t('Delete')}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// The signed-in user's avatar beside the comment box, like Confluence.
function ComposerAvatar() {
  const { user } = useAuth()
  return <Avatar size="medium" name={user?.displayName ?? ''} src={user?.avatarUrl ?? undefined} />
}

// Confluence's footer comment thread.
export function WikiCommentsSection({ pageId, readOnly }: { pageId: string; readOnly?: boolean }) {
  const { data: allComments } = useWikiComments(pageId)
  // Inline threads live on the page highlights; the footer keeps page comments.
  const comments = (allComments ?? []).filter((c) => !c.inlineText && !c.parentId)
  const add = useAddWikiComment(pageId)
  const [composing, setComposing] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const doc = useRef<unknown>(null)
  const text = useRef('')

  return (
    <div style={{ marginTop: 40, borderTop: `1px solid ${token('color.border', '#DFE1E6')}`, paddingTop: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
        {t('Comments')} {comments.length > 0 && <span style={subtleText}>({comments.length})</span>}
      </div>
      {comments.map((c) => (
        <CommentRow key={c.id} comment={c} pageId={pageId} />
      ))}
      {readOnly ? null : composing ? (
        <>
          <RichTextEditor
            key={editorKey}
            placeholder={t('Add a comment… (type @ to mention someone)')}
            autoFocus
            onChange={(d, txt) => {
              doc.current = d
              text.current = txt
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <Button
              appearance="primary"
              spacing="compact"
              isLoading={add.isPending}
              onClick={() =>
                add.mutate(
                  { body: text.current, bodyDoc: doc.current },
                  {
                    onSuccess: () => {
                      setComposing(false)
                      setEditorKey((k) => k + 1)
                      doc.current = null
                      text.current = ''
                    },
                  },
                )
              }
            >
              {t('Save')}
            </Button>
            <Button appearance="subtle" spacing="compact" onClick={() => setComposing(false)}>{t('Cancel')}</Button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ComposerAvatar />
          <div
            onClick={() => setComposing(true)}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6, cursor: 'text', fontSize: 14,
              border: `1px solid ${token('color.border.input', '#8590A2')}`, ...subtleText,
            }}
          >
            {t('Add a comment…')}
          </div>
        </div>
      )}
    </div>
  )
}

function fmtSize(n: number): string {
  if (n < 1024) return t('{n} B', { n })
  if (n < 1024 * 1024) return t('{n} KB', { n: Math.round(n / 1024) })
  return t('{n} MB', { n: Math.round((n / 1024 / 1024) * 10) / 10 })
}

// Attachments strip; upload via the hidden input (also exposed from the ⋯ menu).
export function WikiAttachmentsSection({ pageId, inputRef }: { pageId: string; inputRef: React.RefObject<HTMLInputElement> }) {
  const { data: atts } = useWikiAttachments(pageId)
  const upload = useUploadWikiAttachment(pageId)
  const del = useDeleteWikiAttachment(pageId)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) upload.mutate(file)
          e.target.value = ''
        }}
      />
      {(atts ?? []).length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {t('Attachments')} <span style={subtleText}>({atts?.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(atts ?? []).map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <AttachmentIcon label="" />
                <span
                  onClick={async () => {
                    const blob = await apiBlob(`/wiki/attachments/${a.id}`)
                    window.open(URL.createObjectURL(blob), '_blank')
                  }}
                  style={{ fontWeight: 500, cursor: 'pointer', color: token('color.link', '#0C66E4') }}
                >
                  {a.filename}
                </span>
                <span style={{ fontSize: 12, ...subtleText }}>
                  {fmtSize(a.sizeBytes)} · {a.uploader?.displayName} · {timeAgo(a.createdAt)}
                </span>
                <span
                  title={t('Delete attachment')}
                  onClick={() => {
                    if (window.confirm(t('Delete {filename}?', { filename: a.filename }))) del.mutate(a.id)
                  }}
                  style={{ cursor: 'pointer', ...subtleText }}
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
