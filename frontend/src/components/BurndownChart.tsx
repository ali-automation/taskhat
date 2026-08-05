import { useMemo, useState } from 'react'
import Spinner from '@atlaskit/spinner'
import { token } from '@atlaskit/tokens'
import { useBurndown } from '../api/hooks'
import { t } from '../i18n'

const W = 640
const H = 280
const M = { top: 16, right: 20, bottom: 30, left: 44 }

// Sprint burndown: one data series (remaining points, blue) against a dashed
// neutral guideline (ideal). #357DE8 validates on both light & dark surfaces.
export default function BurndownChart({ sprintId }: { sprintId: string }) {
  const { data, isLoading } = useBurndown(sprintId)
  const [hover, setHover] = useState<number | null>(null)

  const blue = token('color.chart.blue.bold', '#357DE8')
  const guide = token('color.border.bold', '#758195')
  const grid = token('color.border', '#DFE1E6')
  const textSubtle = token('color.text.subtlest', '#626F86')
  const surface = token('elevation.surface.overlay', '#FFFFFF')

  const points = data?.points ?? []
  const maxY = useMemo(() => {
    let m = 1
    for (const p of points) m = Math.max(m, p.ideal, p.remaining)
    return Math.ceil(m)
  }, [points])

  if (isLoading) return <Spinner />
  if (points.length === 0) {
    return <p style={{ color: textSubtle }}>{t('No burndown yet — the sprint has no dates.')}</p>
  }

  const innerW = W - M.left - M.right
  const innerH = H - M.top - M.bottom
  const x = (i: number) => M.left + (i / Math.max(points.length - 1, 1)) * innerW
  const y = (v: number) => M.top + innerH - (v / maxY) * innerH

  const idealPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.ideal)}`).join(' ')
  const actual = points.filter((p) => p.remaining >= 0)
  const actualPath = actual.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(points.indexOf(p))},${y(p.remaining)}`).join(' ')

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f * 10) / 10)
  const xLabelEvery = Math.max(1, Math.ceil(points.length / 8))

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const i = Math.round(((px - M.left) / innerW) * (points.length - 1))
    setHover(i >= 0 && i < points.length ? i : null)
  }

  const h = hover != null ? points[hover] : null

  return (
    <div style={{ position: 'relative' }}>
      {/* Legend: 2 series → always present; text wears text tokens */}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: textSubtle, marginBottom: 4 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke={blue} strokeWidth="2" /></svg>
          {t('Remaining')}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="4"><line x1="0" y1="2" x2="16" y2="2" stroke={guide} strokeWidth="2" strokeDasharray="4 3" /></svg>
          {t('Guideline')}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', maxWidth: W, display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={t('Sprint burndown chart of remaining story points per day')}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} y1={y(t)} x2={W - M.right} y2={y(t)} stroke={grid} strokeWidth="1" />
            <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={textSubtle}>
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % xLabelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={textSubtle}>
              {p.date.slice(5)}
            </text>
          ) : null,
        )}

        <path d={idealPath} fill="none" stroke={guide} strokeWidth="2" strokeDasharray="5 4" />
        <path d={actualPath} fill="none" stroke={blue} strokeWidth="2" strokeLinejoin="round" />

        {h && (
          <g>
            <line x1={x(hover!)} y1={M.top} x2={x(hover!)} y2={M.top + innerH} stroke={grid} strokeWidth="1" />
            {h.remaining >= 0 && <circle cx={x(hover!)} cy={y(h.remaining)} r="4" fill={blue} stroke={surface} strokeWidth="2" />}
            <circle cx={x(hover!)} cy={y(h.ideal)} r="4" fill={guide} stroke={surface} strokeWidth="2" />
          </g>
        )}
      </svg>

      {h && (
        <div
          style={{
            position: 'absolute',
            left: `${(x(hover!) / W) * 100}%`,
            top: 24,
            transform: x(hover!) > W / 2 ? 'translateX(-105%)' : 'translateX(8px)',
            background: surface,
            border: `1px solid ${grid}`,
            borderRadius: 4,
            boxShadow: token('elevation.shadow.overlay', '0 4px 8px rgba(9,30,66,0.16)'),
            padding: '6px 10px',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          <div style={{ fontWeight: 600 }}>{h.date}</div>
          {h.remaining >= 0 && <div>{t('Remaining: {n}', { n: h.remaining })}</div>}
          <div style={{ color: textSubtle }}>{t('Guideline: {n}', { n: Math.round(h.ideal * 10) / 10 })}</div>
        </div>
      )}
    </div>
  )
}
