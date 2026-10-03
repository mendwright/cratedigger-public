// Per-site extractor for albumoftheyear.org. Runs in the webview's page
// context via webview.executeJavaScript(). Returns { artist, album } when the
// current page is recognizably an album page, null otherwise.

export const aoty = {
  match(url: string): boolean {
    try {
      const u = new URL(url)
      return u.hostname === 'www.albumoftheyear.org' || u.hostname === 'albumoftheyear.org'
    } catch {
      return false
    }
  },
  // Self-contained IIFE that the webview runs in its own page. h1.albumTitle
  // and .artist a are the canonical AOTY album-page selectors. If a future
  // redesign breaks them, this returns null and the selection-text fallback
  // takes over.
  extractScript: `(() => {
    try {
      const titleEl = document.querySelector('h1.albumTitle')
      const artistEl = document.querySelector('.artist a')
      const album = titleEl && titleEl.textContent ? titleEl.textContent.trim() : ''
      const artist = artistEl && artistEl.textContent ? artistEl.textContent.trim() : ''
      return album && artist ? { artist, album } : null
    } catch (e) {
      return null
    }
  })()`
}
