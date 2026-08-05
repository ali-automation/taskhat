import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import Spinner from '@atlaskit/spinner'
import SectionMessage from '@atlaskit/section-message'
import Lozenge from '@atlaskit/lozenge'
import { token } from '@atlaskit/tokens'
import { useQueryClient } from '@tanstack/react-query'
import { useImportJob, useImportJobs, useRunImport, useStartImport } from '../api/hooks'
import { api, ApiError } from '../api/client'
import type { ImportJob, ImportStats } from '../api/types'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const statusAppearance: Record<ImportJob['status'], 'default' | 'inprogress' | 'success' | 'removed' | 'moved'> = {
  created: 'default',
  scanning: 'inprogress',
  scanned: 'moved',
  running: 'inprogress',
  done: 'success',
  failed: 'removed',
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 12, fontWeight: 600, ...subtleText, display: 'block', marginBottom: 2 }
}

function MappingTable({ title, entries }: { title: string; entries: Record<string, string> }) {
  const keys = Object.keys(entries)
  if (keys.length === 0) return null
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, margin: '10px 0 4px', textTransform: 'uppercase', ...subtleText }}>
        {title}
      </div>
      <table style={{ fontSize: 13, borderCollapse: 'collapse' }}>
        <tbody>
          {keys.sort().map((k) => (
            <tr key={k}>
              <td style={{ padding: '2px 16px 2px 0' }}>{k}</td>
              <td style={{ padding: '2px 0', ...subtleText }}>→ {entries[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatsCounts({ counts }: { counts: Record<string, number> | null }) {
  if (!counts) return null
  const labels: Record<string, string> = {
    issues: t('Issues found'),
    issuesCreated: t('Issues created'),
    issuesUpdated: t('Issues updated'),
    comments: t('Comments'),
    attachments: t('Attachments'),
    sprints: t('Sprints'),
    users: t('Users'),
    people: t('People'),
    usersMatched: t('Users matched'),
    statusesCreated: t('Statuses created'),
    workTypesCreated: t('Work types created'),
    fixVersions: t('Releases'),
    components: t('Components'),
    worklogs: t('Worklogs'),
    watchers: t('Watchers'),
    historyEvents: t('History events'),
    customValues: t('Custom values'),
    links: t('Epic/parent links'),
    failed: t('Failed items'),
  }
  return (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '8px 0' }}>
      {Object.entries(labels)
        .filter(([k]) => counts[k] !== undefined)
        .map(([k, label]) => (
          <div
            key={k}
            style={{
              border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 6,
              padding: '8px 14px',
              minWidth: 90,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 600 }}>{counts[k]}</div>
            <div style={{ fontSize: 11, ...subtleText }}>{label}</div>
          </div>
        ))}
    </div>
  )
}

function JobPanel({ jobId }: { jobId: string }) {
  const { data: job } = useImportJob(jobId)
  const runImport = useRunImport()
  if (!job) return <Spinner />
  const stats = job.stats as ImportStats

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>
          {job.projectKey} — {job.source === 'jira_api' ? t('Jira API') : t('CSV')}
        </span>
        <Lozenge appearance={statusAppearance[job.status]}>{job.status}</Lozenge>
        {(job.status === 'scanning' || job.status === 'running') && <Spinner size="small" />}
      </div>

      {stats?.progress && (job.status === 'scanning' || job.status === 'running') && (
        <div style={{ fontSize: 13, marginBottom: 8, ...subtleText }}>
          {stats.phase}: {stats.progress}
        </div>
      )}

      {job.status === 'failed' && (
        <SectionMessage appearance="error" title={t('Import failed')}>
          {job.error}
        </SectionMessage>
      )}

      {(job.status === 'scanned' || job.status === 'done' || job.status === 'running') && (
        <>
          <StatsCounts counts={stats?.counts ?? null} />
          {job.status === 'scanned' && (
            <>
              <SectionMessage appearance="discovery" title={t('Dry run complete — nothing imported yet')}>
                {t('Review the mapping below, then start the import. Re-running later is safe: items are matched by their Jira id and updated instead of duplicated.')}
              </SectionMessage>
              {stats?.mapping && (
                <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                  <MappingTable title={t('Issue types')} entries={stats.mapping.types} />
                  <MappingTable title={t('Statuses')} entries={stats.mapping.statuses} />
                  <MappingTable title={t('Priorities')} entries={stats.mapping.priorities} />
                  <MappingTable title={t('Users')} entries={stats.mapping.users} />
                </div>
              )}
              <div style={{ marginTop: 16 }}>
                <Button appearance="primary" isLoading={runImport.isPending} onClick={() => runImport.mutate(job.id)}>
                  {t('Start import')}
                </Button>
              </div>
            </>
          )}
          {job.status === 'done' && (
            <>
              {(stats?.errors?.length ?? 0) > 0 && (
                <SectionMessage appearance="warning" title={t('{n} items failed', { n: stats.errors!.length })}>
                  <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                    {stats.errors!.slice(0, 10).map((e, i) => (
                      <li key={i} style={{ fontSize: 12 }}>{e}</li>
                    ))}
                  </ul>
                </SectionMessage>
              )}
              <SectionMessage appearance="success" title={t('Import complete')}>
                <Link to={`/projects/${job.projectKey}/board`}>{t('Open the {key} board →', { key: job.projectKey })}</Link>
              </SectionMessage>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default function ImportPage() {
  const startImport = useStartImport()
  const { data: jobs } = useImportJobs()
  const qc = useQueryClient()
  const [activeJob, setActiveJob] = useState<string | null>(null)
  const deleteJob = async (id: string) => {
    await api(`/import/jira/${id}`, { method: 'DELETE' })
    if (activeJob === id) setActiveJob(null)
    void qc.invalidateQueries({ queryKey: ['import-jobs'] })
  }
  const [mode, setMode] = useState<'api' | 'csv'>('api')
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [projectKey, setProjectKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async () => {
    setError(null)
    try {
      let job
      if (mode === 'api') {
        job = await startImport.mutateAsync({ site, email, apiToken, projectKey })
      } else {
        const file = fileInput.current?.files?.[0]
        if (!file) {
          setError(t('Choose a Jira CSV export file first.'))
          return
        }
        const form = new FormData()
        form.append('file', file)
        if (projectKey.trim()) form.append('projectKey', projectKey.trim())
        job = await startImport.mutateAsync(form)
      }
      setActiveJob(job.id)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(Object.values(err.body.errors)[0] ?? err.message)
      } else {
        setError(t('failed to start import'))
      }
    }
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>{t('Import from Jira')}</h1>
      <p style={{ marginBottom: 16, ...subtleText }}>
        {t('Pull a project straight from Jira Cloud, or upload a CSV export. A dry run shows what will happen before anything is written.')}
      </p>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 340,
            flexShrink: 0,
            border: `1px solid ${token('color.border', '#DFE1E6')}`,
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            <Button appearance={mode === 'api' ? 'primary' : 'default'} spacing="compact" onClick={() => setMode('api')}>
              {t('Jira Cloud API')}
            </Button>
            <Button appearance={mode === 'csv' ? 'primary' : 'default'} spacing="compact" onClick={() => setMode('csv')}>
              {t('CSV export')}
            </Button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mode === 'api' ? (
              <>
                <label>
                  <span style={labelStyle()}>{t('Jira site URL')}</span>
                  <TextField isCompact value={site} onChange={(e) => setSite(e.currentTarget.value)} placeholder="https://your-team.atlassian.net" />
                </label>
                <label>
                  <span style={labelStyle()}>{t('Email')}</span>
                  <TextField isCompact value={email} onChange={(e) => setEmail(e.currentTarget.value)} placeholder="you@company.com" />
                </label>
                <label>
                  <span style={labelStyle()}>{t('API token')}</span>
                  <TextField isCompact type="password" value={apiToken} onChange={(e) => setApiToken(e.currentTarget.value)} placeholder={t('from id.atlassian.com')} />
                </label>
                <label>
                  <span style={labelStyle()}>{t('Project key')}</span>
                  <TextField isCompact value={projectKey} onChange={(e) => setProjectKey(e.currentTarget.value.toUpperCase())} placeholder="PROJ" />
                </label>
              </>
            ) : (
              <>
                <label>
                  <span style={labelStyle()}>{t('Jira CSV export file')}</span>
                  <input ref={fileInput} type="file" accept=".csv,text/csv" style={{ fontSize: 13 }} />
                </label>
                <label>
                  <span style={labelStyle()}>{t('Target project key (optional — defaults to keys in the file)')}</span>
                  <TextField isCompact value={projectKey} onChange={(e) => setProjectKey(e.currentTarget.value.toUpperCase())} placeholder="PROJ" />
                </label>
              </>
            )}
            {error && <div style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12 }}>{error}</div>}
            <Button appearance="primary" isLoading={startImport.isPending} onClick={submit}>
              {t('Scan (dry run)')}
            </Button>
          </div>

          {(jobs ?? []).length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', marginBottom: 6, ...subtleText }}>
                {t('Recent imports')}
              </div>
              {(jobs ?? []).map((j) => (
                <div
                  key={j.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveJob(j.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setActiveJob(j.id) }}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    width: '100%',
                    background: activeJob === j.id ? token('color.background.selected', '#E9F2FF') : 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    padding: '5px 8px',
                    fontSize: 13,
                    textAlign: 'start',
                  }}
                >
                  <span style={{ flex: 1 }}>{j.projectKey}</span>
                  <Lozenge appearance={statusAppearance[j.status]}>{j.status}</Lozenge>
                  {j.status !== 'scanning' && j.status !== 'running' && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={t('Delete import and its stored snapshot')}
                      onClick={(e) => { e.stopPropagation(); void deleteJob(j.id) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void deleteJob(j.id) } }}
                      style={{ color: token('color.text.subtlest', '#626F86'), lineHeight: 1, padding: '0 2px' }}
                    >
                      ✕
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeJob ? (
            <JobPanel jobId={activeJob} />
          ) : (
            <div style={{ padding: 40, textAlign: 'center', ...subtleText }}>
              {t('Start a scan or pick a recent import to see its report.')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
