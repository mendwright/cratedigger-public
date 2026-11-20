import type { ChartsCachedView } from '../shared/charts.js'
import { PUBLIC_BUILD } from '../shared/build-flags.js'
import { JsonCache } from './mb-cache.js'
import { getActiveAccountId, getValue } from './store.js'

const cache = new JsonCache<ChartsCachedView>('charts-views-v1')
const scope = (key: string): string => `${PUBLIC_BUILD ? 'public' : 'private'}|${getActiveAccountId()}|${getValue('preferredServerId')}|${key}`
export async function readChartsCache(key: string): Promise<ChartsCachedView | null> {
  const value = await cache.get(scope(key)) ?? null
  return PUBLIC_BUILD && key.startsWith('you') ? null : value
}
export async function writeChartsCache(key: string, value: ChartsCachedView): Promise<void> {
  if (PUBLIC_BUILD && (key.startsWith('you') || value.history || value.review)) return
  await cache.set(scope(key), value)
}
