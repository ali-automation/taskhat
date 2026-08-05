// Lightweight i18n (Stage 19). Messages are keyed by their English source
// string, so untranslated text falls back to English instead of breaking.
// The language is decided before React renders (localStorage, synced from the
// account preference after login) and switching reloads the app, like Jira —
// no per-component subscription machinery needed.
import { ar } from './ar'

export type Language = 'en' | 'ar'

const STORAGE_KEY = 'taskhat-language'

export const language: Language = localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en'

// Keep Western digits — business convention in Iraqi/Gulf software, and issue
// keys like TH-12 stay consistent across both languages.
export const locale = language === 'ar' ? 'ar-u-nu-latn' : 'en'

export function t(text: string, vars?: Record<string, string | number>): string {
  let out = language === 'ar' ? (ar[text] ?? text) : text
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v))
  }
  return out
}

// Applies dir/lang to the document; call once at bootstrap.
export function initLanguage() {
  document.documentElement.lang = language
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
}

// Persist + reload when the language actually changes (from the account
// preference after login, or the personal settings page).
export function setLanguage(l: string) {
  const next: Language = l === 'ar' ? 'ar' : 'en'
  if (next === language) return
  localStorage.setItem(STORAGE_KEY, next)
  window.location.reload()
}

export function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString(locale, opts ?? { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 3600) return t('{n}m ago', { n: Math.max(1, Math.floor(seconds / 60)) })
  if (seconds < 86400) return t('{n}h ago', { n: Math.floor(seconds / 3600) })
  return t('{n}d ago', { n: Math.floor(seconds / 86400) })
}
