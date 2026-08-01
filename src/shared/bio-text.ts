import type { Bio } from './plex'

// Last.fm-derived text carries a recognizable footer: a "Read more on Last.fm"
// link plus CC-license boilerplate. We strip it from our own Last.fm fetches,
// but it also shows up *inside Plex's own summary field* — Plex's metadata
// agent started scraping Last.fm album blurbs (truncated summary, footer
// intact). These helpers let every "Plex summary wins" gate distinguish a
// genuinely curated Plex review (still wins unconditionally) from a scrape
// (fall through to our own fetch, which gets the full text, footer stripped).

const READ_MORE_RE = /read more on last\.fm/i
const LICENSE_RE = /user-contributed text is available under the creative commons/i

export function isLastfmScrape(text: string | null | undefined): boolean {
  if (!text) return false
  return READ_MORE_RE.test(text) || LICENSE_RE.test(text)
}

/** A Plex summary counts only when present AND curated (not a Last.fm scrape). */
export function isCuratedPlexSummary(summary: string | null | undefined): boolean {
  return !!summary && summary.trim().length > 0 && !isLastfmScrape(summary)
}

/**
 * Strip the Last.fm footer (linked or plain-text form), any residual HTML,
 * and collapse the whitespace that's left behind.
 */
export function stripLastfmFooter(text: string): string {
  return text
    .replace(/<a [^>]*>read more on last\.fm<\/a>\.?/gi, '')
    .replace(/read more on last\.fm\.?/gi, '')
    .replace(/user-contributed text is available[\s\S]*$/i, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Wikipedia sections that are lists or boilerplate, not bio prose. Matched
// against top-level `== Heading ==` names when expanding a stub lead.
const NON_PROSE_SECTION_RE =
  /^(discography|references|external links|see also|notes|further reading|sources|bibliography|filmography|videography|awards( and nominations)?|band members|members|personnel|tours?|track listing)$/i

/**
 * Reduce a full plain-text Wikipedia extract (`action=query&prop=extracts&
 * explaintext`) to its prose: the lead plus narrative sections (History,
 * Career, Style…), dropping list-y sections. Used when an article's lead is a
 * one-line stub but the body has the actual bio. Capped at `cap` chars,
 * cutting at a sentence boundary where possible.
 */
export function extractWikipediaProse(fullText: string, cap = 3000): string {
  const out: string[] = []
  let include = true
  for (const rawLine of fullText.split('\n')) {
    const line = rawLine.trim()
    const top = /^==\s*([^=].*?)\s*==$/.exec(line)
    if (top) {
      include = !NON_PROSE_SECTION_RE.test(top[1])
      continue
    }
    if (/^===+.*===+$/.test(line)) continue // sub-headings: drop the line, keep parent's include
    if (!include) continue
    out.push(rawLine)
  }
  let text = out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (text.length > cap) {
    text = text.slice(0, cap)
    const lastStop = text.lastIndexOf('. ')
    if (lastStop > cap * 0.6) text = text.slice(0, lastStop + 1)
    else text = text.trimEnd() + '…'
  }
  return text
}

const MUSIC_HINT_RE =
  /\b(music|musician|band|singer|songwriter|rapper|composer|album|record label|records|guitarist|bassist|drummer|pianist|vocalist|producer|dj|ep|discography)\b/i

/**
 * Sanity check for a Wikipedia article found via fuzzy title search (no
 * MBID anchor): the title must match the artist name, and the text must read
 * like a music article — so a same-named athlete or politician (or a random
 * long article) can't displace a correct one-line Last.fm bio.
 */
export function looksLikeArtistArticle(opts: {
  title: string
  extract: string
  artistName: string
}): boolean {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s*\(.*?\)\s*$/, '') // "Greg Mendez (musician)" → "Greg Mendez"
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
  const t = norm(opts.title)
  const n = norm(opts.artistName)
  if (!t || !n) return false
  if (t !== n && !t.includes(n) && !n.includes(t)) return false
  return MUSIC_HINT_RE.test(opts.extract)
}

/**
 * Choose between our fetched bio and a Plex summary that turned out to be a
 * Last.fm scrape: whichever text is more complete wins. The stripped scrape is
 * the floor — we never show less than Plex already had. Curated Plex summaries
 * never reach this function (they win at the gate).
 */
export function pickMoreCompleteBio(
  fetched: Bio | null,
  plexSummary: string | null | undefined
): Bio | null {
  const scraped =
    plexSummary && isLastfmScrape(plexSummary) ? stripLastfmFooter(plexSummary) : ''
  if (fetched && fetched.text.length >= scraped.length) return fetched
  if (scraped) return { source: 'lastfm', text: scraped, url: fetched?.url ?? null }
  return fetched
}
