import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Lozenge from '@atlaskit/lozenge'
import Button from '@atlaskit/button/new'
import DynamicTable from '@atlaskit/dynamic-table'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Spinner from '@atlaskit/spinner'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import { useCreateWikiSpace, useWikiPagesByLabel, useWikiSpace, useWikiSpaces } from '../api/hooks'
import { ImportSpaceModal } from '../components/WikiImport'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

function CreateSpaceModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const create = useCreateWikiSpace()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const suggestKey = (n: string) =>
    n.replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().slice(0, 10)

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{t('Create a space')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Space name')} *</div>
              <TextField
                value={name}
                autoFocus
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value
                  setName(v)
                  if (!keyTouched) setKey(suggestKey(v))
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Space key')} *</div>
              <TextField
                value={key}
                onChange={(e) => {
                  setKeyTouched(true)
                  setKey((e.target as HTMLInputElement).value.toUpperCase())
                }}
              />
              {errors.key && <div style={{ fontSize: 12, color: token('color.text.danger', '#AE2E24'), marginTop: 4 }}>{errors.key}</div>}
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Description')}</div>
              <TextArea value={description} onChange={(e) => setDescription(e.target.value)} minimumRows={2} placeholder={t('What is this space about?')} />
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button
            appearance="primary"
            isDisabled={!name.trim() || !key.trim()}
            isLoading={create.isPending}
            onClick={() =>
              create.mutate(
                { key: key.trim(), name: name.trim(), description: description.trim() },
                {
                  onSuccess: (s) => { onClose(); navigate(`/wiki/spaces/${s.key}`) },
                  onError: (e) => setErrors(e instanceof ApiError ? e.body.errors : { key: t('Something went wrong') }),
                },
              )
            }
          >
            {t('Create')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// DocHat home: the spaces directory, like Confluence's Spaces page.
export default function WikiHomePage() {
  const navigate = useNavigate()
  const { data: spaces, isLoading } = useWikiSpaces()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [category, setCategory] = useState('')

  const allCategories = [...new Set((spaces ?? []).flatMap((s) => s.categories))].sort()
  const active = (spaces ?? []).filter((s) => !s.archivedAt && (!category || s.categories.includes(category)))
  const archivedSpaces = (spaces ?? []).filter((s) => !!s.archivedAt)

  const head = {
    cells: [
      { key: 'name', content: t('Name') },
      { key: 'key', content: t('Key') },
      { key: 'pages', content: t('Pages') },
    ],
  }
  const rows = active.map((s) => ({
    key: s.id,
    onClick: () => navigate(`/wiki/spaces/${s.key}`),
    style: { cursor: 'pointer' },
    cells: [
      {
        key: 'name',
        content: (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
            {s.icon ? <span style={{ fontSize: 20 }}>{s.icon}</span> : <Avatar appearance="square" size="small" name={s.name} />}
            <span>
              <span style={{ fontWeight: 600, color: token('color.link', '#0C66E4') }}>{s.name}</span>
              {s.categories.length > 0 && (
                <span style={{ marginInlineStart: 6, display: 'inline-flex', gap: 4 }}>
                  {s.categories.map((c) => (
                    <span key={c} style={{ fontSize: 11, padding: '1px 6px', borderRadius: 10, background: token('color.background.neutral', '#F1F2F4'), ...subtleText }}>{c}</span>
                  ))}
                </span>
              )}
              {s.description && <div style={{ fontSize: 12, ...subtleText }}>{s.description}</div>}
            </span>
          </span>
        ),
      },
      { key: 'key', content: s.key },
      { key: 'pages', content: s.pageCount },
    ],
  }))

  return (
    <div style={{ maxWidth: 880, padding: '16px 40px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '8px 0 20px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{t('Spaces')}</h1>
        <span style={{ display: 'inline-flex', gap: 8 }}>
          <Button onClick={() => setImporting(true)}>{t('Import from Confluence')}</Button>
          <Button appearance="primary" onClick={() => setCreating(true)}>{t('Create a space')}</Button>
        </span>
      </div>
      <DynamicTable
        head={head}
        rows={rows}
        isLoading={isLoading}
        emptyView={<span>{t('No spaces yet — create the first one to start documenting.')}</span>}
      />
      {allCategories.length > 0 && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0 12px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, ...subtleText }}>{t('Categories')}:</span>
          {allCategories.map((c) => (
            <span
              key={c}
              onClick={() => setCategory(category === c ? '' : c)}
              style={{
                fontSize: 12, padding: '2px 10px', borderRadius: 12, cursor: 'pointer',
                background: category === c ? token('color.background.selected', '#E9F2FF') : token('color.background.neutral', '#F1F2F4'),
                color: category === c ? token('color.text.selected', '#0C66E4') : 'inherit',
              }}
            >
              {c}
            </span>
          ))}
        </div>
      )}
      {archivedSpaces.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, ...subtleText }}>{t('Archived spaces')}</div>
          {archivedSpaces.map((s) => (
            <div
              key={s.id}
              onClick={() => navigate(`/wiki/spaces/${s.key}`)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer', opacity: 0.75 }}
            >
              {s.icon ? <span style={{ fontSize: 18 }}>{s.icon}</span> : <Avatar appearance="square" size="xsmall" name={s.name} />}
              <span style={{ fontSize: 14 }}>{s.name}</span>
              <Lozenge appearance="moved">{t('Archived')}</Lozenge>
            </div>
          ))}
        </div>
      )}
      {creating && <CreateSpaceModal onClose={() => setCreating(false)} />}
      {importing && <ImportSpaceModal onClose={() => setImporting(false)} />}
    </div>
  )
}

// /wiki/spaces/:key → jump to the space's Overview page.
export function WikiSpaceRedirect() {
  const { key } = useParams<{ key: string }>()
  const navigate = useNavigate()
  const { data, isError } = useWikiSpace(key?.toUpperCase())
  useEffect(() => {
    if (data?.space.homePageId) {
      navigate(`/wiki/spaces/${data.space.key}/pages/${data.space.homePageId}`, { replace: true })
    }
  }, [data, navigate])
  if (isError) {
    return <div style={{ padding: 40, ...subtleText }}>{t('Wiki space not found.')}</div>
  }
  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
      <Spinner size="large" />
    </div>
  )
}


// Pages carrying a label within a space (label chips link here).
export function WikiLabelPage() {
  const { key, label } = useParams<{ key: string; label: string }>()
  const spaceKey = key?.toUpperCase() ?? ''
  const navigate = useNavigate()
  const { data: pages, isLoading } = useWikiPagesByLabel(spaceKey, label)
  return (
    <div style={{ maxWidth: 720, padding: '16px 40px 40px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: '8px 0 4px' }}>🏷 {label}</h1>
      <p style={{ fontSize: 13, marginBottom: 16, ...subtleText }}>{t('Pages with this label in {space}', { space: spaceKey })}</p>
      {isLoading && <Spinner />}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {(pages ?? []).map((p) => (
          <span
            key={p.id}
            onClick={() => navigate(`/wiki/spaces/${spaceKey}/pages/${p.id}`)}
            style={{ cursor: 'pointer', fontSize: 14, color: token('color.link', '#0C66E4') }}
          >
            {p.icon || '📄'} {p.title}
          </span>
        ))}
        {!isLoading && (pages ?? []).length === 0 && <span style={subtleText}>{t('No pages carry this label.')}</span>}
      </div>
    </div>
  )
}
