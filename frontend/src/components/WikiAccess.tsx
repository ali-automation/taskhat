import { useState } from 'react'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog'
import Select from '@atlaskit/select'
import TextArea from '@atlaskit/textarea'
import { token } from '@atlaskit/tokens'
import { Link } from 'react-router-dom'
import {
  useSetWikiLabels, useSetWikiRestrictions, useShareWikiPage, useUserSearch,
  useWikiLabels, useWikiRestrictions,
} from '../api/hooks'
import { t } from '../i18n'
import { TagIcon } from './coreIcons'
import type { User } from '../api/client'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Async multi user picker backed by /users search.
function UserPicker({ selected, onChange, placeholder }: {
  selected: { label: string; value: string }[]
  onChange: (v: { label: string; value: string }[]) => void
  placeholder: string
}) {
  const [input, setInput] = useState('')
  const { data: users } = useUserSearch(input)
  const options = (users ?? []).map((u: User) => ({ label: `${u.displayName} (${u.email})`, value: u.id }))
  return (
    <Select
      isMulti
      options={options}
      value={selected}
      inputValue={input}
      onInputChange={(v) => setInput(v)}
      onChange={(v) => onChange([...(v ?? [])])}
      placeholder={placeholder}
      filterOption={() => true}
      noOptionsMessage={() => (input.length >= 1 ? t('No people found') : t('Type to search'))}
    />
  )
}

// Confluence's Restrictions dialog: empty list = anyone can view.
export function RestrictionsDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const { data: current } = useWikiRestrictions(pageId)
  const setRestrictions = useSetWikiRestrictions(pageId)
  const [picked, setPicked] = useState<{ label: string; value: string }[] | null>(null)
  const value = picked ?? (current ?? []).map((u) => ({ label: `${u.displayName} (${u.email})`, value: u.id }))
  const restricted = value.length > 0

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{t('Restrictions')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <div style={{ fontSize: 13, ...subtleText }}>
              {restricted
                ? t('Only the people below (and site admins) can view this page and everything under it.')
                : t('Anyone who can use DocHat can view this page. Add people to restrict it.')}
            </div>
            <UserPicker selected={value} onChange={setPicked} placeholder={t('Add people…')} />
            <div style={{ fontSize: 12, ...subtleText }}>
              {t('You stay on the list automatically so you cannot lock yourself out.')}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button
            appearance="primary"
            isLoading={setRestrictions.isPending}
            onClick={() => setRestrictions.mutate(value.map((v) => v.value), { onSuccess: onClose })}
          >
            {t('Apply')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// Confluence's Share dialog: notify people (and grant access when restricted).
export function ShareDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const share = useShareWikiPage(pageId)
  const [picked, setPicked] = useState<{ label: string; value: string }[]>([])
  const [message, setMessage] = useState('')
  const [sent, setSent] = useState(false)

  return (
    <ModalTransition>
      <Modal onClose={onClose} width="small">
        <ModalHeader>
          <ModalTitle>{t('Share')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 8 }}>
            <UserPicker selected={picked} onChange={setPicked} placeholder={t('Add people…')} />
            <TextArea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              minimumRows={2}
              placeholder={t('Say something about this page (optional)')}
            />
            {sent && <Lozenge appearance="success">{t('Shared')}</Lozenge>}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
          <Button
            appearance="primary"
            isDisabled={picked.length === 0}
            isLoading={share.isPending}
            onClick={() =>
              share.mutate(
                { userIds: picked.map((p) => p.value), message },
                {
                  onSuccess: () => {
                    setSent(true)
                    setTimeout(onClose, 700)
                  },
                },
              )
            }
          >
            {t('Share')}
          </Button>
        </ModalFooter>
      </Modal>
    </ModalTransition>
  )
}

// Confluence puts labels at the bottom of the page: chips + inline add.
export function WikiLabelsBar({ pageId, spaceKey, readOnly }: { pageId: string; spaceKey: string; readOnly?: boolean }) {
  const { data: labels } = useWikiLabels(pageId)
  const setLabels = useSetWikiLabels(pageId)
  const [adding, setAdding] = useState(false)
  const [input, setInput] = useState('')

  const commit = () => {
    const l = input.trim()
    if (l) setLabels.mutate([...(labels ?? []), l])
    setInput('')
    setAdding(false)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 32 }}>
      {(labels ?? []).map((l) => (
        <span
          key={l}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4,
            fontSize: 12, background: token('color.background.neutral', '#F1F2F4'),
            color: token('color.text.subtle', '#44546F'),
          }}
        >
          <Link to={`/wiki/spaces/${spaceKey}/labels/${encodeURIComponent(l)}`} style={{ color: 'inherit' }}>{l}</Link>
          <span
            style={{ cursor: 'pointer' }}
            onClick={() => setLabels.mutate((labels ?? []).filter((x) => x !== l))}
          >
            ×
          </span>
        </span>
      ))}
      {adding ? (
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setAdding(false)
          }}
          onBlur={commit}
          placeholder={t('Add label')}
          style={{
            fontSize: 12, padding: '2px 8px', borderRadius: 4, outline: 'none',
            border: `1px solid ${token('color.border.input', '#8590A2')}`,
            background: token('elevation.surface', '#FFFFFF'), color: 'inherit', width: 120,
          }}
        />
      ) : readOnly ? null : (
        <span
          onClick={() => setAdding(true)}
          style={{
            cursor: 'pointer', fontSize: 12, padding: '2px 8px', borderRadius: 4,
            display: 'inline-flex', alignItems: 'center', gap: 4,
            border: `1px dashed ${token('color.border', '#DFE1E6')}`, ...subtleText,
          }}
        >
          <TagIcon label="" /> {t('Add label')}
        </span>
      )}
    </div>
  )
}
