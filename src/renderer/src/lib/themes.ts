/*
 * Cratedigger's one theme: Crate, drawn from the app icon.
 *
 * The palette lives in app.css — :root holds every token, and the
 * [data-theme='crate'] block (index.html sets the attribute) holds the
 * structural touches. This module only reads those tokens back out for the
 * two places outside the renderer's CSS that need them: the BrowserWindow
 * background and the living-room kiosk.
 *
 * Until 2026-09 there were ten switchable themes; they went when Crate became
 * the only one. `shadow-color` is still a bare "R, G, B" triplet so call sites
 * can write rgba(var(--shadow-color), 0.28).
 */

const TOKEN_KEYS = [
  'paper',
  'surface',
  'surface-deep',
  'inset',
  'espresso',
  'walnut',
  'faded',
  'whisper',
  'hairline',
  'hairline-strong',
  'brick',
  'brick-deep',
  'brick-wash',
  'on-brick',
  'ink-tint-04',
  'ink-tint-06',
  'ink-tint-08',
  'ink-tint-12',
  'ink-tint-16',
  'ok-fg',
  'ok-bg',
  'ok-border',
  'warn-fg',
  'warn-bg',
  'warn-border',
  'err-fg',
  'shadow-sm',
  'shadow-md',
  'shadow-lg',
  'shadow-color',
  'font-display',
  'font-body',
  'font-mono',
  'radius-xs',
  'radius-sm',
  'radius-md',
  'radius-lg',
  'radius-xl',
  'radius-2xl',
  'radius-pill',
  'texture'
] as const

export type TokenName = (typeof TOKEN_KEYS)[number]

export interface ThemeSnapshot {
  id: string
  name: string
  scheme: 'dark'
  tokens: Record<TokenName, string>
}

/** The resolved tokens, read from app.css so there's one source of truth. */
export function crateTheme(): ThemeSnapshot {
  const css = getComputedStyle(document.documentElement)
  const tokens = {} as Record<TokenName, string>
  for (const key of TOKEN_KEYS) tokens[key] = css.getPropertyValue(`--${key}`).trim()
  return { id: 'crate', name: 'Crate', scheme: 'dark', tokens }
}

/** Keep the BrowserWindow background (resize gutter, next launch's pre-paint
 *  frame) on the Crate paper — a store written under an older theme still
 *  holds that theme's colour until this runs once. */
export function syncWindowBackground(): void {
  if (typeof document === 'undefined') return
  window.cratedigger?.win.setBackground(crateTheme().tokens.paper)
}
