import { useEffect, useRef, useState } from 'react'
import { useSiteInfo } from '../api/hooks'
import { t } from '../i18n'

// SysHat — the demo-mode notification banner, now a guided micro-tour.
// A small DevOps assistant robot greets the visitor, walks up to the
// read-only sentence and highlights it, then walks over to the social
// buttons and signals "contact my creator". Speech renders in a
// holographic terminal bubble with a typewriter effect. Pure SVG + CSS
// (styles injected into <head> once); prefers-reduced-motion skips the
// walk and shows the final state.

const STYLE_ID = 'th-syshat-styles'
const BLUE = '#60A5FA'
const PURPLE = '#A78BFA'
const CYAN = '#7DD3FC'

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
@keyframes sh-gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes sh-scan {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(1400%); }
}
@keyframes sh-step-a {
  0%, 100% { transform: rotate(22deg); }
  50% { transform: rotate(-22deg); }
}
@keyframes sh-step-b {
  0%, 100% { transform: rotate(-22deg); }
  50% { transform: rotate(22deg); }
}
@keyframes sh-stride {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.6px); }
}
@keyframes sh-idle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1px); }
}
@keyframes sh-visor {
  0%, 90%, 100% { opacity: 1; }
  94% { opacity: 0.25; }
}
@keyframes sh-wave {
  0%, 100% { transform: rotate(0deg); }
  30% { transform: rotate(-38deg); }
  60% { transform: rotate(-16deg); }
  80% { transform: rotate(-34deg); }
}
@keyframes sh-signal {
  0% { transform: scale(0.4); opacity: 0.9; }
  100% { transform: scale(1.5); opacity: 0; }
}
@keyframes sh-cursor {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes sh-cta-pulse {
  0%, 100% { box-shadow: 0 0 0 rgba(96, 165, 250, 0); }
  50% { box-shadow: 0 0 12px rgba(96, 165, 250, 0.55); }
}
@keyframes sh-text-glow {
  0%, 100% { text-shadow: none; }
  50% { text-shadow: 0 0 10px rgba(125, 211, 252, 0.8); }
}
.sh-banner { position: relative; overflow: hidden; border-radius: 10px;
  margin: 6px 10px 2px; flex-shrink: 0;
  border: 1px solid rgba(139, 92, 246, 0.45);
  box-shadow: 0 0 12px rgba(96, 165, 250, 0.18), inset 0 0 24px rgba(59, 130, 246, 0.08);
  background: linear-gradient(115deg, rgba(10, 16, 34, 0.96) 0%, rgba(34, 24, 66, 0.96) 35%, rgba(13, 26, 51, 0.96) 70%, rgba(30, 20, 60, 0.96) 100%);
  color: #DCE6F7; }
.sh-grid { position: absolute; inset: 0; pointer-events: none; opacity: 0.55;
  background-image:
    repeating-linear-gradient(90deg, rgba(148, 163, 255, 0.055) 0 1px, transparent 1px 26px),
    repeating-linear-gradient(0deg, rgba(148, 163, 255, 0.045) 0 1px, transparent 1px 13px); }
.sh-scanline { position: absolute; top: 0; bottom: 0; width: 8%; pointer-events: none;
  background: linear-gradient(90deg, transparent, rgba(125, 211, 252, 0.08), transparent);
  animation: sh-scan 9s linear infinite; }
.sh-bot { position: absolute; bottom: 1px; left: 0; z-index: 2; pointer-events: none;
  transition-property: transform; transition-timing-function: linear; will-change: transform; }
.sh-bot svg { display: block; overflow: visible;
  filter: drop-shadow(0 0 4px rgba(139, 92, 246, 0.45)); }
.sh-bot.walking svg { animation: sh-stride 0.4s ease-in-out infinite; }
.sh-bot.walking .sh-leg-a { animation: sh-step-a 0.4s ease-in-out infinite; }
.sh-bot.walking .sh-leg-b { animation: sh-step-b 0.4s ease-in-out infinite; }
.sh-leg-a, .sh-leg-b { transform-origin: 50% 8%; transform-box: fill-box; }
.sh-bot.idle svg { animation: sh-idle 3.2s ease-in-out infinite; }
.sh-visor-led { animation: sh-visor 4.2s linear infinite; }
.sh-arm-back { transform-origin: 20% 20%; transform-box: fill-box; transition: transform 0.4s ease-out; }
.sh-bot.pointing .sh-arm-back { transform: rotate(-58deg); }
.sh-bot.greeting .sh-arm-back { animation: sh-wave 1.6s ease-in-out infinite; }
.sh-signal-ring { transform-origin: center; transform-box: fill-box; opacity: 0;
  fill: none; stroke: ${CYAN}; stroke-width: 1.6; }
.sh-bot.signaling .sh-signal-ring { animation: sh-signal 1.4s ease-out infinite; }
.sh-bot.signaling .sh-signal-ring.r2 { animation-delay: 0.5s; }
.sh-bubble { position: absolute; z-index: 3; bottom: 38px; max-width: 400px; pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; line-height: 1.4;
  color: #D9F3FF; background: rgba(8, 14, 30, 0.92);
  border: 1px solid rgba(125, 211, 252, 0.55); border-radius: 8px 8px 8px 2px;
  padding: 4px 9px; white-space: nowrap;
  box-shadow: 0 0 10px rgba(125, 211, 252, 0.25);
  transition: left 0.3s ease, right 0.3s ease; }
.sh-bubble .sh-cursor { display: inline-block; width: 6px; margin-inline-start: 1px;
  background: ${CYAN}; height: 10px; vertical-align: -1px; animation: sh-cursor 0.9s steps(1) infinite; }
.sh-msg { transition: color 0.4s ease; }
.sh-msg.hot { color: ${CYAN}; animation: sh-text-glow 1.6s ease-in-out infinite; }
.sh-links.hot .sh-link { animation: sh-cta-pulse 1.5s ease-in-out infinite; }
.sh-link { display: inline-flex; align-items: center; gap: 6px;
  padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600;
  color: #C7D8F9; text-decoration: none; line-height: 1.6;
  background: rgba(96, 165, 250, 0.10);
  border: 1px solid rgba(139, 92, 246, 0.45);
  transition: background 0.15s ease, box-shadow 0.15s ease, color 0.15s ease; }
.sh-link:hover { background: rgba(96, 165, 250, 0.22); color: #EAF2FF;
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.35); }
.sh-link:focus-visible { outline: 2px solid ${BLUE}; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .sh-banner, .sh-scanline, .sh-bot svg, .sh-bot .sh-leg-a, .sh-bot .sh-leg-b,
  .sh-bot.greeting .sh-arm-back, .sh-bot.signaling .sh-signal-ring,
  .sh-msg.hot, .sh-links.hot .sh-link { animation: none; }
  .sh-bot { transition: none; }
}
`
  document.head.appendChild(el)
}

function SysHatBot({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="sh-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3B4252" />
          <stop offset="0.55" stopColor="#232A38" />
          <stop offset="1" stopColor="#131826" />
        </linearGradient>
      </defs>
      {/* antenna signal rings (visible while signaling) */}
      <circle className="sh-signal-ring" cx={32} cy={3} r={7} />
      <circle className="sh-signal-ring r2" cx={32} cy={3} r={11} />
      {/* back arm — waves in greeting, points when presenting */}
      <g className="sh-arm-back">
        <rect x={42} y={26} width={13} height={4.6} rx={2.3} fill="#2A3244" stroke={PURPLE} strokeOpacity="0.5" strokeWidth="0.7" />
        <circle cx={55.4} cy={28.3} r={2.4} fill={BLUE} opacity={0.9} />
      </g>
      {/* legs */}
      <g className="sh-leg-a">
        <rect x={24} y={46} width={5} height={12} rx={2.4} fill="#1B2130" stroke={BLUE} strokeOpacity="0.35" strokeWidth="0.7" />
        <rect x={22.6} y={56.4} width={7.8} height={3} rx={1.5} fill="#2A3244" />
      </g>
      <g className="sh-leg-b">
        <rect x={34} y={46} width={5} height={12} rx={2.4} fill="#1B2130" stroke={BLUE} strokeOpacity="0.35" strokeWidth="0.7" />
        <rect x={32.6} y={56.4} width={7.8} height={3} rx={1.5} fill="#2A3244" />
      </g>
      {/* torso */}
      <path d="M22 27 h20 q3.4 0 3.2 3.4 l-1.1 13.2 q-0.3 3.4 -3.7 3.4 h-16.8 q-3.4 0 -3.7 -3.4 l-1.1 -13.2 q-0.2 -3.4 3.2 -3.4 Z"
        fill="url(#sh-metal)" stroke={PURPLE} strokeOpacity="0.55" strokeWidth="1" />
      {/* chest terminal: >_ */}
      <rect x={25.5} y={31.5} width={13} height={8.4} rx={1.8} fill="#0A0F1C" stroke={BLUE} strokeOpacity="0.5" strokeWidth="0.7" />
      <text x={27.4} y={38} fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontSize="6.4" fontWeight="700" fill={BLUE}>&gt;_</text>
      {/* front arm */}
      <rect x={9} y={28} width={5} height={13} rx={2.4} fill="#1B2130" stroke={BLUE} strokeOpacity="0.35" strokeWidth="0.7" />
      {/* head */}
      <rect x={18} y={8} width={28} height={16} rx={6} fill="url(#sh-metal)" stroke={PURPLE} strokeOpacity="0.55" strokeWidth="1" />
      <rect x={21.5} y={12.4} width={21} height={7.2} rx={3.6} fill="#070B14" />
      <g className="sh-eyes">
        <rect x={25.5} y={14.4} width={4.6} height={3.2} rx={1} fill={BLUE} className="sh-visor-led" />
        <rect x={33.5} y={14.4} width={4.6} height={3.2} rx={1} fill={BLUE} className="sh-visor-led" />
      </g>
      <rect x={15.4} y={13} width={3} height={6} rx={1.5} fill="#2A3244" stroke={PURPLE} strokeOpacity="0.4" strokeWidth="0.6" />
      <rect x={45.6} y={13} width={3} height={6} rx={1.5} fill="#2A3244" stroke={PURPLE} strokeOpacity="0.4" strokeWidth="0.6" />
      <rect x={31.2} y={3.4} width={1.6} height={4.6} fill="#3B4252" />
      <circle cx={32} cy={3} r={1.8} fill={PURPLE} className="sh-visor-led" />
    </svg>
  )
}

const socialIconProps = { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true } as const

function LinkedInIcon() {
  return (
    <svg {...socialIconProps} fill="#7DB4F7">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56v11.45z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg {...socialIconProps} fill="none" stroke="#C58AF9" strokeWidth="1.8">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="1.2" fill="#C58AF9" stroke="none" />
    </svg>
  )
}

// Typewriter line with a blinking block cursor.
function TypeLine({ text, instant }: { text: string; instant: boolean }) {
  const [n, setN] = useState(instant ? text.length : 0)
  useEffect(() => {
    if (instant) {
      setN(text.length)
      return
    }
    setN(0)
    const started = performance.now()
    const id = setInterval(() => {
      const chars = Math.min(text.length, Math.floor((performance.now() - started) / 22))
      setN(chars)
      if (chars >= text.length) clearInterval(id)
    }, 50)
    return () => clearInterval(id)
  }, [text, instant])
  return (
    <span>
      {text.slice(0, n)}
      <span className="sh-cursor" />
    </span>
  )
}

// Tour phases: 0 greet → 1 walk to message → 2 present message →
// 3 walk to links → 4 signal contact → 5 rest (bubble hidden, idle).
const WALK_SPEED = 220 // px per second

export default function SysHatBanner() {
  ensureStyles()
  const { data: site } = useSiteInfo()
  const bannerRef = useRef<HTMLDivElement>(null)
  const msgRef = useRef<HTMLSpanElement>(null)
  const linksRef = useRef<HTMLSpanElement>(null)
  const [phase, setPhase] = useState(0)
  const [x, setX] = useState(8)
  const [walkMs, setWalkMs] = useState(0)
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const targetFor = (el: HTMLElement | null) => {
    const banner = bannerRef.current
    if (!banner || !el) return 8
    const bx = banner.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return Math.max(8, Math.min(r.left - bx.left - 42, bx.width - 46))
  }

  // Phase timeline. Walking phases set a linear transition sized to the
  // distance; arrival advances via onTransitionEnd (with a timer fallback).
  useEffect(() => {
    if (reduced) {
      setPhase(4)
      setX(8)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    if (phase === 0) {
      timer = setTimeout(() => setPhase(1), 2800)
    } else if (phase === 1 || phase === 3) {
      const dest = targetFor(phase === 1 ? msgRef.current : linksRef.current)
      const dist = Math.abs(dest - x)
      const ms = Math.max(600, (dist / WALK_SPEED) * 1000)
      setWalkMs(ms)
      // next frame so the transition duration applies before the move
      requestAnimationFrame(() => setX(dest))
      timer = setTimeout(() => setPhase(phase + 1), ms + 250) // fallback if transitionend is missed
    } else if (phase === 2) {
      timer = setTimeout(() => setPhase(3), 4200)
    } else if (phase === 4) {
      timer = setTimeout(() => setPhase(5), 8000)
    }
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, reduced])

  const walking = phase === 1 || phase === 3
  const botClass = [
    'sh-bot',
    walking ? 'walking' : 'idle',
    phase === 0 ? 'greeting' : '',
    phase === 2 ? 'pointing' : '',
    phase >= 4 ? 'signaling pointing' : '',
  ].join(' ')

  const bubbleText =
    phase <= 1 ? t("Hello dear — I'm SysHat robot. Wanted to let you know…")
    : phase <= 3 ? t('This is a read-only demo account.')
    : t('Contact my creator for more details:')
  const showBubble = phase < 5
  // Bubble follows the robot; flips to the left near the right edge.
  const bannerW = bannerRef.current?.getBoundingClientRect().width ?? 1200
  const bubbleLeft = x + 40 + 400 < bannerW

  return (
    <div ref={bannerRef} className="sh-banner" role="region" aria-label={t('Demo notice')}>
      <div className="sh-grid" />
      <div className="sh-scanline" />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '30px 14px 10px 116px', flexWrap: 'wrap', minHeight: 30 }}>
        <span ref={msgRef} className={`sh-msg${phase === 2 ? ' hot' : ''}`} style={{ flex: 1, minWidth: 220, fontSize: 13, lineHeight: 1.45 }}>
          {t("You're exploring TaskHat in read-only mode. Want admin access or to test the Jira/Confluence importer with your own data?")}
        </span>
        <span ref={linksRef} className={`sh-links${phase >= 4 && phase < 5 ? ' hot' : ''}`} style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
          {site?.demoContactUrl && (
            <a className="sh-link" href={site.demoContactUrl} target="_blank" rel="noopener noreferrer">
              <LinkedInIcon /> {t('LinkedIn')}
            </a>
          )}
          {site?.demoInstagramUrl && (
            <a className="sh-link" href={site.demoInstagramUrl} target="_blank" rel="noopener noreferrer">
              <InstagramIcon /> {t('Instagram')}
            </a>
          )}
        </span>
      </div>
      {showBubble && (
        <div
          className="sh-bubble"
          style={bubbleLeft
            ? { left: Math.max(8, x + 40) }
            : { right: Math.max(8, bannerW - x + 6), borderRadius: '8px 8px 2px 8px' }}
        >
          <TypeLine text={bubbleText} instant={reduced} />
        </div>
      )}
      <div
        className={botClass}
        style={{ transform: `translateX(${x}px)`, transitionDuration: `${walkMs}ms` }}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform' && (phase === 1 || phase === 3)) {
            setPhase(phase + 1)
          }
        }}
      >
        <SysHatBot />
      </div>
    </div>
  )
}
