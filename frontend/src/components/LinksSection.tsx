import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '@atlaskit/button/new'
import Lozenge from '@atlaskit/lozenge'
import Select from '@atlaskit/select'
import { token } from '@atlaskit/tokens'
import { ApiError } from '../api/client'
import { useCreateLink, useDeleteLink, useIssueLinks, useQuickSearch } from '../api/hooks'
import { IssueTypeIcon } from './icons'
import type { IssueLink } from '../api/types'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Jira's relationship phrases → (linkType, direction) pairs.
const RELATIONSHIPS: { label: string; linkType: string; direction: 'outward' | 'inward' }[] = [
  { label: 'blocks', linkType: 'blocks', direction: 'outward' },
  { label: 'is blocked by', linkType: 'blocks', direction: 'inward' },
  { label: 'relates to', linkType: 'relates', direction: 'outward' },
  { label: 'duplicates', linkType: 'duplicates', direction: 'outward' },
  { label: 'is duplicated by', linkType: 'duplicates', direction: 'inward' },
]

const STATUS_APPEARANCE = { todo: 'default', in_progress: 'inprogress', done: 'success' } as const

function LinkRow({ link, issueKey }: { link: IssueLink; issueKey: string }) {
  const deleteLink = useDeleteLink(issueKey)
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', fontSize: 14,
        border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 4, marginBottom: 4,
        background: token('elevation.surface.raised', '#FFFFFF'),
      }}
    >
      <IssueTypeIcon type={link.other.type} />
      <Link to={`/browse/${link.other.key}`} style={{ fontWeight: 600, whiteSpace: 'nowrap', color: token('color.link', '#0C66E4'), textDecoration: 'none' }}>
        {link.other.key}
      </Link>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{link.other.summary}</span>
      <Lozenge appearance={STATUS_APPEARANCE[link.other.statusCategory] ?? 'default'}>{link.other.statusName}</Lozenge>
      <button
        type="button"
        title={t('Remove link')}
        onClick={() => deleteLink.mutate(link.id)}
        style={{
          border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, width: 22,
          color: token('color.text.subtle', '#44546F'), visibility: hover ? 'visible' : 'hidden',
        }}
      >
        ✕
      </button>
    </div>
  )
}

export default function LinksSection({ issueKey }: { issueKey: string }) {
  const { data: links } = useIssueLinks(issueKey)
  const createLink = useCreateLink(issueKey)
  const [adding, setAdding] = useState(false)
  const [rel, setRel] = useState(RELATIONSHIPS[0])
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<{ label: string; value: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data: results } = useQuickSearch(search.length >= 2 ? search : '')

  const groups = useMemo(() => {
    const byRel = new Map<string, IssueLink[]>()
    for (const l of links ?? []) {
      const arr = byRel.get(l.relationship) ?? []
      arr.push(l)
      byRel.set(l.relationship, arr)
    }
    return [...byRel.entries()]
  }, [links])

  const issueOptions = (results?.values ?? [])
    .filter((i) => i.key !== issueKey)
    .map((i) => ({ label: `${i.key} — ${i.summary}`, value: i.key }))

  if ((links ?? []).length === 0 && !adding) {
    return (
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t('Linked work items')}</span>
          <Button appearance="subtle" spacing="compact" onClick={() => setAdding(true)}>{t('+ Add')}</Button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t('Linked work items')}</span>
        {!adding && <Button appearance="subtle" spacing="compact" onClick={() => setAdding(true)}>{t('+ Add')}</Button>}
      </div>

      {groups.map(([relationship, items]) => (
        <div key={relationship} style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, ...subtleText }}>{t(relationship)}</div>
          {items.map((l) => (
            <LinkRow key={l.id} link={l} issueKey={issueKey} />
          ))}
        </div>
      ))}

      {adding && (
        <div style={{ border: `1px solid ${token('color.border', '#DFE1E6')}`, borderRadius: 6, padding: 10, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ width: 170 }}>
              <Select
                spacing="compact"
                options={RELATIONSHIPS.map((r) => ({ label: t(r.label), value: r.label }))}
                value={{ label: t(rel.label), value: rel.label }}
                onChange={(o) => {
                  const found = RELATIONSHIPS.find((r) => r.label === o?.value)
                  if (found) setRel(found)
                }}
              />
            </div>
            <div style={{ flex: 1, minWidth: 260 }}>
              <Select
                spacing="compact"
                options={issueOptions}
                value={target}
                placeholder={t('Search work items…')}
                inputValue={search}
                onInputChange={(v) => setSearch(v)}
                onChange={(o) => setTarget(o)}
                isClearable
                noOptionsMessage={() => (search.length >= 2 ? t('No matches') : t('Type to search'))}
                filterOption={() => true}
              />
            </div>
            <Button
              appearance="primary"
              spacing="compact"
              isDisabled={!target}
              isLoading={createLink.isPending}
              onClick={() => {
                setError(null)
                createLink.mutate(
                  { linkType: rel.linkType, direction: rel.direction, otherKey: target!.value },
                  {
                    onSuccess: () => {
                      setTarget(null)
                      setSearch('')
                      setAdding(false)
                    },
                    onError: (e) => setError(e instanceof ApiError ? Object.values(e.body.errors)[0] ?? e.message : t('Linking failed')),
                  },
                )
              }}
            >
              {t('Link')}
            </Button>
            <Button appearance="subtle" spacing="compact" onClick={() => { setAdding(false); setError(null) }}>
              {t('Cancel')}
            </Button>
          </div>
          {error && <div style={{ marginTop: 6, fontSize: 13, color: token('color.text.danger', '#AE2E24') }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
