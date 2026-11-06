// Wire-format type for the auto-update state that main pushes to renderer.
// Defined in shared because both main (emits) and renderer (consumes) need it,
// and the renderer's tsconfig can't reach across the preload boundary.
export type UpdateState =
  | { status: 'idle' }
  | { status: 'available'; latest: string; current: string }
  | { status: 'downloading'; latest: string; current: string; percent: number }
  | { status: 'downloaded'; latest: string; current: string }
