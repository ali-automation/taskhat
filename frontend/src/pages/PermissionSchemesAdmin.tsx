import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import {
  useAdminAddGrant, useAdminCreateScheme, useAdminDeleteScheme, useAdminRemoveGrant,
  useAdminScheme, useAdminSchemes, useAdminUpdateScheme,
} from '../api/hooks'
import type { PermissionGrant, PermissionScheme } from '../api/types'
import type { User } from '../api/client'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Jira's permission table, grouped by section.
export const PERMISSION_GROUPS: { group: string; perms: { key: string; name: string; hint: string }[] }[] = [
  {
    group: t('Space permissions'),
    perms: [
      { key: 'administer', name: t('Administer space'), hint: t('Manage space settings, members, board, workflow and automation. Site admins always hold this.') },
    ],
  },
  {
    group: t('Work item permissions'),
    perms: [
      { key: 'create', name: t('Create work items'), hint: t('Create new work items in the space.') },
      { key: 'edit', name: t('Edit work items'), hint: t('Edit fields, rank and timeline dates.') },
      { key: 'transition', name: t('Transition work items'), hint: t('Move work items through the workflow (board drags included).') },
      { key: 'assign', name: t('Assign work items'), hint: t('Change the assignee of a work item.') },
      { key: 'link', name: t('Link work items'), hint: t('Create and remove links between work items.') },
      { key: 'delete', name: t('Delete work items'), hint: t('Delete work items permanently.') },
    ],
  },
  {
    group: t('Comment permissions'),
    perms: [
      { key: 'comment', name: t('Add comments'), hint: t('Comment on work items. Everyone can edit and delete their own comments.') },
      { key: 'comment-edit-all', name: t('Edit all comments'), hint: t('Edit comments made by other people.') },
      { key: 'comment-delete-all', name: t('Delete all comments'), hint: t('Delete comments made by other people.') },
    ],
  },
  {
    group: t('Attachment permissions'),
    perms: [
      { key: 'attach', name: t('Create attachments'), hint: t('Attach files to work items. Everyone can delete their own attachments.') },
      { key: 'attach-delete-all', name: t('Delete all attachments'), hint: t('Delete attachments added by other people.') },
    ],
  },
  {
    group: t('Sprint & release permissions'),
    perms: [
      { key: 'manage-sprints', name: t('Manage sprints'), hint: t('Create, start, complete and delete sprints.') },
      { key: 'manage-versions', name: t('Manage releases'), hint: t('Create, edit, release and archive versions. Deleting needs Administer space.') },
    ],
  },
  {
    group: t('Time tracking permissions'),
    perms: [
      { key: 'log-work', name: t('Log work'), hint: t('Log work and edit or delete their own worklogs.') },
    ],
  },
]

const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((g) => g.perms)

export function permissionName(key: string): string {
  return ALL_PERMISSIONS.find((p) => p.key === key)?.name ?? key
}

const ROLE_NAMES: Record<string, string> = { admin: t('Admin'), member: t('Member'), viewer: t('Viewer') }

function granteeLabel(g: PermissionGrant): string {
  switch (g.granteeType) {
    case 'role': return t('Space role: {role}', { role: ROLE_NAMES[g.granteeId ?? ''] ?? g.granteeId ?? '' })
    case 'user': return t('User: {name}', { name: g.granteeName || (g.granteeId ?? '') })
    case 'lead': return t('Space lead')
    case 'reporter': return t('Reporter')
    case 'assignee': return t('Assignee')
    default: return t('Any space member')
  }
}

function useErrorBanner(): [string | null, (e: unknown) => void, () => void] {
  const [error, setError] = useState<string | null>(null)
  return [
    error,
    (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong')),
    () => setError(null),
  ]
}

// ---- schemes directory ----

export function SchemesListPage() {
  const { data: schemes } = useAdminSchemes()
  const createScheme = useAdminCreateScheme()
  const deleteScheme = useAdminDeleteScheme()
  const navigate = useNavigate()
  const [error, fail, clearError] = useErrorBanner()
  const [creating, setCreating] = useState(false)
  const [copyFrom, setCopyFrom] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const submit = () => {
    clearError()
    createScheme.mutate(
      { name, description, copyFrom: copyFrom ?? '' },
      {
        onSuccess: (sc) => {
          setCreating(false)
          setName('')
          setDescription('')
          setCopyFrom(null)
          navigate(`/admin/work-items/permissions/${sc.id}`)
        },
        onError: fail,
      },
    )
  }

  const rows = (schemes ?? []).map((sc) => ({
    key: sc.id,
    cells: [
      {
        key: 'name',
        content: (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Link to={`/admin/work-items/permissions/${sc.id}`} style={{ fontWeight: 500 }}>{sc.name}</Link>
            {sc.isDefault && <Lozenge appearance="inprogress">{t('Default')}</Lozenge>}
          </span>
        ),
      },
      { key: 'desc', content: <span style={subtleText}>{sc.description}</span> },
      { key: 'used', content: t('{n} spaces', { n: sc.usedBy }) },
      {
        key: 'actions',
        content: (
          <span style={{ display: 'flex', gap: 4 }}>
            <Button appearance="subtle" spacing="compact" onClick={() => { setCopyFrom(sc.id); setName(t('Copy of {name}', { name: sc.name })); setDescription(sc.description); setCreating(true) }}>
              {t('Copy')}
            </Button>
            {!sc.isDefault && (
              <Button
                appearance="subtle"
                spacing="compact"
                onClick={() => {
                  clearError()
                  if (confirm(t('Delete scheme “{name}”?', { name: sc.name }))) deleteScheme.mutate(sc.id, { onError: fail })
                }}
              >
                {t('Delete')}
              </Button>
            )}
          </span>
        ),
      },
    ],
  }))

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Permission schemes')}</h1>
        <Button appearance="primary" onClick={() => { setCopyFrom(null); setName(''); setDescription(''); setCreating(true) }}>
          {t('Add permission scheme')}
        </Button>
      </div>
      <p style={{ fontSize: 13, marginBottom: 16, ...subtleText }}>
        {t('A permission scheme maps each space permission to the people who hold it. Assign schemes to spaces from Manage spaces.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
      <DynamicTable
        head={{ cells: [{ key: 'n', content: t('Name') }, { key: 'd', content: t('Description') }, { key: 'u', content: t('Used by') }, { key: 'a', content: '' }] }}
        rows={rows}
      />
      <ModalTransition>
        {creating && (
          <Modal onClose={() => setCreating(false)} width="small">
            <ModalHeader><ModalTitle>{copyFrom ? t('Copy permission scheme') : t('Add permission scheme')}</ModalTitle></ModalHeader>
            <ModalBody>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <TextField autoFocus placeholder={t('Scheme name')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
                <TextField placeholder={t('Description (optional)')} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
                {!copyFrom && <span style={{ fontSize: 12, ...subtleText }}>{t('New schemes start with a copy of the default scheme’s grants.')}</span>}
              </div>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setCreating(false)}>{t('Cancel')}</Button>
              <Button appearance="primary" isLoading={createScheme.isPending} isDisabled={!name.trim()} onClick={submit}>{t('Create')}</Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}

// ---- single scheme editor ----

function GrantModal({ scheme, initialPermission, onClose }: { scheme: PermissionScheme; initialPermission: string; onClose: () => void }) {
  const addGrant = useAdminAddGrant(scheme.id)
  const [error, fail, clearError] = useErrorBanner()
  const [permission, setPermission] = useState(initialPermission)
  const [granteeType, setGranteeType] = useState('role')
  const [role, setRole] = useState('member')
  const [userId, setUserId] = useState<string | null>(null)
  const { data: users } = useQuery({
    queryKey: ['user-search-all'],
    queryFn: () => api<User[]>('/users?query='),
    enabled: granteeType === 'user',
  })

  const permOptions = PERMISSION_GROUPS.map((g) => ({
    label: g.group,
    options: g.perms.map((p) => ({ label: p.name, value: p.key })),
  }))
  const flatPerms = permOptions.flatMap((g) => g.options)
  const typeOptions = [
    { label: t('Space role'), value: 'role' },
    { label: t('Single user'), value: 'user' },
    { label: t('Space lead'), value: 'lead' },
    { label: t('Reporter'), value: 'reporter' },
    { label: t('Assignee'), value: 'assignee' },
    { label: t('Any space member'), value: 'anyone' },
  ]
  const roleOptions = Object.entries(ROLE_NAMES).map(([value, label]) => ({ label, value }))
  const userOptions = (users ?? []).map((u) => ({ label: `${u.displayName} (${u.email})`, value: u.id }))

  const submit = () => {
    clearError()
    const granteeId = granteeType === 'role' ? role : granteeType === 'user' ? userId : null
    addGrant.mutate({ permission, granteeType, granteeId }, { onSuccess: onClose, onError: fail })
  }

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader><ModalTitle>{t('Grant permission')}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 220 }}>
          {error && <SectionMessage appearance="error">{error}</SectionMessage>}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Permission')}</div>
            <Select
              options={permOptions}
              value={flatPerms.find((o) => o.value === permission)}
              onChange={(o) => o && setPermission(o.value)}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Granted to')}</div>
            <Select
              options={typeOptions}
              value={typeOptions.find((o) => o.value === granteeType)}
              onChange={(o) => o && setGranteeType(o.value)}
            />
          </div>
          {granteeType === 'role' && (
            <Select options={roleOptions} value={roleOptions.find((o) => o.value === role)} onChange={(o) => o && setRole(o.value)} />
          )}
          {granteeType === 'user' && (
            <Select
              placeholder={t('Choose a user')}
              options={userOptions}
              value={userOptions.find((o) => o.value === userId) ?? null}
              onChange={(o) => setUserId(o?.value ?? null)}
            />
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button appearance="primary" isLoading={addGrant.isPending} isDisabled={granteeType === 'user' && !userId} onClick={submit}>
          {t('Grant')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export function SchemeDetailPage() {
  const location = useLocation()
  const schemeId = location.pathname.split('/').pop() ?? ''
  const { data: scheme } = useAdminScheme(schemeId)
  const updateScheme = useAdminUpdateScheme(schemeId)
  const removeGrant = useAdminRemoveGrant(schemeId)
  const [error, fail, clearError] = useErrorBanner()
  const [granting, setGranting] = useState<string | null>(null) // permission key pre-selected
  const [editingMeta, setEditingMeta] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const grantsByPerm = useMemo(() => {
    const map: Record<string, PermissionGrant[]> = {}
    for (const g of scheme?.grants ?? []) (map[g.permission] ??= []).push(g)
    return map
  }, [scheme])

  if (!scheme) return null

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ fontSize: 12, marginBottom: 4 }}>
        <Link to="/admin/work-items/permissions" style={subtleText}>{t('Permission schemes')}</Link>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
          {scheme.name}
          {scheme.isDefault && <Lozenge appearance="inprogress">{t('Default')}</Lozenge>}
        </h1>
        <span style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => { setName(scheme.name); setDescription(scheme.description); setEditingMeta(true) }}>{t('Edit')}</Button>
          <Button appearance="primary" onClick={() => setGranting('create')}>{t('Grant permission')}</Button>
        </span>
      </div>
      <p style={{ fontSize: 13, marginBottom: 4, ...subtleText }}>{scheme.description}</p>
      <p style={{ fontSize: 13, marginBottom: 16, ...subtleText }}>
        {(scheme.spaces ?? []).length > 0
          ? t('Used by: {spaces}', { spaces: (scheme.spaces ?? []).join(', ') })
          : t('Not used by any space yet.')}
      </p>
      {error && <div style={{ marginBottom: 12 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}

      {PERMISSION_GROUPS.map((group) => (
        <div key={group.group} style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{group.group}</h3>
          <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6 }}>
            {group.perms.map((p, i) => (
              <div
                key={p.key}
                style={{
                  display: 'flex', gap: 16, padding: '10px 14px', alignItems: 'flex-start',
                  borderTop: i > 0 ? `1px solid ${token('color.border', '#DFE1E6')}` : 'none',
                }}
              >
                <div style={{ width: 260, flexShrink: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.name}</div>
                  <div style={{ fontSize: 12, ...subtleText }}>{p.hint}</div>
                </div>
                <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  {(grantsByPerm[p.key] ?? []).map((g) => (
                    <span
                      key={g.id}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12,
                        padding: '2px 8px', borderRadius: 12,
                        background: token('color.background.neutral', '#F1F2F4'),
                      }}
                    >
                      {g.granteeType === 'user' && <Avatar size="xsmall" name={g.granteeName} />}
                      {granteeLabel(g)}
                      <span
                        title={t('Remove grant')}
                        onClick={() => { clearError(); removeGrant.mutate(g.id, { onError: fail }) }}
                        style={{ cursor: 'pointer', ...subtleText }}
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                  {(grantsByPerm[p.key] ?? []).length === 0 && (
                    <span style={{ fontSize: 12, ...subtleText }}>{t('Nobody')}</span>
                  )}
                  <Button appearance="subtle" spacing="compact" onClick={() => setGranting(p.key)}>+</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <ModalTransition>
        {granting && <GrantModal scheme={scheme} initialPermission={granting} onClose={() => setGranting(null)} />}
        {editingMeta && (
          <Modal onClose={() => setEditingMeta(false)} width="small">
            <ModalHeader><ModalTitle>{t('Edit scheme')}</ModalTitle></ModalHeader>
            <ModalBody>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <TextField autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} />
                <TextField placeholder={t('Description (optional)')} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
              </div>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setEditingMeta(false)}>{t('Cancel')}</Button>
              <Button
                appearance="primary"
                isLoading={updateScheme.isPending}
                isDisabled={!name.trim()}
                onClick={() => {
                  clearError()
                  updateScheme.mutate({ name, description }, { onSuccess: () => setEditingMeta(false), onError: fail })
                }}
              >
                {t('Save')}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </div>
  )
}
