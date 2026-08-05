import { Link, useNavigate, useParams } from 'react-router-dom'
import Avatar from '@atlaskit/avatar'
import Button from '@atlaskit/button/new'
import { token } from '@atlaskit/tokens'
import { useWikiBlogPosts, useWikiSpace } from '../api/hooks'
import { fmtDate, t } from '../i18n'

const subtleText = { color: token('color.text.subtlest', '#626F86') }

// Confluence's space blog: a chronological feed grouped by month.
export default function WikiBlogPage() {
  const { key = '' } = useParams()
  const spaceKey = key.toUpperCase()
  const navigate = useNavigate()
  const { data: spaceData } = useWikiSpace(spaceKey)
  const { data: posts } = useWikiBlogPosts(spaceKey)
  const canPost = (spaceData?.myRole ?? 'collaborator') !== 'viewer'

  const groups: { label: string; items: NonNullable<typeof posts> }[] = []
  for (const p of posts ?? []) {
    const d = new Date(p.createdAt)
    const label = d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(p)
    else groups.push({ label, items: [p] })
  }

  return (
    <div style={{ padding: '24px 32px 48px', maxWidth: 820 }}>
      <div style={{ fontSize: 12, marginBottom: 4, ...subtleText }}>{spaceData?.space.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>{t('Blog')}</h1>
        {canPost && (
          <Button appearance="primary" onClick={() => navigate(`/wiki/spaces/${spaceKey}/new?kind=blog`)}>
            {t('Create blog post')}
          </Button>
        )}
      </div>
      <p style={{ fontSize: 13, marginBottom: 20, ...subtleText }}>
        {t('News, announcements and updates from this space, newest first.')}
      </p>

      {(posts ?? []).length === 0 && (
        <div style={{ padding: '40px 0', textAlign: 'center', ...subtleText }}>
          {t('No blog posts yet. Share the first update!')}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.label} style={{ marginBottom: 26 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, ...subtleText }}>
            {g.label}
          </div>
          {g.items.map((p) => (
            <div
              key={p.id}
              style={{
                border: `1px solid ${token('color.border', '#DFE1E6')}`,
                borderRadius: 8, padding: '14px 18px', marginBottom: 10,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Avatar size="small" name={p.author?.displayName ?? ''} src={p.author?.avatarUrl ?? undefined} />
                <span style={{ fontSize: 13 }}>
                  <strong>{p.author?.displayName}</strong>{' '}
                  <span style={subtleText}>· {fmtDate(p.createdAt)}</span>
                </span>
              </div>
              <Link
                to={`/wiki/spaces/${spaceKey}/pages/${p.id}`}
                style={{ fontSize: 18, fontWeight: 600, color: token('color.link', '#0C66E4'), textDecoration: 'none' }}
              >
                {p.icon ? `${p.icon} ` : ''}{p.title}
              </Link>
              {p.excerpt && (
                <div style={{ fontSize: 13, marginTop: 6, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', ...subtleText }}>
                  {p.excerpt}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
