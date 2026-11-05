import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SpotifyTrack } from '../shared/spotify.js'

const execFileP = promisify(execFile)

// Read playlists straight out of the local Music.app library over Apple
// Events (JXA via osascript) — Apple Music cloud playlists sync into the
// app, so this covers them with no MusicKit tokens or network. First call
// triggers the one-time macOS Automation consent prompt and launches Music
// if it isn't running. Bulk property fetches (p.tracks.name() = ONE Apple
// Event for the whole column) keep big playlists fast.

export interface ApplePlaylistSummary {
  // Music.app persistent ID — stable across launches, unlike `id()`.
  id: string
  name: string
  trackCount: number
}

async function runJxa<T>(script: string, timeoutMs = 120_000): Promise<T> {
  if (process.platform !== 'darwin') throw new Error('Music.app import is macOS-only')
  try {
    const { stdout } = await execFileP('osascript', ['-l', 'JavaScript', '-e', script], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024
    })
    return JSON.parse(stdout.trim()) as T
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/not authorized|-1743/.test(msg)) {
      throw new Error(
        'macOS blocked access to Music — allow Cratedigger under System Settings → Privacy & Security → Automation'
      )
    }
    throw new Error(`Music.app read failed: ${msg}`)
  }
}

export async function appleMusicListPlaylists(): Promise<ApplePlaylistSummary[]> {
  // specialKind "none" filters out the built-ins (Library, Music, Genius,
  // folders, Top 25…); smart stays excluded too — transferred Spotify
  // playlists are plain user playlists.
  return await runJxa<ApplePlaylistSummary[]>(`
    const app = Application("Music");
    const out = [];
    for (const p of app.userPlaylists()) {
      try {
        if (p.smart()) continue;
        if (p.specialKind() !== "none") continue;
        out.push({ id: p.persistentID(), name: p.name(), trackCount: p.tracks.name().length });
      } catch (e) { /* dead specifier — skip */ }
    }
    JSON.stringify(out)
  `)
}

export async function appleMusicGetPlaylistTracks(persistentId: string): Promise<SpotifyTrack[]> {
  const idLiteral = JSON.stringify(persistentId)
  interface Raw {
    names: string[]
    artists: (string | null)[]
    albums: (string | null)[]
    durations: (number | null)[]
  }
  const raw = await runJxa<Raw>(`
    const app = Application("Music");
    const hits = app.userPlaylists.whose({ persistentID: ${idLiteral} })();
    if (hits.length === 0) throw new Error("playlist not found");
    const p = hits[0];
    const grab = (col) => { try { return p.tracks[col]() } catch (e) { return null } };
    const names = grab("name") ?? [];
    const pad = (arr) => (arr && arr.length === names.length ? arr : names.map(() => null));
    JSON.stringify({
      names,
      artists: pad(grab("artist")),
      albums: pad(grab("album")),
      durations: pad(grab("duration"))
    })
  `)
  return raw.names.map((title, i) => ({
    title,
    artist: raw.artists[i] ?? '',
    album: raw.albums[i] ?? '',
    // AppleScript duration is seconds (float).
    durationMs:
      typeof raw.durations[i] === 'number' && raw.durations[i]! > 0
        ? Math.round(raw.durations[i]! * 1000)
        : null,
    isLocal: false
  }))
}
