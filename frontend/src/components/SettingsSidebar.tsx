import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import Lozenge from '@atlaskit/lozenge'
import Select from '@atlaskit/select'
import { token } from '@atlaskit/tokens'
import { ArrowLeftIcon, LibraryIcon, LinkIcon, PeopleGroupIcon, ScreenIcon, TaskIcon } from './coreIcons'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function Item({ label, to, soon, active, onGo }: { label: string; to?: string; soon?: string; active?: boolean; onGo: (to: string) => void }) {
  const disabled = !to
  return (
    <div
      onClick={() => to && onGo(to)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        height: 34,
        padding: '0 10px',
        margin: '0 8px',
        borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        fontSize: 14,
        background: active ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: disabled
          ? token('color.text.disabled', '#8993A5')
          : active
            ? token('color.text.selected', '#0C66E4')
            : token('color.text.subtle', '#44546F'),
        boxShadow: active ? `inset ${document.documentElement.dir === 'rtl' ? -2 : 2}px 0 0 ${token('color.border.selected', '#0C66E4')}` : 'none',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4')
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {soon && <Lozenge>{soon}</Lozenge>}
    </div>
  )
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '16px 18px 4px', fontSize: 12, fontWeight: 600, ...subtleText }}>
      {children}
    </div>
  )
}

interface AreaOption {
  label: string
  value: string
  icon: React.ComponentType<{ label: string }>
  isDisabled?: boolean
}

// The "Switch settings" areas — mirrors the gear menu's admin entries.
const AREAS: AreaOption[] = [
  { label: t('System'), value: '/admin/system/general', icon: ScreenIcon },
  { label: t('Spaces'), value: '/admin/spaces', icon: LibraryIcon },
  { label: t('User management'), value: '/admin/users', icon: PeopleGroupIcon },
  { label: t('Work items'), value: '/admin/work-items/types', icon: TaskIcon },
  { label: t('Integrations'), value: '/admin/integrations/webhooks', icon: LinkIcon },
]

// System sections, mirroring Jira's System settings sidebar.
const SYSTEM_SECTIONS: { group?: string; items: { label: string; to?: string; soon?: string }[] }[] = [
  {
    items: [
      { label: t('General configuration'), to: '/admin/system/general' },
      { label: t('Beta features'), soon: t('Backlog') },
    ],
  },
  {
    group: t('Troubleshooting and support'),
    items: [
      { label: t('Audit log'), to: '/admin/system/audit' },
      { label: t('System info'), to: '/admin/system/info' },
    ],
  },
  {
    group: t('Security'),
    items: [
      { label: t('Security'), to: '/admin/system/security' },
      { label: t('Space roles'), to: '/admin/system/roles' },
      { label: t('Global permissions'), to: '/admin/system/permissions' },
      { label: t('Work item collectors'), soon: t('Backlog') },
    ],
  },
  {
    group: t('Automation'),
    items: [{ label: t('Global automation'), to: '/admin/automation' }],
  },
  {
    group: t('User interface'),
    items: [
      { label: t('Default user preferences'), to: '/admin/system/defaults' },
      { label: t('Default dashboard'), to: '/dashboards/default' },
    ],
  },
  {
    group: t('Mail'),
    items: [
      { label: t('Outgoing mail'), to: '/admin/system/mail' },
      { label: t('Incoming mail'), to: '/admin/system/incoming-mail' },
    ],
  },
]

// Settings sidebar takeover, Jira-style: back arrow + title, "Switch settings"
// dropdown, then the active area's sections.
export default function SettingsSidebar({ area }: { area: 'admin' | 'personal' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const path = location.pathname

  const currentArea = path.startsWith('/admin/spaces')
    ? AREAS[1]
    : path.startsWith('/admin/users')
      ? AREAS[2]
      : path.startsWith('/admin/work-items')
        ? AREAS[3]
        : path.startsWith('/admin/integrations')
          ? AREAS[4]
          : AREAS[0]

  return (
    <nav
      style={{
        width: 264,
        flexShrink: 0,
        overflowY: 'auto',
        borderInlineEnd: `1px solid ${token('color.border', '#DFE1E6')}`,
        background: token('elevation.surface.sunken', '#F7F8F9'),
        padding: '8px 0 24px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px 10px' }}>
        <button
          type="button"
          aria-label={t('Back to TaskHat')}
          onClick={() => navigate('/')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            border: 'none',
            borderRadius: 6,
            background: 'transparent',
            cursor: 'pointer',
            color: token('color.text.subtle', '#44546F'),
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <ArrowLeftIcon label="" />
        </button>
        <span style={{ fontSize: 15, fontWeight: 700 }}>
          {area === 'admin' ? t('TaskHat admin settings') : t('Personal settings')}
        </span>
      </div>

      {area === 'personal' ? (
        <>
          <Item
            label={t('General settings')}
            to="/settings/general"
            active={path === '/settings/general'}
            onGo={navigate}
          />
          <Item
            label={t('Notification settings')}
            to="/settings/notifications"
            active={path === '/settings/notifications'}
            onGo={navigate}
          />
          <Item
            label={t('API tokens')}
            to="/settings/api-tokens"
            active={path === '/settings/api-tokens'}
            onGo={navigate}
          />
        </>
      ) : (
        <>
          <div style={{ padding: '0 16px 12px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: token('color.text.subtle', '#44546F') }}>
              {t('Switch settings')}
            </div>
            <Select<AreaOption>
              spacing="compact"
              options={AREAS}
              value={currentArea}
              isOptionDisabled={(o) => !!o.isDisabled}
              formatOptionLabel={(o) => {
                const Icon = o.icon
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon label="" />
                    {o.label}
                  </span>
                )
              }}
              onChange={(o) => {
                if (o && !o.isDisabled) navigate(o.value)
              }}
            />
          </div>

          {currentArea === AREAS[0] &&
            SYSTEM_SECTIONS.map((section, i) => (
              <div key={i}>
                {section.group && <GroupLabel>{section.group}</GroupLabel>}
                {section.items.map((item) => (
                  <Item
                    key={item.label}
                    {...item}
                    active={item.to === path || (item.to === '/admin/automation' && path.startsWith('/admin/automation'))}
                    onGo={navigate}
                  />
                ))}
              </div>
            ))}

          {currentArea === AREAS[1] && (
            <>
              <GroupLabel>{t('Spaces')}</GroupLabel>
              <Item label={t('Manage spaces')} to="/admin/spaces" active={path === '/admin/spaces'} onGo={navigate} />
              <Item label={t('Space categories')} to="/admin/spaces/categories" active={path === '/admin/spaces/categories'} onGo={navigate} />
              <Item label={t('Archived spaces')} to="/admin/spaces/archived" active={path === '/admin/spaces/archived'} onGo={navigate} />
            </>
          )}

          {currentArea === AREAS[2] && (
            <>
              <GroupLabel>{t('User management')}</GroupLabel>
              <Item label={t('Users')} to="/admin/users" active={path.startsWith('/admin/users')} onGo={navigate} />
            </>
          )}

          {currentArea === AREAS[4] && (
            <>
              <GroupLabel>{t('Integrations')}</GroupLabel>
              <Item label={t('Webhooks')} to="/admin/integrations/webhooks" active={path === '/admin/integrations/webhooks'} onGo={navigate} />
              <Item label={t('API tokens (personal)')} to="/settings/api-tokens" onGo={navigate} />
              <Item label={t('Incoming webhooks')} soon={t('Backlog')} onGo={navigate} />
            </>
          )}

          {currentArea === AREAS[3] && (
            <>
              <GroupLabel>{t('Work items')}</GroupLabel>
              <Item label={t('Work types')} to="/admin/work-items/types" active={path === '/admin/work-items/types'} onGo={navigate} />
              <Item label={t('Workflows')} to="/admin/work-items/workflows" active={path === '/admin/work-items/workflows'} onGo={navigate} />
              <Item label={t('Custom fields')} to="/admin/work-items/fields" active={path === '/admin/work-items/fields'} onGo={navigate} />
              <Item label={t('Permission schemes')} to="/admin/work-items/permissions" active={path.startsWith('/admin/work-items/permissions')} onGo={navigate} />
              <Item label={t('Screens')} soon={t('Simplified')} onGo={navigate} />
            </>
          )}
        </>
      )}

      <GroupLabel>{t('Personal')}</GroupLabel>
      {area === 'admin' && (
        <>
          <Item label={t('General settings')} to="/settings/general" onGo={navigate} />
          <Item label={t('Notification settings')} to="/settings/notifications" onGo={navigate} />
        </>
      )}
      {area === 'personal' && (
        <Item label={t('Profile and account')} to="/account" onGo={navigate} />
      )}
    </nav>
  )
}
