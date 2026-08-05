import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import TextField from '@atlaskit/textfield'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useArchiveWikiPage, useRemoveWikiSpaceMember, useSetWikiSpaceAccess, useSetWikiSpaceMember,
  useUpdateWikiSpaceMeta, useWikiArchivedPages, useWikiDeleteTemplate, useWikiSpace,
  useWikiSpaceAction, useWikiSpaceMembers, useWikiTemplates, useWikiTrashAction, useWikiTrashList,
} from '../api/hooks'
import { useAuth } from '../auth/AuthContext'
import { t, timeAgo } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }
const cardStyle = {
  border: `1px solid ${token('color.border', '#DFE1E6')}`,
  borderRadius: 8,
  padding: 20,
  marginBottom: 20,
  maxWidth: 760,
}
const h3Style = { fontSize: 16, fontWeight: 600, marginBottom: 8 }
const hintStyle = { fontSize: 12, ...subtleText }
const fieldLabel = { fontSize: 12, fontWeight: 600, marginBottom: 4 }

const ROLE_OPTIONS = [
  { label: t('Admin'), value: 'admin' },
  { label: t('Collaborator'), value: 'collaborator' },
  { label: t('Viewer'), value: 'viewer' },
]

const ACCESS_OPTIONS = [
  { label: t('Anyone can view and edit'), value: 'collaborator' },
  { label: t('Anyone can view'), value: 'viewer' },
  { label: t('Members only (private)'), value: 'none' },
]

const SECTIONS = [
  { key: 'details', label: t('Space details') },
  { key: 'access', label: t('Access') },
  { key: 'templates', label: t('Templates') },
  { key: 'archived', label: t('Archived content') },
  { key: 'trash', label: t('Trash') },
]

// Confluence's Space settings takeover: sub-nav on the left, sections on the right.
export default function WikiSpaceSettings() {
  const { key = '', section = 'details' } = useParams()
  const spaceKey = key.toUpperCase()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { data: spaceData } = useWikiSpace(spaceKey)
  const { data: members } = useWikiSpaceMembers(spaceKey)
  const { data: templates } = useWikiTemplates(spaceKey)
  const { data: archived } = useWikiArchivedPages(spaceKey)
  const { data: trash } = useWikiTrashList(spaceKey)
  const updateMeta = useUpdateWikiSpaceMeta(spaceKey)
  const setAccess = useSetWikiSpaceAccess(spaceKey)
  const setMember = useSetWikiSpaceMember(spaceKey)
  const removeMember = useRemoveWikiSpaceMember(spaceKey)
  const deleteTemplate = useWikiDeleteTemplate(spaceKey)
  const restorePage = useArchiveWikiPage(spaceKey)
  const spaceAction = useWikiSpaceAction(spaceKey)
  const trashAction = useWikiTrashAction(spaceKey)

  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [icon, setIcon] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState('collaborator')

  if (!spaceData) return null
  const space = spaceData.space
  if (spaceData.myRole !== 'admin') {
    return (
      <div style={{ padding: '24px 32px' }}>
        <SectionMessage appearance="warning" title={t('Space admin access required')}>
          {t('Only space admins can manage settings for {name}.', { name: space.name })}
        </SectionMessage>
      </div>
    )
  }

  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : t('Something went wrong'))
  const clear = () => setError(null)
  const owner = (members ?? []).find((m) => m.user.id === space.ownerId)
  const admins = (members ?? []).filter((m) => m.role === 'admin')
  const pageOptions = (spaceData.pages ?? [])
    .filter((p) => p.kind === 'page')
    .map((p) => ({ label: `${p.icon ? p.icon + ' ' : ''}${p.title}`, value: p.id }))
  const homeOption = space.homePageId
    ? pageOptions.find((o) => o.value === space.homePageId) ?? { label: t('Overview'), value: space.homePageId }
    : null

  const sectionBody = () => {
    switch (section) {
      case 'access':
        return (
          <div style={cardStyle}>
            <h3 style={h3Style}>{t('Access')}</h3>
            <p style={{ ...hintStyle, marginBottom: 10 }}>{t('What people who are not members of this space can do.')}</p>
            <div style={{ maxWidth: 320, marginBottom: 18 }}>
              <Select
                options={ACCESS_OPTIONS}
                value={ACCESS_OPTIONS.find((o) => o.value === space.defaultRole)}
                onChange={(o) => { clear(); o && setAccess.mutate(o.value, { onError: fail }) }}
              />
            </div>
            <h3 style={{ ...h3Style, fontSize: 14 }}>{t('Members')}</h3>
            {(members ?? []).map((m) => (
              <div key={m.user.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                <Avatar size="small" name={m.user.displayName} src={m.user.avatarUrl ?? undefined} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {m.user.displayName} {m.user.id === user?.id && <Lozenge>{t('You')}</Lozenge>}{' '}
                    {m.user.id === space.ownerId && <Lozenge appearance="inprogress">{t('Owner')}</Lozenge>}
                  </div>
                  <div style={hintStyle}>{m.user.email}</div>
                </div>
                <div style={{ width: 150 }}>
                  <Select
                    spacing="compact"
                    isDisabled={m.user.id === user?.id}
                    options={ROLE_OPTIONS}
                    value={ROLE_OPTIONS.find((o) => o.value === m.role)}
                    onChange={(o) => { clear(); o && setMember.mutate({ email: m.user.email, role: o.value }, { onError: fail }) }}
                  />
                </div>
                {m.user.id !== user?.id && (
                  <Button appearance="subtle" spacing="compact" onClick={() => { clear(); removeMember.mutate(m.user.id, { onError: fail }) }}>
                    {t('Remove')}
                  </Button>
                )}
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
              <div style={{ flex: 1, maxWidth: 280 }}>
                <TextField placeholder="someone@company.com" value={newEmail} onChange={(e) => setNewEmail(e.currentTarget.value)} />
              </div>
              <div style={{ width: 150 }}>
                <Select options={ROLE_OPTIONS} value={ROLE_OPTIONS.find((o) => o.value === newRole)} onChange={(o) => o && setNewRole(o.value)} />
              </div>
              <Button
                isDisabled={!newEmail.trim()}
                isLoading={setMember.isPending}
                onClick={() => {
                  clear()
                  setMember.mutate({ email: newEmail.trim(), role: newRole }, { onSuccess: () => setNewEmail(''), onError: fail })
                }}
              >
                {t('Add member')}
              </Button>
            </div>
          </div>
        )
      case 'templates':
        return (
          <div style={cardStyle}>
            <h3 style={h3Style}>{t('Templates')}</h3>
            <p style={{ ...hintStyle, marginBottom: 10 }}>
              {t('Custom templates saved in this space. Save any page as a template from its ••• menu; they appear in the editor’s template gallery.')}
            </p>
            {(templates ?? []).length === 0 && <div style={{ fontSize: 13, ...subtleText }}>{t('No custom templates yet.')}</div>}
            {(templates ?? []).map((tp) => (
              <div key={tp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                <span style={{ fontSize: 16 }}>{tp.icon || '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{tp.name}</div>
                  <div style={hintStyle}>{tp.description ? tp.description + ' · ' : ''}{tp.author?.displayName} · {timeAgo(tp.updatedAt)}</div>
                </div>
                <Button
                  appearance="subtle"
                  spacing="compact"
                  onClick={() => {
                    clear()
                    if (window.confirm(t('Delete template “{name}”?', { name: tp.name }))) deleteTemplate.mutate(tp.id, { onError: fail })
                  }}
                >
                  {t('Delete')}
                </Button>
              </div>
            ))}
          </div>
        )
      case 'archived':
        return (
          <div style={cardStyle}>
            <h3 style={h3Style}>{t('Archived content')}</h3>
            <p style={{ ...hintStyle, marginBottom: 10 }}>
              {t('Archived pages leave the tree and search but keep their content. Restore brings a page and everything under it back.')}
            </p>
            {(archived ?? []).length === 0 && <div style={{ fontSize: 13, ...subtleText }}>{t('Nothing archived.')}</div>}
            {(archived ?? []).map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                <span style={{ fontSize: 15 }}>{p.icon || '📄'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.title}</div>
                  <div style={hintStyle}>{t('Archived {ago}', { ago: timeAgo(p.archivedAt) })}</div>
                </div>
                <Button appearance="subtle" spacing="compact" onClick={() => restorePage.mutate({ id: p.id, archived: false })}>
                  {t('Restore')}
                </Button>
              </div>
            ))}
          </div>
        )
      case 'trash':
        return (
          <div style={cardStyle}>
            <h3 style={h3Style}>{t('Trash')}</h3>
            <p style={{ ...hintStyle, marginBottom: 10 }}>
              {t('Deleted pages land here. Restore puts a page back at the top level; deleting forever cannot be undone.')}
            </p>
            {(trash ?? []).length === 0 && <div style={{ fontSize: 13, ...subtleText }}>{t('The trash is empty.')}</div>}
            {(trash ?? []).map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${token('color.border', '#DFE1E6')}` }}>
                <span style={{ fontSize: 15 }}>{p.icon || '🗑️'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{p.title}</div>
                  <div style={hintStyle}>{t('Deleted {ago}', { ago: timeAgo(p.deletedAt) })}</div>
                </div>
                <Button appearance="subtle" spacing="compact" onClick={() => { clear(); trashAction.mutate({ id: p.id, purge: false }, { onError: fail }) }}>
                  {t('Restore')}
                </Button>
                <Button
                  appearance="subtle"
                  spacing="compact"
                  onClick={() => {
                    clear()
                    if (window.confirm(t('Delete "{title}" forever? This cannot be undone.', { title: p.title })))
                      trashAction.mutate({ id: p.id, purge: true }, { onError: fail })
                  }}
                >
                  {t('Delete forever')}
                </Button>
              </div>
            ))}
          </div>
        )
      default:
        return (
          <div style={cardStyle}>
            <h3 style={h3Style}>{t('Space details')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460 }}>
              <div>
                <div style={fieldLabel}>{t('Space icon (emoji)')}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 24, width: 34, textAlign: 'center' }}>{(icon ?? space.icon) || '📁'}</span>
                  <div style={{ width: 120 }}>
                    <TextField value={icon ?? space.icon} onChange={(e) => setIcon(e.currentTarget.value)} placeholder="🚀" />
                  </div>
                  <Button
                    spacing="compact"
                    onClick={() => { clear(); spaceAction.mutate({ action: '/icon', method: 'PUT', body: { icon: (icon ?? space.icon).trim() } }, { onError: fail }) }}
                  >
                    {t('Save')}
                  </Button>
                </div>
              </div>
              <div>
                <div style={fieldLabel}>{t('Name')}</div>
                <TextField value={name ?? space.name} onChange={(e) => setName(e.currentTarget.value)} />
              </div>
              <div>
                <div style={fieldLabel}>{t('Description')}</div>
                <TextField value={description ?? space.description} onChange={(e) => setDescription(e.currentTarget.value)} />
              </div>
              <div>
                <Button
                  appearance="primary"
                  isLoading={updateMeta.isPending}
                  onClick={() => { clear(); updateMeta.mutate({ name: name ?? space.name, description: description ?? space.description }, { onError: fail }) }}
                >
                  {t('Save')}
                </Button>
              </div>
              <div>
                <div style={fieldLabel}>{t('Space key')}</div>
                <div style={{ fontSize: 14 }}>{space.key}</div>
              </div>
              <div>
                <div style={fieldLabel}>{t('Owner')}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {owner && <Avatar size="small" name={owner.user.displayName} src={owner.user.avatarUrl ?? undefined} />}
                  <div style={{ flex: 1, maxWidth: 240 }}>
                    <TextField placeholder={owner?.user.email ?? 'owner@company.com'} value={ownerEmail} onChange={(e) => setOwnerEmail(e.currentTarget.value)} />
                  </div>
                  <Button
                    spacing="compact"
                    isDisabled={!ownerEmail.trim()}
                    onClick={() => {
                      clear()
                      spaceAction.mutate({ action: '/owner', method: 'PUT', body: { email: ownerEmail.trim() } },
                        { onSuccess: () => setOwnerEmail(''), onError: fail })
                    }}
                  >
                    {t('Change owner')}
                  </Button>
                </div>
              </div>
              <div>
                <div style={fieldLabel}>{t('Admins')}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {admins.map((m) => (
                    <Avatar key={m.user.id} size="small" name={m.user.displayName} src={m.user.avatarUrl ?? undefined} />
                  ))}
                </div>
              </div>
              <div>
                <div style={fieldLabel}>{t('Categories')}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {space.categories.map((c) => (
                    <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 8px', borderRadius: 12, background: token('color.background.neutral', '#F1F2F4') }}>
                      {c}
                      <span
                        style={{ cursor: 'pointer', ...subtleText }}
                        onClick={() => { clear(); spaceAction.mutate({ action: '/categories', method: 'PUT', body: { categories: space.categories.filter((x) => x !== c) } }, { onError: fail }) }}
                      >
                        ✕
                      </span>
                    </span>
                  ))}
                  <div style={{ width: 140 }}>
                    <TextField
                      isCompact
                      placeholder={t('Add category')}
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newCategory.trim()) {
                          clear()
                          spaceAction.mutate({ action: '/categories', method: 'PUT', body: { categories: [...space.categories, newCategory.trim()] } },
                            { onSuccess: () => setNewCategory(''), onError: fail })
                        }
                      }}
                    />
                  </div>
                </div>
              </div>
              <div>
                <div style={fieldLabel}>{t('Home content')}</div>
                <div style={{ maxWidth: 320 }}>
                  <Select
                    options={pageOptions}
                    value={homeOption}
                    onChange={(o) => { clear(); o && spaceAction.mutate({ action: '/home', method: 'PUT', body: { pageId: o.value } }, { onError: fail }) }}
                  />
                </div>
                <div style={{ ...hintStyle, marginTop: 4 }}>{t('The content that displays when users navigate to this space.')}</div>
              </div>
            </div>
          </div>
        )
    }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 49px)' }}>
      <nav style={{ width: 220, flexShrink: 0, overflowY: 'auto', borderInlineEnd: `1px solid ${token('color.border', '#DFE1E6')}`, background: token('elevation.surface.sunken', '#F7F8F9'), padding: '16px 0' }}>
        <div style={{ padding: '0 16px 12px', fontSize: 15, fontWeight: 700 }}>{t('Space settings')}</div>
        <div style={{ padding: '0 16px 10px', display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          {space.icon ? <span style={{ fontSize: 16 }}>{space.icon}</span> : <Avatar appearance="square" size="xsmall" name={space.name} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{space.name}</span>
        </div>
        {SECTIONS.map((s) => (
          <div
            key={s.key}
            onClick={() => navigate(`/wiki/spaces/${spaceKey}/settings/${s.key}`)}
            style={{
              padding: '7px 16px', fontSize: 14, cursor: 'pointer',
              background: section === s.key ? token('color.background.selected', '#E9F2FF') : 'transparent',
              color: section === s.key ? token('color.text.selected', '#0C66E4') : 'inherit',
              fontWeight: section === s.key ? 600 : 400,
            }}
          >
            {s.label}
          </div>
        ))}
        <div style={{ margin: '10px 16px', borderTop: `1px solid ${token('color.border', '#DFE1E6')}` }} />
        <div onClick={() => navigate(`/wiki/spaces/${spaceKey}`)} style={{ padding: '7px 16px', fontSize: 13, cursor: 'pointer', ...subtleText }}>
          ← {t('Back to space')}
        </div>
      </nav>
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 48px' }}>
        {error && <div style={{ marginBottom: 16, maxWidth: 760 }}><SectionMessage appearance="error">{error}</SectionMessage></div>}
        {sectionBody()}
      </div>
    </div>
  )
}
