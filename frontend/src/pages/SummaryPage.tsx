import { useParams, Link } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useProjectSummary } from '../api/hooks'
import SpaceHeader from '../components/SpaceHeader'
import { issueTypeLabel } from '../components/icons'
import { t, timeAgo } from '../i18n'
import type { IssueType, StatusCategory, StatusCount } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Status palette: these ARE statuses, so they wear the reserved status hues,
// always accompanied by a text legend with counts (never color alone).
const categoryColor: Record<StatusCategory, string> = {
  todo: '#8590A2',
  in_progress: '#357DE8',
  done: '#22A06B',
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 8,
        padding: 16,
        background: token('elevation.surface', '#FFFFFF'),
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        flex: 1,
        border: `1px solid ${token('color.border', '#DFE1E6')}`,
        borderRadius: 8,
        padding: '14px 16px',
        background: token('elevation.surface', '#FFFFFF'),
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.2 }}>{value}</div>
      <div style={{ fontSize: 12, ...subtleText }}>{label}</div>
    </div>
  )
}

// Donut of status distribution: ring segments with 2px surface gaps, percent
// complete in the center, legend with explicit counts beside it.
function StatusDonut({ counts, total, done }: { counts: StatusCount[]; total: number; done: number }) {
  const size = 160
  const r = 60
  const stroke = 22
  const c = 2 * Math.PI * r
  const gap = total > 1 ? 2 : 0

  let offset = 0
  const segments = counts
    .filter((sc) => sc.count > 0)
    .map((sc) => {
      const frac = sc.count / total
      const len = Math.max(frac * c - gap, 1)
      const seg = { color: categoryColor[sc.category], dash: `${len} ${c - len}`, offset }
      offset -= frac * c
      return seg
    })

  const pct = total ? Math.round((done / total) * 100) : 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={t('Issues by status')}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={token('color.background.neutral', '#F1F2F4')}
          strokeWidth={stroke}
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={s.color}
            strokeWidth={stroke}
            strokeDasharray={s.dash}
            strokeDashoffset={s.offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
        <text x="50%" y="47%" textAnchor="middle" fontSize="26" fontWeight="600" fill="currentColor">
          {pct}%
        </text>
        <text x="50%" y="61%" textAnchor="middle" fontSize="11" fill={token('color.text.subtlest', '#626F86')}>
          {t('complete')}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {counts.map((sc) => (
          <div key={sc.status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: categoryColor[sc.category], flexShrink: 0 }} />
            <span style={{ minWidth: 90 }}>{sc.status}</span>
            <span style={{ fontWeight: 600 }}>{sc.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function describeActivity(field: string, newValue: string): string {
  const clean = newValue.replaceAll('"', '')
  switch (field) {
    case 'created':
      return t('created')
    case 'status':
      return t('moved to {status}', { status: clean })
    case 'comment':
      return t('commented on')
    case 'attachment':
      return t('attached a file to')
    default:
      return t('updated {field} on', { field })
  }
}

export default function SummaryPage() {
  const { key } = useParams<{ key: string }>()
  const projectKey = key?.toUpperCase()
  const { data: summary, isLoading } = useProjectSummary(projectKey)

  if (isLoading || !summary) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <Spinner size="large" />
      </div>
    )
  }

  const workload = summary.workload ?? []
  const maxLoad = Math.max(1, ...workload.map((w) => w.openCount))

  return (
    <div style={{ maxWidth: 960 }}>
      <SpaceHeader projectKey={projectKey ?? ''} tab="summary" />

      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <StatTile label={t('Total issues')} value={summary.total} />
        <StatTile label={t('Open')} value={summary.open} />
        <StatTile label={t('Done')} value={summary.done} />
        {(Object.keys(summary.typeCounts) as IssueType[]).slice(0, 2).map((t) => (
          <StatTile key={t} label={issueTypeLabel[t] ?? t} value={summary.typeCounts[t]} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title={t('Status overview')}>
          {summary.total === 0 ? (
            <span style={subtleText}>{t('No issues yet.')}</span>
          ) : (
            <StatusDonut counts={summary.statusCounts ?? []} total={summary.total} done={summary.done} />
          )}
        </Card>

        <Card title={t('Team workload (open issues)')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {workload.map((w, i) => (
              <div key={w.user?.id ?? `unassigned-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {w.user ? <Avatar size="small" name={w.user.displayName} src={w.user.avatarUrl ?? undefined} /> : <Avatar size="small" />}
                <span style={{ width: 130, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.user?.displayName ?? <span style={subtleText}>{t('Unassigned')}</span>}
                </span>
                <div style={{ flex: 1, height: 8, background: token('color.background.neutral', '#F1F2F4'), borderRadius: 4 }}>
                  <div
                    style={{
                      width: `${(w.openCount / maxLoad) * 100}%`,
                      height: 8,
                      borderRadius: 4,
                      background: '#357DE8',
                    }}
                  />
                </div>
                <span style={{ fontSize: 13, fontWeight: 600, width: 24, textAlign: 'end' }}>{w.openCount}</span>
              </div>
            ))}
            {workload.length === 0 && <span style={subtleText}>{t('No open issues.')}</span>}
          </div>
        </Card>
      </div>

      <Card title={t('Recent activity')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(summary.activity ?? []).map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <Avatar size="xsmall" name={a.actor.displayName} src={a.actor.avatarUrl ?? undefined} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <strong>{a.actor.displayName}</strong> {describeActivity(a.field, a.newValue)}{' '}
                <Link to={`/browse/${a.issueKey}`}>{a.issueKey}</Link>
                <span style={subtleText}> — {a.issueSummary}</span>
              </span>
              <span style={{ marginInlineStart: 'auto', flexShrink: 0, fontSize: 11, ...subtleText }}>{timeAgo(a.createdAt)}</span>
            </div>
          ))}
          {(summary.activity ?? []).length === 0 && <span style={subtleText}>{t('No activity yet.')}</span>}
        </div>
      </Card>
    </div>
  )
}
