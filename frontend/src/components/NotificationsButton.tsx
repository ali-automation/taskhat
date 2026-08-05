import { useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DropdownMenu from '@atlaskit/dropdown-menu'
import { token } from '@atlaskit/tokens'
import { useMarkNotificationsRead, useNotifications } from '../api/hooks'
import type { AppNotification } from '../api/types'
import { t, timeAgo } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function describe(n: AppNotification): string {
  switch (n.kind) {
    case 'created':
      return t('created')
    case 'transitioned':
      return t('moved to {status}', { status: n.payload.preview ?? t('a new status') })
    case 'comment':
      return t('commented on')
    case 'mention':
      return t('mentioned you on')
    case 'shared':
      return t('shared with you')
    default:
      return t('updated')
  }
}

// Bell with unread badge; Jira-style notifications panel.
export default function NotificationsButton({ icon }: { icon?: React.ReactNode }) {
  const { data } = useNotifications()
  const markRead = useMarkNotificationsRead()
  const navigate = useNavigate()
  const notifications = data?.values ?? []
  const unread = data?.unread ?? 0

  return (
    <DropdownMenu<HTMLButtonElement>
      trigger={({ triggerRef, ...props }) => (
        <button
          type="button"
          ref={triggerRef}
          {...props}
          title={t('Notifications')}
          style={{
            position: 'relative',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            padding: 6,
            borderRadius: 6,
            lineHeight: 1,
            color: token('color.text.subtle', '#44546F'),
            display: 'inline-flex',
          }}
        >
          {icon ?? '🔔'}
          {unread > 0 && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                insetInlineEnd: 0,
                background: token('color.background.danger.bold', '#CA3521'),
                color: '#fff',
                borderRadius: 8,
                fontSize: 10,
                fontWeight: 700,
                padding: '1px 5px',
                minWidth: 16,
                textAlign: 'center',
              }}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
      shouldRenderToParent
    >
      <div style={{ width: 380, maxHeight: 440, overflowY: 'auto' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
          }}
        >
          <span style={{ fontWeight: 600 }}>{t('Notifications')}</span>
          {unread > 0 && (
            <Button appearance="subtle" spacing="compact" onClick={() => markRead.mutate([])}>
              {t('Mark all as read')}
            </Button>
          )}
        </div>
        {notifications.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 13, ...subtleText }}>
            {t('You have no notifications. 🎩')}
          </div>
        )}
        {notifications.map((n) => (
          <div
            key={n.id}
            onClick={() => {
              if (!n.readAt) markRead.mutate([n.id])
              n.payload.wikiPageId ? navigate(`/wiki/spaces/${n.payload.spaceKey}/pages/${n.payload.wikiPageId}`) : navigate(`/browse/${n.payload.issueKey}`)
            }}
            style={{
              display: 'flex',
              gap: 10,
              padding: '10px 14px',
              cursor: 'pointer',
              background: n.readAt ? 'transparent' : token('color.background.selected', '#E9F2FF'),
              borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`,
            }}
          >
            <Avatar size="small" name={n.actor.displayName} src={n.actor.avatarUrl ?? undefined} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13 }}>
                <strong>{n.actor.displayName}</strong> {describe(n)}{' '}
                <strong>{n.payload.issueKey}</strong>
              </div>
              <div
                style={{
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  ...subtleText,
                }}
              >
                {n.payload.preview || n.payload.summary}
              </div>
              <div style={{ fontSize: 11, ...subtleText }}>{timeAgo(n.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
    </DropdownMenu>
  )
}
