import { app } from 'electron'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Detach any lingering Cratedigger installer DMG on launch.
 *
 * Install flow is: mount the DMG, drag to /Applications, launch from there —
 * which leaves the installer volume mounted on the desktop until the user
 * remembers to eject it. There's no hook that runs "after the drag", so the
 * first launch of the installed copy is the natural cleanup point: if we're
 * NOT running from a /Volumes path and a Cratedigger volume is mounted, eject
 * it quietly.
 *
 * Deliberately skipped when running from the DMG itself (launching the app
 * straight from the installer window) — detaching would yank the binary out
 * from under us. Auto-update is unaffected: it installs from the ZIP, never
 * the DMG.
 */
export function detachInstallerDmg(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  if (process.execPath.startsWith('/Volumes/')) return
  void (async () => {
    try {
      const volumes = await readdir('/Volumes')
      for (const name of volumes) {
        if (!name.startsWith('Cratedigger')) continue
        // Verify it's actually our installer image before ejecting — a user
        // could conceivably have an unrelated volume with this name.
        const contents = await readdir(join('/Volumes', name)).catch(() => [] as string[])
        if (!contents.includes('Cratedigger.app')) continue
        execFile('hdiutil', ['detach', join('/Volumes', name), '-quiet'], () => {
          // Best-effort: a busy volume (Finder copy still running) just stays
          // mounted; the next launch retries.
        })
      }
    } catch {
      // /Volumes unreadable — nothing to clean up.
    }
  })()
}
