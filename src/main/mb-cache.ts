import { app } from 'electron'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

// File-backed cache for MusicBrainz / Last.fm / Wikipedia lookups so the data
// survives app restarts and version bumps. Each bucket gets its own directory
// under userData/mb-cache/<bucket>/, one JSON file per key. Atomic writes
// (tmp + rename) keep us safe against crash-during-write.
//
// Envelope format is versioned so we can break the on-disk shape later without
// having to migrate — a mismatched version is treated as a miss, the entry is
// silently refetched and overwritten on next access.

const CACHE_VERSION = 1
const SAFE_KEY_RE = /^[A-Za-z0-9._-]{1,200}$/

// The album-credits bucket is written by musicbrainz.ts but enumerated
// directly by several readers (credit-index.ts, classical-catalog.ts,
// classical/service.ts). A version bump that misses one of them silently
// empties that reader's feature, so the name lives here — the one module
// they all already depend on — rather than in musicbrainz.ts, which
// credit-index.ts can't import without a cycle.
export const ALBUM_CREDITS_BUCKET = 'album-credits-v5'

// On-disk directory for a bucket. Exported for readers that enumerate a
// bucket's files themselves (JsonCache has no listing API), so their paths
// come from the same code that writes them. app.getPath('userData') requires
// app.whenReady() — call lazily, not at module load.
export function bucketDir(name: string): string {
  return join(app.getPath('userData'), 'mb-cache', name)
}

interface Envelope<T> {
  v: number
  t: string
  d: T | null
}

function safeKey(key: string): string {
  if (SAFE_KEY_RE.test(key)) return key
  return createHash('sha1').update(key).digest('hex')
}

export class JsonCache<T> {
  private name: string
  private mem = new Map<string, T | null>()

  constructor(name: string) {
    this.name = name
  }

  // Caches are created at module-load time, so the dir resolves lazily on
  // first access (see bucketDir).
  private dir(): string {
    return bucketDir(this.name)
  }

  private file(key: string): string {
    return join(this.dir(), `${safeKey(key)}.json`)
  }

  // Returns:
  //   T | null — cached value (null = "we tried, no result")
  //   undefined — never cached, caller must fetch
  async get(key: string): Promise<T | null | undefined> {
    if (this.mem.has(key)) return this.mem.get(key) as T | null
    try {
      const raw = await readFile(this.file(key), 'utf8')
      const env = JSON.parse(raw) as Envelope<T>
      if (env.v !== CACHE_VERSION) return undefined
      this.mem.set(key, env.d)
      return env.d
    } catch {
      return undefined
    }
  }

  async set(key: string, data: T | null): Promise<void> {
    this.mem.set(key, data)
    const env: Envelope<T> = { v: CACHE_VERSION, t: new Date().toISOString(), d: data }
    const path = this.file(key)
    try {
      await mkdir(this.dir(), { recursive: true })
      const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(tmp, JSON.stringify(env))
      await rename(tmp, path)
    } catch (err) {
      console.error(`[mb-cache:${this.name}] write failed for ${key}:`, err)
    }
  }

  async delete(key: string): Promise<void> {
    this.mem.delete(key)
    try {
      await unlink(this.file(key))
    } catch {
      // already gone — fine
    }
  }
}
