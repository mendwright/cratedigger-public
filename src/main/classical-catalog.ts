import { app } from 'electron'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AlbumCredits } from '../shared/plex.js'
import { buildClassicalCatalog, type ClassicalCatalogSnapshot } from '../shared/classical-catalog.js'

const CACHE_ENVELOPE_VERSION = 1
const CLASSICAL_CREDITS_BUCKET = 'album-credits-v5'

export async function readClassicalCatalogCache(mbCacheRoot: string): Promise<ClassicalCatalogSnapshot> {
  const dir = join(mbCacheRoot, CLASSICAL_CREDITS_BUCKET)
  const albums: Array<{ ratingKey: string; credits: AlbumCredits }> = []
  let files: string[] = []
  try { files = await readdir(dir) } catch { return buildClassicalCatalog([]) }
  for (const file of files) {
    if (!file.endsWith('.json')) continue
    try {
      const env = JSON.parse(await readFile(join(dir, file), 'utf8')) as { v: number; d: AlbumCredits | null }
      if (env.v === CACHE_ENVELOPE_VERSION && env.d) {
        albums.push({ ratingKey: file.slice(0, -5), credits: env.d })
      }
    } catch { /* Ignore partial/corrupt cache entries; the warmer repairs them. */ }
  }
  return buildClassicalCatalog(albums)
}

export async function getClassicalCatalog(): Promise<ClassicalCatalogSnapshot> {
  return readClassicalCatalogCache(join(app.getPath('userData'), 'mb-cache'))
}
