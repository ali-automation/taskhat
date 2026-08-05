import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup, DropdownItemRadio, DropdownItemRadioGroup } from '@atlaskit/dropdown-menu'
import { token } from '@atlaskit/tokens'
import Modal, { ModalBody, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SidebarCollapseIcon, SidebarExpandIcon, AppSwitcherIcon, NotificationIcon, QuestionCircleIcon, SettingsIcon, PersonAvatarIcon, ClockIcon, StarUnstarredIcon, LibraryIcon, FilterIcon, SearchIcon, BoardIcon, ChevronRightIcon, ChevronDownIcon, AddIcon, DashboardIcon, HatLogo, DocHatLogo, ShowMoreHorizontalIcon } from './coreIcons'
import { useAuth } from '../auth/AuthContext'
import { api } from '../api/client'
import { useAccount, useBoards, useProjects, useWikiSpaces, useWorkTypes } from '../api/hooks'
import type { Project } from '../api/types'
import { language, setLanguage, t } from '../i18n'
import { registerWorkTypes } from './icons'
import { applyTheme, currentTheme, type ThemeChoice } from '../theme'
import CreateIssueModal from './CreateIssueModal'
import NotificationsBell from './NotificationsButton'
import QuickSearch from './QuickSearch'
import SettingsMenu from './SettingsMenu'
import SettingsSidebar from './SettingsSidebar'
import CommandPalette from './CommandPalette'
import WikiSideNav from './WikiSideNav'
import { RichTextStyles } from './RichText'
import SysHatBanner from './SysHatBanner'
import { useUserRealtime } from '../hooks/useUserRealtime'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        border: 'none',
        borderRadius: 6,
        background: 'transparent',
        cursor: 'pointer',
        color: token('color.text.subtle', '#44546F'),
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  )
}

function UserMenu() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const [theme, setTheme] = useState<ThemeChoice>(currentTheme())
  if (!user) return null
  return (
    <DropdownMenu<HTMLButtonElement>
      trigger={({ triggerRef, ...props }) => (
        <button
          type="button"
          ref={triggerRef}
          {...props}
          style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2, borderRadius: '50%' }}
          title={user.displayName}
        >
          <Avatar size="small" name={user.displayName} src={user.avatarUrl ?? undefined} />
        </button>
      )}
      shouldRenderToParent
    >
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'center', minWidth: 240 }}>
        <Avatar size="medium" name={user.displayName} src={user.avatarUrl ?? undefined} />
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{user.displayName}</div>
          <div style={{ fontSize: 12, ...subtleText }}>{user.email}</div>
        </div>
      </div>
      <DropdownItemGroup hasSeparator>
        <DropdownItem onClick={() => navigate('/account')}>{t('Profile')}</DropdownItem>
        <DropdownItem onClick={() => navigate('/account')}>{t('Account settings')}</DropdownItem>
        <DropdownItem
          onClick={async () => {
            const { api } = await import('../api/client')
            const space = await api<{ key: string }>('/wiki/personal-space', { method: 'POST' })
            navigate(`/wiki/spaces/${space.key}`)
          }}
        >
          {t('Personal space')}
        </DropdownItem>
        {isAdmin && <DropdownItem onClick={() => navigate('/admin')}>{t('Administration')}</DropdownItem>}
      </DropdownItemGroup>
      <DropdownItemGroup hasSeparator>
        <DropdownItemRadioGroup id="theme" title={t('Theme')}>
          {(
            [
              ['light', t('Light')],
              ['dark', t('Dark')],
              ['auto', t('Match browser')],
            ] as [ThemeChoice, string][]
          ).map(([value, label]) => (
            <DropdownItemRadio
              key={value}
              id={value}
              isSelected={theme === value}
              onClick={() => {
                setTheme(value)
                applyTheme(value)
              }}
            >
              {label}
            </DropdownItemRadio>
          ))}
        </DropdownItemRadioGroup>
      </DropdownItemGroup>
      <DropdownItemGroup hasSeparator>
        <DropdownItem
          onClick={async () => {
            await logout()
            navigate('/login', { replace: true })
          }}
        >
          {t('Log out')}
        </DropdownItem>
      </DropdownItemGroup>
    </DropdownMenu>
  )
}

// The Atlassian-style app switcher: hop between the site's apps.
const HAT_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%231868DB'/%3E%3Cpath d='M8.4 6.5h7.2c.4 0 .7.3.7.7v6h1.9c.5 0 .9.4.9.9s-.4.9-.9.9H5.8c-.5 0-.9-.4-.9-.9s.4-.9.9-.9h1.9v-6c0-.4.3-.7.7-.7z' fill='%23fff'/%3E%3Crect x='7.7' y='10.2' width='8.6' height='1.6' fill='%239DC1F7'/%3E%3C/svg%3E"
const DOC_FAVICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='5' fill='%231868DB'/%3E%3Crect x='6.5' y='4.8' width='11' height='14.4' rx='1.5' fill='%23fff'/%3E%3Crect x='8.6' y='8' width='6.8' height='1.6' rx='0.8' fill='%231868DB'/%3E%3Crect x='8.6' y='11.2' width='6.8' height='1.6' rx='0.8' fill='%239DC1F7'/%3E%3Crect x='8.6' y='14.4' width='4.4' height='1.6' rx='0.8' fill='%239DC1F7'/%3E%3C/svg%3E"

function AppSwitcherMenu() {
  const navigate = useNavigate()
  const location = useLocation()
  const inWiki = location.pathname.startsWith('/wiki')
  const apps = [
    { name: 'TaskHat', desc: t('Project & issue tracking'), to: '/', active: !inWiki, color: '#0C66E4', icon: <HatLogo /> },
    { name: 'DocHat', desc: t('Knowledge base & documentation'), to: '/wiki', active: inWiki, color: '#1868DB', icon: <DocHatLogo /> },
  ]
  return (
    <DropdownMenu<HTMLButtonElement>
      trigger={({ triggerRef, ...props }) => (
        <button
          type="button"
          ref={triggerRef}
          {...props}
          title={t('App switcher')}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 32, height: 32, border: 'none', borderRadius: 6, background: 'transparent',
            cursor: 'pointer', color: token('color.text.subtle', '#44546F'),
          }}
        >
          <AppSwitcherIcon label="" />
        </button>
      )}
      shouldRenderToParent
    >
      <div style={{ padding: '10px 16px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', minWidth: 260, ...subtleText }}>
        {t('Your apps')}
      </div>
      <DropdownItemGroup>
        {apps.map((app) => (
          <DropdownItem
            key={app.name}
            onClick={() => navigate(app.to)}
            isSelected={app.active}
            elemBefore={
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 28, height: 28, borderRadius: 6, color: '#FFFFFF', background: app.color, flexShrink: 0,
                }}
              >
                {app.icon}
              </span>
            }
            description={app.desc}
          >
            <span style={{ fontWeight: 600 }}>{app.name}</span>
          </DropdownItem>
        ))}
      </DropdownItemGroup>
    </DropdownMenu>
  )
}

// DocHat's top-bar Create: a Confluence-style menu (Page / Blog post /
// Whiteboard), with a space picker when you're not inside a space.
function WikiCreateButton({ currentKey }: { currentKey?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { data: spaces } = useWikiSpaces()
  const [pickedKey, setPickedKey] = useState('')
  const spaceKey = currentKey ?? (pickedKey || ((spaces ?? [])[0]?.key ?? ''))

  const row = (label: string, glyph: string, run: () => void) => (
    <button
      type="button"
      onClick={() => {
        if (!spaceKey) return
        setOpen(false)
        run()
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '7px 10px',
        border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14, textAlign: 'start',
        background: 'transparent', color: 'inherit',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4'))}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ width: 20, textAlign: 'center' }}>{glyph}</span> {label}
    </button>
  )

  const newWhiteboard = async () => {
    const { api } = await import('../api/client')
    const p = await api<{ id: string }>(`/wiki/spaces/${spaceKey}/pages`, {
      method: 'POST',
      body: JSON.stringify({ title: t('Untitled whiteboard'), icon: '', parentId: null, bodyDoc: null, kind: 'whiteboard' }),
    })
    navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`)
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <Button appearance="primary" iconBefore={AddIcon} onClick={() => setOpen(!open)}>
        {t('Create')}
      </Button>
      {open && (
        <>
          <span style={{ position: 'fixed', inset: 0, zIndex: 400 }} onMouseDown={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute', top: '100%', insetInlineEnd: 0, zIndex: 401, width: 230, marginTop: 4,
              background: token('elevation.surface.overlay', '#FFFFFF'),
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6, boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'),
              padding: 4, display: 'flex', flexDirection: 'column',
            }}
          >
            {!currentKey && (
              <div style={{ padding: '4px 8px 8px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, color: token('color.text.subtlest', '#626F86') }}>
                  {t('In space')}
                </div>
                <select
                  value={spaceKey}
                  onChange={(e) => setPickedKey(e.currentTarget.value)}
                  style={{
                    width: '100%', fontSize: 13, padding: '5px 6px', borderRadius: 4,
                    border: `1px solid ${token('color.border.input', '#8590A2')}`,
                    background: 'transparent', color: 'inherit',
                  }}
                >
                  {(spaces ?? []).map((s) => (
                    <option key={s.id} value={s.key}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            {row(t('Page'), '📄', () => navigate(`/wiki/spaces/${spaceKey}/new`))}
            {row(t('Blog post'), '✍️', () => navigate(`/wiki/spaces/${spaceKey}/new?kind=blog`))}
            {row(t('Whiteboard'), '🖼', () => { void newWhiteboard() })}
            <div style={{ margin: '4px 0', borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }} />
            {row(t('Space'), '🗂', () => navigate('/wiki/directory'))}
          </div>
        </>
      )}
    </span>
  )
}

function TopBar({ onToggleSidebar, sidebarOpen, onCreate, onOpenPalette }: { onToggleSidebar: () => void; sidebarOpen: boolean; onCreate: () => void; onOpenPalette: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inWiki = location.pathname.startsWith('/wiki')
  const wikiSpaceMatch = useMatch('/wiki/spaces/:key/*')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const create = () => onCreate()
  // Each app carries its own favicon, Jira/Confluence style.
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) link.href = inWiki ? DOC_FAVICON : HAT_FAVICON
  }, [inWiki])
  return (
    <header
      style={{
        height: 48,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '0 12px',
        borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
        background: token('elevation.surface', '#FFFFFF'),
        zIndex: 200,
      }}
    >
      <IconButton label={sidebarOpen ? t('Collapse sidebar') : t('Expand sidebar')} onClick={onToggleSidebar}>
        {sidebarOpen ? <SidebarCollapseIcon label="" /> : <SidebarExpandIcon label="" />}
      </IconButton>
      <AppSwitcherMenu />
      <button
        type="button"
        onClick={() => navigate(inWiki ? '/wiki' : '/')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: 15,
          color: 'inherit',
          padding: '4px 8px',
        }}
      >
        {inWiki ? <DocHatLogo /> : <HatLogo />} {inWiki ? 'DocHat' : 'TaskHat'}
      </button>

      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        <div style={{ flex: 1, maxWidth: 760 }}>
          <QuickSearch />
        </div>
        {inWiki ? (
          <WikiCreateButton currentKey={wikiSpaceMatch?.params.key?.toUpperCase()} />
        ) : (
          <Button appearance="primary" iconBefore={AddIcon} onClick={create}>
            {t('Create')}
          </Button>
        )}
      </div>

      <span id="th-notifications" style={{ display: 'inline-flex' }}>
        <NotificationsBell icon={<NotificationIcon label={t('Notifications')} />} />
      </span>
      <IconButton label={t('Help')}>
        <QuestionCircleIcon label="" />
      </IconButton>
      <div style={{ position: 'relative' }}>
        <IconButton label={t('Settings')} onClick={() => setSettingsOpen(!settingsOpen)}>
          <SettingsIcon label="" />
        </IconButton>
        {settingsOpen && <SettingsMenu onClose={() => setSettingsOpen(false)} onOpenPalette={onOpenPalette} />}
      </div>
      <UserMenu />
    </header>
  )
}

function NavItem({
  icon,
  label,
  onClick,
  active,
  indent = 0,
  trailing,
}: {
  icon?: ReactNode
  label: ReactNode
  onClick?: () => void
  active?: boolean
  indent?: number
  trailing?: ReactNode
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 34,
        paddingInline: `${10 + indent * 20}px 8px`,
        margin: '0 8px',
        borderRadius: 6,
        cursor: onClick ? 'pointer' : 'default',
        fontSize: 14,
        background: active ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: active ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
        boxShadow: active ? `inset ${language === 'ar' ? -2 : 2}px 0 0 ${token('color.border.selected', '#0C66E4')}` : 'none',
        fontWeight: active ? 600 : 400,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F1F2F4')
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {icon && <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {trailing}
    </div>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '14px 18px 4px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', ...subtleText }}>
      {children}
    </div>
  )
}

function SideNav({ projectKey }: { projectKey: string | undefined }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { data: projects } = useProjects()
  const [recentOpen, setRecentOpen] = useState(false)
  const [starredOpen, setStarredOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)

  const myOpenTQL = `assignee = ${user?.email ?? ''} AND resolution = EMPTY ORDER BY updated DESC`
  const reportedTQL = `reporter = ${user?.email ?? ''} ORDER BY created DESC`

  const chevron = (open: boolean) => (open ? <ChevronDownIcon label="" /> : <ChevronRightIcon label="" />)

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
      <NavItem icon={<PersonAvatarIcon label="" />} label={t('For you')} active={location.pathname === '/'} onClick={() => navigate('/')} />
      <NavItem
        icon={<ClockIcon label="" />}
        label={t('Recent')}
        onClick={() => setRecentOpen(!recentOpen)}
        trailing={chevron(recentOpen)}
      />
      {recentOpen &&
        (projects ?? []).slice(0, 3).map((p) => (
          <NavItem
            key={p.id}
            indent={1}
            icon={<Avatar appearance="square" size="xsmall" src={p.avatarUrl ?? undefined} name={p.name} />}
            label={p.name}
            onClick={() => navigate(`/projects/${p.key}/board`)}
          />
        ))}
      <NavItem
        icon={<StarUnstarredIcon label="" />}
        label={t('Starred')}
        onClick={() => setStarredOpen(!starredOpen)}
        trailing={chevron(starredOpen)}
      />
      {starredOpen && <StarredList />}

      <NavItem
        icon={<LibraryIcon label="" />}
        label={t('Spaces')}
        active={location.pathname === '/projects'}
        onClick={() => navigate('/projects')}
      />
      <SectionLabel>{t('Recent')}</SectionLabel>
      {(projects ?? []).slice(0, 6).map((p) => (
        <SpaceNavRow key={p.id} project={p} isActive={p.key === projectKey} />
      ))}
      <NavItem indent={1} label={t('More spaces')} onClick={() => navigate('/projects')} trailing={<ChevronRightIcon label="" />} />

      <NavItem
        icon={<FilterIcon label="" />}
        label={t('Filters')}
        active={location.pathname === '/issues' && !location.search}
        onClick={() => navigate('/issues')}
      />
      <NavItem
        indent={1}
        icon={<SearchIcon label="" />}
        label={t('Search work items')}
        onClick={() => navigate('/issues')}
      />
      <NavItem
        indent={1}
        label={t('Default filters')}
        onClick={() => setFiltersOpen(!filtersOpen)}
        trailing={chevron(filtersOpen)}
      />
      {filtersOpen && (
        <>
          <NavItem
            indent={2}
            icon={<FilterIcon label="" />}
            label={t('My open work items')}
            onClick={() => navigate(`/issues?tql=${encodeURIComponent(myOpenTQL)}`)}
          />
          <NavItem
            indent={2}
            icon={<FilterIcon label="" />}
            label={t('Reported by me')}
            onClick={() => navigate(`/issues?tql=${encodeURIComponent(reportedTQL)}`)}
          />
        </>
      )}

      <NavItem
        icon={<DashboardIcon label="" />}
        label={t('Dashboards')}
        active={location.pathname.startsWith('/dashboards')}
        onClick={() => navigate('/dashboards')}
      />
    </nav>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  useUserRealtime(user?.id)

  // Feed the icon registry so custom work types render with their color.
  const { data: workTypes } = useWorkTypes()
  useEffect(() => {
    if (workTypes) registerWorkTypes(workTypes)
  }, [workTypes])

  // The account's language preference wins; setLanguage reloads only on change.
  const { data: profile } = useAccount()
  useEffect(() => {
    if (profile?.language) setLanguage(profile.language)
  }, [profile?.language])

  const projectMatch = useMatch('/projects/:key/*')
  const browseMatch = useMatch('/browse/:issueKey')
  const projectKey =
    projectMatch?.params.key?.toUpperCase() ??
    (browseMatch?.params.issueKey?.includes('-')
      ? browseMatch.params.issueKey.split('-')[0].toUpperCase()
      : undefined)

  const wikiArea = location.pathname.startsWith('/wiki')

  // Settings pages swap the app sidebar for the settings sidebar, like Jira.
  const settingsArea = location.pathname.startsWith('/admin')
    ? ('admin' as const)
    : location.pathname.startsWith('/settings')
      ? ('personal' as const)
      : null

  // Global shortcuts: ⌘/Ctrl+K command palette, C = create (Jira parity).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      const target = e.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        setCreateOpen(true)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: token('elevation.surface', '#FFFFFF') }}>
      <RichTextStyles />
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onCreate={() => setCreateOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      {user?.isDemo && <SysHatBanner />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {sidebarOpen && (settingsArea ? <SettingsSidebar area={settingsArea} /> : wikiArea ? <WikiSideNav /> : <SideNav projectKey={projectKey} />)}
        <main style={{ flex: 1, overflowY: 'auto', minWidth: 0 }}>
          {/* Wiki pages manage their own layout — the editor is full-bleed like Confluence. */}
          <div style={{ padding: wikiArea ? 0 : '16px 40px 40px' }}>{children}</div>
        </main>
      </div>
      <CreateIssueModal isOpen={createOpen} onClose={() => setCreateOpen(false)} defaultProjectKey={projectKey} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onCreate={() => setCreateOpen(true)} />}
    </div>
  )
}

// ---- Starred + space/board sidebar rows (Jira parity) ----

type StarredItem = { kind: 'space' | 'board'; id: string; key: string; name: string; avatarUrl: string | null }

function useStars() {
  return useQuery({ queryKey: ['stars'], queryFn: () => api<{ values: StarredItem[] }>('/stars') })
}

function useSetStar() {
  const qc = useQueryClient()
  return (kind: 'space' | 'board', targetId: string, starred: boolean) =>
    api('/stars', { method: 'POST', body: JSON.stringify({ kind, targetId, starred }) })
      .then(() => qc.invalidateQueries({ queryKey: ['stars'] }))
}

function StarredList() {
  const navigate = useNavigate()
  const { data } = useStars()
  const items = data?.values ?? []
  if (items.length === 0) {
    return <div style={{ padding: '2px 18px 6px 40px', fontSize: 12, ...subtleText }}>{t('Nothing starred yet.')}</div>
  }
  return (
    <>
      {items.map((it) => (
        <NavItem
          key={`${it.kind}-${it.id}`}
          indent={1}
          icon={it.kind === 'space'
            ? <Avatar appearance="square" size="xsmall" src={it.avatarUrl ?? undefined} name={it.name} />
            : <BoardIcon label="" />}
          label={it.name}
          onClick={() => navigate(it.kind === 'space' ? `/projects/${it.key}/summary` : `/projects/${it.key}/board/${it.id}`)}
        />
      ))}
    </>
  )
}

// Hover-revealed trailing actions, like Jira's sidebar rows.
function RowActions({ children, visible }: { children: ReactNode; visible: boolean }) {
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 2, visibility: visible ? 'visible' : 'hidden' }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </span>
  )
}

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 24, height: 24, border: 'none', borderRadius: 4, cursor: 'pointer',
  background: 'transparent', color: 'inherit', padding: 0,
}

function SpaceNavRow({ project, isActive }: { project: Project; isActive: boolean }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const { data: stars } = useStars()
  const setStar = useSetStar()
  const { data: boards } = useBoards(isActive ? project.key : undefined)
  const starred = (stars?.values ?? []).some((s) => s.kind === 'space' && s.id === project.id)

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <NavItem
        indent={1}
        icon={<Avatar appearance="square" size="xsmall" src={project.avatarUrl ?? undefined} name={project.name} />}
        label={project.name}
        active={isActive && !location.pathname.includes('/board')}
        onClick={() => navigate(`/projects/${project.key}/summary`)}
        trailing={
          <RowActions visible={hover || menuOpen}>
            <button type="button" style={iconBtnStyle} title={t('Create a board')} onClick={() => setCreateOpen(true)}>
              <AddIcon label={t('Create a board')} />
            </button>
            <DropdownMenu
              isOpen={menuOpen}
              onOpenChange={({ isOpen }) => setMenuOpen(isOpen)}
              placement="bottom-start"
              shouldRenderToParent={false}
              trigger={({ triggerRef, ...props }) => (
                <button type="button" ref={triggerRef as React.Ref<HTMLButtonElement>} {...props} style={iconBtnStyle} title={t('More actions')}>
                  <ShowMoreHorizontalIcon label={t('More actions')} />
                </button>
              )}
            >
              <DropdownItemGroup>
                <DropdownItem onClick={() => void setStar('space', project.id, !starred)}>
                  {starred ? t('Remove from starred') : t('Add to starred')}
                </DropdownItem>
                <DropdownItem onClick={() => navigate(`/projects/${project.key}/settings/people`)}>
                  {t('Add people')}
                </DropdownItem>
                <DropdownItem onClick={() => navigate(`/projects/${project.key}/settings/details`)}>
                  {t('Space settings')}
                </DropdownItem>
              </DropdownItemGroup>
              <DropdownItemGroup hasSeparator>
                <DropdownItem isDisabled description={t('TaskHat-managed')}>
                  {t('Software space')}
                </DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>
          </RowActions>
        }
      />
      {isActive && (boards ?? []).map((b) => (
        <BoardNavRow key={b.id} projectKey={project.key} board={b} boardsCount={(boards ?? []).length} />
      ))}
      {createOpen && (
        <CreateBoardModal projectKey={project.key} onClose={() => setCreateOpen(false)} />
      )}
    </div>
  )
}

function BoardNavRow({ projectKey, board, boardsCount }: {
  projectKey: string; board: { id: string; name: string }; boardsCount: number
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { data: stars } = useStars()
  const setStar = useSetStar()
  const starred = (stars?.values ?? []).some((s) => s.kind === 'board' && s.id === board.id)
  const active = location.pathname.includes('/board') &&
    (location.pathname.endsWith(`/board/${board.id}`) || (!/\/board\/.+/.test(location.pathname)))

  const remove = () => {
    api(`/boards/${board.id}`, { method: 'DELETE' })
      .then(() => {
        setConfirmDelete(false)
        qc.invalidateQueries({ queryKey: ['boards', projectKey] })
        navigate(`/projects/${projectKey}/board`)
      })
      .catch(() => setConfirmDelete(false))
  }

  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <NavItem
        indent={2}
        icon={<BoardIcon label="" />}
        label={board.name}
        active={active}
        onClick={() => navigate(`/projects/${projectKey}/board/${board.id}`)}
        trailing={
          <RowActions visible={hover || menuOpen}>
            <DropdownMenu
              isOpen={menuOpen}
              onOpenChange={({ isOpen }) => setMenuOpen(isOpen)}
              placement="bottom-start"
              shouldRenderToParent={false}
              trigger={({ triggerRef, ...props }) => (
                <button type="button" ref={triggerRef as React.Ref<HTMLButtonElement>} {...props} style={iconBtnStyle} title={t('More actions')}>
                  <ShowMoreHorizontalIcon label={t('More actions')} />
                </button>
              )}
            >
              <DropdownItemGroup>
                <DropdownItem onClick={() => void setStar('board', board.id, !starred)}>
                  {starred ? t('Remove from starred') : t('Add to starred')}
                </DropdownItem>
                <DropdownItem onClick={() => navigate(`/projects/${projectKey}/settings/people`)}>
                  {t('Add people')}
                </DropdownItem>
                <DropdownItem onClick={() => navigate(`/boards/${board.id}/settings`)}>
                  {t('Board settings')}
                </DropdownItem>
              </DropdownItemGroup>
              <DropdownItemGroup hasSeparator>
                <DropdownItem isDisabled={boardsCount <= 1} onClick={() => setConfirmDelete(true)}>
                  <span style={{ color: boardsCount <= 1 ? undefined : token('color.text.danger', '#AE2E24') }}>{t('Delete board')}</span>
                </DropdownItem>
              </DropdownItemGroup>
            </DropdownMenu>
          </RowActions>
        }
      />
      <ModalTransition>
        {confirmDelete && (
          <Modal onClose={() => setConfirmDelete(false)} width="small">
            <ModalHeader hasCloseButton>
              <ModalTitle appearance="danger">{t('Delete board')}</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <p style={{ fontSize: 14 }}>{t('Delete "{name}"? Work items stay in the space; sprints on this board are removed.', { name: board.name })}</p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', margin: '16px 0 8px' }}>
                <Button appearance="subtle" onClick={() => setConfirmDelete(false)}>{t('Cancel')}</Button>
                <Button appearance="danger" onClick={remove}>{t('Delete')}</Button>
              </div>
            </ModalBody>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}

function CreateBoardModal({ projectKey, onClose }: { projectKey: string; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const create = (type: 'scrum' | 'kanban') => {
    if (busy) return
    setBusy(true)
    const name = type === 'scrum' ? t('Scrum board') : t('Kanban board')
    api<{ id: string }>(`/projects/${projectKey}/boards`, { method: 'POST', body: JSON.stringify({ name, type }) })
      .then((b) => {
        qc.invalidateQueries({ queryKey: ['boards', projectKey] })
        onClose()
        navigate(`/projects/${projectKey}/board/${b.id}`)
      })
      .finally(() => setBusy(false))
  }
  const card = (type: 'scrum' | 'kanban', title: string, desc: string, icon: ReactNode) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => create(type)}
      onKeyDown={(e) => { if (e.key === 'Enter') create(type) }}
      style={{
        display: 'flex', gap: 12, alignItems: 'flex-start', padding: 14,
        border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, cursor: 'pointer',
      }}
    >
      <span style={{ display: 'inline-flex', width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: token('color.background.neutral', '#F1F2F4') }}>
        {icon}
      </span>
      <span>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 13, ...subtleText }}>{desc}</div>
      </span>
    </div>
  )
  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader hasCloseButton>
          <ModalTitle>{t('Create a board')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '4px 0 16px' }}>
            {card('scrum', t('Scrum'), t('Sprint towards your team objectives with a board, backlog, and reports.'), <ClockIcon label="" />)}
            {card('kanban', t('Kanban'), t('Manage a continuous delivery of work with a kanban board and reports.'), <BoardIcon label="" />)}
          </div>
        </ModalBody>
      </Modal>
    </ModalTransition>
  )
}
