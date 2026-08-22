import { plexState, type ContextMenuEntry } from './plex-state.svelte'

/**
 * The shared queue section of every right-click menu (album cards, track
 * rows, rails, AOTD, slot machine, Listen Later). Callers prepend their own
 * "Play Now" entry — its cast call differs per surface — then spread this.
 *
 * Three insert positions, each with a wipe variant that clears everything
 * after the insert point first (see PlaybackController.enqueue):
 *   next        — after the playing song
 *   after-album — after the playing record finishes
 *   end         — after everything queued (wipe = "…then stop": latches
 *                 radio off past the pick)
 */
export function queueMenuItems(
  kind: 'album' | 'track',
  ratingKey: string,
  title: string,
  artist: string
): ContextMenuEntry[] {
  const enqueue =
    (mode: 'next' | 'after-album' | 'end', wipe: boolean) => () =>
      void plexState.playback.enqueue(kind, ratingKey, title, artist, mode, { wipe })
  return [
    { label: 'Play Next (after this song)', onClick: enqueue('next', false) },
    { label: 'Play Next (after this album)', onClick: enqueue('after-album', false) },
    { label: 'Add to Queue (at the end)', onClick: enqueue('end', false) },
    { separator: true },
    { label: 'Play Next + wipe the rest', onClick: enqueue('next', true) },
    { label: 'Play After Album + wipe the rest', onClick: enqueue('after-album', true) },
    { label: 'Play Last, then stop', onClick: enqueue('end', true) },
    { separator: true },
    {
      label: 'Add to Playlist…',
      onClick: () =>
        plexState.openAddToPlaylist({
          ratingKey,
          kind,
          label: kind === 'album' ? `${artist} — ${title}` : title
        })
    }
  ]
}
