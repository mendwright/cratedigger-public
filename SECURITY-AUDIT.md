# Security Audit Log

Recurring security review for Cratedigger. Target cadence: **every couple of weeks**.

## How to run an audit

Trigger phrase: **"let's continue security audits."** Any agent session that sees this should:

1. Read this file — threat model, checklist, open findings.
2. Work the [standing checklist](#standing-checklist) fresh. Don't assume last pass's results still hold; re-run the commands, re-read the hot spots.
3. Update the [findings register](#findings-register): close fixed items (move to the log entry), open new ones, re-confirm `accepted` ones still reflect the decision.
4. Append a dated entry to the [audit log](#audit-log) (newest at top) with what was checked and what changed.
5. Fix what the user asks for; record the rest. Don't silently expand scope.

## Threat model

Single-user desktop app (macOS, signed + notarized). What we're defending:

- **Arbitrary web content in the BrowserPane `<webview>`** — the user browses AOTY, Discogs, ticket sites in-app. An unpatched Chromium renderer CVE or a malicious page is the most realistic remote-code path. The webview guest has no preload (no IPC reach) and nodeIntegration is off.
- **The LAN** — Plex server/players (often plain http), the theater server on :9334, slskd/tagger services. LAN devices are semi-trusted, not trusted.
- **The update feed** — `mendwright/cratedigger-releases` GitHub repo. A compromised feed is a supply-chain path to every installed copy. Mitigations: HTTPS, SHA-512 manifest, Squirrel.Mac code-signature match on the downloaded bundle.
- **Local file theft** — auth tokens for Plex/Spotify/slskd/tagger/etc. live in `userData/jayamp.json`, AES-256-GCM under `userData/secrets.key` (0600). This protects backups and casual snooping, **not** a process running as the user (it can read both files). Accepted tradeoff, documented in `store.ts`.

Explicitly out of scope: multi-user attack, hostile physical access, the friends build's users doing anything but running the app.

## Standing checklist

Run every pass. Check the box in the log entry, note deltas.

### 1. Dependencies

- [ ] `npm audit` — note count by severity; identify any **runtime** (not build/dev-toolchain) advisories. Build-toolchain-only vulns (tar, esbuild dev server, etc.) are low priority but worth clearing with `npm audit fix` when free.
- [ ] Electron version vs. current stable. Known-CVE list: <https://github.com/advisories?query=electron>. We're exposed via the webview.
- [ ] `git diff` on `package.json` since last audit — any new dependency = review its provenance.

### 2. Electron window & webview surface

- [ ] `webPreferences` on every `BrowserWindow` (`src/main/index.ts`, `src/main/mini-player.ts`): `contextIsolation: true`, no `nodeIntegration`, `sandbox` status.
- [ ] `setWindowOpenHandler` on every window that can render content — http/https only → `shell.openExternal`, else deny.
- [ ] `<webview>` in `BrowserPane.svelte`: no `preload` attr, `partition` set, popup handling (CD-SEC-003), no `nodeintegration` attr.
- [ ] `session.setPermissionRequestHandler` / `setPermissionCheckHandler` — should exist and deny by default (CD-SEC-002).
- [ ] No `app.on('web-contents-created')` gaps: any new WebContents type (webview guest, popup) should get the same treatment.

### 3. Renderer & CSP

- [ ] `src/renderer/index.html` CSP meta: `default-src 'self'`, no `script-src 'unsafe-inline'/'unsafe-eval'`. Loosenings (`img-src`/`connect-src` to `https: http:`) must stay justified by Plex LAN + cover overrides.
- [ ] `grep -r "{@html" src/renderer` — must stay empty. Svelte's default escaping is our XSS wall.
- [ ] No `eval(`, `new Function(`, `dangerouslySetInnerHTML` equivalents.

### 4. IPC bridge

- [ ] `src/preload/index.ts` exposes only typed `invoke`/`listen` wrappers from `src/shared/ipc-contract.ts` — no raw `ipcRenderer` passthrough, no `send` of secrets.
- [ ] New channels since last audit: does the handler validate renderer-supplied input before it hits the network/disk/shell? Renderer is trusted UI, but defense-in-depth on anything that becomes a path, URL, or shell arg.
- [ ] No secret values (decrypted tokens) returned to the renderer except where the Settings UI genuinely round-trips them.

### 5. Secrets & local files

- [ ] `store.ts`: writes still always emit `enc:v2:`; `migrateSecrets()` still runs at boot; no new plaintext secret field snuck into `StoreSchema` outside the `SecretKey` union.
- [ ] No silent plaintext fallback in `encrypt()` (CD-SEC-007).
- [ ] `~/.cratedigger/secrets.json` still 0600, still user-invoked only.
- [ ] Path-traversal guards intact on anything serving files (`cover-store.ts resolveCoverFile`, protocol handlers in `imageProxy.ts`).

### 6. Network listeners

- [ ] `theater-server.ts`: bind address, auth posture, what `/state` `/players` `/cover` expose (CD-SEC-004). Any new listener in main gets the same scrutiny — grep for `createServer(` in `src/main`.
- [ ] `spotify.ts` auth callback: still bound to `127.0.0.1` only, state + PKCE intact.

### 7. Outbound requests

- [ ] No `rejectUnauthorized: false`, no `NODE_TLS_REJECT_UNAUTHORIZED` anywhere.
- [ ] Token-in-URL usage (`X-Plex-Token` query params) — confirm it only goes to the user's own Plex hosts, never third parties.
- [ ] API keys for user-configured URLs (slskd/tagger/tautulli): http cleartext is accepted for LAN; flag if any default becomes a WAN host.

### 8. Build & release

- [ ] `build/entitlements.mac.plist` — no new entitlements without a comment justifying them. `disable-library-validation` stays only as long as the native media-service dep does.
- [ ] Updater still: HTTPS feed, SHA-512 manifest, both `latest-mac.yml` **and** the `-mac.zip` attached to the release (see CLAUDE.md releasing section).
- [ ] `scripts/publish-public.sh` leak tripwire intact — private-only code (slskd, tagger, theater server) stays out of the friends build via `PUBLIC_BUILD`.

## Severity scale

- **Critical** — remote code execution or token theft plausible in normal use.
- **High** — known-exploitable component in the attack path, or secret exposure.
- **Medium** — missing hardening that a real attack chain would need.
- **Low** — hygiene; fix when touching the area.

Statuses: `open` · `accepted` (documented risk decision) · `fixed` (move to log) · `wontfix` (with reason).

## Findings register

| ID | Sev | Area | Finding | Status |
|----|-----|------|---------|--------|
| CD-SEC-002 | Medium | Main | **No permission gate.** No `session.setPermissionRequestHandler`/`setPermissionCheckHandler`; Electron defaults grant most permissions (notifications, media, clipboard…) to any origin incl. webview guests. Add deny-by-default handler in `index.ts`. | open |
| CD-SEC-003 | Medium | Webview | **Uncontrolled popups.** `allowpopups` on the BrowserPane webview, no `windowOpenHandler` on the guest contents — arbitrary pages can spawn windows (sandboxed by default, but uncontrolled attack surface). Route guest new-windows through the same http/https → `openExternal` policy as the main window, or drop `allowpopups`. | open |
| CD-SEC-004 | Medium | Network | **Theater server unauthenticated on LAN.** Binds `0.0.0.0:9334`, no auth. Exposes now-playing metadata, player roster, and `/cover?path=` which proxies *any* Plex path (must start with `/`) with the user's token embedded upstream — a read SSRF limited to the Plex server. Home-LAN risk modest; private build only. Options: shared-secret param, restrict `/cover` path prefixes, bind to a specific interface. | open |
| CD-SEC-005 | Medium | Deps | **11 npm audit vulns remain** (5 high / 5 moderate / 1 low; down from 25 after the Electron-43 bump cleared the `electron` advisories + transitive refresh). Essentially all build/dev toolchain (tar, esbuild dev server, etc.), not shipped runtime. `npm audit fix` may clear more. | open |
| CD-SEC-006 | Low | Main | **`sandbox: false`** on both windows. Preload uses only `contextBridge` + `ipcRenderer` → should tolerate `sandbox: true`. Verify media-service still works after flipping. | open |
| CD-SEC-007 | Low | Store | **`encrypt()` silently persists plaintext on failure** (`store.ts`, "encrypt failed — storing plaintext"). A crypto failure becomes an at-rest cleartext token. Throw instead of persisting. | open |
| CD-SEC-008 | Low | CSP | **CSP hardening nits.** Missing `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`. `img-src`/`connect-src` wide (`https: http:`) — accepted, required for LAN Plex + external cover overrides. | open |
| CD-SEC-009 | Low | Store | **v2 at-rest scheme is obfuscation-grade by design**: key file sits next to ciphertext; defeats backup theft, not a user-level process. Documented in `store.ts`. | accepted |
| CD-SEC-010 | Low | Plex | **Plain http to LAN Plex endpoints**, token in query string. Connection ranking prefers https but falls back for mixed-cert home setups. Plex-ecosystem norm. | accepted |
| CD-SEC-011 | Low | Build | **Entitlement `com.apple.security.cs.disable-library-validation`** required to dlopen `@arcanewizards/electron-media-service`. Revisit if the dep is dropped. | accepted |

## What's already solid

Re-checked each pass; don't re-flag unless regressed.

- `contextIsolation: true` everywhere; no `nodeIntegration`; main windows load only local bundle / dev URL.
- `setWindowOpenHandler` on main window: http/https only → `shell.openExternal`, all else denied; invalid URLs dropped.
- CSP present; `script-src` effectively `'self'` (via `default-src`); no `{@html}` anywhere in the renderer.
- Preload bridge is a frozen typed surface from `ipc-contract.ts`; webview guest has no preload → no IPC reach from arbitrary web content.
- Custom protocols (`cratedigger-plex:`, `cratedigger-cover:`) validate params; cover file resolution has a real path-traversal guard (`resolveCoverFile`).
- Secrets encrypted at rest (v2) with boot-time migration; renderer only sees them where Settings round-trips.
- Spotify OAuth: PKCE (S256) + state check + callback bound to `127.0.0.1` + timeout.
- Auto-update: HTTPS feed, SHA-512-verified manifest, signed + notarized bundles, Squirrel.Mac signature match.
- No `rejectUnauthorized`/`NODE_TLS_REJECT_UNAUTHORIZED` anywhere; no `eval`; no renderer-controlled `exec`/`spawn`; `shell.openPath` only called with a constant path.
- IPC handlers wrap errors in `new Error(...)` (structured-clone safety).

## Audit log

### 2026-07-20 (follow-up) — CD-SEC-001 fixed

- **Electron 33 → 43.1.1.** All 19 Electron advisories cleared from `npm audit` (25 → 11 total, remainder build toolchain).
- Forced by the bump: **electron-builder 25 → 26.15.7**, **@electron/rebuild 4.0.4 → 4.2.0** (old one couldn't detect Electron 43's ABI), **nan 2.26 → 2.28** (V8 `External::New` signature change), **better-sqlite3 11.8.1 → 12.11.1** (same V8 breakage).
- Packaging fix: electron-builder 26 / @electron/universal rejects identical `.node` files in both arch slices. Native modules' `bin/darwin-<arch>-<abi>/` dirs (stale shipped prebuilds + rebuild cache) are never what `bindings` resolves (runtime = `build/Release`), so `build.files` now excludes `node_modules/**/bin/darwin-*-*/**`.
- Verified: typecheck clean; 630/630 tests; unsigned universal DMG+zip smoke build with universal (lipo'd) native binaries; dev boots on Electron 43 (media-keys native loads, theater server up).
- Trap documented in CLAUDE.md: native modules are single-ABI — `npm run test` needs the Node-ABI build (`npm rebuild better-sqlite3`), dev/dist need the Electron-ABI build (`npx @electron/rebuild`). Tree was left in the Node-ABI (test-green) state.
- Note: the `electron` package's postinstall (binary download) is blocked by npm's allow-scripts policy — if dev ever reports "Electron uninstall", run `node node_modules/electron/install.js`.

### 2026-07-20 — first pass

Full baseline. All eight checklist sections run.

- **Deps:** `npm audit` = 25 vulns (1 critical / 17 high / 5 moderate / 2 low), near-all build toolchain → CD-SEC-005. Electron pinned `^33.2.0`, 19 known CVEs behind → CD-SEC-001 (the pass's headline finding).
- **Windows/webview:** found missing permission handler (CD-SEC-002) and uncontrolled webview popups (CD-SEC-003). Window configs otherwise clean (isolation on, no nodeIntegration, openExternal policy correct).
- **Network:** theater server confirmed `0.0.0.0`, no auth, `/cover` proxies arbitrary Plex paths → CD-SEC-004. Spotify callback confirmed `127.0.0.1`-only. No other listeners (`createServer` only in theater-server + spotify).
- **Secrets:** v2 scheme verified; plaintext-fallback wart noted (CD-SEC-007); `~/.cratedigger/secrets.json` is 0600.
- **Hardening backlog:** sandbox flip (CD-SEC-006), CSP nits (CD-SEC-008).
- **No fixes applied this pass** — baseline only. Suggested first actions, in order: Electron bump (001), permission handler (002), `npm audit fix` (005).
