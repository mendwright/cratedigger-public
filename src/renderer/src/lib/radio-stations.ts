// Bundled station tiles, shown wherever radio is playing but no song art is
// known — ads, DJ breaks, station IDs. Real branding where a usable asset
// exists (KEXP's own wordmark, Radio Paradise's app icon), typeset tiles for
// the SiriusXM channels. Assets live in src/renderer/src/assets/radio/.
import kexpTile from '../assets/radio/kexp.svg'
import paradiseTile from '../assets/radio/paradise.svg'
import sxmXmuTile from '../assets/radio/sxm-xmu.svg'
import sxmIndieTile from '../assets/radio/sxm-indie.svg'

// Live stations carry their id in the ratingKey ('radio:kexp'); SiriusXM
// Xtra queue tracks are 'sxm:<track-uuid>' with the channel name only in the
// timeline's album string ('((·)) Indie 1.0 — live'), hence the substring
// fallback. Titles match RADIO_STATIONS in src/main/pi-player.ts.
const BY_STATION_ID: Record<string, string> = {
  kexp: kexpTile,
  paradise: paradiseTile,
  'sxm-xmu': sxmXmuTile,
  'sxm-indie': sxmIndieTile
}
const BY_TITLE: [needle: string, tile: string][] = [
  ['KEXP', kexpTile],
  ['Radio Paradise', paradiseTile],
  ['SiriusXMU', sxmXmuTile],
  ['Indie 1.0', sxmIndieTile]
]

export function radioStationArt(tl: { ratingKey: string; album: string }): string | null {
  if (tl.ratingKey.startsWith('radio:')) {
    return BY_STATION_ID[tl.ratingKey.slice('radio:'.length)] ?? null
  }
  if (tl.ratingKey.startsWith('sxm:')) {
    return BY_TITLE.find(([needle]) => tl.album.includes(needle))?.[1] ?? null
  }
  return null
}
