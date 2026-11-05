# VIKYFLIX — "Aurora" redesign notes

A structural redesign of the VikyFlix Android app (React + Vite + Capacitor),
not a repaint. This file records what changed, where, and why.

## 1. The identity

**Aurora** — a layered-cinema look. A near-black indigo canvas, hairline
surfaces with a single top light-edge, and ONE signature ember gradient
(`--primary-gradient`) reserved for primary actions and active states. Nothing
else competes for attention: the artwork does.

Tokens live in `src/styles/aurora.css` and are the only source of colour,
type, spacing, radius, elevation and motion. Legacy rules in `src/App.css`
were kept for untouched surfaces, but every new screen uses the token layer.

## 2. Structure that changed

| Before | After |
|---|---|
| Home shelves built from the local-files pool only | Home reads the **merged catalog** (local + online movies + series) — the feed is one library |
| A standalone "Binge-Worthy Web Series" section | Removed; series are folded into the themed rows (7 movies + 3 series per row) |
| "Looking for something specific?" discovery banner | Removed — redundant once the catalog is merged |
| Genres / Languages tabs rendering the stale local pool | Both now render the merged catalog |
| Series detail "More Web Series" rail fed by the local pool (1 item, broken poster) | Fed by the merged pool, artwork via the shared `<Poster>` |
| Movies catalog with a "Load More" button | Infinite auto-load (IntersectionObserver, 36/chunk) with a slim tail spinner |
| Movies catalog with Quality + Decade dropdowns | Removed (per user request); search + Genres + Languages + Sort remain |
| Web Series page with **no** filter/sort UI | Same shared control hub as the Movies page |
| Language dropdown opening as a detached bottom sheet | Dropdowns anchor directly under the button they belong to (measured, fixed) |
| Sort default "Recently Added" (meaningless online) | "Latest Releases" — 2026 → down by release year, both pages |
| Raw `<img>` artwork in 14 places | One shared `<Poster>` surface everywhere |
| Silent image failures, broken-image icons | Designed fallback + tap-to-retry + server-side generated artwork |

## 3. The poster system (the real defect)

Root cause found during the audit: every poster surface hand-rolled its own
`<img>`. Consequences:

* a title with no artwork rendered `<img src="">` → a broken-image icon;
* a failed CDN request had no recovery path;
* images were not size-reserved → layout shift;
* **cached images that finished decoding before React attached `onLoad` never
  fired the event, so the artwork stayed permanently invisible behind the
  skeleton** (reproduced live in the browser, fixed in `Poster.jsx`).

The fix is systemic:

* `src/components/Poster.jsx` — reserved 2:3 / 16:9 box, shimmer skeleton,
  fade-in on decode, designed fallback (initial + title) with tap-to-retry,
  URL-change resets so artwork can never stick to the wrong card, and
  `console.warn` logging of every failure.
* `server/index.js` — `/api/moviebox/poster/:id` now returns a **generated
  SVG poster** (gradient, film glyph, initial, title) instead of 404/502 when
  upstream artwork is missing, so the client always receives a valid image.
* `utils/mediaUtils.js` — protocol-relative CDN URLs (`//host/…`) are pinned to
  https, and relative paths are resolved against the API base.

## 4. Motion

One curve family: `--ease-out` (0.16, 1, 0.3, 1) for entrances, `--ease-spring`
for tactile press feedback. Entrances are staggered 40 ms per child
(`.vf-stagger`). The hero drifts very slowly (Ken Burns, 20 s) and only when
`prefers-reduced-motion: no-preference`. A global reduced-motion rule
neutralises decorative movement while keeping state changes legible.

## 5. Accessibility

44 px minimum touch targets, visible `:focus-visible` rings, `aria-label` on
icon-only controls, keyboard-operable search (↑ ↓ ⏎ Esc, Ctrl/Cmd-K),
`role="option"`/`aria-selected` on search results, and contrast-checked text
on the dark canvas.

## 6. Files

**New:** `src/styles/aurora.css` (design system), `src/styles/shell.css`
(nav + dock + splash), `src/styles/search.css`, `src/styles/home.css`,
`src/styles/catalog.css`, `src/styles/details.css`, `src/styles/player.css`,
`src/components/Poster.jsx`, `src/components/CatalogFilterHub.jsx`.

**Rewritten:** `Navbar.jsx`, `BottomNav.jsx`, `SearchModal.jsx`, `MovieCard.jsx`,
`HeroBillboard.jsx`, `ShelfRow.jsx`, `EditorialPanorama.jsx`, `CuratorBento.jsx`,
`AllMoviesView.jsx`, `WebSeriesView.jsx`, `SeriesDetailsView.jsx`,
`DetailModal.jsx`, `VideoPlayer.jsx`.

**Deleted (dead code):** `src/components/MovieBoxView.jsx`,
`src/components/SeriesDetailModal.jsx`, `src/player.css` (orphan; the live
player styles were in `App.css`).

## 7. Known limitations

* The catalog only ships portrait artwork, so the hero uses the poster as an
  atmospheric backdrop (blurred, darkened) rather than true landscape key art.
  A landscape endpoint would be the next step.
* There is no account/profile surface in this app — "My List" plus the
  theme/monitor controls are the entire personalisation area.
* Light theme is tokenised but the darkest surfaces (hero scrims, player
  chrome) are tuned for the dark canvas.
