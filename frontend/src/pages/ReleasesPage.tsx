import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Button, { IconButton } from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Select from '@atlaskit/select'
import Spinner from '@atlaskit/spinner'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import { Field } from '@atlaskit/form'
import { token } from '@atlaskit/tokens'
import {
  useCreateVersion, useDeleteVersion, useSetVersionStatus, useUpdateVersion, useVersion, useVersions,
} from '../api/hooks'
import { ApiError } from '../api/client'
import SpaceHeader from '../components/SpaceHeader'
import { IssueTypeIcon } from '../components/icons'
import { ShowMoreHorizontalIcon } from '../components/coreIcons'
import { fmtDate, t } from '../i18n'
import type { Version } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function statusLozenge(v: Version) {
  if (v.status === 'released') return <Lozenge appearance="success">{t('Released')}</Lozenge>
  if (v.status === 'archived') return <Lozenge>{t('Archived')}</Lozenge>
  return <Lozenge appearance="inprogress">{t('Unreleased')}</Lozenge>
}

// Jira's release progress bar: green done vs blue open.
function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 160 }}>
      <div style={{ flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', background: token('color.background.accent.blue.subtler', '#CCE0FF'), display: 'flex' }}>
        <div style={{ width: `${pct}%`, background: token('color.background.accent.green.bolder', '#1F845A') }} />
      </div>
      <span style={{ fontSize: 12, whiteSpace: 'nowrap', ...subtleText }}>
        {total > 0 ? t('{done} of {total} done', { done, total }) : t('No work items')}
      </span>
    </div>
  )
}

function VersionModal({ projectKey, version, onClose }: { projectKey: string; version: Version | null; onClose: () => void }) {
  const create = useCreateVersion(projectKey)
  const update = useUpdateVersion(projectKey)
  const [name, setName] = useState(version?.name ?? '')
  const [description, setDescription] = useState(version?.description ?? '')
  const [startDate, setStartDate] = useState(version?.startDate?.slice(0, 10) ?? '')
  const [releaseDate, setReleaseDate] = useState(version?.releaseDate?.slice(0, 10) ?? '')
  const [error, setError] = useState('')
  const pending = create.isPending || update.isPending

  const save = () => {
    setError('')
    const body = { name: name.trim(), description: description.trim(), startDate, releaseDate }
    const onError = (e: unknown) => setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Something went wrong'))
    if (version) update.mutate({ id: version.id, ...body }, { onSuccess: onClose, onError })
    else create.mutate(body, { onSuccess: onClose, onError })
  }

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{version ? t('Edit version') : t('Create version')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Field name="name" label={t('Version name')} isRequired>
            {() => <TextField value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t('e.g. 2.1.0')} autoFocus />}
          </Field>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Field name="startDate" label={t('Start date')}>
                {() => <TextField type="date" value={startDate} onChange={(e) => setStartDate((e.target as HTMLInputElement).value)} />}
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field name="releaseDate" label={t('Release date')}>
                {() => <TextField type="date" value={releaseDate} onChange={(e) => setReleaseDate((e.target as HTMLInputElement).value)} />}
              </Field>
            </div>
          </div>
          <Field name="description" label={t('Description')}>
            {() => <TextArea value={description} onChange={(e) => setDescription(e.currentTarget.value)} minimumRows={2} />}
          </Field>
          {error && <p style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 13 }}>{error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button appearance="primary" isLoading={pending} isDisabled={!name.trim()} onClick={save}>
            {version ? t('Save') : t('Create')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// Jira's release dialog: warn about open items, offer to move them.
function ReleaseModal({ projectKey, version, others, onClose }: { projectKey: string; version: Version; others: Version[]; onClose: () => void }) {
  const setStatus = useSetVersionStatus(projectKey)
  const open = version.total - version.done
  const [moveTo, setMoveTo] = useState<string | undefined>()
  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{t('Release {name}', { name: version.name })}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          {open > 0 ? (
            <>
              <p style={{ fontSize: 14 }}>{t('This version has {n} unresolved work items.', { n: open })}</p>
              <Field name="moveTo" label={t('Move open work items to')}>
                {() => (
                  <Select
                    options={[{ label: t('Leave them on this version'), value: '' },
                      ...others.filter((v) => v.status === 'unreleased').map((v) => ({ label: v.name, value: v.id }))]}
                    onChange={(o) => setMoveTo(o?.value || undefined)}
                    placeholder={t('Leave them on this version')}
                  />
                )}
              </Field>
            </>
          ) : (
            <p style={{ fontSize: 14 }}>{t('All work items on this version are done.')}</p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button appearance="primary" isLoading={setStatus.isPending}
            onClick={() => setStatus.mutate({ id: version.id, status: 'released', moveOpenTo: moveTo }, { onSuccess: onClose })}>
            {t('Release')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// The version detail: progress + its work items (Jira's release page).
function VersionDetail({ projectKey, versionId, onBack }: { projectKey: string; versionId: string; onBack: () => void }) {
  const { data, isLoading } = useVersion(projectKey, versionId)
  if (isLoading || !data) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Spinner size="large" /></div>
  const { version, issues } = data
  return (
    <div>
      <Button appearance="subtle" spacing="compact" onClick={onBack}>← {t('All versions')}</Button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '12px 0 4px' }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>{version.name}</h2>
        {statusLozenge(version)}
      </div>
      {version.description && <p style={{ fontSize: 13, margin: '4px 0', ...subtleText }}>{version.description}</p>}
      <div style={{ fontSize: 12, marginBottom: 12, ...subtleText }}>
        {version.startDate && <>{t('Start date')}: {fmtDate(version.startDate)} · </>}
        {version.releaseDate && <>{t('Release date')}: {fmtDate(version.releaseDate)}</>}
      </div>
      <div style={{ maxWidth: 420, marginBottom: 20 }}>
        <ProgressBar done={version.done} total={version.total} />
      </div>
      <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, overflow: 'hidden' }}>
        {issues.map((i) => (
          <Link key={i.id} to={`/browse/${i.key}`} style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', fontSize: 14,
            borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`, color: 'inherit', textDecoration: 'none',
          }}>
            <IssueTypeIcon type={i.type} />
            <span style={{ ...subtleText, fontSize: 12, textDecoration: i.resolution ? 'line-through' : 'none' }}>{i.key}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</span>
            <Lozenge appearance={i.status.category === 'done' ? 'success' : i.status.category === 'in_progress' ? 'inprogress' : 'default'}>
              {i.status.name}
            </Lozenge>
          </Link>
        ))}
        {issues.length === 0 && <div style={{ padding: 20, fontSize: 13, textAlign: 'center', ...subtleText }}>{t('No work items on this version yet. Set a fix version on a work item to plan it here.')}</div>}
      </div>
    </div>
  )
}

export default function ReleasesPage() {
  const { key, versionId } = useParams<{ key: string; versionId?: string }>()
  const projectKey = key?.toUpperCase() ?? ''
  const navigate = useNavigate()
  const { data: versions, isLoading } = useVersions(projectKey)
  const setStatus = useSetVersionStatus(projectKey)
  const deleteVersion = useDeleteVersion(projectKey)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Version | null>(null)
  const [releasing, setReleasing] = useState<Version | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const visible = useMemo(
    () => (versions ?? []).filter((v) => showArchived || v.status !== 'archived'),
    [versions, showArchived],
  )
  const archivedCount = (versions ?? []).filter((v) => v.status === 'archived').length
  const border = token('color.border', '#DFE1E6')

  return (
    <div>
      <SpaceHeader projectKey={projectKey} tab="releases" />
      {versionId ? (
        <VersionDetail projectKey={projectKey} versionId={versionId} onBack={() => navigate(`/projects/${projectKey}/releases`)} />
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 16px' }}>
            <span style={{ fontSize: 13, ...subtleText }}>
              {t('Plan and track what ships, like Jira releases.')}
              {archivedCount > 0 && (
                <Button appearance="subtle" spacing="compact" onClick={() => setShowArchived(!showArchived)}>
                  {showArchived ? t('Hide archived') : t('Show archived ({n})', { n: archivedCount })}
                </Button>
              )}
            </span>
            <Button appearance="primary" onClick={() => setCreating(true)}>{t('Create version')}</Button>
          </div>

          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}><Spinner size="large" /></div>
          ) : (
            <div style={{ border: `1px solid ${border}`, borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '220px 110px 1fr 110px 110px 40px', gap: 12, padding: '8px 14px', fontSize: 12, fontWeight: 700, borderBottom: `1px solid ${border}`, ...subtleText }}>
                <span>{t('Version')}</span><span>{t('Status')}</span><span>{t('Progress')}</span>
                <span>{t('Start date')}</span><span>{t('Release date')}</span><span />
              </div>
              {visible.map((v) => (
                <div key={v.id}
                  onClick={() => navigate(`/projects/${projectKey}/releases/${v.id}`)}
                  style={{ display: 'grid', gridTemplateColumns: '220px 110px 1fr 110px 110px 40px', gap: 12, alignItems: 'center', padding: '10px 14px', fontSize: 14, borderBottom: `1px solid ${border}`, cursor: 'pointer' }}>
                  <span style={{ fontWeight: 600, color: token('color.link', '#0C66E4'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
                  <span>{statusLozenge(v)}</span>
                  <ProgressBar done={v.done} total={v.total} />
                  <span style={{ fontSize: 12, ...subtleText }}>{v.startDate ? fmtDate(v.startDate) : '—'}</span>
                  <span style={{ fontSize: 12, ...subtleText }}>{v.releaseDate ? fmtDate(v.releaseDate) : '—'}</span>
                  <span onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu<HTMLButtonElement>
                      trigger={({ triggerRef, ...props }) => (
                        <IconButton {...props} ref={triggerRef} icon={ShowMoreHorizontalIcon} label={t('Version actions')} appearance="subtle" spacing="compact" />
                      )}
                      shouldRenderToParent
                    >
                      <DropdownItemGroup>
                        {v.status === 'unreleased' && <DropdownItem onClick={() => setReleasing(v)}>{t('Release')}</DropdownItem>}
                        {v.status === 'released' && (
                          <DropdownItem onClick={() => setStatus.mutate({ id: v.id, status: 'unreleased' })}>{t('Unrelease')}</DropdownItem>
                        )}
                        <DropdownItem onClick={() => setEditing(v)}>{t('Edit')}</DropdownItem>
                        {v.status !== 'archived' ? (
                          <DropdownItem onClick={() => setStatus.mutate({ id: v.id, status: 'archived' })}>{t('Archive')}</DropdownItem>
                        ) : (
                          <DropdownItem onClick={() => setStatus.mutate({ id: v.id, status: 'unreleased' })}>{t('Restore')}</DropdownItem>
                        )}
                        <DropdownItem onClick={() => {
                          if (window.confirm(t('Delete version "{name}"? Work items keep their other versions.', { name: v.name })))
                            deleteVersion.mutate(v.id)
                        }}>{t('Delete')}</DropdownItem>
                      </DropdownItemGroup>
                    </DropdownMenu>
                  </span>
                </div>
              ))}
              {visible.length === 0 && (
                <div style={{ padding: 28, textAlign: 'center', fontSize: 13, ...subtleText }}>
                  {t('No versions yet. Create one to start planning releases.')}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {creating && <VersionModal projectKey={projectKey} version={null} onClose={() => setCreating(false)} />}
      {editing && <VersionModal projectKey={projectKey} version={editing} onClose={() => setEditing(null)} />}
      {releasing && <ReleaseModal projectKey={projectKey} version={releasing} others={versions ?? []} onClose={() => setReleasing(null)} />}
    </div>
  )
}
