import { useState } from 'react'
import Button from '@atlaskit/button/new'
import TextField from '@atlaskit/textfield'
import TextArea from '@atlaskit/textarea'
import Select from '@atlaskit/select'
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle } from '@atlaskit/modal-dialog'
import { token } from '@atlaskit/tokens'
import { useCompleteSprint, useSprintIssues, useSprints, useStartSprint } from '../api/hooks'
import type { Board, Sprint } from '../api/types'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }
const BACKLOG = 'backlog'

export function StartSprintModal({ sprint, onClose }: { sprint: Sprint; onClose: () => void }) {
  const startSprint = useStartSprint(sprint.id)
  const [name, setName] = useState(sprint.name)
  const [goal, setGoal] = useState(sprint.goal)
  const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10))
  const [weeks, setWeeks] = useState<{ label: string; value: number }>({ label: t('{n} weeks', { n: 2 }), value: 2 })
  const [error, setError] = useState<string | null>(null)

  const durations = [1, 2, 3, 4].map((w) => ({ label: w > 1 ? t('{n} weeks', { n: w }) : t('{n} week', { n: w }), value: w }))

  const submit = async () => {
    try {
      const startAt = new Date(start + 'T00:00:00Z')
      const endAt = new Date(startAt)
      endAt.setUTCDate(endAt.getUTCDate() + weeks.value * 7)
      await startSprint.mutateAsync({
        name,
        goal,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('failed to start sprint'))
    }
  }

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader>
        <ModalTitle>{t('Start sprint')}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Sprint name')}
            <TextField value={name} onChange={(e) => setName(e.currentTarget.value)} />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Duration')}
            <Select
              options={durations}
              value={weeks}
              onChange={(v) => v && setWeeks(v)}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Start date')}
            <br />
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.currentTarget.value)}
              style={{
                padding: 8,
                border: `2px solid ${token('color.border', '#DFE1E6')}`,
                borderRadius: 3,
                fontFamily: 'inherit',
                width: '100%',
              }}
            />
          </label>
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Sprint goal')}
            <TextArea value={goal} onChange={(e) => setGoal(e.currentTarget.value)} minimumRows={2} />
          </label>
          {error && <div style={{ color: token('color.text.danger', '#AE2E24'), fontSize: 12 }}>{error}</div>}
        </div>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button appearance="primary" isLoading={startSprint.isPending} onClick={submit}>
          {t('Start')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export function CompleteSprintModal({ sprint, board, onClose }: { sprint: Sprint; board: Board; onClose: () => void }) {
  const { data } = useSprintIssues(sprint.id)
  const { data: sprints } = useSprints(board.id)
  const completeSprint = useCompleteSprint(sprint.id)
  const issues = data?.values ?? []
  const done = issues.filter((i) => i.status.category === 'done').length
  const open = issues.length - done

  const options = [
    { label: t('Backlog'), value: BACKLOG },
    ...(sprints ?? []).filter((s) => s.state === 'future').map((s) => ({ label: s.name, value: s.id })),
  ]
  const [moveTo, setMoveTo] = useState(options[0])

  return (
    <Modal onClose={onClose} width="small">
      <ModalHeader>
        <ModalTitle>{t('Complete {name}', { name: sprint.name })}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <p style={{ marginBottom: 12 }}>
          {t('This sprint contains')} <strong>{t('{n} completed', { n: done })}</strong> {t('and')}{' '}
          <strong>{t('{n} open', { n: open })}</strong> {open === 1 ? t('issue') : t('issues')}.
        </p>
        {open > 0 && (
          <label style={{ fontSize: 12, fontWeight: 600, ...subtleText }}>
            {t('Move open issues to')}
            <Select options={options} value={moveTo} onChange={(v) => v && setMoveTo(v)} />
          </label>
        )}
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={onClose}>
          {t('Cancel')}
        </Button>
        <Button
          appearance="primary"
          isLoading={completeSprint.isPending}
          onClick={async () => {
            await completeSprint.mutateAsync(moveTo.value === BACKLOG ? null : moveTo.value)
            onClose()
          }}
        >
          {t('Complete sprint')}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

