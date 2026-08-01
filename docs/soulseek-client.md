# Private Soulseek client

Cratedigger's Soulseek surface is a private-build feature backed by slskd. It
should feel like one client: a username means the same thing everywhere, and
search, browsing, transfers, and conversations share one user identity.

## Shipped foundation

- Album and track search, MusicBrainz-aware completeness matching, lossless-first
  results, uploader-speed ranking, RED fallback, and queue prefetching.
- Download monitoring, retry/removal controls, automatic retries, durable album
  acquisition history, and inbox/tagger handoff.
- Persistent successful-uploader reputation.
- Share browsing for successful or manually entered users, with audio-folder
  filtering and direct album downloads.
- Clickable usernames in results, alternates, acquisition history, active
  downloads, and uploader history; all open the same share browser.

## Build order

1. **User identity:** profile/status, online state, notes, and a persistent buddy
   list attached to the existing share browser.
2. **Saved discovery:** wishlist searches and notifications when a wanted record
   appears, reusing the current ranked album results.
3. **Conversations:** private-message threads and rooms. Sending is always an
   explicit user action; Cratedigger never messages peers automatically.
4. **Transfer parity:** upload activity, queue position/control, per-user limits,
   and clearer offline/locked-share states.
5. **Client controls:** interests, ignored users, privileges, connection state,
   and diagnostics needed to replace routine use of slskd's own web UI.

## Boundary

Everything here remains behind `PUBLIC_BUILD === false`. slskd remains the
Soulseek protocol daemon; Cratedigger owns the music-focused interface and
durable local history rather than reimplementing the network protocol.
