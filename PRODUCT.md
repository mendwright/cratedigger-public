# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The desktop app is the primary design surface: an Electron + Svelte 5 renderer, shipped as a macOS app. A companion Flutter app for iPad and iPhone lives in `cratedigger_mobile/` (MaterialApp, iOS target, TestFlight to family). It is the same product with the same vocabulary (see `cratedigger_mobile/CONTEXT.md`), but it is a second codebase, not one UI adapting per OS. Mobile-specific design work should read this file plus that CONTEXT.md.

## Users

- **Jay (primary).** A record collector digging through his own large Plex library, which Bijou fills. He browses albums, reads credits, follows session musicians from one record to the next, and casts to the speakers around the house. He's album-first, not playlist-first. Design decisions are made for him.
- **Secondary users (must work, don't steer the design):**
  - Mary (partner): mostly internet radio (KEXP, SiriusXM, Radio Paradise), plus simple album play. She uses the living-room kiosk and the phone app.
  - The bike-shop Mac ("Shop Amp"): read-only Plex account, playlists and playback in a shared space.
  - Friends on the public build (`PUBLIC_BUILD=1`): their own Plex servers, with Soulseek, triage and library writes stripped out.

## Product Purpose

A Plex music client for digging through a collection rather than playing music quickly. It adds what general-purpose players skip: a record-crate flip-through of the library, a clickable credit graph (songwriters, performers, session players) enriched from MusicBrainz, and the context around a record (bios, liner credits, lyrics, critics' picks, listening history). It leaves library authority and playback with Plex. Success means browsing feels like flipping through records in a crate, and following a name from one album to the next is effortless.

## Positioning

Built for one collector's library, house and listening habits. Unlike general players tuned for speed-to-play, it treats the library as a collection to explore. Plex stays the source of truth, MusicBrainz is enrichment only, and it plays to Jay's own Raspberry Pi players and house speakers instead of a generic cast protocol.

## Operating Context

- Desktop at home or at the shop, often with music playing on another room's speakers, not on the Mac.
- **Viewed from across the room:** theater mode (⌘T), Now Playing and the shop display must read at a distance.
- Playback targets: headless Plexamp on the Pis (Plex Companion API), the in-app "This Mac" player, and the direct Pi player ("Living Room (direct)"). House speaker routing goes through Hayes. There's also a living-room kiosk, a separate repo (nowplaying-kiosk).
- Keyboard-heavy: command palette (⌘K), mini player (⌘⇧M), triage keys (j/k, a, dd).
- Long listening and reading sessions, including deliberate, unhurried ones. Browsing is part of the listening.

## Capabilities and Constraints

- **Shipped:** album-flip crate browse, search, credits and person (entity) pages, manual MusicBrainz match, album/artist bios, lyrics (lrclib, Genius fallback), crates and smart playlists, radio continuation, internet radio stations, charts and listening history (Last.fm, Plex, Spotify), critics' picks and studio badges, album-of-the-day, Soulseek and inbox tagging, library triage, album art fixer, classical mode, the Crate theme (the only one since 2026-09), media keys. Full list in `docs/subsystems.md`.
- **Hard constraints:** this is a Plex client, not a standalone player. No local file indexing, no non-Plex playback paths, and no Chromecast, AirPlay or Snapcast. MusicBrainz enriches and never overrides Plex as the source of truth. Library writes need the server-owner account.
- **Play just plays:** no confirmation modals before playback. Instant action plus visible queue state.
- **Vocabulary:** Server, Section, Album (Plex side) vs release (MusicBrainz side), Credit / Credit graph, Player, Cast, Timeline. See `cratedigger_mobile/CONTEXT.md`.
- Personal-only features (Soulseek, triage, writes, Hayes, Pi player) are gated out of the public build. Design must degrade cleanly when they're absent.

## Brand Commitments

- Name: **Cratedigger** (formerly jayamp, then Sideman; old names persist in storage keys on purpose).
- Icon: a brick U-shaped crate holding three vinyl spines, on cream paper.
- Core metaphor: the physical record crate. Flipping, digging and liner notes.
- Voice: plain and personal. The README is written in the first person by the collector who built it.

## Evidence on Hand

- Real library metadata, cover art and MusicBrainz credits come live from Jay's Plex server. `~/Library/Application Support/cratedigger/library-snapshot.json` is an offline snapshot.
- Real listening history, 2005 to now (Last.fm, Plex, Spotify), backs Charts.
- No testimonials, user counts or press exist. Never fabricate them.

## Product Principles

1. **Digging over speed.** Optimize for exploring and lingering, not for the fastest route to a play button.
2. **Plex is the authority.** Enrich, never contradict or replace, the library and playback state.
3. **Every name is a door.** Credits, labels, studios and people should be navigable wherever they appear.
4. **Act instantly, show state.** No interstitials. Make what's playing and what's queued plainly visible.
5. **Album-first.** Playlists exist for secondary users. Don't push playlist-centric flows on the primary user.

## Accessibility & Inclusion

- Distance legibility: theater mode, Now Playing and shop-display surfaces must stay readable from across a room.
- Otherwise the baseline: solid contrast across all themes and full keyboard operability.
