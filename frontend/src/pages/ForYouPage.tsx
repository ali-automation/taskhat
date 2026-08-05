import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Badge from '@atlaskit/badge'
import { token } from '@atlaskit/tokens'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { User } from '../api/client'
import { useProjects } from '../api/hooks'
import { IssueTypeIcon, StatusLozenge } from '../components/icons'
import { fmtDate, t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

interface ForYouIssue {
  key: string
  summary: string
  type: string
  statusName: string
  statusCategory: string
  projectKey: string
  projectName: string
  at: string
  assignee: User | null
}

interface ForYouData {
  recommended: { key: string; openCount: number; at: string }[]
  assigned: ForYouIssue[]
  assignedCount: number
  workedOn: ForYouIssue[]
  viewed: ForYouIssue[]
}

type Tab = 'assigned' | 'worked' | 'viewed'

// Recency buckets, like Jira's "In the last month" grouping.
function bucketOf(at: string): string {
  const days = (Date.now() - new Date(at).getTime()) / 86400e3
  if (days < 1) return t('Today')
  if (days < 7) return t('In the last week')
  if (days < 31) return t('In the last month')
  return t('Older')
}

// Jira's For-you home: recommended spaces + your work item tabs.
export default function ForYouPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('assigned')
  const { data } = useQuery({ queryKey: ['foryou'], queryFn: () => api<ForYouData>('/foryou') })
  const { data: projects } = useProjects()

  const items = (tab === 'assigned' ? data?.assigned : tab === 'worked' ? data?.workedOn : data?.viewed) ?? []
  const groups: { label: string; rows: ForYouIssue[] }[] = []
  for (const it of items) {
    const label = bucketOf(it.at)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.rows.push(it)
    else groups.push({ label, rows: [it] })
  }

  const pill = (key: Tab, label: string, badge?: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 14,
        borderRadius: 20, cursor: 'pointer',
        border: `1px solid ${tab === key ? token('color.border.selected', '#0C66E4') : token('color.border', '#DFE1E6')}`,
        background: tab === key ? token('color.background.selected', '#E9F2FF') : 'transparent',
        color: tab === key ? token('color.text.selected', '#0C66E4') : 'inherit',
        fontWeight: tab === key ? 600 : 400,
      }}
    >
      {label}
      {badge !== undefined && badge > 0 && <Badge appearance="primary">{badge}</Badge>}
    </button>
  )

  const recommended = (data?.recommended ?? [])
    .map((r) => ({ ...r, project: (projects ?? []).find((p) => p.key === r.key) }))
    .filter((r) => r.project)

  return (
    <div style={{ padding: '8px 8px 64px', maxWidth: 1120 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t('Recommended spaces')}</h2>
        <Link to="/projects" style={{ fontSize: 13 }}>{t('View all spaces')}</Link>
      </div>
      {recommended.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 0 40px' }}>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>{t('No spaces found')}</div>
          <div style={{ fontSize: 13, ...subtleText }}>{t('Any recommended spaces will appear here')}</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14, marginBottom: 30 }}>
          {recommended.map((r) => (
            <div
              key={r.key}
              onClick={() => navigate(`/projects/${r.key}/summary`)}
              style={{
                border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8,
                padding: '14px 16px', cursor: 'pointer', display: 'flex', gap: 12, alignItems: 'center',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F7F8F9'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Avatar appearance="square" size="medium" name={r.project!.name} src={r.project!.avatarUrl ?? undefined} />
              <span style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.project!.name}
                </div>
                <div style={{ fontSize: 12, ...subtleText }}>
                  {r.key} · {t('{n} open work items', { n: r.openCount })}
                </div>
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{t('For you')}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {pill('assigned', t('Assigned to me'), data?.assignedCount)}
          {pill('worked', t('Worked on'))}
          {pill('viewed', t('Viewed'))}
        </div>
      </div>

      {items.length === 0 && (
        <div style={{ fontSize: 13, padding: '18px 0', ...subtleText }}>
          {tab === 'assigned'
            ? t('Nothing assigned to you — enjoy the calm.')
            : tab === 'worked'
              ? t('Work items you edit, comment on or log time to will show up here.')
              : t('Work items you open will show up here.')}
        </div>
      )}
      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, ...subtleText }}>{g.label}</div>
          {g.rows.map((it) => (
            <div
              key={it.key}
              onClick={() => navigate(`/browse/${it.key}`)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', cursor: 'pointer',
                borderBottom: `1px solid ${token('color.border', '#F1F2F4')}`, borderRadius: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = token('color.background.neutral.subtle.hovered', '#F7F8F9'))}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <IssueTypeIcon type={it.type} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.summary}
                </div>
                <div style={{ fontSize: 12, ...subtleText }}>
                  {it.type.charAt(0).toUpperCase() + it.type.slice(1)} · {it.key} · {it.projectName}
                </div>
              </span>
              <StatusLozenge name={it.statusName} category={it.statusCategory as 'todo' | 'in_progress' | 'done'} />
              {it.assignee && (
                <Avatar size="small" name={it.assignee.displayName} src={it.assignee.avatarUrl ?? undefined} />
              )}
              <span style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 64, textAlign: 'end', ...subtleText }}>
                {fmtDate(it.at)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
