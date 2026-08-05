import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Lozenge from '@atlaskit/lozenge'
import { token } from '@atlaskit/tokens'
import {
  LibraryIcon, LinkIcon, NotificationIcon, PeopleGroupIcon, PersonAvatarIcon,
  ScreenIcon, TaskIcon,
} from './coreIcons'
import { isMac } from './CommandPalette'
import { useAuth } from '../auth/AuthContext'
import { t } from '../i18n'

interface MenuItem {
  title: string
  description: string
  icon: React.ComponentType<{ label: string }>
  to?: string
  soon?: string // stage label when not built yet
}

interface MenuSection {
  header: string
  adminOnly: boolean
  items: MenuItem[]
}

// Mirrors Jira's gear menu (2025): Personal / admin sections, searchable.
const SECTIONS: MenuSection[] = [
  {
    header: t('Personal TaskHat settings'),
    adminOnly: false,
    items: [
      {
        title: t('General settings'),
        description: t('Manage language, time zone, and other personal preferences'),
        icon: PersonAvatarIcon,
        to: '/settings/general',
      },
      {
        title: t('Notification settings'),
        description: t('Manage email and in-app notifications from TaskHat'),
        icon: NotificationIcon,
        to: '/settings/notifications',
      },
    ],
  },
  {
    header: t('TaskHat admin settings'),
    adminOnly: true,
    items: [
      {
        title: t('System'),
        description: t('Manage general configuration, security, user interface, and more'),
        icon: ScreenIcon,
        to: '/admin/system/general',
      },
      {
        title: t('Spaces'),
        description: t('Manage space settings, categories, and more'),
        icon: LibraryIcon,
        to: '/admin/spaces',
      },
      {
        title: t('Work items'),
        description: t('Configure work types, workflows, screens, fields, and more'),
        icon: TaskIcon,
        to: '/admin/work-items/types',
      },
      {
        title: t('Integrations'),
        description: t('Webhooks and API tokens for connecting other tools'),
        icon: LinkIcon,
        to: '/admin/integrations/webhooks',
      },
    ],
  },
  {
    header: t('Site admin settings'),
    adminOnly: true,
    items: [
      {
        title: t('User management'),
        description: t('Manage users, invites, and access'),
        icon: PeopleGroupIcon,
        to: '/admin/users',
      },
    ],
  },
]

export default function SettingsMenu({ onClose, onOpenPalette }: { onClose: () => void; onOpenPalette: () => void }) {
  const { isAdmin } = useAuth()
  const navigate = useNavigate()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const sections = useMemo(() => SECTIONS.filter((s) => !s.adminOnly || isAdmin), [isAdmin])

  const open = (item: MenuItem) => {
    if (!item.to) return
    onClose()
    navigate(item.to)
  }

  return (
    <div
      ref={panelRef}
      role="menu"
      style={{
        position: 'absolute',
        top: 40,
        insetInlineEnd: -44, // anchor near the window edge like Jira (avatar sits beside us)
        width: 'min(920px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 64px)',
        overflowY: 'auto',
        background: token('elevation.surface.overlay', '#FFFFFF'),
        borderRadius: 8,
        boxShadow: token('elevation.shadow.overlay', '0 8px 28px rgba(9,30,66,0.25)'),
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        padding: '20px 24px 12px',
        zIndex: 400,
      }}
    >
      {sections.map((section, si) => (
        <div key={section.header}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              marginTop: si === 0 ? 0 : 18,
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700 }}>{section.header}</div>
            {si === 0 && (
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenPalette()
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  border: `1px solid ${token('color.border', '#DFE1E6')}`,
                  borderRadius: 8,
                  background: token('color.background.neutral.subtle', 'transparent'),
                  cursor: 'pointer',
                  fontSize: 14,
                  color: token('color.text.subtle', '#44546F'),
                }}
              >
                {t('Search')} (
                <kbd
                  style={{
                    fontFamily: 'inherit',
                    background: token('color.background.neutral', '#F1F2F4'),
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 12,
                  }}
                >
                  {isMac ? '⌘' : 'Ctrl'}
                </kbd>
                +
                <kbd
                  style={{
                    fontFamily: 'inherit',
                    background: token('color.background.neutral', '#F1F2F4'),
                    borderRadius: 4,
                    padding: '1px 6px',
                    fontSize: 12,
                  }}
                >
                  K
                </kbd>
                )
              </button>
            )}
          </div>
          {section.items.map((item) => {
            const Icon = item.icon
            const disabled = !item.to
            return (
              <button
                key={item.title}
                type="button"
                role="menuitem"
                onClick={() => open(item)}
                disabled={disabled}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'none',
                  cursor: disabled ? 'default' : 'pointer',
                  opacity: disabled ? 0.55 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!disabled) e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4')
                }}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ color: token('color.text.subtle', '#44546F'), marginTop: 3, display: 'inline-flex' }}>
                  <Icon label="" />
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 500 }}>
                    {item.title}
                    {item.soon && <Lozenge appearance="new">{t('Coming in {stage}', { stage: item.soon })}</Lozenge>}
                  </span>
                  <span style={{ display: 'block', fontSize: 13.5, color: token('color.text.subtlest', '#626F86'), marginTop: 1 }}>
                    {item.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
