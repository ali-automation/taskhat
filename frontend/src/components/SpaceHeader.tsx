import { Link, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Lozenge from '@atlaskit/lozenge'
import { token } from '@atlaskit/tokens'
import { HomeIcon, BoardIcon, BacklogIcon, ChartTrendIcon, ListBulletedIcon, ReleaseIcon, SettingsIcon, ShowMoreHorizontalIcon, TimelineIcon } from '../components/coreIcons'
import { useProject } from '../api/hooks'
import { t } from '../i18n'

export type SpaceTab = 'summary' | 'timeline' | 'board' | 'backlog' | 'reports' | 'list' | 'releases' | 'settings'

const TABS: { key: SpaceTab; label: string; path: string; icon: React.ComponentType<{ label: string }> }[] = [
  { key: 'summary', label: t('Summary'), path: 'summary', icon: HomeIcon },
  { key: 'timeline', label: t('Timeline'), path: 'timeline', icon: TimelineIcon },
  { key: 'board', label: t('Kanban board'), path: 'board', icon: BoardIcon },
  { key: 'backlog', label: t('Backlog'), path: 'backlog', icon: BacklogIcon },
  { key: 'reports', label: t('Reports'), path: 'reports', icon: ChartTrendIcon },
  { key: 'list', label: t('List'), path: 'issues', icon: ListBulletedIcon },
  { key: 'releases', label: t('Releases'), path: 'releases', icon: ReleaseIcon },
  { key: 'settings', label: t('Settings'), path: 'settings', icon: SettingsIcon },
]

// Space page header, Jira 2025 style: breadcrumb, big title, tab strip.
export default function SpaceHeader({ projectKey, tab }: { projectKey: string; tab: SpaceTab }) {
  const { data: project } = useProject(projectKey)
  const navigate = useNavigate()

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 14, marginBottom: 2 }}>
        <Link to="/projects" style={{ color: token('color.text.subtle', '#44546F'), textDecoration: 'none' }}>
          {t('Spaces')}
        </Link>
        <span style={{ color: token('color.text.subtlest', '#626F86'), margin: '0 6px' }}>/</span>
        <span style={{ color: token('color.text.subtle', '#44546F') }}>{project?.name ?? projectKey}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{projectKey}</h1>
        <Avatar appearance="square" size="xsmall" src={project?.avatarUrl ?? undefined} name={project?.name ?? projectKey} />
        {project?.archivedAt && <Lozenge appearance="moved" isBold>{t('Archived')}</Lozenge>}
        <span style={{ color: token('color.text.subtlest', '#626F86'), display: 'inline-flex' }}>
          <ShowMoreHorizontalIcon label={t('More')} />
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
        }}
      >
        {TABS.filter(({ key }) => {
          // Space settings > Features can turn optional tabs off.
          const toggleable = key === 'timeline' || key === 'backlog' || key === 'reports' || key === 'releases'
          return !toggleable || project?.features?.[key] !== false
        }).map(({ key, label, path, icon: Icon }) => {
          const active = key === tab
          return (
            <button
              key={key}
              type="button"
              onClick={() => navigate(`/projects/${projectKey}/${path}`)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 10px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500,
                color: active ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
                boxShadow: active ? `inset 0 -2px 0 ${token('color.border.selected', '#0C66E4')}` : 'none',
              }}
            >
              <Icon label="" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
