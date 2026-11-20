import { plexState } from './plex-state.svelte'

// True when the key event originates in a text-editing control — plain-letter
// hotkeys must never fire while the user is typing.
export function isTextTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
}

// True when a global overlay owns the keyboard — screens with their own list
// hotkeys (Triage, Inbox) stand down while one of these is up.
export function overlayOwnsKeys(): boolean {
  return (
    !!plexState.manualMatch.current ||
    !!plexState.addToPlaylist ||
    plexState.commandPaletteOpen ||
    plexState.keyboardHelpOpen ||
    !!plexState.contextMenu ||
    plexState.settings.open
  )
}
