// Shared iTunes song lookup for radio playback — album name + cover art for
// whatever the station is playing. One fetch per artist|title, read by every
// surface that shows radio art (the Now Playing screen, the bottom bar), so
// the screen and the bar can't disagree. Consumers call ensure() from their
// own $effect (it's key-guarded and cheap) and read `current`.
export interface RadioSongInfo {
  album: string | null
  art: string | null
}

export function isRadioRatingKey(rk: string | null | undefined): boolean {
  return !!rk && (rk.startsWith('radio:') || rk.startsWith('sxm:'))
}

class RadioSongInfoStore {
  current = $state<RadioSongInfo | null>(null)
  #key = ''

  ensure(artist: string | undefined | null, title: string | undefined | null): void {
    // No parsable song (DJ talking, ad break, station ID) — drop the previous
    // song's art so the surfaces fall back to the station tile instead of
    // showing a stale cover under the station's name.
    if (!artist || !title) {
      this.#key = ''
      this.current = null
      return
    }
    const key = `${artist}|${title}`
    if (key === this.#key) return
    this.#key = key
    this.current = null
    void window.cratedigger.plex.radioSongInfo({ artist, title }).then((info) => {
      if (this.#key === key) this.current = info
    })
  }
}

export const radioSongInfo = new RadioSongInfoStore()
