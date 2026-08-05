import { useState } from 'react'
import Button from '@atlaskit/button/new'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@atlaskit/modal-dialog'
import SectionMessage from '@atlaskit/section-message'
import Select from '@atlaskit/select'
import { ApiError } from '../api/client'
import { useMoveWikiPageTo, useWikiSpace, useWikiSpaces } from '../api/hooks'
import { t } from '../i18n'

// Confluence's Move… dialog: pick a target space and parent.
export default function WikiMoveDialog({
  pageId, pageTitle, currentSpaceKey, onClose, onMoved,
}: {
  pageId: string
  pageTitle: string
  currentSpaceKey: string
  onClose: () => void
  onMoved: (spaceKey: string) => void
}) {
  const { data: spaces } = useWikiSpaces()
  const [targetKey, setTargetKey] = useState(currentSpaceKey)
  const [parentId, setParentId] = useState<string | null>(null)
  const { data: targetSpace } = useWikiSpace(targetKey)
  const move = useMoveWikiPageTo()
  const [error, setError] = useState<string | null>(null)

  const spaceOptions = (spaces ?? []).map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }))
  const parentOptions = [
    { label: t('— Top level —'), value: '' },
    ...(targetSpace?.pages ?? [])
      .filter((p) => p.id !== pageId && p.kind !== 'whiteboard')
      .map((p) => ({ label: `${p.icon ? p.icon + ' ' : ''}${p.title}`, value: p.id })),
  ]

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader><ModalTitle>{t('Move “{title}”', { title: pageTitle })}</ModalTitle></ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 180 }}>
          {error && <SectionMessage appearance="error">{error}</SectionMessage>}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Space')}</div>
            <Select
              options={spaceOptions}
              value={spaceOptions.find((o) => o.value === targetKey)}
              onChange={(o) => {
                if (o) {
                  setTargetKey(o.value)
                  setParentId(null)
                }
              }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{t('Parent')}</div>
            <Select
              options={parentOptions}
              value={parentOptions.find((o) => o.value === (parentId ?? '')) ?? parentOptions[0]}
              onChange={(o) => setParentId(o && o.value !== '' ? o.value : null)}
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>{t('Cancel')}</Button>
        <Button
          appearance="primary"
          isLoading={move.isPending}
          onClick={() => {
            setError(null)
            move.mutate(
              { id: pageId, spaceKey: targetKey, parentId },
              {
                onSuccess: () => onMoved(targetKey),
                onError: (e) => setError(e instanceof ApiError ? e.message : t('Something went wrong')),
              },
            )
          }}
        >
          {t('Move')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
