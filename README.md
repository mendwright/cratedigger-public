# Cratedigger

A desktop Plex music client. It doesn't play audio itself — it casts to Plexamp running on speakers around the house. What it adds on top of Plex is browsing and credits: a record-crate flip-through of the library, and a clickable credit graph (songwriters, performers, session players) enriched from MusicBrainz.

I built it because the tools for playing a Plex library treat that library as a database: a search box, a play button, a scroll of covers tuned to get you listening as fast as possible. I'm not trying to play music quickly. I'm digging through a collection. Plexamp already handles playback well, so I left playback alone and built the parts no product bothers with — flipping through covers the way you flip through records in a crate, reading the credits, and following a session musician from one record to the next.

MusicBrainz fills in what Plex's metadata lacks, but Plex stays the source of truth for the library and the authority for playback. This is a Plex client, not a standalone player.

## What this build does

- **Browse** your library as a record crate — cover-size slider, sorting, infinite scroll.
- **Album detail** with full per-role credits (songwriters, performers, session players), clickable to walk the credit graph.
- **Search** across Plex metadata, grouped into artists / albums / tracks.
- **Cast** to a Plexamp instance on your network (this is a remote control, not a player — audio comes out of Plexamp).
- **Now Playing** transport, queue (Play Next / Add to Queue), lyrics, artist & album bios, new releases, listen-later, and local touches like cover overrides and labels.

It is **read-only against your library**: it never writes tags, moves files, or deletes anything. (Those tools exist in the author's private build but are stripped from this one.)

## Requirements

- A **Plex Media Server** with a music library, and a Plex account to sign in.
- At least one **Plexamp** instance reachable on your network to cast to (e.g. headless Plexamp on a Raspberry Pi, or the Plexamp desktop/mobile app).
- macOS (the prebuilt app is a signed universal macOS DMG). Building from source needs Node 20+.

## Install

Grab the latest DMG from the [Releases](https://github.com/mendwright/cratedigger-public/releases) page, drag it to /Applications, open it, and sign in with Plex.

Optional API keys (set in Settings → all optional, all free):

- **Last.fm** — richer artist/album bios.
- **Genius** — lyrics fallback when lrclib.net has nothing.
- **Ticketmaster** — the Shows view (US venues).

## Build from source

```sh
npm install
npm run dev        # run in development
npm run build      # production bundle
npm run dist       # signed macOS DMG (needs your own Apple Developer signing setup)
```

This repo always builds the public configuration (no library-write / download tooling).

## License

MIT — see [LICENSE](LICENSE). Shared with friends; use it however you like.
