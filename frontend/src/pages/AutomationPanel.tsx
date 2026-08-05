import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Select from '@atlaskit/select'
import TextArea from '@atlaskit/textarea'
import TextField from '@atlaskit/textfield'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { useAdminUsers, useAutomationRuns, useProjects, useWorkTypes } from '../api/hooks'
import type { AutomationRule, AutomationRuleInput, FlowComponent } from '../api/types'
import {
  ACTIONS, appendAt, BRANCHES, CONDITIONS, TRIGGERS, getAt, mutateAt, type Path, type Selection,
} from './AutomationAdmin'
import { t, fmtDateTime } from '../i18n'

const subtle = { color: token('color.text.subtlest', '#626F86') }

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 600, margin: '14px 0 4px', color: token('color.text.subtle', '#44546F') }}>
      {children} {required && <span style={{ color: token('color.text.danger', '#AE2E24') }}>*</span>}
    </div>
  )
}

const SMART_HINT = 'Smart values: {{issue.key}} {{issue.summary}} {{issue.assignee.displayName}} {{issue.url}} {{now}}'

interface PanelProps {
  flow: AutomationRuleInput
  patch: (p: Partial<AutomationRuleInput>) => void
  selection: Selection
  setSelection: (s: Selection) => void
  ruleId?: string
  existing?: AutomationRule
  spaceKey?: string | null
}

export default function Panel({ flow, patch, selection, setSelection, ruleId, existing, spaceKey }: PanelProps) {
  switch (selection.kind) {
    case 'trigger':
      return <TriggerPanel flow={flow} patch={patch} />
    case 'add':
      return <AddPanel flow={flow} patch={patch} path={selection.path} setSelection={setSelection} />
    case 'component':
      return <ComponentPanel flow={flow} patch={patch} path={selection.path} setSelection={setSelection} />
    case 'runs':
      return <RunsPanel ruleId={ruleId} spaceKey={spaceKey} />
    default:
      return <FlowDetailsPanel flow={flow} patch={patch} existing={existing} spaceKey={spaceKey} />
  }
}

// ---- flow details (matches Jira's right panel) ----

function FlowDetailsPanel({ flow, patch, existing, spaceKey }: { flow: AutomationRuleInput; patch: PanelProps['patch']; existing?: AutomationRule; spaceKey?: string | null }) {
  const { data: projects } = useProjects()
  const { data: users } = useAdminUsers('')

  const scopeOptions = [
    { label: t('Global (all spaces)'), value: '' },
    { label: t('Single space'), value: 'single' },
  ]
  const spaceOptions = (projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key }))
  const ownerOptions = (users ?? []).filter((u) => u.isActive).map((u) => ({ label: u.displayName, value: u.id }))
  const notifyOptions = [
    { label: t('E-mail flow owner once when flow starts failing repeatedly'), value: 'once' },
    { label: t('E-mail flow owner on every failure'), value: 'always' },
    { label: t('Never'), value: 'never' },
  ]
  const single = flow.scopeProjectKey != null

  return (
    <div>
      <FieldLabel required>{t('Name')}</FieldLabel>
      <TextField autoFocus={!flow.name} value={flow.name} onChange={(e) => patch({ name: (e.target as HTMLInputElement).value })} placeholder={t('Name your flow')} />

      <FieldLabel>{t('Description')}</FieldLabel>
      <TextArea minimumRows={3} value={flow.description} onChange={(e) => patch({ description: e.target.value })} placeholder={t('Add a description to your flow')} />

      <FieldLabel>{t('Scope')}</FieldLabel>
      {spaceKey ? (
        <div style={{ padding: '8px 10px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4, fontSize: 14 }}>
          {t('Single space — {key}', { key: spaceKey })}
        </div>
      ) : (
      <Select
        options={scopeOptions}
        value={single ? scopeOptions[1] : scopeOptions[0]}
        onChange={(o) => patch({ scopeProjectKey: o?.value === 'single' ? (spaceOptions[0]?.value ?? '') : null })}
      />
      )}
      {!spaceKey && single && (
        <>
          <FieldLabel required>{t('Spaces')}</FieldLabel>
          <Select
            options={spaceOptions}
            value={spaceOptions.find((o) => o.value === flow.scopeProjectKey) ?? null}
            onChange={(o) => o && patch({ scopeProjectKey: o.value })}
            placeholder={t('Select a space')}
          />
        </>
      )}

      <FieldLabel required>{t('Owner')}</FieldLabel>
      <Select
        options={ownerOptions}
        value={ownerOptions.find((o) => o.value === flow.ownerId) ?? null}
        onChange={(o) => o && patch({ ownerId: o.value })}
        placeholder={t('Select an owner')}
        formatOptionLabel={(o) => (
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Avatar size="xsmall" name={o.label} />
            {o.label}
          </span>
        )}
      />
      <div style={{ fontSize: 12, marginTop: 4, ...subtle }}>{t('The owner will receive emails when the flow fails.')}</div>

      <FieldLabel required>{t('Actor')}</FieldLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4, fontSize: 14 }}>
        <span style={{ width: 20, height: 20, borderRadius: 4, background: '#8270DB', color: '#FFF', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>A</span>
        {t('Automation for TaskHat')}
      </div>
      <div style={{ fontSize: 12, marginTop: 4, ...subtle }}>
        {t('Actions defined in this flow will be performed by the automation user.')}
      </div>

      <FieldLabel>{t('Notify on error')}</FieldLabel>
      <Select
        options={notifyOptions}
        value={notifyOptions.find((o) => o.value === flow.notifyOnError) ?? notifyOptions[0]}
        onChange={(o) => o && patch({ notifyOnError: o.value })}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18 }}>
        <Toggle isChecked={flow.allowSelfTrigger} onChange={() => patch({ allowSelfTrigger: !flow.allowSelfTrigger })} />
        <span style={{ fontSize: 13 }}>{t("Allow this flow to be triggered by other flows' actions")}</span>
      </div>

      {existing && existing.consecutiveFailures > 0 && (
        <div style={{ marginTop: 16 }}>
          <Lozenge appearance="removed">{existing.consecutiveFailures === 1 ? t('{n} consecutive failure', { n: existing.consecutiveFailures }) : t('{n} consecutive failures', { n: existing.consecutiveFailures })}</Lozenge>
        </div>
      )}
    </div>
  )
}

// ---- trigger config ----

function TriggerPanel({ flow, patch }: { flow: AutomationRuleInput; patch: PanelProps['patch'] }) {
  const trg = flow.trigger
  const set = (p: Partial<typeof trg>) => patch({ trigger: { ...trg, ...p } })
  const triggerOptions = TRIGGERS.map((x) => ({ label: x.label, value: x.value }))
  const eventOptions = TRIGGERS.filter((x) => x.value !== 'scheduled' && x.value !== 'multiple').map((x) => ({ label: x.label, value: x.value }))

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{t('Trigger')}</h3>
      <p style={{ fontSize: 13, ...subtle }}>{t('Every flow starts here.')}</p>

      <FieldLabel required>{t('When')}</FieldLabel>
      <Select
        options={triggerOptions}
        value={triggerOptions.find((o) => o.value === trg.type)}
        onChange={(o) => o && set({ type: o.value })}
      />

      {trg.type === 'issue.transitioned' && (
        <>
          <FieldLabel>{t('To status (optional)')}</FieldLabel>
          <TextField value={trg.toStatusName ?? ''} onChange={(e) => set({ toStatusName: (e.target as HTMLInputElement).value })} placeholder={t('e.g. Done')} />
        </>
      )}
      {trg.type === 'scheduled' && (
        <>
          <FieldLabel>{t('Every (minutes)')}</FieldLabel>
          <TextField type="number" value={String(trg.intervalMinutes ?? 60)} onChange={(e) => set({ intervalMinutes: Math.max(1, parseInt((e.target as HTMLInputElement).value, 10) || 60) })} />
          <FieldLabel>{t('Run for each work item matching TQL (optional)')}</FieldLabel>
          <TextField value={trg.tql ?? ''} onChange={(e) => set({ tql: (e.target as HTMLInputElement).value })} placeholder='status != Done AND updated <= -30d' />
        </>
      )}
      {trg.type === 'issue.field_changed' && (
        <>
          <FieldLabel>{t('Fields to watch (empty = any)')}</FieldLabel>
          <Select
            isMulti
            options={['summary', 'description', 'priority', 'assignee', 'labels', 'duedate', 'sprint', 'parent', 'storyPoints', 'type'].map((f) => ({ label: f, value: f }))}
            value={(trg.fields ?? []).map((f) => ({ label: f, value: f }))}
            onChange={(v) => set({ fields: v.map((x) => x.value) })}
          />
        </>
      )}
      {trg.type === 'manual' && (
        <p style={{ fontSize: 13, marginTop: 12, ...subtle }}>
          {t('This flow appears under ⚡ Automation on every work item it applies to, and runs when a member clicks it.')}
        </p>
      )}
      {trg.type === 'incoming' && (
        <>
          <FieldLabel>{t('Webhook URL')}</FieldLabel>
          {trg.token ? (
            <code style={{ fontSize: 12, wordBreak: 'break-all', display: 'block', padding: '8px 10px', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4 }}>
              {window.location.origin}/api/v1/automation/incoming/{trg.token}
            </code>
          ) : (
            <p style={{ fontSize: 13, ...subtle }}>{t('Save the flow to mint the webhook URL.')}</p>
          )}
          <p style={{ fontSize: 12, marginTop: 6, ...subtle }}>
            {t('POST to this URL to run the flow; include {example} to give it a work item context.', { example: '{"issueKey": "TH-1"}' })}
          </p>
        </>
      )}
      {trg.type === 'multiple' && (
        <>
          <FieldLabel required>{t('Events')}</FieldLabel>
          <Select
            isMulti
            options={eventOptions}
            value={eventOptions.filter((o) => (trg.events ?? []).includes(o.value))}
            onChange={(v) => set({ events: v.map((x) => x.value) })}
          />
        </>
      )}
    </div>
  )
}

// ---- add component picker ----

function AddPanel({ flow, patch, path, setSelection }: { flow: AutomationRuleInput; patch: PanelProps['patch']; path: Path; setSelection: (s: Selection) => void }) {
  const append = (c: FlowComponent) => {
    const { next, newPath } = appendAt(flow.components, path, c)
    patch({ components: next })
    setSelection({ kind: 'component', path: newPath })
  }

  const group = (title: string, items: { type: string; label: string; hint?: string }[], kind: FlowComponent['kind']) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, ...subtle }}>{title}</div>
      {items.map((it) => (
        <button
          key={it.type}
          type="button"
          onClick={() => append({ kind, type: it.type, config: {}, ...(kind === 'branch' || kind === 'ifelse' ? { components: [] } : {}), ...(kind === 'ifelse' ? { else: [] } : {}) })}
          style={{
            display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', marginBottom: 4,
            border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6,
            background: 'none', cursor: 'pointer', color: 'inherit',
          }}
        >
          <span style={{ display: 'block', fontSize: 14, fontWeight: 500 }}>{it.label}</span>
          {it.hint && <span style={{ display: 'block', fontSize: 12, marginTop: 1, ...subtle }}>{it.hint}</span>}
        </button>
      ))}
    </div>
  )

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{t('Add component')}</h3>
      {group(t('Conditions'), CONDITIONS, 'condition')}
      {group(t('If / else blocks'), CONDITIONS.map((c) => ({ ...c, label: t('If / else: ') + c.label.replace(/^If /, '') })), 'ifelse')}
      {group(t('Branches (act on related items)'), BRANCHES, 'branch')}
      {group(t('Actions'), ACTIONS, 'action')}
    </div>
  )
}

// ---- per-component config ----

function ComponentPanel({ flow, patch, path, setSelection }: { flow: AutomationRuleInput; patch: PanelProps['patch']; path: Path; setSelection: (s: Selection) => void }) {
  const comp = getAt(flow.components, path)
  const { data: workTypes } = useWorkTypes()
  const { data: projects } = useProjects()
  if (!comp) return null

  const cfg = (comp.config ?? {}) as Record<string, unknown>
  const setCfg = (p: Record<string, unknown>) => {
    patch({
      components: mutateAt(flow.components, path, (arr, idx) => {
        arr[idx] = { ...arr[idx], config: { ...(arr[idx].config ?? {}), ...p } }
      }),
    })
  }
  const remove = () => {
    patch({ components: mutateAt(flow.components, path, (arr, idx) => arr.splice(idx, 1)) })
    setSelection({ kind: 'flow' })
  }

  const str = (k: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : '')
  const text = (label: string, key: string, placeholder = '', required = false) => (
    <>
      <FieldLabel required={required}>{label}</FieldLabel>
      <TextField value={str(key)} onChange={(e) => setCfg({ [key]: (e.target as HTMLInputElement).value })} placeholder={placeholder} />
    </>
  )
  const area = (label: string, key: string, placeholder = '') => (
    <>
      <FieldLabel>{label}</FieldLabel>
      <TextArea minimumRows={4} value={str(key)} onChange={(e) => setCfg({ [key]: e.target.value })} placeholder={placeholder} />
      <div style={{ fontSize: 11, marginTop: 4, ...subtle }}>{SMART_HINT}</div>
    </>
  )
  const select = (label: string, key: string, options: { label: string; value: string }[], def = '') => (
    <>
      <FieldLabel>{label}</FieldLabel>
      <Select
        options={options}
        value={options.find((o) => o.value === (str(key) || def)) ?? null}
        onChange={(o) => o && setCfg({ [key]: o.value })}
      />
    </>
  )

  const title =
    comp.kind === 'branch'
      ? BRANCHES.find((b) => b.type === comp.type)?.label
      : comp.kind === 'condition' || comp.kind === 'ifelse'
        ? (comp.kind === 'ifelse' ? t('If / else: ') : '') + (CONDITIONS.find((b) => b.type === comp.type)?.label ?? comp.type)
        : ACTIONS.find((b) => b.type === comp.type)?.label

  let body: React.ReactNode = null
  if (comp.kind === 'branch') {
    body = comp.type === 'tql'
      ? text(t('TQL query'), 'tql', 'project = TH AND status = Done', true)
      : <p style={{ fontSize: 13, marginTop: 10, ...subtle }}>{t('Components inside this branch run once per related item.')}</p>
  } else if (comp.kind === 'condition' || comp.kind === 'ifelse') {
    switch (comp.type) {
      case 'tql':
        body = text(t('TQL query'), 'tql', 'type in (story, task)', true)
        break
      case 'related':
        body = (
          <>
            {select(t('Related items'), 'relation', [
              { label: t('Children'), value: 'children' },
              { label: t('Sub-tasks'), value: 'subtasks' },
            ], 'children')}
            {select(t('Match'), 'match', [
              { label: t('All match'), value: 'all' },
              { label: t('Any match'), value: 'any' },
              { label: t('None match'), value: 'none' },
            ], 'all')}
            {text(t('TQL query'), 'tql', 'status = Done', true)}
          </>
        )
        break
      case 'actor':
        body = (
          <>
            <FieldLabel>{t('Actor')}</FieldLabel>
            <Select
              options={[
                { label: t('Is'), value: 'true' },
                { label: t('Is not'), value: 'false' },
              ]}
              value={cfg.is === false ? { label: t('Is not'), value: 'false' } : { label: t('Is'), value: 'true' }}
              onChange={(o) => o && setCfg({ is: o.value === 'true' })}
            />
            {text(t('User email'), 'email', 'someone@company.com', true)}
          </>
        )
        break
      default:
        body = <p style={{ fontSize: 13, marginTop: 10, ...subtle }}>{t('No configuration needed.')}</p>
    }
  } else {
    switch (comp.type) {
      case 'transition':
        body = text(t('To status'), 'statusName', t('e.g. Done'), true)
        break
      case 'edit':
        body = (
          <>
            <FieldLabel>{t('Assignee')}</FieldLabel>
            <Select
              options={[
                { label: t('Leave unchanged'), value: '__keep' },
                { label: t('Unassign'), value: '' },
                { label: t('Reporter'), value: 'reporter' },
                { label: t('Space lead'), value: 'space-lead' },
              ]}
              value={(() => {
                const v = cfg.assignee
                if (v === undefined || v === null) return { label: t('Leave unchanged'), value: '__keep' }
                if (v === '') return { label: t('Unassign'), value: '' }
                if (v === 'reporter') return { label: t('Reporter'), value: 'reporter' }
                return { label: t('Space lead'), value: 'space-lead' }
              })()}
              onChange={(o) => o && setCfg({ assignee: o.value === '__keep' ? null : o.value })}
            />
            {select(t('Priority'), 'priority', [
              { label: t('Leave unchanged'), value: '' },
              { label: t('Highest'), value: 'highest' },
              { label: t('High'), value: 'high' },
              { label: t('Medium'), value: 'medium' },
              { label: t('Low'), value: 'low' },
              { label: t('Lowest'), value: 'lowest' },
            ])}
            <FieldLabel>{t('Add labels (comma separated)')}</FieldLabel>
            <TextField
              value={str('addLabelsCsv')}
              placeholder="automation, triaged"
              onChange={(e) => {
                const raw = (e.target as HTMLInputElement).value
                setCfg({ addLabelsCsv: raw, addLabels: raw.split(',').map((l) => l.trim()).filter(Boolean) })
              }}
            />
            <FieldLabel>{t('Remove labels (comma separated)')}</FieldLabel>
            <TextField
              value={str('removeLabelsCsv')}
              onChange={(e) => {
                const raw = (e.target as HTMLInputElement).value
                setCfg({ removeLabelsCsv: raw, removeLabels: raw.split(',').map((l) => l.trim()).filter(Boolean) })
              }}
            />
          </>
        )
        break
      case 'comment':
        body = area(t('Comment body'), 'body', t('This item was updated by automation because…'))
        break
      case 'email':
        body = (
          <>
            {text(t('To'), 'to', t('email, or: assignee / reporter'), true)}
            {text(t('Subject'), 'subject', '[TaskHat] {{issue.key}} needs attention', true)}
            {area(t('Body'), 'body')}
          </>
        )
        break
      case 'webrequest':
        body = (
          <>
            {text(t('URL'), 'url', 'https://example.com/hook', true)}
            {text(t('Secret (optional, HMAC-SHA256)'), 'secret')}
            {area(t('Custom body (optional; default = item JSON)'), 'body')}
          </>
        )
        break
      case 'create':
        body = (
          <>
            {select(t('Space'), 'projectKey', [
              { label: t('Same space as trigger item'), value: '' },
              ...(projects ?? []).map((p) => ({ label: `${p.name} (${p.key})`, value: p.key })),
            ])}
            {select(t('Work type'), 'type', (workTypes ?? []).filter((wt) => wt.key !== 'subtask').map((wt) => ({ label: wt.name, value: wt.key })), 'task')}
            {text(t('Summary'), 'summary', 'Follow-up for {{issue.key}}', true)}
            {area(t('Description'), 'description')}
          </>
        )
        break
      case 'create_wiki_page':
        body = (
          <>
            {text(t('Wiki space key'), 'spaceKey', 'ENG', true)}
            {text(t('Page title'), 'title', 'Release notes for {{issue.key}}', true)}
            {area(t('Page body (smart values supported)'), 'body')}
          </>
        )
        break
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{title}</h3>
      <Lozenge>{comp.kind}</Lozenge>
      {body}
      <div style={{ marginTop: 22 }}>
        <Button appearance="danger" onClick={remove}>{t('Delete component')}</Button>
      </div>
    </div>
  )
}

// ---- run log ----

function RunsPanel({ ruleId, spaceKey }: { ruleId?: string; spaceKey?: string | null }) {
  const { data: runs } = useAutomationRuns(ruleId, spaceKey)
  const appearance = (s: string) => (s === 'success' ? 'success' : s === 'failure' ? 'removed' : 'default')

  return (
    <div>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{t('Run log')}</h3>
      {(runs ?? []).length === 0 && <p style={{ fontSize: 13, ...subtle }}>{t('No runs yet.')}</p>}
      {(runs ?? []).map((r) => (
        <div key={r.id} style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Lozenge appearance={appearance(r.status)}>{r.status.replace('_', ' ')}</Lozenge>
            <span style={{ fontWeight: 600 }}>{r.itemKey}</span>
            <span style={subtle}>{r.eventType}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 11, ...subtle }}>{fmtDateTime(r.createdAt)}</span>
          </div>
          {(r.log ?? []).map((l, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, marginTop: 4, ...subtle }}>
              <span style={{ width: 150, flexShrink: 0 }}>{l.component}</span>
              <span style={{ width: 60, flexShrink: 0, fontWeight: 600, color: l.outcome === 'failed' ? token('color.text.danger', '#AE2E24') : undefined }}>{l.outcome}</span>
              <span>{[l.item, l.detail].filter(Boolean).join(' — ')}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
