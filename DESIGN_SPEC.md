# VIKYFLIX — "AURORA" DESIGN SPEC (v1)

Every screen must read as one designed product. This spec is binding for all
implementations. Do not invent a second visual language.

## 1. Identity

A layered-cinema look: near-black indigo canvas, hairline surfaces with a
single top light-edge, one signature ember gradient used **only** for primary
actions and active states, and generous negative space. Content is the hero;
the chrome recedes.

## 2. Tokens (already live in `src/styles/aurora.css`)

| Token | Use |
|---|---|
| `--bg-deep / --bg-base / --bg-surface / --bg-card / --bg-elevated` | Canvas → raised surface ladder (use in order, never skip) |
| `--bg-glass / --bg-glass-strong` | Floating bars, menus, modals |
| `--border-subtle / --border-strong` | Hairlines |
| `--edge-light` | The 1px inner top highlight on cards |
| `--primary-gradient` | Play buttons, active tab, focus — nowhere else |
| `--accent-gold / --accent-amber / --accent-cyan / --accent-violet` | Semantic accents (quality, audio, series) |
| `--text-main / --text-muted / --text-dim` | Type hierarchy |
| `--radius-pill / --radius-sm / --radius-md / --radius-lg / --radius-xl` | 999 / 8 / 12 / 18 / 24 |
| `--shadow-card / --shadow-raised / --shadow-modal / --shadow-glow` | Elevation |
| `--ease-out / --ease-spring` | Motion curves (0.16,1,0.3,1) / (0.34,1.4,0.64,1) |
| `--dur-fast / --dur-base / --dur-slow` | 160 / 280 / 460ms |
| `--fs-display / --fs-title / --fs-heading / --fs-body / --fs-meta / --fs-micro` | Fluid type scale |
| `--ratio-poster / --ratio-landscape` | 2/3 and 16/9 artwork boxes |

## 3. Shared primitives (use these, do not re-invent)

- `<Poster item={...} alt={...} ratio="2 / 3" className imgClassName />`
  (`src/components/Poster.jsx`) — reserves the box, shows a shimmer, fades the
  artwork in, and renders a designed fallback with tap-to-retry when a URL
  fails. **Never render a raw `<img>` for content artwork.**
- `.vf-btn.primary | .ghost | .quiet` — buttons (44px min touch target).
- `.vf-chip | .vf-chip.accent | .gold | .violet` — metadata pills.
- `.vf-surface` — raised panel.
- `.vf-enter`, `.vf-stagger` — entrance motion; `.vf-stagger` staggers direct
  children by 40ms.

## 4. Rules

1. **Type**: one display face weight (800–900) for titles, 600–700 for labels,
   400–500 for body. Titles use `--tracking-tight`. No text below 11px.
2. **Metadata**: year · genre · runtime on ONE line, ellipsis, never wrapped.
3. **Badges**: maximum two per artwork (rating + one type badge). No "WEB
   SERIES"/"ONLINE" noise on cards; type is communicated by layout, not text.
4. **Motion**: entrances only on first paint of a screen; hover = lift +
   artwork zoom (2–4% scale, 280ms). Nothing loops, nothing bounces.
5. **Accessibility**: visible `:focus-visible` ring, 44px touch targets,
   `aria-label` on icon-only buttons, `prefers-reduced-motion` respected
   (global rule in aurora.css).
6. **Empty/loading/error states** are designed, not blank: skeletons for
   artwork, a short human sentence, and one clear recovery action.
7. **Layout**: content max-width 1680px, page padding 16px (phone) / 32px
   (tablet) / 40px (desktop). Vertical rhythm in 8px steps.

## 5. Per-screen direction

### Home
- **Opening**: one dominant hero — full-bleed artwork, heavy bottom scrim,
  content anchored bottom-left, title in `--fs-display`. A slim progress rail
  (not dots) shows position; swipe works on touch.
- **Shelves**: each row is a titled band with a "See all" affordance and
  horizontally scrolling artwork. The first row may be an **editorial
  panorama** (one large landscape tile + 4 small ones) instead of a flat row.
- Rows mix movies and series — one library, no separate series section.

### Catalog (Movies / Web Series)
- Filter hub: compact search pill + filter chips + sort. Dropdowns anchor
  under the button they belong to (never a detached sheet, never a corner
  panel).
- Grid: posters 2:3, generous 14–18px gutters, title 1 line + meta 1 line.
  Cards lift on hover, artwork zooms 3%.
- Infinite scroll — no "Load More" button; a slim spinner marks the tail.

### Detail pages
- Hero: artwork, title, 2-line synopsis, one primary action (Play), one
  secondary (My List), and a compact metadata line. No wall of pills.
- Episodes: numbers as a dense grid of tiles, season switch as a dropdown
  showing episode counts.
- "More like this": small poster cards with reserved boxes.

### Player
- Controls auto-hide; tap toggles. Bottom bar: progress, transport, then a
  single row of icon actions (audio, quality, speed, subtitles, view mode).
- Only ONE quality/size indicator on screen at a time (top chip only).
- No language annotation in the title.

### My List / Watchlist
- Same card language as the catalog; empty state explains the one action.

## 6. Engineering rules

- Stay in React + Vite + Capacitor. No new dependencies.
- Do not change API contracts, endpoints, or the shape of catalog data.
- Keep every existing feature working (play, watchlist, search, sync, theme,
  admin monitor, live search, filters, sort, infinite scroll, seasons/episodes,
  audio editions, subtitles, quality selection, resume).
- New CSS goes in a NEW file per area (`src/styles/<area>.css`) imported from
  the component that owns it — do not append to `src/App.css` (it is huge and
  shared) and do not touch `src/styles/aurora.css` (owned by the lead).
- Prefix new class names per area, e.g. `.cat-`, `.det-`, `.ply-`, `.home-`.
- Run `npm run build` in `E:\projects\My Streaming Services\web` and make sure
  it succeeds before reporting done.
