import type {
  ChartUser,
  ChartResult,
  ChartWindow,
  ChartDimension
} from '../shared/charts.js'

// Friends can't reach Tautulli (it's internal/Tailscale-only), so the friends
// build reads a precomputed, world-readable snapshot published to the public
// cratedigger-public GitHub release (see scripts/publish-charts.mjs). No creds,
// no Tailscale — just a public fetch. The owner build prefers live Tautulli and
// falls back here when Tautulli is unreachable.

const SNAPSHOT_URL =
  'https://github.com/jaybeaman/cratedigger-public/releases/download/charts-data/charts.json'
const TTL = 2 * 60_000

interface SnapshotEntry {
  title: string
  subtitle: string | null
  ratingKey: string | null
  thumb: string | null
  plays: number
}
interface Snapshot {
  generatedAt: number
  users: ChartUser[]
  // charts[window][dimension][userId] = ranked entries for that user
  charts: Record<string, Record<string, Record<string, SnapshotEntry[]>>>
}

let cache: { at: number; snap: Snapshot } | null = null

async function load(): Promise<Snapshot> {
  if (cache && Date.now() - cache.at < TTL) return cache.snap
  let r: Response
  try {
    r = await fetch(SNAPSHOT_URL, { signal: AbortSignal.timeout(20000) })
  } catch {
    throw new Error('Could not reach the published charts.')
  }
  if (!r.ok) throw new Error(`No published charts yet (${r.status}).`)
  const snap = (await r.json()) as Snapshot
  cache = { at: Date.now(), snap }
  return snap
}

export function clearSnapshotCache(): void {
  cache = null
}

export async function snapshotUsers(): Promise<ChartUser[]> {
  return (await load()).users
}

// Combine the selected users' per-user top lists into one ranking. Each user's
// list is capped (top-150 in the publisher), which keeps arbitrary include/
// exclude combinations accurate for a top-50 view.
export async function snapshotTop(args: {
  userIds: number[]
  window: ChartWindow
  dimension: ChartDimension
  limit: number
}): Promise<ChartResult> {
  const snap = await load()
  const limit = Math.max(1, Math.min(args.limit || 25, 100))
  const dimMap = snap.charts?.[args.window]?.[args.dimension] || {}
  const tally = new Map<string, SnapshotEntry>()
  for (const uid of args.userIds) {
    for (const e of dimMap[String(uid)] || []) {
      const key = e.ratingKey || `${e.title}//${e.subtitle ?? ''}`
      const cur = tally.get(key)
      if (cur) cur.plays += e.plays
      else tally.set(key, { ...e })
    }
  }
  const entries = [...tally.values()]
    .sort((a, b) => b.plays - a.plays)
    .slice(0, limit)
    .map((e, i) => ({
      rank: i + 1,
      title: e.title,
      subtitle: e.subtitle,
      plays: e.plays,
      ratingKey: e.ratingKey,
      thumb: e.thumb ?? null
    }))
  return { dimension: args.dimension, window: args.window, userIds: args.userIds, entries }
}
