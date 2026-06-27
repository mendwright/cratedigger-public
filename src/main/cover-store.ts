import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join, extname, basename, resolve } from 'node:path'

// User-uploaded album covers live alongside the rest of the app's state in
// userData so they survive updates and are wiped with the app. They're served
// to the renderer over the cratedigger-cover:// protocol (see imageProxy.ts),
// never as file:// (blocked under the renderer's CSP / standard-scheme rules).

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])

export function coversDir(): string {
  return join(app.getPath('userData'), 'covers')
}

// Plex ratingKeys are numeric strings, but sanitize defensively so a key can
// never escape the covers dir or collide with another album's file.
function safeKey(plexRatingKey: string): string {
  return plexRatingKey.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function removeExisting(dir: string, key: string): Promise<void> {
  let entries: string[] = []
  try {
    entries = await fs.readdir(dir)
  } catch {
    return
  }
  await Promise.all(
    entries
      .filter((f) => f === key || f.startsWith(`${key}.`))
      .map((f) => fs.unlink(join(dir, f)).catch(() => {}))
  )
}

// Copy a user-chosen image into the covers dir and return the bare filename the
// cover protocol serves. Replaces any prior upload for this album so we never
// orphan files when the user re-uploads.
export async function saveLocalCover(plexRatingKey: string, sourcePath: string): Promise<string> {
  const ext = extname(sourcePath).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Unsupported image type "${ext || 'none'}" — use PNG, JPG, WebP, or GIF.`)
  }
  const dir = coversDir()
  await fs.mkdir(dir, { recursive: true })
  const key = safeKey(plexRatingKey)
  await removeExisting(dir, key)
  const filename = `${key}${ext}`
  await fs.copyFile(sourcePath, join(dir, filename))
  return filename
}

export async function deleteLocalCover(plexRatingKey: string): Promise<void> {
  await removeExisting(coversDir(), safeKey(plexRatingKey))
}

// Resolve a protocol ?file= param to an absolute path, refusing anything that
// isn't a bare filename inside the covers dir (path-traversal guard).
export function resolveCoverFile(file: string): string | null {
  if (basename(file) !== file) return null
  const dir = resolve(coversDir())
  const full = resolve(dir, file)
  if (full !== join(dir, file)) return null
  if (!full.startsWith(dir)) return null
  return full
}
