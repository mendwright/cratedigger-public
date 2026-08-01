// The navigable-entity union for Cratedigger's dive-upon-dive navigation.
// Album and artist are live; label/genre/year are stubbed for Wave 6 —
// they'll gain dedicated screens once their detail pages exist.
export type NavEntity =
  | { kind: 'album'; ratingKey: string }
  | { kind: 'artist'; mbid: string; name: string }
  | { kind: 'label'; name: string }
  | { kind: 'genre'; name: string }
  | { kind: 'year'; year: number }

export interface NavFrame {
  entity: NavEntity
  scrollY: number
  pushedAt: number
}

export function entityKey(e: NavEntity): string {
  switch (e.kind) {
    case 'album':
      return `album:${e.ratingKey}`
    case 'artist':
      return `artist:${e.mbid}`
    case 'label':
      return `label:${e.name.toLowerCase()}`
    case 'genre':
      return `genre:${e.name.toLowerCase()}`
    case 'year':
      return `year:${e.year}`
  }
}

export const NAV_STACK_CAP = 25
