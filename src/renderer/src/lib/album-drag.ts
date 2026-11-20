// Drag-and-drop payload for album cards. A custom MIME type keeps our drags
// distinguishable from stray browser drags (images, text, files), and it's
// all `dragover` can see — the DnD spec hides the data itself until drop.

const MIME = 'application/x-cratedigger-album'

export interface AlbumDragPayload {
  ratingKey: string
  title: string
  artist: string
}

export function startAlbumDrag(e: DragEvent, album: AlbumDragPayload, coverImg?: HTMLImageElement | null): void {
  if (!e.dataTransfer) return
  e.dataTransfer.setData(
    MIME,
    JSON.stringify({ ratingKey: album.ratingKey, title: album.title, artist: album.artist })
  )
  e.dataTransfer.effectAllowed = 'copy'
  // Default drag image is the whole card — at grid size it blots out the
  // rail, so you can't see which crate you're over. Hand the browser a
  // small cover thumbnail instead. The ghost element must be in the DOM
  // when setDragImage reads it; parked offscreen and removed next tick.
  if (coverImg) {
    const ghost = document.createElement('img')
    ghost.src = coverImg.currentSrc || coverImg.src
    ghost.style.cssText =
      'position:fixed;top:-200px;left:-200px;width:72px;height:72px;object-fit:cover;' +
      'border-radius:6px;box-shadow:0 6px 16px rgba(0,0,0,0.35);'
    document.body.appendChild(ghost)
    e.dataTransfer.setDragImage(ghost, 36, 64)
    window.setTimeout(() => ghost.remove(), 0)
  }
}

/** For dragover/dragenter — is this drag one of our album cards? */
export function albumDragActive(e: DragEvent): boolean {
  return !!e.dataTransfer?.types.includes(MIME)
}

/** For drop. */
export function readAlbumDrag(e: DragEvent): AlbumDragPayload | null {
  const raw = e.dataTransfer?.getData(MIME)
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<AlbumDragPayload>
    if (typeof p.ratingKey === 'string' && typeof p.title === 'string') {
      return { ratingKey: p.ratingKey, title: p.title, artist: p.artist ?? '' }
    }
  } catch {
    // not ours / malformed — ignore
  }
  return null
}
