import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Spinner from '@atlaskit/spinner'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useMembers, useProject } from '../api/hooks'
import type { Board } from '../api/types'
import { BoardSection } from './SpaceSettingsPage'
import { t } from '../i18n'

// Jira-parity board settings (board ⋯ > Board settings): own sub-nav with
// Details, Working Days, Timeline and the Layout group, plus a link out to
// space settings — mirroring Jira's takeover.

type Section = 'details' | 'working-days' | 'timeline' | 'columns' | 'swimlanes' | 'card-colors' | 'card-layout' | 'quick-filters'

const subtle = () => token('color.text.subtlest', '#626F86')
const cardStyle: React.CSSProperties = {
  border: `1px solid ${token('color.border', '#DFE1E6')}`,
  borderRadius: 8,
  padding: 20,
  marginBottom: 16,
}

function useBoard(boardId: string | undefined) {
  return useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api<Board>(`/boards/${boardId}`),
    enabled: !!boardId,
  })
}

export default function BoardSettingsPage() {
  const { id = '', section: sectionParam } = useParams()
  const navigate = useNavigate()
  const { data: board, isLoading } = useBoard(id)
  const projectKey = board?.projectKey
  const { data: project } = useProject(projectKey)
  const { data: members } = useMembers(projectKey)
  const section = (['details', 'working-days', 'timeline', 'columns', 'swimlanes', 'card-colors', 'card-layout', 'quick-filters']
    .includes(sectionParam ?? '') ? sectionParam : 'details') as Section

  if (isLoading || !board) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>
  }

  const navBtn = (key: Section, label: string, indent?: boolean) => {
    const active = key === section
    return (
      <button
        key={key}
        type="button"
        onClick={() => navigate(`/boards/${id}/settings/${key}`)}
        style={{
          display: 'block', width: '100%', textAlign: 'start',
          padding: '6px 10px', paddingInlineStart: indent ? 22 : 10, marginBottom: 1,
          border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 14,
          fontWeight: active ? 600 : 400,
          color: active ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
          background: active ? token('color.background.selected', '#E9F2FF') : 'none',
        }}
      >
        {label}
      </button>
    )
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ fontSize: 14, marginBottom: 2 }}>
        <Link to="/projects" style={{ color: token('color.text.subtle', '#44546F'), textDecoration: 'none' }}>{t('Spaces')}</Link>
        <span style={{ color: subtle(), margin: '0 6px' }}>/</span>
        <Link to={`/projects/${projectKey}/summary`} style={{ color: token('color.text.subtle', '#44546F'), textDecoration: 'none' }}>
          {project?.name ?? projectKey}
        </Link>
        <span style={{ color: subtle(), margin: '0 6px' }}>/</span>
        <span style={{ color: token('color.text.subtle', '#44546F') }}>{board.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Settings for {name}', { name: board.name })}</h1>
        <Link to={`/projects/${projectKey}/board/${board.id}`} style={{ fontSize: 14 }}>←{t('Back to board')}</Link>
      </div>

      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>
        <nav style={{ width: 200, flexShrink: 0 }}>
          {navBtn('details', t('Details'))}
          {navBtn('working-days', t('Working Days'))}
          {navBtn('timeline', t('Timeline'))}
          <div style={{ padding: '7px 10px 3px', fontSize: 13, fontWeight: 600, color: token('color.text.subtle', '#44546F') }}>
            {t('Layout')}
          </div>
          {navBtn('columns', t('Columns'), true)}
          {navBtn('swimlanes', t('Swimlanes'), true)}
          {navBtn('card-colors', t('Card colors'), true)}
          {navBtn('card-layout', t('Card layout'), true)}
          {navBtn('quick-filters', t('Quick filters'), true)}
          <div style={{ marginTop: 20, padding: '0 10px' }}>
            <Link to={`/projects/${projectKey}/settings/details`} style={{ fontSize: 14 }}>{t('View space settings')} ↗</Link>
            <p style={{ fontSize: 12, color: subtle(), marginTop: 4 }}>
              {t('To manage work types, workflows, permissions, and more visit your space settings.')}
            </p>
          </div>
        </nav>
        <div style={{ flex: 1, minWidth: 0 }}>
          {section === 'details' && <DetailsSection board={board} projectName={project?.name ?? ''} admins={(members ?? []).filter((m) => m.role === 'admin')} />}
          {section === 'working-days' && (
            <Info title={t('Working Days')}
              text={t('TaskHat estimates use an 8-hour working day and a 5-day working week (1w = 5d = 40h) everywhere durations appear. Per-board working-day calendars are on the roadmap.')} />
          )}
          {section === 'timeline' && (
            <Info title={t('Timeline')}
              text={t('The Timeline tab plans this space’s work on a Gantt-style schedule. Turn it on or off for everyone under Space settings → Features.')}
              links={[
                { label: t('Open timeline'), to: `/projects/${projectKey}/timeline` },
                { label: t('Features'), to: `/projects/${projectKey}/settings/features` },
              ]} />
          )}
          {section === 'columns' && projectKey && <BoardSection projectKey={projectKey} boardId={board.id} />}
          {section === 'swimlanes' && (
            <Info title={t('Swimlanes')}
              text={t('Jira groups board rows into swimlanes (by epic, assignee, or query). TaskHat boards show one lane today; swimlanes are on the roadmap.')} />
          )}
          {section === 'card-colors' && (
            <Info title={t('Card colors')}
              text={t('Jira colors cards by query or assignee. TaskHat cards show the work type icon and priority instead; card color rules are on the roadmap.')} />
          )}
          {section === 'card-layout' && (
            <Info title={t('Card layout')}
              text={t('Cards show the summary, key, work type, priority and assignee. Extra card fields are on the roadmap.')} />
          )}
          {section === 'quick-filters' && (
            <Info title={t('Quick filters')}
              text={t('Quick filters narrow the board with one click. This board ships with "Only my work items"; custom TQL quick filters are on the roadmap.')} />
          )}
        </div>
      </div>
    </div>
  )
}

function Info({ title, text, links }: { title: string; text: string; links?: { label: string; to: string }[] }) {
  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{title}</h3>
      <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F'), maxWidth: 640, lineHeight: 1.6 }}>{text}</p>
      {links && (
        <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
          {links.map((l) => <Link key={l.to} to={l.to} style={{ fontSize: 13 }}>{l.label}</Link>)}
        </div>
      )}
    </div>
  )
}

function DetailsSection({ board, projectName, admins }: {
  board: Board; projectName: string
  admins: { user: { id: string; displayName: string; avatarUrl: string | null } }[]
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(board.name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const save = () => {
    setSaving(true)
    setSaved(false)
    setError('')
    api<Board>(`/boards/${board.id}`, { method: 'PUT', body: JSON.stringify({ name: name.trim() }) })
      .then((updated) => {
        qc.setQueryData(['board', board.id], updated)
        qc.invalidateQueries({ queryKey: ['boards', board.projectKey] })
        setSaved(true)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')))
      .finally(() => setSaving(false))
  }

  const row = (label: string, required: boolean, children: React.ReactNode, hint?: string) => (
    <div style={{ marginBottom: 16, maxWidth: 440 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: token('color.text.subtle', '#44546F'), marginBottom: 4 }}>
        {label} {required && <span style={{ color: token('color.text.danger', '#AE2E24') }}>*</span>}
      </div>
      {children}
      {hint && <div style={{ fontSize: 12, color: subtle(), marginTop: 4 }}>{hint}</div>}
    </div>
  )

  return (
    <div style={cardStyle}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{t('General settings')}</h3>
      <p style={{ fontSize: 12, color: subtle(), marginBottom: 16 }}>
        {t('Required fields are marked with an asterisk')} <span style={{ color: token('color.text.danger', '#AE2E24') }}>*</span>
      </p>

      {row(t('Board name'), true,
        <TextField value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />)}
      {row(t('Administrators'), true, (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '6px 0' }}>
          {admins.map((m) => (
            <span key={m.user.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 10px 2px 2px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 16, fontSize: 13 }}>
              <Avatar size="xsmall" name={m.user.displayName} src={m.user.avatarUrl ?? undefined} />
              {m.user.displayName}
            </span>
          ))}
        </div>
      ), t('Space admins administer every board in the space.'))}
      {row(t('Location'), true,
        <TextField value={`${projectName} (${board.projectKey})`} isDisabled />)}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button appearance="primary" onClick={save} isLoading={saving} isDisabled={!name.trim()}>{t('Save')}</Button>
        {saved && <span style={{ fontSize: 13, color: token('color.text.success', '#216E4E') }}>{t('Saved')}</span>}
        {error && <span style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error}</span>}
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{t('Board filter')}</h3>
      <p style={{ fontSize: 13, color: token('color.text.subtle', '#44546F'), maxWidth: 640, lineHeight: 1.6 }}>
        {t('The board filter determines the work items that appear on your board. This board shows every work item in the {key} space; TQL-based board filters are on the roadmap.', { key: board.projectKey })}
      </p>
    </div>
  )
}
