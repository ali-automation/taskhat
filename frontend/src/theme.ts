import { setGlobalTheme } from '@atlaskit/tokens'

export type ThemeChoice = 'light' | 'dark' | 'auto'

const KEY = 'taskhat-theme'

export function currentTheme(): ThemeChoice {
  const v = localStorage.getItem(KEY)
  return v === 'dark' || v === 'auto' ? v : 'light'
}

export function applyTheme(choice: ThemeChoice) {
  localStorage.setItem(KEY, choice)
  void setGlobalTheme({ colorMode: choice })
}

export function initTheme() {
  void setGlobalTheme({ colorMode: currentTheme() })
}
