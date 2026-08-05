import { Link } from 'react-router-dom'
import { token } from '@atlaskit/tokens'
import { useMentionedOn } from '../api/hooks'
import { t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// DocHat pages that reference this work item via smart chips, like
// Confluence's "mentioned on" links on Jira issues.
export default function MentionedOnSection({ issueKey }: { issueKey: string }) {
  const { data: pages } = useMentionedOn(issueKey)
  if (!pages || pages.length === 0) return null
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{t('Mentioned on')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {pages.map((p) => (
          <Link
            key={p.id}
            to={`/wiki/spaces/${p.spaceKey}/pages/${p.id}`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14 }}
          >
            <span>{p.icon || '📄'}</span> {p.title}
            <span style={{ fontSize: 12, ...subtleText }}>· {p.spaceName}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
