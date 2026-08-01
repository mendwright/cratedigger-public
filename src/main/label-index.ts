import { BrowserWindow } from 'electron'
import {
  getReleaseLabels,
  getReleaseGroupLabels,
  findLabelsByArtistTitle
} from './musicbrainz.js'
import { BackgroundJobRunner } from './background-job.js'
import { getValue, patchRecord } from './store.js'
import type { LabelIndexProgress } from '../shared/plex.js'

// Everything the indexer needs to resolve labels for a single album, gathered
// by the renderer from the already-loaded album list so main doesn't have to
// re-query Plex.
export interface IndexJobItem {
  ratingKey: string
  artist: string
  title: string
  studio: string | null
  releaseMbid: string | null
  releaseGroupMbid: string | null
}

const job = new BackgroundJobRunner<LabelIndexProgress>(
  {
    running: false,
    done: 0,
    total: 0,
    current: null,
    error: null
  },
  (progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mb:label-index-progress', progress)
    }
  }
)

export function getLabelIndexProgress(): LabelIndexProgress {
  return job.getProgress()
}

export function stopLabelIndex(): void {
  job.stop()
}

// MB-first lookup: release MBID → release-group MBID → artist+title search.
// Plex's studio tag is only used as a last resort, because it's whatever was
// in the file's label tag and tends to be inconsistent ("K" vs "K Records"
// for the same label), which fragments the label entity pages.
async function resolveLabels(item: IndexJobItem): Promise<string[]> {
  if (item.releaseMbid) {
    const labels = await getReleaseLabels(item.releaseMbid)
    if (labels.length > 0) return labels
  }
  if (item.releaseGroupMbid) {
    const labels = await getReleaseGroupLabels(item.releaseGroupMbid)
    if (labels.length > 0) return labels
  }
  const searched = await findLabelsByArtistTitle(item.artist, item.title)
  if (searched.length > 0) return searched
  const studio = item.studio?.trim()
  return studio ? [studio] : []
}

export async function startLabelIndex(
  items: IndexJobItem[],
  opts: { rebuild?: boolean } = {}
): Promise<void> {
  const existing = getValue('albumLabels')
  const todo = opts.rebuild
    ? items
    : items.filter((it) => !Object.prototype.hasOwnProperty.call(existing, it.ratingKey))

  await job.run(
    {
      done: 0,
      total: todo.length,
      current: null,
      error: null
    },
    async () => {
      for (const item of todo) {
        if (job.cancelled) break
        try {
          const labels = await resolveLabels(item)
          patchRecord('albumLabels', item.ratingKey, labels)
          job.update({
            done: job.progress.done + 1,
            current: labels[0] ?? '(no label)'
          })
        } catch (err) {
          // Per-item failures shouldn't halt the whole run — record empty and move
          // on. The error surfaces in the progress object so the UI can flag it.
          patchRecord('albumLabels', item.ratingKey, [])
          job.update({
            done: job.progress.done + 1,
            current: null,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }
    },
    { current: null }
  )
}
