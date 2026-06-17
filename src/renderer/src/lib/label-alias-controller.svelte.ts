type PlexApi = Window['cratedigger']['plex']

export interface LabelAliasDeps {
  plex?: PlexApi
}

/**
 * User-curated label alias map. Folds variant names (e.g. "New West Records
 * LLC") into a canonical form ("New West Records") at view time — the raw
 * per-album label arrays from MusicBrainz stay untouched on disk so we never
 * lose the original signal. {@link canonical} is the one read path; every
 * UI surface that displays or filters by label goes through it.
 *
 * Aliases are kept single-hop: setting `A → B` when `B → C` already exists
 * stores `A → C` directly (see `setLabelAlias` in `src/main/store.ts`), so a
 * naive one-level lookup here is sufficient.
 */
export class LabelAliasController {
  aliases = $state<Record<string, string>>({})

  #plex: PlexApi

  constructor(deps: LabelAliasDeps) {
    this.#plex = deps.plex ?? window.cratedigger.plex
  }

  canonical(name: string): string {
    const t = name.trim()
    if (!t) return t
    return this.aliases[t] ?? t
  }

  /** Resolve a list of raw labels to their canonical forms, deduped, preserving order. */
  canonicalize(names: string[]): string[] {
    const seen = new Set<string>()
    const out: string[] = []
    for (const n of names) {
      const c = this.canonical(n)
      if (!c || seen.has(c)) continue
      seen.add(c)
      out.push(c)
    }
    return out
  }

  async load(): Promise<void> {
    try {
      this.aliases = await this.#plex.listLabelAliases()
    } catch {
      // leave existing value in place
    }
  }

  async setAlias(alias: string, canonical: string): Promise<void> {
    try {
      this.aliases = await this.#plex.setLabelAlias({ alias, canonical })
    } catch {
      // ignore
    }
  }

  async removeAlias(alias: string): Promise<void> {
    try {
      this.aliases = await this.#plex.removeLabelAlias({ alias })
    } catch {
      // ignore
    }
  }
}
