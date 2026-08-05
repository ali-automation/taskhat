import { useRef } from 'react'
import Button from '@atlaskit/button/new'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useAttachments, useAttachmentURL, useDeleteAttachment, useUploadAttachment } from '../api/hooks'
import { AttachmentIcon } from './coreIcons'
import type { Attachment } from '../api/types'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function formatSize(bytes: number): string {
  if (bytes < 1024) return t('{n} B', { n: bytes })
  if (bytes < 1024 * 1024) return t('{n} KB', { n: (bytes / 1024).toFixed(0) })
  return t('{n} MB', { n: (bytes / 1024 / 1024).toFixed(1) })
}

function AttachmentCard({ attachment, issueKey }: { attachment: Attachment; issueKey: string }) {
  const isImage = attachment.mime.startsWith('image/')
  const { data: url } = useAttachmentURL(attachment.id, true)
  const deleteAttachment = useDeleteAttachment(issueKey)

  return (
    <div
      style={{
        width: 150,
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 4,
        overflow: 'hidden',
        position: 'relative',
        background: token('elevation.surface.raised', '#FFFFFF'),
      }}
    >
      <div
        onClick={() => url && window.open(url, '_blank')}
        style={{
          height: 90,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          background: token('elevation.surface.sunken', '#F7F8F9'),
          overflow: 'hidden',
        }}
      >
        {isImage && url ? (
          <img src={url} alt={attachment.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
            {attachment.filename.split('.').pop()?.slice(0, 5) ?? t('file')}
          </span>
        )}
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {attachment.filename}
        </div>
        <div style={{ fontSize: 11, ...subtleText }}>{formatSize(attachment.sizeBytes)}</div>
      </div>
      <button
        type="button"
        title={t('Delete attachment')}
        onClick={() => {
          if (confirm(t('Delete {filename}?', { filename: attachment.filename }))) deleteAttachment.mutate(attachment.id)
        }}
        style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 22,
          height: 22,
          borderRadius: 3,
          border: 'none',
          cursor: 'pointer',
          background: token('elevation.surface.overlay', 'rgba(255,255,255,0.9)'),
          color: '#44546F',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}

export default function AttachmentsSection({ issueKey }: { issueKey: string }) {
  const { data } = useAttachments(issueKey)
  const upload = useUploadAttachment(issueKey)
  const fileInput = useRef<HTMLInputElement>(null)
  const attachments = data?.values ?? []

  const onFiles = async (files: FileList | null) => {
    if (!files) return
    for (const file of Array.from(files)) {
      await upload.mutateAsync(file)
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  if (attachments.length === 0 && !upload.isPending) {
    return (
      <div style={{ marginTop: 16 }}>
        <Button appearance="subtle" spacing="compact" onClick={() => fileInput.current?.click()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><AttachmentIcon label="" /> {t('Attach')}</span>
        </Button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => onFiles(e.currentTarget.files)} />
      </div>
    )
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('Attachments ({n})', { n: attachments.length })}</span>
        <Button appearance="subtle" spacing="compact" onClick={() => fileInput.current?.click()}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><AttachmentIcon label="" /> {t('Attach')}</span>
        </Button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => onFiles(e.currentTarget.files)} />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {attachments.map((a) => (
          <AttachmentCard key={a.id} attachment={a} issueKey={issueKey} />
        ))}
        {upload.isPending && (
          <div style={{ width: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 120 }}>
            <Spinner />
          </div>
        )}
      </div>
    </div>
  )
}
