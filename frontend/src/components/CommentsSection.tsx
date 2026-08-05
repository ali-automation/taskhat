import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import { token } from '@atlaskit/tokens'
import { useAddComment, useComments, useDeleteComment, useUpdateComment } from '../api/hooks'
import { RichTextEditor, RichTextView } from './RichText'
import { useAuth } from '../auth/AuthContext'
import type { Comment } from '../api/types'
import { t, timeAgo } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function CommentItem({ comment, issueKey }: { comment: Comment; issueKey: string }) {
  const { user } = useAuth()
  const updateComment = useUpdateComment(issueKey)
  const deleteComment = useDeleteComment(issueKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ doc: unknown; text: string }>({ doc: comment.bodyDoc, text: comment.body })
  const mine = user?.id === comment.author.id

  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Avatar size="medium" name={comment.author.displayName} src={comment.author.avatarUrl ?? undefined} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>
          <Link to={`/people/${comment.author.id}`} style={{ fontWeight: 600, color: 'inherit', textDecoration: 'none' }}>
            {comment.author.displayName}
          </Link>{' '}
          <span style={subtleText}>
            {timeAgo(comment.createdAt)}
            {comment.editedAt && t(' · Edited')}
          </span>
        </div>
        {editing ? (
          <div style={{ marginTop: 4 }}>
            <RichTextEditor
              initialDoc={comment.bodyDoc}
              initialText={comment.body}
              autoFocus
              onChange={(doc, text) => setDraft({ doc, text })}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <Button
                appearance="primary"
                spacing="compact"
                isLoading={updateComment.isPending}
                onClick={async () => {
                  if (draft.text.trim()) {
                    await updateComment.mutateAsync({ id: comment.id, bodyDoc: draft.doc })
                    setEditing(false)
                  }
                }}
              >
                {t('Save')}
              </Button>
              <Button appearance="subtle" spacing="compact" onClick={() => setEditing(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14, marginTop: 2, wordBreak: 'break-word' }}>
              <RichTextView doc={comment.bodyDoc} fallback={comment.body} />
            </div>
            {mine && (
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button type="button" style={linkButton} onClick={() => { setDraft({ doc: comment.bodyDoc, text: comment.body }); setEditing(true) }}>
                  {t('Edit')}
                </button>
                <button
                  type="button"
                  style={linkButton}
                  onClick={() => {
                    if (confirm(t('Delete this comment?'))) deleteComment.mutate(comment.id)
                  }}
                >
                  {t('Delete')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: 12,
  cursor: 'pointer',
  color: '#626F86',
}

export default function CommentsSection({ issueKey }: { issueKey: string }) {
  const { user } = useAuth()
  const { data } = useComments(issueKey)
  const addComment = useAddComment(issueKey)
  const [draft, setDraft] = useState<{ doc: unknown; text: string } | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [open, setOpen] = useState(false)

  const comments = data?.values ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Avatar size="medium" name={user?.displayName} src={user?.avatarUrl ?? undefined} />
        <div style={{ flex: 1, minWidth: 0 }}>
          {!open ? (
            <button
              type="button"
              onClick={() => setOpen(true)}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 12px', fontSize: 14,
                border: `2px solid ${token('color.border.input', '#8590A2')}`, borderRadius: 4,
                background: 'none', cursor: 'text', color: token('color.text.subtlest', '#626F86'),
              }}
            >
              {t('Add a comment… (type @ to mention someone)')}
            </button>
          ) : (
            <>
              <RichTextEditor
                key={editorKey}
                placeholder={t('Add a comment… (type @ to mention someone)')}
                autoFocus
                onChange={(doc, text) => setDraft({ doc, text })}
              />
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                <Button
                  appearance="primary"
                  spacing="compact"
                  isLoading={addComment.isPending}
                  onClick={async () => {
                    if (draft?.text.trim()) {
                      await addComment.mutateAsync({ bodyDoc: draft.doc })
                      setDraft(null)
                      setEditorKey((k) => k + 1)
                      setOpen(false)
                    }
                  }}
                >
                  {t('Save')}
                </Button>
                <Button appearance="subtle" spacing="compact" onClick={() => { setDraft(null); setOpen(false) }}>
                  {t('Cancel')}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      {[...comments].reverse().map((c) => (
        <CommentItem key={c.id} comment={c} issueKey={issueKey} />
      ))}
    </div>
  )
}
