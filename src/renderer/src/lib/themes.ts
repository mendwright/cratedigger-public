/*
 * Cratedigger themes.
 *
 * Each theme is a complete token set — color, typography, shape, texture,
 * shadow. applyTheme() writes them to document.documentElement.style; every
 * component already consumes var(--*) so swapping the theme is a one-call
 * repaint.
 *
 * Themes differentiate on five axes, not just palette:
 *   - color        (paper/ink/accent families, as before)
 *   - typography   (font-display for headlines & serif accents, font-body,
 *                   font-mono — all macOS system faces, no webfont fetch)
 *   - shape        (the radius scale: square, or near-square hairline)
 *   - texture      (a full-viewport overlay: paper grain, darkroom vignette,
 *                   brass spotlight, rain-glass glow — or none)
 *   - shadow       (soft warm drops, hard print offsets, neon glow)
 *
 * `shadow-color` is the odd one out: a bare "R, G, B" triplet rather than a
 * finished color, so the many call sites that need their own alpha can write
 * rgba(var(--shadow-color), 0.28). Shadows and scrims were previously baked as
 * rgba(43, 29, 18, x) — liner-notes' espresso — which meant every shadow in
 * the app stayed warm brown no matter which theme was active.
 *
 * Sleeve is the default — its values are duplicated in app.css under :root so
 * the first paint at boot is already right, before any JS runs. Change the
 * default and you must change that block too, or every launch flashes the old
 * scheme for a frame.
 */

export type ColorScheme = 'light' | 'dark'

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

export interface Theme {
  id: string
  name: string
  mood: string
  scheme: ColorScheme
  // Record<TokenName, string> so the compiler rejects a theme that forgets a
  // token — applyTheme writes every key, so a partial theme would otherwise
  // leak the previous theme's values.
  tokens: Record<TokenName, string>
}

/* — Shared font stacks (every face ships with macOS) */
const SYSTEM_SANS = "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
const BOOK_SERIF =
  "'Iowan Old Style', 'Iowan Old Style BT', 'Apple Garamond', 'Hoefler Text', Charter, Georgia, ui-serif, serif"
const MONO = "'SF Mono', ui-monospace, Menlo, monospace"

/* — Shared radius scales. Only the two the current themes use; the softer
     scales went with the ten themes they belonged to. */
type RadiusTokens = Record<
  'radius-xs' | 'radius-sm' | 'radius-md' | 'radius-lg' | 'radius-xl' | 'radius-2xl' | 'radius-pill',
  string
>
const RADII_SQUARE: RadiusTokens = {
  'radius-xs': '0',
  'radius-sm': '0',
  'radius-md': '0',
  'radius-lg': '0',
  'radius-xl': '0',
  'radius-2xl': '0',
  'radius-pill': '0'
}
const RADII_HAIRLINE: RadiusTokens = {
  'radius-xs': '1px',
  'radius-sm': '2px',
  'radius-md': '3px',
  'radius-lg': '4px',
  'radius-xl': '6px',
  'radius-2xl': '8px',
  'radius-pill': '999px'
}

/* — Texture builders. Each returns a full CSS background value for the
     fixed body::before overlay (see app.css). Grain is an inline SVG
     fractal-noise tile with the opacity baked into the rect, so light and
     dark themes can dial it independently. */
function grain(opacity: string): string {
  return (
    'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\'%3E' +
    '%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.8\' numOctaves=\'2\' stitchTiles=\'stitch\'/%3E%3C/filter%3E' +
    `%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='${opacity}'/%3E%3C/svg%3E")`
  )
}

/* — The themes of the 2026-08 design review, which replaced the original
     ten (liner-notes, warm-noir, studio-darkroom, audiophile-modernist,
     jazz-cellar, field-recording, tape-rose, brutalist-concrete, vellum,
     neon-noir). Anyone still holding one of those ids in localStorage is
     carried across by LEGACY_THEME_MAP at the bottom of this file.

     Each theme is more than a palette: several also carry structural CSS,
     keyed off [data-theme] at the bottom of app.css. Adding a theme here
     without checking that block gets you a repaint, not a theme. */

const sleeve: Theme = {
  id: 'sleeve',
  name: 'Sleeve',
  mood: 'A gallery wall after dark — the art is the interface, everything else gets out of the way.',
  scheme: 'dark',
  tokens: {
    paper: '#0c0b0a',
    surface: '#100e0d',
    'surface-deep': '#080706',
    inset: '#141210',
    espresso: '#efe9df',
    walnut: '#cfc7bb',
    faded: '#8a8278',
    whisper: '#6f6860',
    hairline: '#1c1917',
    'hairline-strong': '#2a2724',
    brick: '#b5474d',
    'brick-deep': '#8f3339',
    'brick-wash': '#2a1518',
    'ink-tint-04': 'rgba(239, 233, 223, 0.04)',
    'ink-tint-06': 'rgba(239, 233, 223, 0.06)',
    'ink-tint-08': 'rgba(239, 233, 223, 0.08)',
    'ink-tint-12': 'rgba(239, 233, 223, 0.12)',
    'ink-tint-16': 'rgba(239, 233, 223, 0.16)',
    'ok-fg': '#9bbf8e',
    'ok-bg': 'rgba(155, 191, 142, 0.1)',
    'ok-border': 'rgba(155, 191, 142, 0.32)',
    'warn-fg': '#d9a45c',
    'warn-bg': 'rgba(217, 164, 92, 0.1)',
    'warn-border': 'rgba(217, 164, 92, 0.32)',
    'err-fg': '#d9686e',
    'shadow-sm': '0 10px 24px -12px rgba(0, 0, 0, 0.9)',
    'shadow-md': '0 24px 50px -24px rgba(0, 0, 0, 0.92)',
    'shadow-lg': '0 40px 80px -30px rgba(0, 0, 0, 0.95)',
    'shadow-color': '0, 0, 0',
    'font-display': BOOK_SERIF,
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: 'none'
  }
}

const cardCatalogue: Theme = {
  id: 'card-catalogue',
  name: 'Card Catalogue',
  mood: 'Oak drawers in a dark reading room — typed cards, red call numbers, art as mounted plates.',
  scheme: 'dark',
  tokens: {
    paper: '#12100f',
    surface: '#1b1917',
    'surface-deep': '#0d0b0a',
    inset: '#171514',
    espresso: '#ece7df',
    walnut: '#cfc6b9',
    faded: '#a49c91',
    whisper: '#7d766c',
    hairline: '#2b2724',
    'hairline-strong': '#3a3532',
    brick: '#e0554e',
    'brick-deep': '#b83f39',
    'brick-wash': '#2c1614',
    'ink-tint-04': 'rgba(236, 231, 223, 0.04)',
    'ink-tint-06': 'rgba(236, 231, 223, 0.06)',
    'ink-tint-08': 'rgba(236, 231, 223, 0.08)',
    'ink-tint-12': 'rgba(236, 231, 223, 0.12)',
    'ink-tint-16': 'rgba(236, 231, 223, 0.16)',
    'ok-fg': '#9bbf8e',
    'ok-bg': 'rgba(155, 191, 142, 0.1)',
    'ok-border': 'rgba(155, 191, 142, 0.32)',
    'warn-fg': '#d9a05c',
    'warn-bg': 'rgba(217, 160, 92, 0.1)',
    'warn-border': 'rgba(217, 160, 92, 0.32)',
    'err-fg': '#e0554e',
    'shadow-sm': '0 4px 12px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 12px 28px rgba(0, 0, 0, 0.6)',
    'shadow-lg': '0 24px 48px rgba(0, 0, 0, 0.7)',
    'shadow-color': '0, 0, 0',
    'font-display': BOOK_SERIF,
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: grain('0.04')
  }
}

const zine: Theme = {
  id: 'zine',
  name: 'Zine',
  mood: 'Photocopied at 3am — toner black, one pink pass, everything slightly off true.',
  scheme: 'light',
  tokens: {
    paper: '#ffffff',
    surface: '#ffffff',
    'surface-deep': '#efefef',
    inset: '#fafafa',
    espresso: '#000000',
    walnut: '#1c1c1c',
    faded: '#565656',
    whisper: '#7a7a7a',
    hairline: '#000000',
    'hairline-strong': '#000000',
    brick: '#e10039',
    'brick-deep': '#a80029',
    'brick-wash': '#ffe0e7',
    'ink-tint-04': 'rgba(0, 0, 0, 0.04)',
    'ink-tint-06': 'rgba(0, 0, 0, 0.06)',
    'ink-tint-08': 'rgba(0, 0, 0, 0.08)',
    'ink-tint-12': 'rgba(0, 0, 0, 0.12)',
    'ink-tint-16': 'rgba(0, 0, 0, 0.16)',
    'ok-fg': '#1d5a2a',
    'ok-bg': '#d8ecd8',
    'ok-border': '#1d5a2a',
    'warn-fg': '#7a4a00',
    'warn-bg': '#f6e6c0',
    'warn-border': '#7a4a00',
    'err-fg': '#a80029',
    'shadow-sm': '3px 3px 0 #000000',
    'shadow-md': '5px 5px 0 #000000',
    'shadow-lg': '8px 8px 0 #000000',
    'shadow-color': '0, 0, 0',
    'font-display': "'Futura', 'Avenir Next', 'Helvetica Neue', sans-serif",
    'font-body': "'Helvetica Neue', Helvetica, -apple-system, sans-serif",
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: grain('0.07')
  }
}

const brutalistNight: Theme = {
  id: 'brutalist-night',
  name: 'Brutalist Night',
  mood: 'The grid made visible — white rules on charcoal, one electric blue, nothing softened.',
  scheme: 'dark',
  tokens: {
    paper: '#1a1a1a',
    surface: '#232323',
    'surface-deep': '#101010',
    inset: '#1e1e1e',
    espresso: '#f2f2f2',
    walnut: '#cccccc',
    faded: '#a0a0a0',
    whisper: '#777777',
    hairline: '#333333',
    'hairline-strong': '#f2f2f2',
    brick: '#828cff',
    'brick-deep': '#5c68f0',
    'brick-wash': '#1e2140',
    'ink-tint-04': 'rgba(242, 242, 242, 0.04)',
    'ink-tint-06': 'rgba(242, 242, 242, 0.06)',
    'ink-tint-08': 'rgba(242, 242, 242, 0.08)',
    'ink-tint-12': 'rgba(242, 242, 242, 0.12)',
    'ink-tint-16': 'rgba(242, 242, 242, 0.16)',
    'ok-fg': '#8ed49c',
    'ok-bg': 'rgba(142, 212, 156, 0.1)',
    'ok-border': 'rgba(142, 212, 156, 0.32)',
    'warn-fg': '#e8b45a',
    'warn-bg': 'rgba(232, 180, 90, 0.1)',
    'warn-border': 'rgba(232, 180, 90, 0.32)',
    'err-fg': '#ef6a66',
    'shadow-sm': 'none',
    'shadow-md': 'none',
    'shadow-lg': 'none',
    'shadow-color': '0, 0, 0',
    'font-display': "'Helvetica Neue', Helvetica, Arial, sans-serif",
    'font-body': "'Helvetica Neue', Helvetica, -apple-system, sans-serif",
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: 'none'
  }
}

const listeningBar: Theme = {
  id: 'listening-bar',
  name: 'Listening Bar',
  mood: 'Lacquer, low light, one lamp on the turntable — three records at a time and no hurry.',
  scheme: 'dark',
  tokens: {
    paper: '#12100d',
    surface: '#1a1713',
    'surface-deep': '#0c0a08',
    inset: '#16130f',
    espresso: '#f0e8dc',
    walnut: '#ded2c0',
    faded: '#a99e8e',
    whisper: '#8b8272',
    hairline: '#241f19',
    'hairline-strong': '#332c23',
    brick: '#d9a441',
    'brick-deep': '#b8862c',
    'brick-wash': '#2a2013',
    'ink-tint-04': 'rgba(240, 232, 220, 0.04)',
    'ink-tint-06': 'rgba(240, 232, 220, 0.06)',
    'ink-tint-08': 'rgba(240, 232, 220, 0.08)',
    'ink-tint-12': 'rgba(240, 232, 220, 0.12)',
    'ink-tint-16': 'rgba(240, 232, 220, 0.16)',
    'ok-fg': '#a3c495',
    'ok-bg': 'rgba(163, 196, 149, 0.1)',
    'ok-border': 'rgba(163, 196, 149, 0.32)',
    'warn-fg': '#d9a441',
    'warn-bg': 'rgba(217, 164, 65, 0.1)',
    'warn-border': 'rgba(217, 164, 65, 0.32)',
    'err-fg': '#e08074',
    'shadow-sm': '0 4px 14px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 14px 34px rgba(0, 0, 0, 0.6)',
    'shadow-lg': '0 40px 80px -34px rgba(0, 0, 0, 0.95)',
    'shadow-color': '0, 0, 0',
    'font-display': BOOK_SERIF,
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_HAIRLINE,
    texture:
      'radial-gradient(ellipse 60% 40% at 50% 12%, rgba(217, 164, 65, 0.07), transparent 70%), radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.45) 135%)'
  }
}

/* Warehouse was cut from the original five on the grounds that its left-hand
   genre rail was new navigation rather than styling. That was overcautious —
   the rail was one element of ten, and the theme reads fine without it. The
   rail is now an ordinary Library feature to spec separately, for every theme.

   The accent is a hi-vis yellow, which makes this the one theme where text on
   an accent fill has to be dark. Everywhere in the app that fills with --brick
   already writes `color: var(--paper)`, and --paper here is near-black, so the
   convention lands the right way round on its own — but it is the case worth
   re-checking whenever a new filled control shows up. */
const warehouse: Theme = {
  id: 'warehouse',
  name: 'Warehouse',
  mood: 'Back room of the record shop — stencil caps, hi-vis tape, everything in crates.',
  scheme: 'dark',
  tokens: {
    paper: '#15181a',
    surface: '#1b1f21',
    'surface-deep': '#101314',
    inset: '#191d1f',
    espresso: '#e8e6e1',
    walnut: '#c3c8c8',
    faded: '#9aa0a0',
    whisper: '#6e7574',
    hairline: '#2a3033',
    'hairline-strong': '#3a4144',
    brick: '#d8e02a',
    'brick-deep': '#b4bb1a',
    'brick-wash': '#2a2e0c',
    'ink-tint-04': 'rgba(232, 230, 225, 0.04)',
    'ink-tint-06': 'rgba(232, 230, 225, 0.06)',
    'ink-tint-08': 'rgba(232, 230, 225, 0.08)',
    'ink-tint-12': 'rgba(232, 230, 225, 0.12)',
    'ink-tint-16': 'rgba(232, 230, 225, 0.16)',
    'ok-fg': '#a8c79a',
    'ok-bg': 'rgba(168, 199, 154, 0.1)',
    'ok-border': 'rgba(168, 199, 154, 0.32)',
    'warn-fg': '#e0b458',
    'warn-bg': 'rgba(224, 180, 88, 0.1)',
    'warn-border': 'rgba(224, 180, 88, 0.32)',
    'err-fg': '#e0685a',
    // Hard print offsets, no blur — the same grammar as Zine, in the shadow
    // colour rather than a literal black so the three stay in step.
    'shadow-sm': '2px 2px 0 rgba(0, 0, 0, 0.5)',
    'shadow-md': '4px 4px 0 rgba(0, 0, 0, 0.55)',
    'shadow-lg': '8px 8px 0 rgba(0, 0, 0, 0.6)',
    'shadow-color': '0, 0, 0',
    'font-display': "'Helvetica Neue', Helvetica, Arial, sans-serif",
    'font-body': "'Helvetica Neue', Helvetica, -apple-system, sans-serif",
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: grain('0.05')
  }
}

export const THEMES: Theme[] = [sleeve, cardCatalogue, zine, brutalistNight, listeningBar, warehouse]

export const DEFAULT_THEME_ID = 'sleeve'

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyTheme(id: string): void {
  if (typeof document === 'undefined') return
  const theme = getTheme(id)
  const root = document.documentElement
  // Iterate the canonical key list (not the theme object) so a theme can
  // never leave a previous theme's token behind.
  for (const key of TOKEN_KEYS) {
    root.style.setProperty(`--${key}`, theme.tokens[key])
  }
  root.style.colorScheme = theme.scheme
  // Presentation hook for the handful of themes that need structural CSS
  // beyond tokens (see the [data-theme=…] block in app.css). Read only by CSS.
  root.dataset.theme = theme.id
  // Keep the BrowserWindow background (resize gutter, next launch's pre-paint
  // frame) in step with the theme's paper. Optional-chained: applyTheme also
  // runs in test environments without the preload bridge.
  window.cratedigger?.win.setBackground(theme.tokens.paper)
}

// localStorage key intentionally still 'sideman:*' through the Cratedigger
// rename — renaming would strand the user's stored theme choice.
const THEME_STORAGE_KEY = 'sideman:theme'

// The ten themes replaced in 2026-08, each pointed at its nearest survivor.
// getTheme() already falls back to THEMES[0], so a stale id was never a crash
// — but it left the picker showing no selection until you clicked something,
// and silently moved anyone on a light theme onto a dark one. Mapping them
// keeps the choice meaningful and rewrites the stored value once.
const LEGACY_THEME_MAP: Record<string, string> = {
  'liner-notes': 'sleeve',
  'warm-noir': 'listening-bar',
  'studio-darkroom': 'brutalist-night',
  'audiophile-modernist': 'brutalist-night',
  'jazz-cellar': 'listening-bar',
  'field-recording': 'card-catalogue',
  'tape-rose': 'zine',
  'brutalist-concrete': 'brutalist-night',
  vellum: 'zine',
  'neon-noir': 'sleeve'
}

export function loadStoredThemeId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  if (!stored) return DEFAULT_THEME_ID
  if (THEMES.some((t) => t.id === stored)) return stored
  const migrated = LEGACY_THEME_MAP[stored] ?? DEFAULT_THEME_ID
  localStorage.setItem(THEME_STORAGE_KEY, migrated)
  return migrated
}

export function storeThemeId(id: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(THEME_STORAGE_KEY, id)
}
