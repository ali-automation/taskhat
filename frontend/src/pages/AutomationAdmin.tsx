import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import Lozenge from '@atlaskit/lozenge'
import SectionMessage from '@atlaskit/section-message'
import Spinner from '@atlaskit/spinner'
import Toggle from '@atlaskit/toggle'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import {
  useAutomationRule, useAutomationRules,
  useCreateAutomationRule, useDeleteAutomationRule, useUpdateAutomationRule,
} from '../api/hooks'
import Panel from './AutomationPanel'
import type { AutomationRuleInput, FlowComponent, FlowTrigger } from '../api/types'
import {
  AddIcon, ArrowLeftIcon, ChevronRightIcon, LinkIcon, NotificationIcon,
  PeopleGroupIcon, ScreenIcon, SearchIcon, TaskIcon,
} from '../components/coreIcons'
import { t, fmtDateTime } from '../i18n'

const subtle = { color: token('color.text.subtlest', '#626F86') }

// ---- catalog (labels + subtitles for the node cards) ----

export const TRIGGERS = [
  { value: 'issue.created', label: t('Work item created') },
  { value: 'issue.transitioned', label: t('Work item transitioned') },
  { value: 'issue.updated', label: t('Work item updated') },
  { value: 'issue.field_changed', label: t('Field value changed') },
  { value: 'issue.deleted', label: t('Work item deleted') },
  { value: 'comment.added', label: t('Comment added') },
  { value: 'issue.linked', label: t('Work item linked') },
  { value: 'issue.link_deleted', label: t('Work item link deleted') },
  { value: 'project.created', label: t('Space created') },
  { value: 'sprint.created', label: t('Sprint created') },
  { value: 'sprint.started', label: t('Sprint started') },
  { value: 'sprint.completed', label: t('Sprint completed') },
  { value: 'scheduled', label: t('Scheduled') },
  { value: 'manual', label: t('Manual trigger from work item') },
  { value: 'incoming', label: t('Incoming webhook') },
  { value: 'multiple', label: t('Multiple work item events') },
]

export const CONDITIONS = [
  { type: 'tql', label: t('If work item matches TQL'), hint: t('Continue only when the item matches a query') },
  { type: 'parent-exists', label: t('If parent exists'), hint: t('Continue only when the item has a parent') },
  { type: 'related', label: t('If related items match'), hint: t('All / any / none of the children match a query') },
  { type: 'actor', label: t('If actor is…'), hint: t('Check who caused the trigger') },
]

export const ACTIONS = [
  { type: 'transition', label: t('Transition work item'), hint: t('Move the item to a status (workflow-checked)') },
  { type: 'edit', label: t('Edit fields'), hint: t('Assignee, priority, labels, due date') },
  { type: 'comment', label: t('Add comment'), hint: t('Comment with smart values') },
  { type: 'email', label: t('Send email'), hint: t('Via the site SMTP server') },
  { type: 'webrequest', label: t('Send web request'), hint: t('POST JSON, HMAC-signed') },
  { type: 'create', label: t('Create work item'), hint: t('In this or another space') },
  { type: 'create_wiki_page', label: t('Create page'), hint: t('A DocHat page from a template body') },
]

export const BRANCHES = [
  { type: 'parent', label: t('For: Parent') },
  { type: 'children', label: t('For: Children') },
  { type: 'subtasks', label: t('For: Sub-tasks') },
  { type: 'epic', label: t('For: Epic') },
  { type: 'linked', label: t('For: Linked items') },
  { type: 'tql', label: t('For: TQL results') },
]

function triggerLabel(trg: FlowTrigger): { title: string; sub: string } {
  const def = TRIGGERS.find((x) => x.value === trg.type)
  const title = def?.label ?? trg.type
  if (trg.type === 'issue.transitioned' && trg.toStatusName) return { title, sub: t('To  {status}', { status: trg.toStatusName }) }
  if (trg.type === 'issue.field_changed') return { title, sub: (trg.fields ?? []).join(', ') || t('Any field') }
  if (trg.type === 'scheduled') return { title, sub: t('Every {n} min', { n: trg.intervalMinutes || 60 }) + (trg.tql ? ` · ${trg.tql}` : '') }
  if (trg.type === 'multiple') return { title, sub: (trg.events ?? []).join(', ') }
  if (trg.type === 'incoming') return { title, sub: trg.token ? t('Token active') : t('Token minted on save') }
  return { title, sub: '' }
}

function componentLabel(c: FlowComponent): { title: string; sub: string } {
  const cfg = (c.config ?? {}) as Record<string, string>
  if (c.kind === 'ifelse') {
    switch (c.type) {
      case 'tql': return { title: t('If / else: matches TQL'), sub: cfg.tql ?? '' }
      case 'parent-exists': return { title: t('If / else: parent exists'), sub: '' }
      case 'related': return { title: t('If / else: {match} {relation} match', { match: cfg.match || 'all', relation: cfg.relation || 'children' }), sub: cfg.tql ?? '' }
      case 'actor': return { title: t('If / else: actor'), sub: cfg.email ?? '' }
    }
    return { title: t('If / else'), sub: '' }
  }
  if (c.kind === 'branch') {
    const def = BRANCHES.find((b) => b.type === c.type)
    return { title: def?.label ?? c.type, sub: c.type === 'tql' ? cfg.tql ?? '' : '' }
  }
  if (c.kind === 'condition') {
    switch (c.type) {
      case 'tql': return { title: t('If work item matches TQL'), sub: cfg.tql ?? '' }
      case 'parent-exists': return { title: t('If parent exists'), sub: '' }
      case 'related': return { title: t('If {match} {relation} match', { match: cfg.match || 'all', relation: cfg.relation || 'children' }), sub: cfg.tql ?? '' }
      case 'actor': return { title: (cfg.is as unknown) === false ? t('If actor is not') : t('If actor is'), sub: cfg.email ?? '' }
    }
  }
  switch (c.type) {
    case 'transition': return { title: t('Transition work item'), sub: cfg.statusName ? t('To  {status}', { status: cfg.statusName }) : '' }
    case 'edit': return { title: t('Edit fields'), sub: '' }
    case 'comment': return { title: t('Add comment'), sub: (cfg.body ?? '').slice(0, 60) }
    case 'email': return { title: t('Send email'), sub: cfg.to ?? '' }
    case 'webrequest': return { title: t('Send web request'), sub: cfg.url ?? '' }
    case 'create': return { title: t('Create work item'), sub: (cfg.summary ?? '').slice(0, 60) }
  }
  return { title: c.type, sub: '' }
}

function kindIcon(kind: string, type: string) {
  const style = (bg: string) => ({
    width: 32, height: 32, borderRadius: 6, background: bg, color: '#FFF',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  })
  if (kind === 'trigger') return <span style={style('#8270DB')}>⚡</span>
  if (kind === 'branch') return <span style={style('#8270DB')}><TaskIcon label="" /></span>
  if (kind === 'ifelse') return <span style={style('#E56910')}>⑂</span>
  if (kind === 'condition')
    return <span style={style('#44546F')}>{type === 'parent-exists' ? <LinkIcon label="" /> : <SearchIcon label="" />}</span>
  switch (type) {
    case 'email': return <span style={style('#0C66E4')}><NotificationIcon label="" /></span>
    case 'webrequest': return <span style={style('#0C66E4')}><ScreenIcon label="" /></span>
    case 'create': return <span style={style('#0C66E4')}><AddIcon label="" /></span>
    default: return <span style={style('#0C66E4')}><PeopleGroupIcon label="" /></span>
  }
}

// ---- component-tree path helpers ----

export type Path = (number | 'else')[] // index chain; 'else' descends an ifelse else-arm

export function getAt(list: FlowComponent[], path: Path): FlowComponent | undefined {
  let cur: FlowComponent | undefined
  let arr = list
  for (const seg of path) {
    if (seg === 'else') {
      if (!cur) return undefined
      arr = cur.else ?? []
      continue
    }
    cur = arr[seg]
    if (!cur) return undefined
    arr = cur.components ?? []
  }
  return cur
}

export function mutateAt(list: FlowComponent[], path: Path, fn: (arr: FlowComponent[], idx: number) => void): FlowComponent[] {
  const clone: FlowComponent[] = JSON.parse(JSON.stringify(list))
  let arr = clone
  let node: FlowComponent | undefined
  for (let d = 0; d < path.length - 1; d++) {
    const seg = path[d]
    if (seg === 'else') {
      if (!node) return clone
      node.else = node.else ?? []
      arr = node.else
      continue
    }
    node = arr[seg]
    node.components = node.components ?? []
    arr = node.components
  }
  const last = path[path.length - 1]
  if (last === 'else') return clone // invalid terminal segment
  fn(arr, last)
  return clone
}

// appendAt adds a component to a chain identified by its container path
// ([] = root; [...i] = inside component i's body; [...i,'else'] = its else-arm).
export function appendAt(list: FlowComponent[], containerPath: Path, c: FlowComponent): { next: FlowComponent[]; newPath: Path } {
  if (containerPath.length === 0) {
    const next = [...list, c]
    return { next, newPath: [next.length - 1] }
  }
  const clone: FlowComponent[] = JSON.parse(JSON.stringify(list))
  let arr = clone
  let node: FlowComponent | undefined
  for (const seg of containerPath) {
    if (seg === 'else') {
      if (!node) return { next: clone, newPath: containerPath }
      node.else = node.else ?? []
      arr = node.else
      continue
    }
    node = arr[seg]
    node.components = node.components ?? []
    arr = node.components
  }
  arr.push(JSON.parse(JSON.stringify(c)))
  return { next: clone, newPath: [...containerPath, arr.length - 1] }
}

// ============================== LIST PAGE ==============================

export const FLOW_TEMPLATES: { title: string; hint: string; flow: AutomationRuleInput }[] = [
  {
    title: t('Children Done = Epic Done'),
    hint: t('When the last child is done, close the parent'),
    flow: {
      name: 'Children Done = Epic Done', description: 'When all children of an epic are done, close the epic',
      scopeProjectKey: null, ownerId: null, isEnabled: true, allowSelfTrigger: false, notifyOnError: 'once',
      trigger: { type: 'issue.transitioned', toStatusName: 'Done' },
      components: [
        { kind: 'condition', type: 'parent-exists', config: {} },
        { kind: 'branch', type: 'parent', config: {}, components: [
          { kind: 'condition', type: 'related', config: { relation: 'children', match: 'all', tql: 'status = Done' } },
          { kind: 'action', type: 'transition', config: { statusName: 'Done' } },
        ] },
      ],
    },
  },
  {
    title: t('Auto-assign to space lead'),
    hint: t('New unassigned work items go to the lead'),
    flow: {
      name: 'Auto-assign to space lead', description: '', scopeProjectKey: null, ownerId: null,
      isEnabled: true, allowSelfTrigger: false, notifyOnError: 'once',
      trigger: { type: 'issue.created' },
      components: [
        { kind: 'condition', type: 'tql', config: { tql: 'assignee = EMPTY' } },
        { kind: 'action', type: 'edit', config: { assignee: 'space-lead' } },
      ],
    },
  },
  {
    title: t('Close stale work items'),
    hint: t('Daily sweep: no updates in 30 days → Done'),
    flow: {
      name: 'Close stale work items', description: 'Runs daily; closes items untouched for 30 days',
      scopeProjectKey: null, ownerId: null, isEnabled: false, allowSelfTrigger: false, notifyOnError: 'once',
      trigger: { type: 'scheduled', intervalMinutes: 1440, tql: 'status != Done AND updated <= -30d' },
      components: [
        { kind: 'action', type: 'comment', config: { body: 'Closed automatically after 30 days without updates.' } },
        { kind: 'action', type: 'transition', config: { statusName: 'Done' } },
      ],
    },
  },
  {
    title: t('High-priority alert'),
    hint: t('Email when a highest-priority item is created'),
    flow: {
      name: 'High-priority alert', description: '', scopeProjectKey: null, ownerId: null,
      isEnabled: true, allowSelfTrigger: false, notifyOnError: 'once',
      trigger: { type: 'issue.created' },
      components: [
        { kind: 'ifelse', type: 'tql', config: { tql: 'priority = highest' }, components: [
          { kind: 'action', type: 'email', config: { to: 'reporter', subject: '[TaskHat] {{issue.key}} is highest priority', body: '{{issue.key}} — {{issue.summary}}\n{{issue.url}}' } },
        ], else: [
          { kind: 'action', type: 'comment', config: { body: 'Triaged automatically — normal queue.' } },
        ] },
      ],
    },
  },
  {
    title: t('Welcome comment'),
    hint: t('Greet every new work item with next steps'),
    flow: {
      name: 'Welcome comment', description: '', scopeProjectKey: null, ownerId: null,
      isEnabled: true, allowSelfTrigger: false, notifyOnError: 'once',
      trigger: { type: 'issue.created' },
      components: [
        { kind: 'action', type: 'comment', config: { body: 'Thanks {{issue.reporter.displayName}} — {{issue.key}} is in the queue.' } },
      ],
    },
  },
]

export function AutomationListPage({ spaceKey }: { spaceKey?: string | null } = {}) {
  const { data: rules } = useAutomationRules(spaceKey)
  const navigate = useNavigate()
  const listPath = spaceKey ? `/projects/${spaceKey}/settings/automation` : '/admin/automation'

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{spaceKey ? t('Automation') : t('Global automation')}</h1>
        <Button appearance="primary" onClick={() => navigate(`${listPath}/new`)}>{t('Create flow')}</Button>
      </div>
      <p style={{ fontSize: 13, ...subtle, marginBottom: 16 }}>
        {t('Flows automate work: a trigger, conditions, branches over related items, and actions — performed by “TaskHat Automation”. Failing flows are disabled after 10 consecutive failures.')}
      </p>
      {(rules ?? []).map((r) => (
        <div
          key={r.id}
          onClick={() => {
            if (spaceKey && !r.scopeProjectKey) return // global rules are read-only here
            navigate(`${listPath}/${r.id}`)
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', marginBottom: 6,
            border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 8, cursor: 'pointer', fontSize: 14,
          }}
        >
          <span style={{ fontSize: 16 }}>⚡</span>
          <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
          <Lozenge appearance={r.scopeProjectKey ? 'default' : 'new'}>{r.scopeProjectKey ?? t('Global')}</Lozenge>
          {spaceKey && !r.scopeProjectKey && <Lozenge appearance="moved">{t('Read-only')}</Lozenge>}
          {r.consecutiveFailures > 0 && <Lozenge appearance="removed">{t('{n} failures', { n: r.consecutiveFailures })}</Lozenge>}
          {r.owner && <Avatar size="xsmall" name={r.owner.displayName} src={r.owner.avatarUrl ?? undefined} />}
          <span style={{ fontSize: 12, ...subtle }}>
            {r.lastRunAt ? t('ran {date}', { date: fmtDateTime(r.lastRunAt) }) : t('never ran')}
          </span>
          <Lozenge appearance={r.isEnabled ? 'success' : 'moved'}>{r.isEnabled ? t('Enabled') : t('Disabled')}</Lozenge>
          <ChevronRightIcon label="" />
        </div>
      ))}
      {(rules ?? []).length === 0 && <p style={{ fontSize: 13, ...subtle }}>{t('No flows yet — create the first one.')}</p>}

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '28px 0 4px' }}>{t('Templates')}</h2>
      <p style={{ fontSize: 13, ...subtle, marginBottom: 10 }}>{t('Start from a proven flow, then adapt it.')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {FLOW_TEMPLATES.map((t) => (
          <button
            key={t.title}
            type="button"
            onClick={() => navigate(`${listPath}/new`, { state: { template: t.flow } })}
            style={{
              textAlign: 'left', padding: '12px 14px', border: `1px solid ${token('color.border', '#DFE1E6')}`,
              borderRadius: 8, background: 'none', cursor: 'pointer', color: 'inherit',
            }}
          >
            <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>⚡ {t.title}</span>
            <span style={{ display: 'block', fontSize: 12, marginTop: 3, ...subtle }}>{t.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ============================== EDITOR ==============================

export type Selection = { kind: 'flow' } | { kind: 'trigger' } | { kind: 'component'; path: Path } | { kind: 'add'; path: Path } | { kind: 'runs' }

const emptyFlow = (): AutomationRuleInput => ({
  name: '',
  description: '',
  scopeProjectKey: null,
  ownerId: null,
  trigger: { type: 'issue.created' },
  components: [],
  isEnabled: true,
  allowSelfTrigger: false,
  notifyOnError: 'once',
})

export function FlowEditorPage() {
  const params = useParams()
  const id = params.flowId ?? params.id ?? 'new'
  const spaceKey = params.key ? params.key.toUpperCase() : null
  const isNew = id === 'new'
  const navigate = useNavigate()
  const location = useLocation()
  const listPath = spaceKey ? `/projects/${spaceKey}/settings/automation` : '/admin/automation'
  const { data: existing, isLoading } = useAutomationRule(id, spaceKey)
  const createRule = useCreateAutomationRule(spaceKey)
  const updateRule = useUpdateAutomationRule(spaceKey)
  const deleteRule = useDeleteAutomationRule(spaceKey)

  const template = (location.state as { template?: AutomationRuleInput } | null)?.template
  const [flow, setFlow] = useState<AutomationRuleInput>(() =>
    template ? { ...template, scopeProjectKey: spaceKey ?? template.scopeProjectKey } : { ...emptyFlow(), scopeProjectKey: spaceKey },
  )
  const [dirty, setDirty] = useState(isNew)
  const [selection, setSelection] = useState<Selection>({ kind: 'flow' })
  const [zoom, setZoom] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (existing) {
      setFlow({
        name: existing.name,
        description: existing.description,
        scopeProjectKey: existing.scopeProjectKey,
        ownerId: existing.owner?.id ?? null,
        trigger: existing.trigger,
        components: existing.components ?? [],
        isEnabled: existing.isEnabled,
        allowSelfTrigger: existing.allowSelfTrigger,
        notifyOnError: existing.notifyOnError,
      })
      setDirty(false)
    }
  }, [existing])

  const patch = (p: Partial<AutomationRuleInput>) => {
    setFlow((f) => ({ ...f, ...p }))
    setDirty(true)
  }

  const save = () => {
    setError(null)
    const onError = (e: unknown) =>
      setError(e instanceof ApiError ? Object.values(e.body.errors)[0] ?? e.message : t('Save failed'))
    if (isNew) {
      createRule.mutate(flow, { onSuccess: (r) => navigate(`${listPath}/${r.id}`, { replace: true }), onError })
    } else {
      updateRule.mutate({ id, ...flow }, { onSuccess: () => setDirty(false), onError })
    }
  }

  if (!isNew && isLoading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}><Spinner size="large" /></div>
  }

  return (
    <div style={{ margin: '-16px -40px -40px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)' }}>
      {/* editor top bar */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
          borderBottom: `1px solid ${token('color.border', '#DFE1E6')}`,
          background: token('elevation.surface', '#FFFFFF'), flexShrink: 0,
        }}
      >
        <button
          type="button"
          onClick={() => navigate(listPath)}
          style={{ background: 'none', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, width: 32, height: 32, cursor: 'pointer', color: 'inherit', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeftIcon label={t('Back')} />
        </button>
        <span style={{ fontSize: 16 }}>⚡</span>
        <span style={{ fontWeight: 700, fontSize: 16, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {flow.name || t('Untitled flow')}
        </span>
        {!isNew && (
          <Button appearance="subtle" onClick={() => setSelection({ kind: 'runs' })}>{t('Run log')}</Button>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
          <Toggle isChecked={flow.isEnabled} onChange={() => patch({ isEnabled: !flow.isEnabled })} />
          {flow.isEnabled ? t('Enabled') : t('Disabled')}
        </label>
        <Button appearance="primary" isDisabled={!dirty || !flow.name.trim()} isLoading={createRule.isPending || updateRule.isPending} onClick={save}>
          {t('Save')}
        </Button>
        {!isNew && (
          <DropdownMenu
            trigger={({ triggerRef, ...props }) => (
              <button type="button" ref={triggerRef as React.Ref<HTMLButtonElement>} {...props} style={{ background: 'none', border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, width: 32, height: 32, cursor: 'pointer', color: 'inherit' }}>
                ⋯
              </button>
            )}
            shouldRenderToParent
          >
            <DropdownItemGroup>
              <DropdownItem
                onClick={() => {
                  if (confirm(t('Delete flow "{name}"?', { name: flow.name }))) {
                    deleteRule.mutate(id, { onSuccess: () => navigate(listPath) })
                  }
                }}
              >
                {t('Delete flow')}
              </DropdownItem>
            </DropdownItemGroup>
          </DropdownMenu>
        )}
      </div>

      {error && (
        <div style={{ padding: '8px 16px' }}>
          <SectionMessage appearance="error">{error}</SectionMessage>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* canvas */}
        <div
          onClick={() => setSelection({ kind: 'flow' })}
          style={{
            flex: 1, overflow: 'auto', position: 'relative',
            background: token('elevation.surface.sunken', '#F7F8F9'),
            backgroundImage: `radial-gradient(${token('color.border', '#DFE1E6')} 1px, transparent 1px)`,
            backgroundSize: '20px 20px',
          }}
        >
          <div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', padding: '40px 24px 120px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <NodeCard
              selected={selection.kind === 'trigger'}
              onClick={() => setSelection({ kind: 'trigger' })}
              icon={kindIcon('trigger', flow.trigger.type)}
              {...triggerLabel(flow.trigger)}
            />
            <Chain
              components={flow.components}
              basePath={[]}
              selection={selection}
              setSelection={setSelection}
            />
          </div>
          {/* zoom control */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'sticky', bottom: 16, marginLeft: 'auto', marginRight: 'auto', width: 140,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: token('elevation.surface.overlay', '#FFFFFF'), borderRadius: 8, padding: '6px 12px',
              boxShadow: token('elevation.shadow.overlay', '0 4px 12px rgba(9,30,66,0.25)'), fontSize: 13,
            }}
          >
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }} onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: 'inherit' }} onClick={() => setZoom((z) => Math.min(1.5, Math.round((z + 0.1) * 10) / 10))}>+</button>
          </div>
        </div>

        {/* right panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            width: 440, flexShrink: 0, overflowY: 'auto',
            borderInlineStart: `1px solid ${token('color.border', '#DFE1E6')}`,
            background: token('elevation.surface', '#FFFFFF'), padding: '18px 20px',
          }}
        >
          <Panel
            flow={flow}
            patch={patch}
            selection={selection}
            setSelection={setSelection}
            ruleId={isNew ? undefined : id}
            existing={existing}
            spaceKey={spaceKey}
          />
        </div>
      </div>
    </div>
  )
}

// ---- canvas pieces ----

function Connector() {
  return <div style={{ width: 2, height: 26, background: token('color.border', '#8590A2'), opacity: 0.6 }} />
}

function NodeCard({ icon, title, sub, selected, onClick }: { icon: React.ReactNode; title: string; sub: string; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick() }}
      style={{
        width: 440, display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
        background: token('elevation.surface.raised', '#FFFFFF'),
        border: `2px solid ${selected ? token('color.border.selected', '#0C66E4') : token('color.border', '#DFE1E6')}`,
        borderRadius: 8, cursor: 'pointer',
        boxShadow: token('elevation.shadow.raised', '0 1px 2px rgba(9,30,66,0.15)'),
      }}
    >
      {icon}
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 15, fontWeight: 600 }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 13, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...subtle }}>{sub}</span>}
      </span>
    </div>
  )
}

function AddButton({ onClick, selected }: { onClick: () => void; selected: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick() }}
      title={t('Add component')}
      style={{
        width: 28, height: 28, borderRadius: '50%',
        border: `2px solid ${selected ? token('color.border.selected', '#0C66E4') : token('color.border', '#8590A2')}`,
        background: token('elevation.surface.raised', '#FFFFFF'),
        color: selected ? token('color.text.selected', '#0C66E4') : token('color.text.subtle', '#44546F'),
        cursor: 'pointer', fontSize: 16, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      +
    </button>
  )
}

function samePath(a: Path, b: Path) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function Chain({ components, basePath, selection, setSelection }: {
  components: FlowComponent[]
  basePath: Path
  selection: Selection
  setSelection: (s: Selection) => void
}) {
  return (
    <>
      {components.map((c, i) => {
        const path = [...basePath, i]
        const isSelected = selection.kind === 'component' && samePath(selection.path, path)
        if (c.kind === 'ifelse') {
          const armStyle = {
            marginTop: 8, marginInlineStart: 48, paddingInlineStart: 20,
            borderInlineStart: `2px solid ${token('color.border', '#8590A2')}`,
            borderBottomLeftRadius: 12, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' as const,
          }
          const chip = (label: string) => (
            <div style={{ alignSelf: 'flex-start', marginInlineStart: 24, marginTop: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: '2px 8px', borderRadius: 4, background: token('color.background.neutral', '#F1F2F4'), ...subtle }}>
                {label}
              </span>
            </div>
          )
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Connector />
              <NodeCard selected={isSelected} onClick={() => setSelection({ kind: 'component', path })} icon={kindIcon(c.kind, c.type)} {...componentLabel(c)} />
              {chip(t('IF'))}
              <div style={armStyle}>
                <Chain components={c.components ?? []} basePath={path} selection={selection} setSelection={setSelection} />
              </div>
              {chip(t('ELSE'))}
              <div style={armStyle}>
                <Chain components={c.else ?? []} basePath={[...path, 'else']} selection={selection} setSelection={setSelection} />
              </div>
            </div>
          )
        }
        if (c.kind === 'branch') {
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Connector />
              <div style={{ alignSelf: 'flex-start', marginInlineStart: 24 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: '2px 8px', borderRadius: 4, background: token('color.background.neutral', '#F1F2F4'), ...subtle }}>
                  {t('BRANCH')}
                </span>
              </div>
              <div style={{ marginTop: 8, marginInlineStart: 48, paddingInlineStart: 20, borderInlineStart: `2px solid ${token('color.border', '#8590A2')}`, borderEndStartRadius: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <NodeCard selected={isSelected} onClick={() => setSelection({ kind: 'component', path })} icon={kindIcon(c.kind, c.type)} {...componentLabel(c)} />
                <Chain components={c.components ?? []} basePath={path} selection={selection} setSelection={setSelection} />
              </div>
            </div>
          )
        }
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Connector />
            <NodeCard selected={isSelected} onClick={() => setSelection({ kind: 'component', path })} icon={kindIcon(c.kind, c.type)} {...componentLabel(c)} />
          </div>
        )
      })}
      <Connector />
      <AddButton
        selected={selection.kind === 'add' && samePath(selection.path, basePath)}
        onClick={() => setSelection({ kind: 'add', path: basePath })}
      />
    </>
  )
}


