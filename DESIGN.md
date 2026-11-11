---
name: Cratedigger
description: A record crate in a dim room. Navy tile, cream ink, and three sleeve colours from the app icon.
colors:
  paper: "#1d2a3a"
  surface: "#243447"
  surface-deep: "#16212e"
  cream-ink: "#f4ead6"
  walnut: "#d8ccb4"
  faded: "#9fa9b4"
  hairline: "#2f4157"
  hairline-strong: "#466078"
  brick: "#f0703f"
  brick-deep: "#cc5528"
  brick-ink: "#f89a72"
  brick-lift: "color-mix(in srgb, #f0703f 50%, #f89a72)"
  brick-wash: "#3b3238"
  on-brick: "#1d2a3a"
  crate-mustard: "#efc35a"
  crate-teal: "#57b3aa"
  ok: "#6cc3b8"
  warn: "#efc35a"
  err: "#e6858a"
typography:
  display:
    fontFamily: "Futura, 'Avenir Next', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(2.4rem, 4.5vw, 3.75rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Futura, 'Avenir Next', 'Helvetica Neue', sans-serif"
    fontSize: "clamp(1.85rem, 3.6vw, 2.8rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Futura, 'Avenir Next', 'Helvetica Neue', sans-serif"
    fontSize: "1.3rem"
    fontWeight: 600
    letterSpacing: "-0.01em"
  name:
    fontFamily: "Futura, 'Avenir Next', 'Helvetica Neue', sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.55
    fontFeature: "'tnum'"
  body-small:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 400
    fontFeature: "'tnum'"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif"
    fontSize: "0.7rem"
    fontWeight: 700
    letterSpacing: "0.18em"
  mono:
    fontFamily: "'SF Mono', ui-monospace, Menlo, monospace"
    fontSize: "0.8rem"
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
  lg: "6px"
  xl: "10px"
  2xl: "14px"
  pill: "999px"
spacing:
  control-gap: "0.5rem"
  section-gap: "1.1rem"
  gutter: "2rem"
components:
  button-play:
    backgroundColor: "{colors.brick}"
    textColor: "{colors.on-brick}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "0.75rem 1.5rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.walnut}"
    rounded: "{rounded.pill}"
    padding: "0.36rem 0.85rem"
  button-secondary-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream-ink}"
  place-tab:
    backgroundColor: "transparent"
    textColor: "{colors.walnut}"
    rounded: "{rounded.pill}"
    padding: "0.32rem 0.8rem"
  place-tab-selected:
    backgroundColor: "{colors.crate-mustard}"
    textColor: "{colors.on-brick}"
  chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream-ink}"
    rounded: "{rounded.pill}"
    padding: "0.22rem 0.55rem"
  search-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream-ink}"
    rounded: "{rounded.pill}"
    padding: "0.45rem 0.95rem"
  format-badge:
    backgroundColor: "{colors.brick}"
    textColor: "{colors.on-brick}"
    rounded: "{rounded.pill}"
    padding: "0.15rem 0.4rem"
  modal:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream-ink}"
    rounded: "{rounded.xl}"
    width: "520px"
---

# Design System: Cratedigger

## Overview

**Creative North Star: "The Record Crate"**

Cratedigger looks like a crate of records in a dim room. The album covers are the objects: they sit in implied cardboard sleeves, lift out when you hover, and carry most of the colour on any screen. Everything around them stays out of the way: navy paper, cream ink, thin hairlines, and a faint paper grain over the whole window (`body::before`, about 2.5% fractal noise). The three sleeve colours from the app icon (brick orange, mustard and teal) are the only loud colours, and each one has a job.

Density is moderate and made for browsing: a grid of covers you can resize, sticky frosted headers, and pill-shaped controls in small type. Futura headlines give it a printed, record-label voice, and system UI type handles everything else. Motion is physical but brief. Covers spring up out of their sleeves, and state changes take 120–380ms on one shared set of durations and curves.

It is dark only and has one theme. It is not a streaming app: no stacked carousels, no algorithmic tile shelves, nothing that pushes speed-to-play over digging.

**Key Characteristics:**
- Covers are physical objects. Chrome recedes.
- Navy paper (`paper`), cream ink (`cream-ink`) and paper grain everywhere.
- Three sleeve accents, each with one job: orange acts, mustard marks where you are, teal is secondary.
- Futura for names and titles, system UI for everything else, tabular figures throughout.
- Pills for controls, near-square corners for covers.
- One motion grammar: three durations × three easings.

## Colors

The palette comes straight from the app icon: a navy tile, a cream sleeve, and an orange label with mustard and teal sleeves fanned behind it.

### Primary
- **Label Orange** (`brick`): the action colour. Play buttons, the playing-cover ring, the home button, keyboard focus outlines, search focus and kicker text. On a filled surface the text is always navy (`on-brick`), never cream.
- **Burnt Label** (`brick-deep`): fill only, for the dark end of progress-bar gradients. Never text: it reads about 3:1 on navy.
- **Label Ink** (`brick-ink`): orange as text on the navy tiles. Selected items, menu hovers, warning badges, neutral chips and counts. 4.7:1 or better on paper, surface, brick-wash and the 18% brick tint.
- **Label Lift** (`brick-lift`, halfway between `brick` and `brick-ink`): the hover fill for orange buttons and the lit top of the Play gradient. Navy text holds about 5.8:1.
- **Label Wash** (`brick-wash`): a muted plum-brown for text selection, the 4px search-focus halo and neutral chip fills.

### Secondary
- **Sleeve Mustard** (`crate-mustard`): "where you are." The selected place in the toolbar, open shelves, the home button on hover, and kickers in the Crate theme block. Navy text on fills.

### Tertiary
- **Sleeve Teal** (`crate-teal`): secondary accents. The 3px rule under artist section heads and every third format sticker.

### Neutral
- **Navy Tile** (`paper`): the window background and the base of every screen.
- **Raised Tile** (`surface`): modals, chips, inputs and hovered secondary buttons. (`inset` currently carries the same value.)
- **Deep Tile** (`surface-deep`): cover fallbacks and the inside of the implied sleeve.
- **Cream Sleeve** (`cream-ink`, token `--espresso`): primary text, 12.2:1 on paper. The token name dates from an old light palette; keep it.
- **Walnut** (`walnut`): secondary text and resting control labels, 9.2:1 on paper.
- **Faded** (`faded`, also `--whisper`): metadata, placeholders and icons, 6.1:1 on paper and 5.3:1 on surface.
- **Hairline / Hairline Strong** (`hairline`, `hairline-strong`): 1px dividers, header bottoms and control borders. The strong one is for hover.
- **Ink tints** (`--ink-tint-04` … `-16`): translucent cream overlays for the place-tab track, scrollbar thumbs and disabled fills.

### Semantic
- **ok** (`ok`, teal-green) marks include chips and **warn** (`warn`, the same value as mustard) marks exclude chips. Both use a 10% fill and a 32% border of the same hue. **err** (`err`) is for error text, toasts and the delete button, at 5.6:1 on paper and 4.9:1 on surface.

### Named Rules
**The Three Sleeves Rule.** Orange, mustard and teal are the only saturated colours in the chrome, and each keeps its job: orange acts, mustard locates, teal supports. A fourth accent colour is not allowed.

**The Navy-On-Fill Rule.** Text on any accent fill is navy (`on-brick`), never cream.

**The Lighter-On-Hover Rule.** On this dark ground, orange controls get lighter when you hover (`brick` to `brick-lift`), never darker. Orange text on a tinted fill (surface, wash, brick tints) is always `brick-ink`. Plain `brick` text is allowed only directly on paper at 0.9rem or larger, like the album page's artist link (4.9:1).

**The Covers Carry Colour Rule.** Album art is the loudest thing on screen. Chrome never competes with it through big colour fields or gradients behind the grid.

## Typography

**Display Font:** Futura (with Avenir Next, Helvetica Neue)
**Body Font:** -apple-system / SF (with Inter, system-ui)
**Label/Mono Font:** SF Mono (with ui-monospace, Menlo)

**Character:** Futura's geometric capitals read like a record label or a sleeve's spine. System UI keeps the dense metadata quiet and native. `font-variant-numeric: tabular-nums` is set at the root, so track numbers, durations and years line up everywhere.

### Hierarchy
- **Display** (Futura 700, `clamp(2.4rem, 4.5vw, 3.75rem)`, 1.05): person and entity page names.
- **Headline** (Futura 700, `clamp(1.85rem, 3.6vw, 2.8rem)`, 1.05, -0.015em): album titles on Album Detail and Now Playing. Flat cream, never a gradient.
- **Title** (Futura 600, 1.3rem, -0.01em): screen headers in the sticky bar, ellipsised at 46ch. Album-card titles also use Futura 600 at body size.
- **Name** (Futura 600, 1rem): people in the credits list. 0.92rem in the per-track panel.
- **Body** (400, 0.85–0.92rem, 1.55): summaries and bios, capped at 58ch.
- **Body small** (0.7–0.82rem): the working size for most chrome, metadata and controls.
- **Label** (700, 0.7rem, 0.16–0.18em, uppercase): kickers above screen titles, in orange (mustard in the Crate theme block).

### Named Rules
**The Futura For Names Rule.** Futura is for the names of things: albums, artists, people, screens and section heads. Controls, metadata and running text stay in system UI.

**The 0.7rem Floor Rule.** Functional text never goes below 0.7rem (11.2px). That covers years, counts, labels and badges in rails. The only exceptions are graphic stickers drawn on artwork (format stickers, critics' seals), which carry a `title` tooltip.

**The Distance Rule.** Theater mode, Now Playing and the shop display are read from across the room. Those surfaces use the display/headline sizes and never drop primary info to body-small.

## Layout

Each screen is a vertical scroller on `paper` with a 2rem side gutter (`gutter`) and children spaced by a 1.1rem flex gap (`section-gap`). The top toolbar is fixed, with an 84px left inset to clear the macOS traffic lights. Under it, each screen's `ScreenHeader` sticks to the top as a frosted bar (paper at 88%, 20px blur) that bleeds to the window edges, while its contents line up with the screen's content column through `--screen-header-max`. Space between the header and the first element is the `--screen-header-gap` variable, never scroller top padding: that padding opens a see-through strip above the sticky bar.

The library grid sizes from a cover-size slider (`--cover-size`, about 110–360px) and scales the format-badge type to match. When Now Playing is visible, a 78px bottom pad reserves its space.

Window-drag regions never change size. The toolbar has a single fixed-width drag handle and everything else is `no-drag`, because macOS caches drag rects and a resized drag region leaves buttons dead until a reload.

## Elevation & Depth

Depth comes from a hybrid: tonal layering for the chrome (paper, then surface, then frosted sticky bars) and real shadows only for objects you can pick up. Covers rest with a soft navy shadow (`0 6px 14px rgba(8,14,22,0.18)`) and lift on hover to `0 16px 32px rgba(8,14,22,0.32)` plus a hairline ring. Modals sit on a 25% navy backdrop with 4px blur and cast `0 30px 80px rgba(8,14,22,0.3)`. The Play button casts a coloured orange glow.

### Shadow Vocabulary
- **Cover rest** (`0 6px 14px rgba(var(--shadow-color), 0.18)`): every album cover at rest.
- **Cover lift** (`0 16px 32px rgba(var(--shadow-color), 0.32), 0 0 0 1px var(--hairline)`): hovered covers.
- **Playing ring** (`0 0 0 2px var(--brick), 0 16px 32px color-mix(in srgb, var(--brick) 22%, transparent)`): the cover that's playing now. The Crate block thickens it to 3px.
- **Play glow** (`0 8px 22px color-mix(in srgb, var(--brick) 28%, transparent)`): the primary Play button, rising to 40% on hover.
- **Modal** (`0 30px 80px rgba(var(--shadow-color), 0.3)`): dialogs.
- **Popover tokens** (`--shadow-sm` 0.32, `--shadow-md` 0.42, `--shadow-lg` 0.5, all `rgba(var(--shadow-color), α)`): menus, pickers, filter popovers, the update banner and small modals. The alphas run higher than a light theme's because a navy shadow on a navy ground needs weight to read.

### Named Rules
**The Only Objects Cast Shadows Rule.** Covers, the Play button and modals cast shadows. Toolbars, headers, chips and inputs are flat and separate themselves with tone and hairlines.

## Shapes

There are two shape families. Controls are pills: buttons, place tabs, chips, the search field and format stickers all use `rounded.pill`. Objects are nearly square: covers use `rounded.sm` (2px, 3px in the Crate block) and the implied sleeve behind them uses `rounded.xs`, so covers read like cardboard rather than app icons. Containers sit in between: modals at `rounded.xl` (10px) and focus outlines wrapping cards at `rounded.lg`. Components use the radius scale and never hard-code px values.

## Components

### Buttons
Tactile but quiet: only Play is loud.
- **Play (primary):** a pill with an orange gradient lit from the top (`brick-lift` to `brick`), navy 700-weight text at 0.95rem, padding 0.75rem 1.5rem and an orange glow. Hover lifts it 1px and raises the glow. Active scales it to 0.98. Disabled turns into a 4% ink-tint fill with faded text and no glow.
- **Secondary:** a transparent pill with a 1px `hairline` border, walnut text at 0.76rem and padding 0.36rem 0.85rem. Hover fills it with `surface`, turns the text cream and the border `hairline-strong`. Active scales it to 0.97.
- **Solid orange (Save, Enqueue):** a `brick` fill with navy text that lifts to `brick-lift` on hover.
- **Home:** the record label. An orange disc with navy glyph that turns mustard on hover and rotates 30°.
- **Focus:** a 2px `brick` outline with a 2–4px offset everywhere.

### Chips
- **Style:** a pill on `surface` with a 1px hairline border and 0.74rem text, split into a body and a remove segment.
- **State:** include = ok fill/border/text, exclude = warn fill/border/text, neutral = brick-wash fill, brick border and `brick-ink` text.

### Cards / Containers
- **Album card:** no container. Cover, then Futura title, then faded metadata, with a 0.4rem gap. The cover sits in an implied sleeve (`::before`, slightly larger, a cream-to-deep-navy gradient at the open top). On hover the cover springs up 9% (`--ease-spring`) while the sleeve stays put. The playing cover gets the orange ring and three bouncing bars bottom-left.
- **Modal:** `surface`, 1px hairline, `rounded.xl`, a 520px max width and the modal shadow.

### Inputs / Fields
- **Search:** a pill on `inset`/`surface` with a 1px hairline border, a faded leading icon and 0.9rem cream text, max width 440px.
- **Focus:** the border turns `brick` with a 4px `brick-wash` halo.

### Navigation
- **Toolbar:** a frosted paper bar (92%, 20px blur) with a hairline bottom. In the Crate theme the hairline is replaced by a 3px tape stripe of the three sleeves, a third each.
- **Places:** a segmented cluster of pill tabs on an `ink-tint-06` track. Resting tabs are walnut, hover turns them cream, and the selected tab is a mustard fill with navy 600-weight text.

### Credits (signature)
The credit graph is the reason the app exists, so the credits get typographic weight, not chips.
- **By person (default):** one row per person in a two-column grid (name column 11–15rem, then roles). The name is a Futura 600 text link (`name`) that turns `brick-ink` with an underline on hover. Next to it, "on N of yours" in `crate-teal` at 0.7rem counts that person's other records in the library. Roles are walnut at 0.85rem, with the track scope (`· 7 tracks`, or up to three titles) in faded. The album artist leads, set off by a `hairline` rule. Players are ordered by how many of your other records they're on, then by tracks on this one. The top 8 show, and "all credits (N)" opens the rest.
- **By role:** the older role wall (uppercase role label, pill chips per person) behind a small segmented "by person / by role" toggle. The choice persists.
- **Per track:** a track title with MusicBrainz credits is a button with a faded "N players" cue after it (teal on hover). It opens a tinted panel under the row listing who played on that song, writers and singers first.

### Format Sticker (signature)
A pill sticker in the cover's top-right corner. Its size scales with `--cover-size` (`clamp(0.55rem, cover × 0.045, 0.7rem)`), it's set in 700 weight, and it sits on fixed colours because it overlays artwork. Going down the grid it cycles orange, mustard, teal (`nth-child(3n…)`), like price stickers on a crate.

## Do's and Don'ts

### Do:
- **Do** use tokens from `app.css` for every colour, radius, duration and easing. It's the only copy, and `lib/themes.ts` reads it back for the window background and the kiosk.
- **Do** use the motion grammar: `--dur-instant` 120ms for hover, `--dur-base` 220ms for panels, `--dur-slow` 380ms for screen morphs and cover crossfades; `--ease-out` for entrances, `--ease-in-out` for reversible changes, `--ease-spring` only for crate-flip and sleeve-peek motions. Reduced motion collapses them to 1ms.
- **Do** keep text on accent fills navy (`on-brick`).
- **Do** keep primary info at headline/display size on theater mode, Now Playing and the shop display.
- **Do** keep tabular figures for anything numeric.

### Don't:
- **Don't** make it look like a streaming app: no stacked carousels, algorithmic tile shelves or speed-to-play hero banners.
- **Don't** add a light mode or a second theme. Crate is the only theme (the other ten were retired in 2026-09).
- **Don't** add a fourth accent colour, or use mustard or teal for primary actions.
- **Don't** put gradients on headline text. The album title is flat cream.
- **Don't** make a sticky header or any resizing element a window-drag region.
- **Don't** set functional text below 0.7rem.
- **Don't** use `brick-deep` as text, or darken an orange control on hover. Orange text is `brick-ink` and hover fills are `brick-lift`.
- **Don't** tint shadows cream. Depth is navy shadow ink (`--shadow-color`).
