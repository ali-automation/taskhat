import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Avatar from '@atlaskit/avatar'
import EmptyState from '@atlaskit/empty-state'
import { useProjects } from '../api/hooks'
import CreateProjectModal from '../components/CreateProjectModal'
import { t } from '../i18n'

// Jira's "Projects" directory page: name, key, type, lead.
export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects()
  const [createOpen, setCreateOpen] = useState(false)
  const navigate = useNavigate()

  const head = {
    cells: [
      { key: 'name', content: t('Name'), isSortable: true },
      { key: 'key', content: t('Key'), isSortable: true },
      { key: 'type', content: t('Type') },
      { key: 'lead', content: t('Lead') },
    ],
  }

  const rows = (projects ?? []).map((p) => ({
    key: p.id,
    cells: [
      {
        key: p.name,
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar appearance="square" size="small" src={p.avatarUrl ?? undefined} name={p.name} />
            <Link to={`/projects/${p.key}/issues`} style={{ fontWeight: 500 }}>
              {p.name}
            </Link>
          </span>
        ),
      },
      { key: p.key, content: p.key },
      { key: p.projectType, content: p.projectType === 'scrum' ? t('Scrum') : t('Kanban') },
      {
        key: p.lead.displayName,
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size="small" name={p.lead.displayName} />
            {p.lead.displayName}
          </span>
        ),
      },
    ],
  }))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 24 }}>{t('Projects')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => navigate('/import')}>{t('Import from Jira')}</Button>
          <Button appearance="primary" onClick={() => setCreateOpen(true)}>
            {t('Create project')}
          </Button>
        </div>
      </div>

      {!isLoading && (projects ?? []).length === 0 ? (
        <EmptyState
          header={t("You don't have any projects yet")}
          description={t('Create your first project to start tracking issues, just like in Jira.')}
          primaryAction={
            <Button appearance="primary" onClick={() => setCreateOpen(true)}>
              {t('Create project')}
            </Button>
          }
        />
      ) : (
        <DynamicTable head={head} rows={rows} isLoading={isLoading} rowsPerPage={25} defaultPage={1} />
      )}

      <CreateProjectModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
