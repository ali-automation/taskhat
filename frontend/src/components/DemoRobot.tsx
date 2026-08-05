import { useEffect, useState } from 'react'
import { useSiteInfo } from '../api/hooks'
import { t } from '../i18n'

// SysHat — the login demo scene: a dark space capsule with twinkling stars and a
// hovering mech (glowing scan visor, pulsing thrusters, radar pings) that
// drifts back and forth. Pure SVG + CSS — no assets, CSP-safe. Styles are
// injected into <head> once so React re-renders can never remove them
// (a <style> rendered inline died on the first re-render and froze the
// animations — the bug behind "the robot doesn't move").

const STYLE_ID = 'th-robot-styles'
const CYAN = '#22D3EE'

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
@keyframes th2-drift {
  0%   { transform: translateX(0); }
  50%  { transform: translateX(var(--drift, 70px)); }
  100% { transform: translateX(0); }
}
@keyframes th2-bob {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@keyframes th2-visor {
  0%   { transform: translateX(-7px); }
  50%  { transform: translateX(7px); }
  100% { transform: translateX(-7px); }
}
@keyframes th2-flame {
  0%, 100% { transform: scaleY(0.55); opacity: 0.55; }
  50% { transform: scaleY(1.15); opacity: 1; }
}
@keyframes th2-twinkle {
  0%, 100% { opacity: 0.15; }
  50% { opacity: 0.9; }
}
@keyframes th2-ping {
  0%   { transform: scale(0.25); opacity: 0.9; }
  70%  { opacity: 0.25; }
  100% { transform: scale(1.8); opacity: 0; }
}
@keyframes th2-beacon {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.2; }
}
@keyframes th2-bubble-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.th2-scene { position: relative; overflow: hidden; border-radius: 10px;
  background: radial-gradient(120% 140% at 30% 20%, #14213D 0%, #0B1220 55%, #05080F 100%);
  box-shadow: inset 0 0 12px rgba(34,211,238,0.15), 0 0 0 1px rgba(34,211,238,0.25); }
.th2-star { position: absolute; width: 2px; height: 2px; border-radius: 50%;
  background: #E2E8F0; animation: th2-twinkle 2.6s ease-in-out infinite; }
.th2-mech { position: absolute; top: 50%; animation: th2-drift var(--speed, 9s) ease-in-out infinite; will-change: transform; }
.th2-mech > svg { display: block; overflow: visible; animation: th2-bob 1.6s ease-in-out infinite;
  filter: drop-shadow(0 0 5px rgba(34,211,238,0.65)); }
.th2-visor-bar { animation: th2-visor 1.8s ease-in-out infinite; }
.th2-flame { animation: th2-flame 0.5s ease-in-out infinite; transform-origin: 50% 0%; transform-box: fill-box; }
.th2-ping { position: absolute; border: 1px solid rgba(34,211,238,0.8); border-radius: 50%;
  animation: th2-ping 3.4s ease-out infinite; }
.th2-beacon { animation: th2-beacon 1.1s steps(2, start) infinite; }
.th2-bubble { animation: th2-bubble-in 0.35s ease-out; }
`
  document.head.appendChild(el)
}

function MechSVG({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="th2-hull" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="0.5" stopColor="#1E293B" />
          <stop offset="1" stopColor="#0F172A" />
        </linearGradient>
        <linearGradient id="th2-jet" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={CYAN} />
          <stop offset="1" stopColor={CYAN} stopOpacity="0" />
        </linearGradient>
        <clipPath id="th2-visor-clip">
          <rect x={20} y={16} width={24} height={7} rx={3.5} />
        </clipPath>
      </defs>

      {/* antenna + beacon */}
      <rect x={31.2} y={2.5} width={1.6} height={6} fill="#475569" />
      <circle className="th2-beacon" cx={32} cy={2.4} r={2.1} fill="#FF5D5D" />

      {/* head: helmet with glowing scan visor */}
      <path d="M18 24 L18 15 Q18 10 23 10 L41 10 Q46 10 46 15 L46 24 Z" fill="url(#th2-hull)" stroke={CYAN} strokeOpacity="0.5" strokeWidth="1" />
      <rect x={20} y={16} width={24} height={7} rx={3.5} fill="#020617" />
      <g clipPath="url(#th2-visor-clip)">
        <rect className="th2-visor-bar" x={26} y={16} width={12} height={7} fill={CYAN} opacity={0.9} />
      </g>

      {/* shoulder fins */}
      <path d="M10 30 L18 26 L18 34 Z" fill="#1E293B" stroke={CYAN} strokeOpacity="0.4" strokeWidth="0.8" />
      <path d="M54 30 L46 26 L46 34 Z" fill="#1E293B" stroke={CYAN} strokeOpacity="0.4" strokeWidth="0.8" />

      {/* torso */}
      <path d="M20 26 L44 26 Q47 26 47 30 L45 44 Q44.5 48 40 48 L24 48 Q19.5 48 19 44 L17 30 Q17 26 20 26 Z"
        fill="url(#th2-hull)" stroke={CYAN} strokeOpacity="0.5" strokeWidth="1" />
      {/* core reactor */}
      <circle cx={32} cy={36} r={4.6} fill="#020617" />
      <circle className="th2-beacon" cx={32} cy={36} r={2.6} fill={CYAN} style={{ animationDuration: '2.2s' }} />
      {/* chest seams */}
      <line x1={24} y1={30} x2={26} y2={44} stroke="#475569" strokeWidth="0.8" />
      <line x1={40} y1={30} x2={38} y2={44} stroke="#475569" strokeWidth="0.8" />

      {/* thrusters */}
      <rect x={23} y={48} width={6} height={4} rx={1.5} fill="#475569" />
      <rect x={35} y={48} width={6} height={4} rx={1.5} fill="#475569" />
      <path className="th2-flame" d="M26 52 L23.5 52 Q26 61 26 61 Q26 61 28.5 52 Z" fill="url(#th2-jet)" />
      <path className="th2-flame" d="M38 52 L35.5 52 Q38 61 38 61 Q38 61 40.5 52 Z" fill="url(#th2-jet)" style={{ animationDelay: '0.25s' }} />
    </svg>
  )
}

const STARS: [number, number, number][] = [
  [8, 18, 0], [22, 70, 0.6], [35, 30, 1.2], [48, 80, 0.3], [58, 15, 1.8],
  [70, 55, 0.9], [82, 25, 1.5], [90, 65, 0.2], [15, 45, 2.1], [64, 40, 0.45],
]

// DemoRobot: the capsule scene, optionally with the transmission bubble.
export default function DemoRobot({ height = 56, width = 190, bubble = true, stack = false }: {
  height?: number; width?: number; bubble?: boolean; stack?: boolean
}) {
  ensureStyles()
  const { data: site } = useSiteInfo()
  const mech = Math.round(height * 0.86)
  const drift = Math.max(10, width - mech - 14)
  const messages = [
    t("⚡ Systems online. I'm SysHat robot, your guide."),
    t('My creator is the god of sci-fi and technology.'),
    t('Transmit a signal for admin access or your own Jira import:'),
  ]
  const [msg, setMsg] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setMsg((m) => (m + 1) % 3), 5000)
    return () => clearInterval(id)
  }, [])
  const linkStyle = { fontWeight: 700, color: '#7DD3FC' }
  return (
    <span style={{ display: stack ? 'flex' : 'inline-flex', flexDirection: stack ? 'column' : 'row', alignItems: 'center', gap: 12 }}>
      <span className="th2-scene" style={{ width, height, flexShrink: 0 }}>
        {STARS.map(([x, y, d], i) => (
          <span key={i} className="th2-star" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s` }} />
        ))}
        <span className="th2-ping" style={{ width: height * 0.9, height: height * 0.9, left: '12%', top: '6%' }} />
        <span className="th2-ping" style={{ width: height * 0.7, height: height * 0.7, left: '68%', top: '18%', animationDelay: '1.7s' }} />
        <span className="th2-mech" style={{
          ['--drift' as string]: `${drift}px`,
          ['--speed' as string]: `${Math.max(6, Math.round(drift / 12))}s`,
          left: 6, marginTop: -(mech / 2),
        }}>
          <MechSVG size={mech} />
        </span>
      </span>
      {bubble && (
        <span
          key={msg}
          className="th2-bubble"
          style={{
            fontSize: 13,
            background: '#0B1220',
            color: '#E6FAFF',
            border: `1px solid rgba(34,211,238,0.55)`,
            boxShadow: '0 0 14px rgba(34,211,238,0.3)',
            borderRadius: 12,
            padding: '7px 13px',
            display: 'inline-flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 10,
            maxWidth: stack ? width : 430,
            textAlign: 'start',
          }}
        >
          <span>{messages[msg]}</span>
          {msg === 2 && (
            <span style={{ display: 'inline-flex', gap: 10 }}>
              {site?.demoContactUrl && (
                <a href={site.demoContactUrl} target="_blank" rel="noreferrer" style={linkStyle}>{t('LinkedIn')}</a>
              )}
              {site?.demoInstagramUrl && (
                <a href={site.demoInstagramUrl} target="_blank" rel="noreferrer" style={linkStyle}>{t('Instagram')}</a>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  )
}
