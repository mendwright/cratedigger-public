import { stripLastfmFooter } from '../../../../shared/bio-text'

/** Plain-text chart excerpts omit source-link footers; the artist page owns links. */
export function cleanChartBio(text: string): string {
  return stripLastfmFooter(text)
    .replace(/\s*see also\s*:?\s*(?:(?:https?:\/\/|www\.)\S+[\s,;]*)+$/i, '')
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
