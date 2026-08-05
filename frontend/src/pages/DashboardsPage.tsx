import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Select from '@atlaskit/select'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import { useCreateDashboard, useDashboards, useDeleteDashboard, useUpdateDashboard, type DashboardInput } from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { t } from '../i18n'
import type { Dashboard } from '../api/types'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

const ACCESS_OPTIONS = [
  { label: t('Private — only you'), value: false },
  { label: t('Shared with everyone'), value: true },
]

// Create/edit dashboard details, like Jira's create-dashboard modal.
export function DashboardModal({
  dashboard,
  onClose,
}: {
  dashboard?: Dashboard // absent = create
  onClose: () => void
}) {
  const navigate = useNavigate()
  const create = useCreateDashboard()
  const update = useUpdateDashboard(dashboard?.id ?? '')
  const [name, setName] = useState(dashboard?.name ?? '')
  const [description, setDescription] = useState(dashboard?.description ?? '')
  const [isShared, setIsShared] = useState(dashboard?.isShared ?? false)
  const [error, setError] = useState<string | null>(null)
  const pending = create.isPending || update.isPending

  const submit = () => {
    setError(null)
    const body: DashboardInput = { name: name.trim(), description: description.trim(), isShared }
    const onError = (e: unknown) =>
      setError(e instanceof ApiError ? (Object.values(e.body.errors)[0] ?? e.message) : t('Something went wrong'))
    if (dashboard) {
      update.mutate(body, { onSuccess: onClose, onError })
    } else {
      create.mutate(body, { onSuccess: (d) => { onClose(); navigate(`/dashboards/${d.id}`) }, onError })
    }
  }

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{dashboard ? t('Dashboard details') : t('Create a dashboard')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Name *')}</div>
              <TextField value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} autoFocus />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Description')}</div>
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                minimumRows={2}
                placeholder={t('What is this dashboard for?')}
              />
            </div>
            {!dashboard?.isDefault && (
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Access')}</div>
                <Select
                  options={ACCESS_OPTIONS}
                  value={ACCESS_OPTIONS.find((o) => o.value === isShared)}
                  onChange={(o) => setIsShared(o?.value ?? false)}
                />
              </div>
            )}
            {error && <div style={{ fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error}</div>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button appearance="primary" onClick={submit} isDisabled={!name.trim()} isLoading={pending}>
            {dashboard ? t('Save') : t('Create')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

export default function DashboardsPage() {
  const { user, isAdmin } = useAuth()
  const { data: dashboards, isLoading } = useDashboards()
  const deleteDashboard = useDeleteDashboard()
  const [creating, setCreating] = useState(false)

  const head = {
    cells: [
      { key: 'name', content: t('Name'), isSortable: false },
      { key: 'owner', content: t('Owner') },
      { key: 'access', content: t('Access') },
      { key: 'gadgets', content: t('Gadgets') },
      { key: 'actions', content: '' },
    ],
  }

  const rows = (dashboards ?? []).map((d) => {
    const canDelete = !d.isDefault && (d.owner ? d.owner.id === user?.id : isAdmin)
    return {
      key: d.id,
      cells: [
        {
          key: 'name',
          content: (
            <div>
              <Link to={`/dashboards/${d.id}`} style={{ fontWeight: 600 }}>{d.name}</Link>
              {d.description && <div style={{ fontSize: 12, ...subtleText }}>{d.description}</div>}
            </div>
          ),
        },
        {
          key: 'owner',
          content: d.owner ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Avatar size="xsmall" name={d.owner.displayName} src={d.owner.avatarUrl ?? undefined} />
              {d.owner.displayName}
            </span>
          ) : (
            <span style={subtleText}>{t('System')}</span>
          ),
        },
        {
          key: 'access',
          content: (
            <span style={{ display: 'inline-flex', gap: 4 }}>
              {d.isDefault && <Lozenge appearance="inprogress">{t('Default')}</Lozenge>}
              <Lozenge appearance={d.isShared ? 'success' : 'default'}>{d.isShared ? t('Shared') : t('Private')}</Lozenge>
            </span>
          ),
        },
        { key: 'gadgets', content: d.gadgetCount },
        {
          key: 'actions',
          content: canDelete ? (
            <Button
              appearance="subtle"
              spacing="compact"
              onClick={() => {
                if (window.confirm(t('Delete dashboard "{name}"?', { name: d.name }))) deleteDashboard.mutate(d.id)
              }}
            >
              {t('Delete')}
            </Button>
          ) : null,
        },
      ],
    }
  })

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{t('Dashboards')}</h1>
        <Button appearance="primary" onClick={() => setCreating(true)}>{t('Create dashboard')}</Button>
      </div>
      <DynamicTable head={head} rows={rows} isLoading={isLoading} emptyView={<span>{t('No dashboards yet.')}</span>} />
      {creating && <DashboardModal onClose={() => setCreating(false)} />}
    </div>
  )
}
