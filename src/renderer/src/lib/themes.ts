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
 *   - shape        (the radius scale: square brutalism → chubby zine)
 *   - texture      (a full-viewport overlay: paper grain, darkroom vignette,
 *                   brass spotlight, rain-glass glow — or none)
 *   - shadow       (soft warm drops, hard print offsets, neon glow)
 *
 * Liner-notes is the default — its values match what's in app.css under
 * :root, kept there so the first paint at boot shows liner-notes before
 * any JS runs.
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

/* — Shared radius scales */
type RadiusTokens = Record<
  'radius-xs' | 'radius-sm' | 'radius-md' | 'radius-lg' | 'radius-xl' | 'radius-2xl' | 'radius-pill',
  string
>
const RADII_DEFAULT: RadiusTokens = {
  'radius-xs': '3px',
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '8px',
  'radius-xl': '12px',
  'radius-2xl': '16px',
  'radius-pill': '999px'
}
const RADII_TIGHT: RadiusTokens = {
  'radius-xs': '2px',
  'radius-sm': '3px',
  'radius-md': '4px',
  'radius-lg': '6px',
  'radius-xl': '8px',
  'radius-2xl': '10px',
  'radius-pill': '999px'
}
const RADII_SQUARE: RadiusTokens = {
  'radius-xs': '0',
  'radius-sm': '0',
  'radius-md': '0',
  'radius-lg': '0',
  'radius-xl': '0',
  'radius-2xl': '0',
  'radius-pill': '0'
}
const RADII_SOFT: RadiusTokens = {
  'radius-xs': '4px',
  'radius-sm': '6px',
  'radius-md': '8px',
  'radius-lg': '12px',
  'radius-xl': '16px',
  'radius-2xl': '20px',
  'radius-pill': '999px'
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

const linerNotes: Theme = {
  id: 'liner-notes',
  name: 'Liner Notes',
  mood: 'A careful record-store newsletter on cream stock — espresso ink, brick stamp.',
  scheme: 'light',
  tokens: {
    paper: '#f3ead4',
    surface: '#fcf6e6',
    'surface-deep': '#e9dfc1',
    inset: '#fffbef',
    espresso: '#2b1d12',
    walnut: '#5a4736',
    faded: '#8b765f',
    whisper: '#b8a684',
    hairline: '#d4c8a6',
    'hairline-strong': '#b8a87e',
    brick: '#8c3522',
    'brick-deep': '#6c2616',
    'brick-wash': '#ecd4cb',
    'ink-tint-04': 'rgba(43, 29, 18, 0.04)',
    'ink-tint-06': 'rgba(43, 29, 18, 0.06)',
    'ink-tint-08': 'rgba(43, 29, 18, 0.08)',
    'ink-tint-12': 'rgba(43, 29, 18, 0.12)',
    'ink-tint-16': 'rgba(43, 29, 18, 0.16)',
    'ok-fg': '#3a6f3f',
    'ok-bg': '#dcebcb',
    'ok-border': '#9bbf8a',
    'warn-fg': '#7d2424',
    'warn-bg': '#f0d6d2',
    'warn-border': '#c08b88',
    'err-fg': '#7d2424',
    'shadow-sm': '0 4px 12px rgba(43, 29, 18, 0.12)',
    'shadow-md': '0 12px 28px rgba(43, 29, 18, 0.18)',
    'shadow-lg': '0 24px 48px rgba(43, 29, 18, 0.24)',
    'font-display': BOOK_SERIF,
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_DEFAULT,
    texture: grain('0.04')
  }
}

const warmNoir: Theme = {
  id: 'warm-noir',
  name: 'Warm Noir',
  mood: 'Deep navy office after hours — typewriter headlines, oxblood ribbon, cream foolscap.',
  scheme: 'dark',
  tokens: {
    paper: '#0d1320',
    surface: '#161e30',
    'surface-deep': '#0a0f1c',
    inset: '#101828',
    espresso: '#e8d8b0',
    walnut: '#a39676',
    faded: '#6e6757',
    whisper: '#4a4639',
    hairline: '#212a3d',
    'hairline-strong': '#2c3650',
    brick: '#a52a3a',
    'brick-deep': '#7a1c2a',
    'brick-wash': '#2a1318',
    'ink-tint-04': 'rgba(232, 216, 176, 0.04)',
    'ink-tint-06': 'rgba(232, 216, 176, 0.06)',
    'ink-tint-08': 'rgba(232, 216, 176, 0.08)',
    'ink-tint-12': 'rgba(232, 216, 176, 0.12)',
    'ink-tint-16': 'rgba(232, 216, 176, 0.16)',
    'ok-fg': '#9bc7a3',
    'ok-bg': 'rgba(155, 199, 163, 0.1)',
    'ok-border': 'rgba(155, 199, 163, 0.32)',
    'warn-fg': '#e8b85a',
    'warn-bg': 'rgba(232, 184, 90, 0.1)',
    'warn-border': 'rgba(232, 184, 90, 0.32)',
    'err-fg': '#e07a82',
    'shadow-sm': '0 4px 12px rgba(0, 0, 0, 0.45)',
    'shadow-md': '0 12px 28px rgba(0, 0, 0, 0.55)',
    'shadow-lg': '0 24px 48px rgba(0, 0, 0, 0.65)',
    'font-display': "'American Typewriter', 'Courier New', Georgia, serif",
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_TIGHT,
    texture: 'radial-gradient(ellipse at 50% 40%, transparent 60%, rgba(0, 0, 0, 0.3) 130%)'
  }
}

const studioDarkroom: Theme = {
  id: 'studio-darkroom',
  name: 'Studio Darkroom',
  mood: 'Neutral charcoal, red safelight, contact sheets annotated in grease pencil.',
  scheme: 'dark',
  tokens: {
    paper: '#151515',
    surface: '#1e1e1e',
    'surface-deep': '#0c0c0c',
    inset: '#181818',
    espresso: '#e8e6e2',
    walnut: '#b0aca4',
    faded: '#7c7974',
    whisper: '#504e4b',
    hairline: '#2a2a2a',
    'hairline-strong': '#3c3c3c',
    brick: '#e0432e',
    'brick-deep': '#b32d1c',
    'brick-wash': '#301310',
    'ink-tint-04': 'rgba(232, 230, 226, 0.04)',
    'ink-tint-06': 'rgba(232, 230, 226, 0.06)',
    'ink-tint-08': 'rgba(232, 230, 226, 0.08)',
    'ink-tint-12': 'rgba(232, 230, 226, 0.12)',
    'ink-tint-16': 'rgba(232, 230, 226, 0.16)',
    'ok-fg': '#a8c79a',
    'ok-bg': 'rgba(168, 199, 154, 0.1)',
    'ok-border': 'rgba(168, 199, 154, 0.32)',
    'warn-fg': '#e0a458',
    'warn-bg': 'rgba(224, 164, 88, 0.1)',
    'warn-border': 'rgba(224, 164, 88, 0.32)',
    'err-fg': '#e0584a',
    'shadow-sm': '0 4px 12px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 12px 28px rgba(0, 0, 0, 0.6)',
    'shadow-lg': '0 24px 48px rgba(0, 0, 0, 0.7)',
    'font-display': MONO,
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_TIGHT,
    texture: 'radial-gradient(ellipse at 50% 35%, transparent 55%, rgba(0, 0, 0, 0.42) 135%)'
  }
}

const audiophileModernist: Theme = {
  id: 'audiophile-modernist',
  name: 'Audiophile Modernist',
  mood: 'Dieter Rams hi-fi — near-black brushed panel, grotesque type, one electric-blue LED.',
  scheme: 'dark',
  tokens: {
    paper: '#0a0a0c',
    surface: '#15151a',
    'surface-deep': '#050507',
    inset: '#101015',
    espresso: '#fafafa',
    walnut: '#bababa',
    faded: '#7a7a7a',
    whisper: '#4a4a4a',
    hairline: '#2a2a2e',
    'hairline-strong': '#3a3a3e',
    brick: '#2196f3',
    'brick-deep': '#1976d2',
    'brick-wash': 'rgba(33, 150, 243, 0.14)',
    'ink-tint-04': 'rgba(250, 250, 250, 0.04)',
    'ink-tint-06': 'rgba(250, 250, 250, 0.06)',
    'ink-tint-08': 'rgba(250, 250, 250, 0.08)',
    'ink-tint-12': 'rgba(250, 250, 250, 0.12)',
    'ink-tint-16': 'rgba(250, 250, 250, 0.16)',
    'ok-fg': '#7ed492',
    'ok-bg': 'rgba(126, 212, 146, 0.1)',
    'ok-border': 'rgba(126, 212, 146, 0.32)',
    'warn-fg': '#e8a258',
    'warn-bg': 'rgba(232, 162, 88, 0.1)',
    'warn-border': 'rgba(232, 162, 88, 0.32)',
    'err-fg': '#ef5350',
    'shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.5)',
    'shadow-md': '0 8px 20px rgba(0, 0, 0, 0.6)',
    'shadow-lg': '0 16px 40px rgba(0, 0, 0, 0.7)',
    'font-display': "'Helvetica Neue', Helvetica, Arial, sans-serif",
    'font-body': "'Helvetica Neue', Helvetica, -apple-system, sans-serif",
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: 'none'
  }
}

const jazzCellar: Theme = {
  id: 'jazz-cellar',
  name: 'Jazz Cellar',
  mood: 'A basement booth at the Vanguard, brass spot on the bandstand, ice melting in the glass.',
  scheme: 'dark',
  tokens: {
    paper: '#161210',
    surface: '#1d1815',
    'surface-deep': '#0f0c0a',
    inset: '#100c0a',
    espresso: '#f3e7d0',
    walnut: '#c2ad8b',
    faded: '#8a7860',
    whisper: '#5a4d3d',
    hairline: '#2a2320',
    'hairline-strong': '#3d3329',
    brick: '#c9892f',
    'brick-deep': '#a96e1c',
    'brick-wash': '#2a1f12',
    'ink-tint-04': 'rgba(243, 231, 208, 0.04)',
    'ink-tint-06': 'rgba(243, 231, 208, 0.06)',
    'ink-tint-08': 'rgba(243, 231, 208, 0.08)',
    'ink-tint-12': 'rgba(243, 231, 208, 0.12)',
    'ink-tint-16': 'rgba(243, 231, 208, 0.16)',
    'ok-fg': '#9bbf8e',
    'ok-bg': '#1a2218',
    'ok-border': '#2f3d2a',
    'warn-fg': '#d96b5c',
    'warn-bg': '#27130f',
    'warn-border': '#4a1f17',
    'err-fg': '#e57b6c',
    'shadow-sm': '0 4px 12px rgba(0, 0, 0, 0.45)',
    'shadow-md': '0 12px 28px rgba(0, 0, 0, 0.55)',
    'shadow-lg': '0 24px 48px rgba(0, 0, 0, 0.65)',
    'font-display': "'Big Caslon', 'Iowan Old Style', 'Hoefler Text', Georgia, ui-serif, serif",
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_DEFAULT,
    texture:
      'radial-gradient(ellipse 70% 50% at 50% 18%, rgba(201, 137, 47, 0.05), transparent 70%), radial-gradient(ellipse at 50% 55%, transparent 55%, rgba(0, 0, 0, 0.4) 135%)'
  }
}

const fieldRecording: Theme = {
  id: 'field-recording',
  name: 'Field Recording',
  mood: "A naturalist's logbook open on a mossy stump, fog drifting through cedars.",
  scheme: 'light',
  tokens: {
    paper: '#e8e5d2',
    surface: '#efecda',
    'surface-deep': '#ddd9c2',
    inset: '#e0dcc4',
    espresso: '#1c2620',
    walnut: '#3f4a3e',
    faded: '#6b7560',
    whisper: '#9aa08a',
    hairline: '#c5c2a8',
    'hairline-strong': '#9aa08a',
    brick: '#2e6e5e',
    'brick-deep': '#1f5246',
    'brick-wash': '#cfe0d4',
    'ink-tint-04': 'rgba(28, 38, 32, 0.04)',
    'ink-tint-06': 'rgba(28, 38, 32, 0.06)',
    'ink-tint-08': 'rgba(28, 38, 32, 0.08)',
    'ink-tint-12': 'rgba(28, 38, 32, 0.12)',
    'ink-tint-16': 'rgba(28, 38, 32, 0.16)',
    'ok-fg': '#2f5234',
    'ok-bg': '#d7dfc2',
    'ok-border': '#8fa37a',
    'warn-fg': '#6b3a1f',
    'warn-bg': '#e6cfb8',
    'warn-border': '#b58c6a',
    'err-fg': '#8c2b1f',
    'shadow-sm': '0 4px 12px rgba(28, 38, 32, 0.1)',
    'shadow-md': '0 12px 28px rgba(28, 38, 32, 0.16)',
    'shadow-lg': '0 24px 48px rgba(28, 38, 32, 0.22)',
    'font-display': "'Seravek', 'Gill Sans', 'Trebuchet MS', sans-serif",
    'font-body': "'Seravek', 'Gill Sans', -apple-system, system-ui, sans-serif",
    'font-mono': MONO,
    ...RADII_DEFAULT,
    texture: grain('0.05')
  }
}

const tapeRose: Theme = {
  id: 'tape-rose',
  name: 'Tape Rose',
  mood: 'A risograph zine on rose paper — Futura headlines, magenta ink still tacky.',
  scheme: 'light',
  tokens: {
    paper: '#f7e4dc',
    surface: '#fbede6',
    'surface-deep': '#f0d6cc',
    inset: '#efd7ce',
    espresso: '#3a1f2b',
    walnut: '#6b3d4e',
    faded: '#9a6b7a',
    whisper: '#b8909c',
    hairline: '#e5c4b9',
    'hairline-strong': '#c99ca8',
    brick: '#c8186e',
    'brick-deep': '#9e0f56',
    'brick-wash': '#f4d2df',
    'ink-tint-04': 'rgba(58, 31, 43, 0.04)',
    'ink-tint-06': 'rgba(58, 31, 43, 0.06)',
    'ink-tint-08': 'rgba(58, 31, 43, 0.08)',
    'ink-tint-12': 'rgba(58, 31, 43, 0.12)',
    'ink-tint-16': 'rgba(58, 31, 43, 0.16)',
    'ok-fg': '#3d5a3a',
    'ok-bg': '#dde6cc',
    'ok-border': '#a8b98e',
    'warn-fg': '#7a4a1c',
    'warn-bg': '#f0ddb8',
    'warn-border': '#c99858',
    'err-fg': '#8a2418',
    'shadow-sm': '0 4px 12px rgba(58, 31, 43, 0.1)',
    'shadow-md': '0 12px 28px rgba(58, 31, 43, 0.14)',
    'shadow-lg': '0 24px 48px rgba(58, 31, 43, 0.18)',
    'font-display': "'Futura', 'Avenir Next', 'Avenir', sans-serif",
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_SOFT,
    texture: grain('0.05')
  }
}

const brutalistConcrete: Theme = {
  id: 'brutalist-concrete',
  name: 'Brutalist Concrete',
  mood: 'Board-formed concrete, square corners, hard shadows — the catalog as civic architecture.',
  scheme: 'light',
  tokens: {
    paper: '#d9d9d6',
    surface: '#cfcfcc',
    'surface-deep': '#bfbfbc',
    inset: '#c5c5c2',
    espresso: '#1a1b1c',
    walnut: '#3d4044',
    faded: '#6e7176',
    whisper: '#8e9196',
    hairline: '#a8a9a7',
    'hairline-strong': '#5c5e61',
    brick: '#e63100',
    'brick-deep': '#b82400',
    'brick-wash': '#f2d7cc',
    'ink-tint-04': 'rgba(26, 27, 28, 0.04)',
    'ink-tint-06': 'rgba(26, 27, 28, 0.06)',
    'ink-tint-08': 'rgba(26, 27, 28, 0.08)',
    'ink-tint-12': 'rgba(26, 27, 28, 0.12)',
    'ink-tint-16': 'rgba(26, 27, 28, 0.16)',
    'ok-fg': '#1f4d2e',
    'ok-bg': '#c8d3cb',
    'ok-border': '#7a8e80',
    'warn-fg': '#6b5a00',
    'warn-bg': '#d8d2a8',
    'warn-border': '#9a8a2e',
    'err-fg': '#7a1a0c',
    'shadow-sm': '3px 3px 0 rgba(26, 27, 28, 0.2)',
    'shadow-md': '6px 6px 0 rgba(26, 27, 28, 0.22)',
    'shadow-lg': '10px 10px 0 rgba(26, 27, 28, 0.25)',
    'font-display': "'Helvetica Neue', Helvetica, Arial, sans-serif",
    'font-body': "'Helvetica Neue', Helvetica, -apple-system, sans-serif",
    'font-mono': MONO,
    ...RADII_SQUARE,
    texture: grain('0.06')
  }
}

const vellum: Theme = {
  id: 'vellum',
  name: 'Vellum',
  mood: 'A gallery wall at noon — bone paper, Didot headlines, one acid-green stamp.',
  scheme: 'light',
  tokens: {
    paper: '#f4f2ec',
    surface: '#faf8f3',
    'surface-deep': '#edeae2',
    inset: '#e6e3da',
    espresso: '#0a0a0a',
    walnut: '#1f1f1e',
    faded: '#6b6b68',
    whisper: '#9a9a95',
    hairline: 'rgba(10, 10, 10, 0.12)',
    'hairline-strong': 'rgba(10, 10, 10, 0.28)',
    brick: '#7fa300',
    'brick-deep': '#5a7600',
    'brick-wash': 'rgba(198, 255, 31, 0.16)',
    'ink-tint-04': 'rgba(10, 10, 10, 0.04)',
    'ink-tint-06': 'rgba(10, 10, 10, 0.06)',
    'ink-tint-08': 'rgba(10, 10, 10, 0.08)',
    'ink-tint-12': 'rgba(10, 10, 10, 0.12)',
    'ink-tint-16': 'rgba(10, 10, 10, 0.16)',
    'ok-fg': '#0e5c2f',
    'ok-bg': '#e4f1e5',
    'ok-border': 'rgba(14, 92, 47, 0.32)',
    'warn-fg': '#8a4a00',
    'warn-bg': '#f6ecda',
    'warn-border': 'rgba(138, 74, 0, 0.32)',
    'err-fg': '#8e1414',
    'shadow-sm': '0 4px 12px rgba(10, 10, 10, 0.06)',
    'shadow-md': '0 12px 28px rgba(10, 10, 10, 0.1)',
    'shadow-lg': '0 24px 48px rgba(10, 10, 10, 0.14)',
    'font-display': "'Didot', 'Bodoni 72', 'Hoefler Text', Georgia, serif",
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_HAIRLINE,
    texture: 'none'
  }
}

const neonNoir: Theme = {
  id: 'neon-noir',
  name: 'Neon Noir',
  mood: 'A rain-glazed window after midnight, one cyan sign humming across the alley.',
  scheme: 'dark',
  tokens: {
    paper: '#100e26',
    surface: '#171434',
    'surface-deep': '#0b0920',
    inset: '#1d1940',
    espresso: '#ede4d3',
    walnut: '#b9b0a1',
    faded: '#7e8299',
    whisper: '#5a6079',
    hairline: '#272247',
    'hairline-strong': '#3a3463',
    brick: '#3fe0e8',
    'brick-deep': '#1fb6be',
    'brick-wash': 'rgba(63, 224, 232, 0.12)',
    'ink-tint-04': 'rgba(237, 228, 211, 0.04)',
    'ink-tint-06': 'rgba(237, 228, 211, 0.06)',
    'ink-tint-08': 'rgba(237, 228, 211, 0.08)',
    'ink-tint-12': 'rgba(237, 228, 211, 0.12)',
    'ink-tint-16': 'rgba(237, 228, 211, 0.16)',
    'ok-fg': '#7fd9a8',
    'ok-bg': 'rgba(127, 217, 168, 0.1)',
    'ok-border': 'rgba(127, 217, 168, 0.32)',
    'warn-fg': '#e8b85a',
    'warn-bg': 'rgba(232, 184, 90, 0.1)',
    'warn-border': 'rgba(232, 184, 90, 0.32)',
    'err-fg': '#e86a7c',
    'shadow-sm': '0 4px 12px rgba(0, 0, 0, 0.45), 0 0 20px rgba(63, 224, 232, 0.05)',
    'shadow-md': '0 10px 28px rgba(0, 0, 0, 0.55), 0 0 32px rgba(63, 224, 232, 0.07)',
    'shadow-lg': '0 24px 56px rgba(0, 0, 0, 0.65), 0 0 48px rgba(63, 224, 232, 0.09)',
    'font-display': "'Avenir Next', 'Avenir', 'Futura', system-ui, sans-serif",
    'font-body': SYSTEM_SANS,
    'font-mono': MONO,
    ...RADII_DEFAULT,
    texture:
      'linear-gradient(180deg, rgba(63, 224, 232, 0.04), transparent 28%), radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0, 0, 0, 0.35) 135%)'
  }
}

export const THEMES: Theme[] = [
  linerNotes,
  warmNoir,
  studioDarkroom,
  audiophileModernist,
  jazzCellar,
  fieldRecording,
  tapeRose,
  brutalistConcrete,
  vellum,
  neonNoir
]

export const DEFAULT_THEME_ID = 'liner-notes'

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
  // Keep the BrowserWindow background (resize gutter, next launch's pre-paint
  // frame) in step with the theme's paper. Optional-chained: applyTheme also
  // runs in test environments without the preload bridge.
  window.cratedigger?.win.setBackground(theme.tokens.paper)
}

// localStorage key intentionally still 'sideman:*' through the Cratedigger
// rename — renaming would strand the user's stored theme choice.
const THEME_STORAGE_KEY = 'sideman:theme'

export function loadStoredThemeId(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_ID
  return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME_ID
}

export function storeThemeId(id: string): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(THEME_STORAGE_KEY, id)
}
