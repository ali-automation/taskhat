import { Epic16Icon, Story16Icon, Task16Icon, Bug16Icon, Subtask16Icon } from './coreIcons'
import type { IssueType, Priority, StatusCategory } from '../api/types'
import Lozenge from '@atlaskit/lozenge'

// Registry of configured work types (populated from the API by AppShell) so
// custom types render with their configured color everywhere.
let workTypeMap: Record<string, { name: string; color: string; glyph: string }> = {}
export function registerWorkTypes(types: { key: string; name: string; color: string; glyph: string }[]) {
  workTypeMap = Object.fromEntries(types.map((t) => [t.key, t]))
}

export function workTypeName(key: string): string {
  return workTypeMap[key]?.name ?? issueTypeLabel[key as IssueType] ?? key
}

// The exact colored-square glyphs Jira uses for issue types; custom types get
// a colored square with their initial (like Jira's custom type icons).
export function IssueTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'epic':
      return <Epic16Icon label="Epic" />
    case 'story':
      return <Story16Icon label="Story" />
    case 'bug':
      return <Bug16Icon label="Bug" />
    case 'subtask':
      return <Subtask16Icon label="Sub-task" />
    case 'task':
      return <Task16Icon label="Task" />
  }
  const meta = workTypeMap[type]
  return (
    <span
      title={meta?.name ?? type}
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        background: meta?.color ?? '#8590A2',
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: 700,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {(meta?.name ?? type).charAt(0).toUpperCase()}
    </span>
  )
}

export const issueTypeLabel: Record<IssueType, string> = {
  epic: 'Epic',
  story: 'Story',
  task: 'Task',
  bug: 'Bug',
  subtask: 'Sub-task',
}

// Jira's real priority glyphs from the new core icon set, in Jira's colors.
import {
  PriorityHighestIcon,
  PriorityHighIcon,
  PriorityMediumIcon,
  PriorityLowIcon,
  PriorityLowestIcon,
} from './coreIcons'

const priorityGlyph: Record<Priority, [typeof PriorityMediumIcon, string]> = {
  highest: [PriorityHighestIcon, '#DE350B'],
  high: [PriorityHighIcon, '#FF5630'],
  medium: [PriorityMediumIcon, '#E97F33'],
  low: [PriorityLowIcon, '#2684FF'],
  lowest: [PriorityLowestIcon, '#0065FF'],
}

export function PriorityIcon({ priority }: { priority: Priority }) {
  const [Icon, color] = priorityGlyph[priority] ?? priorityGlyph.medium
  return (
    <span style={{ color, display: 'inline-flex' }} title={`Priority: ${priority}`}>
      <Icon label="" />
    </span>
  )
}

export const priorityLabel: Record<Priority, string> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  lowest: 'Lowest',
}

const lozengeAppearance: Record<StatusCategory, 'default' | 'inprogress' | 'success'> = {
  todo: 'default',
  in_progress: 'inprogress',
  done: 'success',
}

// Jira status chip: gray / blue / green lozenge by category.
export function StatusLozenge({ name, category }: { name: string; category: StatusCategory }) {
  return (
    <Lozenge appearance={lozengeAppearance[category]} isBold={category === 'in_progress'}>
      {name}
    </Lozenge>
  )
}
