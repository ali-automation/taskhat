import { Link, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Spinner from '@atlaskit/spinner'
import DynamicTable from '@atlaskit/dynamic-table'
import { token } from '@atlaskit/tokens'
import { usePersonProfile, useSearch } from '../api/hooks'
import { t } from '../i18n'
import { IssueTypeIcon, StatusLozenge } from '../components/icons'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Public profile page: banner, avatar, details card, shared spaces, open work.
export default function PeoplePage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading } = usePersonProfile(id)
  const profile = data?.profile
  const tql = profile ? `assignee = ${profile.email} AND resolution = EMPTY ORDER BY updated DESC` : ''
  const { data: work } = useSearch(tql, 0, !!profile)

  if (isLoading || !profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  const rows = (work?.values ?? []).slice(0, 10).map((issue) => ({
    key: issue.id,
    cells: [
      { key: 't', content: <IssueTypeIcon type={issue.type} /> },
      { key: 'key', content: <Link to={`/browse/${issue.key}`}>{issue.key}</Link> },
      { key: 'summary', content: <Link to={`/browse/${issue.key}`}>{issue.summary}</Link> },
      { key: 'status', content: <StatusLozenge name={issue.status.name} category={issue.status.category} /> },
    ],
  }))

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${token('color.border', '#DFE1E6')}`, marginBottom: 24 }}>
        <div
          style={{
            height: 140,
            background: profile.headerUrl
              ? `url(${profile.headerUrl}) center/cover`
              : 'linear-gradient(90deg, #FFAB00, #FFE380)',
          }}
        />
        <div style={{ padding: '0 28px 20px', display: 'flex', gap: 20, alignItems: 'flex-end' }}>
          <div style={{ marginTop: -52, borderRadius: '50%', border: `4px solid ${token('elevation.surface', '#FFFFFF')}` }}>
            <Avatar size="xxlarge" name={profile.displayName} src={profile.avatarUrl ?? undefined} />
          </div>
          <div style={{ paddingBottom: 4 }}>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {profile.publicName || profile.displayName}
              {!profile.isActive && (
                <span style={{ fontSize: 12, fontWeight: 600, marginInlineStart: 8, ...subtleText }}>{t('(deactivated)')}</span>
              )}
            </div>
            <div style={{ fontSize: 13, ...subtleText }}>
              {[profile.jobTitle, profile.department, profile.organization].filter(Boolean).join(' · ') || profile.email}
              {profile.location && ` · ${profile.location}`}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', marginBottom: 10, ...subtleText }}>
            {t('Works with you in')}
          </div>
          {(data?.sharedProjects ?? []).map((p) => (
            <Link
              key={p.id}
              to={`/projects/${p.key}/summary`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13, textDecoration: 'none', color: 'inherit' }}
            >
              <Avatar appearance="square" size="xsmall" name={p.name} /> {p.name}
            </Link>
          ))}
          {(data?.sharedProjects ?? []).length === 0 && (
            <span style={{ fontSize: 13, ...subtleText }}>{t('No shared spaces.')}</span>
          )}
        </div>

        <div>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
            {t('Open work items')} {work ? `(${work.total})` : ''}
          </div>
          <DynamicTable
            head={{ cells: [{ key: 't', content: '' }, { key: 'key', content: t('Key') }, { key: 'summary', content: t('Summary') }, { key: 'status', content: t('Status') }] }}
            rows={rows}
          />
        </div>
      </div>
    </div>
  )
}
