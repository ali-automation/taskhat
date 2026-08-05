import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import DynamicTable from '@atlaskit/dynamic-table'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAdminCreateField, useAdminCreateWorkType, useAdminDeleteField, useAdminDeleteWorkType,
  useAdminFields, useAdminUpdateWorkType, useAdminWorkTypes, useAdminWorkflows,
  useAssignAdminWorkflow, useCopyAdminWorkflow, useCreateAdminWorkflow, useDeleteAdminWorkflow,
  useProjects,
} from '../api/hooks'
import { IssueTypeIcon } from '../components/icons'
import type { AdminWorkflowRow, WorkType } from '../api/types'
import { fmtDate, t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function useErrorBanner(): [string | null, (e: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null)
  return [
    error,
    (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong')),
    () => setError(null),
  ]
}

const GLYPH_OPTIONS = (['task', 'story', 'bug', 'epic', 'subtask'] as const).map((g) => ({ label: g, value: g }))

// ---- Work types ----

export function WorkTypesAdmin() {
  const { data: types } = useAdminWorkTypes()
  const createType = useAdminCreateWorkType()
  const updateType = useAdminUpdateWorkType()
  const deleteType = useAdminDeleteWorkType()
  const [error, fail, clearError] = useErrorBanner()
  const [newName, setNewName] = useState('')
  const [newGlyph, setNewGlyph] = useState<'task' | 'story' | 'bug' | 'epic' | 'subtask'>('task')
  const [newColor, setNewColor] = useState('#357DE8')

  const save = (t: WorkType, patch: Partial<WorkType>) => {
    clearError()
    updateType.mutate(
      { id: t.id, name: patch.name ?? t.name, glyph: patch.glyph ?? t.glyph, color: patch.color ?? t.color, isEnabled: patch.isEnabled ?? t.isEnabled },
      { onError: fail },
    )
  }

  const rows = (types ?? []).map((wt) => ({
    key: wt.id,
    cells: [
      { key: 'icon', content: <IssueTypeIcon type={wt.key} /> },
      {
        key: 'name',
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 500 }}>{wt.name}</span>
            {wt.builtin && <Lozenge>{t('Built-in')}</Lozenge>}
            {!wt.isEnabled && <Lozenge appearance="moved">{t('Disabled')}</Lozenge>}
          </span>
        ),
      },
      { key: 'key', content: <code style={{ fontSize: 12, ...subtleText }}>{wt.key}</code> },
      {
        key: 'color',
        content: (
          <input
            type="color"
            value={wt.color}
            onChange={(e) => save(wt, { color: e.currentTarget.value })}
            style={{ width: 32, height: 24, border: 'none', background: 'none', cursor: 'pointer' }}
            title={t('Type color (used for custom type icons)')}
          />
        ),
      },
      {
        key: 'enabled',
        content: (
          <Toggle
            isChecked={wt.isEnabled}
            isDisabled={wt.key === 'task'}
            onChange={() => save(wt, { isEnabled: !wt.isEnabled })}
          />
        ),
      },
      {
        key: 'actions',
        content: !wt.builtin && (
          <Button appearance="subtle" spacing="compact" onClick={() => { clearError(); deleteType.mutate(wt.id, { onError: fail }) }}>
            {t('Delete')}
          </Button>
        ),
      },
    ],
  }))

  return (
    <div style={{ maxWidth: 860 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Work types')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Site-wide work item types. Disable types you don’t use, or add your own — custom types show a colored icon with their initial. The Task type stays enabled as the fallback.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
      <DynamicTable
        head={{ cells: [
          { key: 'i', content: '' },
          { key: 'n', content: t('Name') },
          { key: 'k', content: t('Key') },
          { key: 'c', content: t('Color') },
          { key: 'e', content: t('Enabled') },
          { key: 'a', content: '' },
        ] }}
        rows={rows}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16 }}>
        <div style={{ flex: 1 }}>
          <TextField placeholder={t('New work type name (e.g. Incident)')} value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
        </div>
        <div style={{ width: 130 }}>
          <Select options={GLYPH_OPTIONS} value={GLYPH_OPTIONS.find((o) => o.value === newGlyph)} onChange={(o) => o && setNewGlyph(o.value)} />
        </div>
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.currentTarget.value)} style={{ width: 36, height: 32, border: 'none', background: 'none', cursor: 'pointer' }} />
        <Button
          appearance="primary"
          isDisabled={!newName.trim()}
          isLoading={createType.isPending}
          onClick={() => {
            clearError()
            createType.mutate(
              { name: newName.trim(), glyph: newGlyph, color: newColor },
              { onSuccess: () => setNewName(''), onError: fail },
            )
          }}
        >
          {t('Add type')}
        </Button>
      </div>
    </div>
  )
}

// ---- Workflows directory (Jira: Settings → Work items → Workflows) ----

const workflowGlyph = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
    <circle cx="8" cy="3" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="3.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="12.5" r="1.8" stroke="currentColor" strokeWidth="1.4" />
    <path d="M7 4.5 4.2 10.8M9 4.5l2.8 6.3" stroke="currentColor" strokeWidth="1.4" />
  </svg>
)

export function WorkflowsAdmin() {
  const navigate = useNavigate()
  const { data: workflows } = useAdminWorkflows()
  const { data: projects } = useProjects()
  const createWorkflow = useCreateAdminWorkflow()
  const copyWorkflow = useCopyAdminWorkflow()
  const deleteWorkflow = useDeleteAdminWorkflow()
  const assignWorkflow = useAssignAdminWorkflow()
  const [error, fail, clearError] = useErrorBanner()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [assigning, setAssigning] = useState<AdminWorkflowRow | null>(null)
  const [assignKey, setAssignKey] = useState<string | null>(null)

  const border = token('color.border', '#DFE1E6')
  const projectByKey = new Map((projects ?? []).map((p) => [p.key, p]))

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Workflows')}</h1>
        <Button appearance="primary" onClick={() => { setNewName(''); setCreating(true) }}>{t('Create workflow')}</Button>
      </div>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Workflows define the statuses and transitions work items move through. Active workflows are used by a space; inactive ones can be edited freely, then assigned. Editing opens the diagram editor.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}

      <div style={{ border: `1px solid ${border}`, borderRadius: 6 }}>
        <div style={{ display: 'flex', gap: 12, padding: '8px 12px', fontSize: 12, fontWeight: 700, borderBottom: `2px solid ${border}`, ...subtleText }}>
          <span style={{ flex: 2 }}>{t('Workflow')}</span>
          <span style={{ flex: 2 }}>{t('Spaces')}</span>
          <span style={{ width: 110 }}>{t('Last edited')}</span>
          <span style={{ width: 32 }} />
        </div>
        {(workflows ?? []).map((wf) => (
          <div key={wf.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${border}`, fontSize: 14 }}>
            <span style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ flexShrink: 0, display: 'inline-flex', ...subtleText }}>{workflowGlyph}</span>
              <a
                style={{ fontWeight: 500, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onClick={() => navigate(`/admin/workflows/${wf.id}/edit`)}
              >
                {wf.name}
              </a>
              {wf.isDefault && <Lozenge>{t('Default')}</Lozenge>}
              {!wf.isDefault && wf.spaces.length === 0 && <Lozenge appearance="moved">{t('Inactive')}</Lozenge>}
            </span>
            <span style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              {wf.spaces.length === 0 && <span style={{ fontSize: 13, ...subtleText }}>—</span>}
              {wf.spaces.map((sp) => (
                <Link key={sp.key} to={`/projects/${sp.key}/summary`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, width: 'fit-content' }}>
                  <Avatar appearance="square" size="xsmall" name={sp.name} src={projectByKey.get(sp.key)?.avatarUrl ?? undefined} />
                  {sp.name}
                </Link>
              ))}
            </span>
            <span style={{ width: 110, fontSize: 13, ...subtleText }}>{fmtDate(wf.updatedAt)}</span>
            <span style={{ width: 32 }}>
              <DropdownMenu
                trigger={({ triggerRef, ...props }) => (
                  <Button {...props} ref={triggerRef} appearance="subtle" spacing="compact" aria-label={t('More actions')}>⋯</Button>
                )}
              >
                <DropdownItemGroup>
                  <DropdownItem onClick={() => navigate(`/admin/workflows/${wf.id}/edit`)}>{t('Edit')}</DropdownItem>
                  <DropdownItem
                    onClick={() => { clearError(); copyWorkflow.mutate(wf.id, { onError: fail }) }}
                  >
                    {t('Copy')}
                  </DropdownItem>
                  <DropdownItem onClick={() => { setAssignKey(null); setAssigning(wf) }}>{t('Assign to space…')}</DropdownItem>
                  {!wf.isDefault && wf.spaces.length === 0 && (
                    <DropdownItem
                      onClick={() => {
                        clearError()
                        if (window.confirm(t('Delete this workflow permanently?'))) deleteWorkflow.mutate(wf.id, { onError: fail })
                      }}
                    >
                      {t('Delete')}
                    </DropdownItem>
                  )}
                </DropdownItemGroup>
              </DropdownMenu>
            </span>
          </div>
        ))}
      </div>

      <ModalTransition>
        {creating && (
          <Modal onClose={() => setCreating(false)}>
            <ModalHeader><ModalTitle>{t('Create workflow')}</ModalTitle></ModalHeader>
            <ModalBody>
              <p style={{ fontSize: 13, marginBottom: 10, ...subtleText }}>
                {t('The new workflow starts from the default statuses. It stays inactive until you assign it to a space.')}
              </p>
              <TextField autoFocus placeholder={t('Workflow name')} value={newName} onChange={(e) => setNewName(e.currentTarget.value)} />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setCreating(false)}>{t('Cancel')}</Button>
              <Button
                appearance="primary"
                isDisabled={!newName.trim()}
                isLoading={createWorkflow.isPending}
                onClick={() => {
                  clearError()
                  createWorkflow.mutate(newName.trim(), {
                    onSuccess: (r) => { setCreating(false); navigate(`/admin/workflows/${r.id}/edit`) },
                    onError: fail,
                  })
                }}
              >
                {t('Create')}
              </Button>
            </ModalFooter>
          </Modal>
        )}
        {assigning && (
          <Modal onClose={() => setAssigning(null)}>
            <ModalHeader><ModalTitle>{t('Assign workflow to a space')}</ModalTitle></ModalHeader>
            <ModalBody>
              <p style={{ fontSize: 13, marginBottom: 10, ...subtleText }}>
                {t('The space gets its own copy of “{name}”. Work items are moved to the status with the same name — or the first status when there is no match — and board columns are rebuilt.', { name: assigning.name })}
              </p>
              <Select
                options={(projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))}
                onChange={(o) => setAssignKey(o?.value ?? null)}
                placeholder={t('Select a space')}
              />
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setAssigning(null)}>{t('Cancel')}</Button>
              <Button
                appearance="primary"
                isDisabled={!assignKey}
                isLoading={assignWorkflow.isPending}
                onClick={() => {
                  clearError()
                  assignWorkflow.mutate(
                    { id: assigning.id, projectKey: assignKey! },
                    { onSuccess: () => setAssigning(null), onError: fail },
                  )
                }}
              >
                {t('Assign')}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}

// ---- Custom fields ----

export function FieldsAdmin() {
  const { data: fields } = useAdminFields()
  const { data: projects } = useProjects()
  const createField = useAdminCreateField()
  const deleteField = useAdminDeleteField()
  const [error, fail, clearError] = useErrorBanner()

  const [name, setName] = useState('')
  const [ftype, setFtype] = useState<'text' | 'number' | 'date' | 'select'>('text')
  const [options, setOptions] = useState('')
  const [scope, setScope] = useState<string | null>(null)

  const typeOptions = (['text', 'number', 'date', 'select'] as const).map((t) => ({ label: t, value: t }))
  const scopeOptions = [
    { label: t('All spaces'), value: '' },
    ...(projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key })),
  ]

  const rows = (fields ?? []).map((f) => ({
    key: f.id,
    cells: [
      { key: 'name', content: <span style={{ fontWeight: 500 }}>{f.name}</span> },
      { key: 'type', content: <Lozenge>{f.type}</Lozenge> },
      { key: 'scope', content: f.projectKey ? f.projectKey : <Lozenge appearance="new">{t('All spaces')}</Lozenge> },
      { key: 'options', content: <span style={{ fontSize: 12, ...subtleText }}>{f.options.join(', ')}</span> },
      { key: 'usage', content: <span style={subtleText}>{f.usageCount === 1 ? t('{n} value', { n: f.usageCount }) : t('{n} values', { n: f.usageCount })}</span> },
      {
        key: 'actions',
        content: (
          <Button
            appearance="subtle"
            spacing="compact"
            onClick={() => {
              if (f.usageCount > 0 && !confirm(t('"{name}" has {n} values that will be deleted. Continue?', { name: f.name, n: f.usageCount }))) return
              clearError()
              deleteField.mutate(f.id, { onError: fail })
            }}
          >
            {t('Delete')}
          </Button>
        ),
      },
    ],
  }))

  return (
    <div style={{ maxWidth: 920 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{t('Custom fields')}</h1>
      <p style={{ fontSize: 13, ...subtleText, marginBottom: 16 }}>
        {t('Fields appear in the create dialog and the work item Details panel, and are searchable in TQL as')}{' '}
        <code>cf["Field name"]</code>.
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
      <DynamicTable
        head={{ cells: [
          { key: 'n', content: t('Field') },
          { key: 't', content: t('Type') },
          { key: 's', content: t('Scope') },
          { key: 'o', content: t('Options') },
          { key: 'u', content: t('Usage') },
          { key: 'a', content: '' },
        ] }}
        rows={rows}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <TextField placeholder={t('Field name (e.g. Customer)')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </div>
        <div style={{ width: 120 }}>
          <Select options={typeOptions} value={typeOptions.find((o) => o.value === ftype)} onChange={(o) => o && setFtype(o.value)} />
        </div>
        <div style={{ width: 180 }}>
          <Select options={scopeOptions} value={scopeOptions.find((o) => o.value === (scope ?? '')) ?? scopeOptions[0]} onChange={(o) => setScope(o && o.value !== '' ? o.value : null)} />
        </div>
        {ftype === 'select' && (
          <div style={{ flex: 1, minWidth: 200 }}>
            <TextField placeholder={t('Options, comma separated')} value={options} onChange={(e) => setOptions(e.currentTarget.value)} />
          </div>
        )}
        <Button
          appearance="primary"
          isDisabled={!name.trim() || (ftype === 'select' && !options.trim())}
          isLoading={createField.isPending}
          onClick={() => {
            clearError()
            createField.mutate(
              {
                name: name.trim(),
                type: ftype,
                options: ftype === 'select' ? options.split(',').map((o) => o.trim()).filter(Boolean) : [],
                projectKey: scope,
              },
              { onSuccess: () => { setName(''); setOptions('') }, onError: fail },
            )
          }}
        >
          {t('Add field')}
        </Button>
      </div>
    </div>
  )
}
