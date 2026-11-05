# Designer — UI/UX craft playbook ("Aurora")

**Purpose.** Implement the one binding visual language; never invent a second. Source of intent is the owner's original design brief, archived in `backups/legacy-skills-2026-11-05/Application Designer.md.txt` (award-grade, multi-platform, one change reflected on website + Android + TV) — this file keeps the ambition and replaces persona with procedure. `AGENTS.md` golden rules apply: the design spec is binding, artwork only through `<Poster>`, hosts only via `getApiBase()`.

## 1 · What is binding, and the cascade you edit

- Load order in `web/src/main.jsx`: `index.css` → `App.css` (+ per-component CSS) → `aurora.css` → `premium.css` (last, wins).
- `aurora.css` is the ONLY token source. `App.css` redeclares the same token names with older values (`--primary: #ff2a55`, `--radius-lg: 14px`); they lose. Never copy a value out of `App.css`.
- `premium.css` is a legacy cinematic skin (`--pm-*`, `--pm-accent: #e8102e`, Sora display / Inter body) that re-tints primitives with `!important`. Treat it as an overlay, not a second system; new work uses Aurora tokens.
- `web/DESIGN_SPEC.md` is binding intent. Where it names something that no longer exists (the "editorial panorama" — no `EditorialPanorama.jsx`), map the intent to the live block (`CuratorBento`) and record the divergence; never invent a component.
- New CSS goes in a NEW `src/styles/<area>.css`, imported by its component, classes prefixed per area (`.cat-`, `.det-`, `.ply-`, `.home-`). Never append to `App.css`; never edit `aurora.css` (lead-owned) without the lead.
- Themes: `document.documentElement[data-theme="light|dark"]` + `body.theme-*` (set in `App.jsx`, stored as `vickyflix_theme`). Hero scrims, detail hero and player chrome stay dark in both themes by design.
- One change ships three times (web, phone, TV); review it through all three lenses in the same pass, not as later ports.

### Style-layer map (pick the owner file before writing CSS)

| File | Owns |
|---|---|
| `src/index.css` | reset, body/root scroll behaviour, `100dvh` app frame |
| `src/App.css` | legacy global: `.cine-*`, `.all-movies-*`, `.top10-*`, `.continue-*`, legacy player, TV-mode block, `.vf-loader*` |
| `src/styles/aurora.css` | tokens + primitives (`.vf-btn`, `.vf-chip`, `.vf-surface`, `.vf-enter`, `.vf-stagger`, `.vf-poster*`, `.vf-skeleton`, reduced motion) |
| `src/styles/premium.css` | last-loaded cinematic overlay (`--pm-*`); only touch it for the premium layer itself |
| `src/styles/shell.css` | top nav, mobile dock, splash, connectivity banner, section heads |
| `src/styles/home.css` | hero billboard, shelf rows, bento, genre strip |
| `src/styles/catalog.css` | filter hub, catalog grid/list, breadcrumbs, empty state, infinite tail |
| `src/styles/details.css` | both detail screens, episodes, recommendations, update card (imported by `AppUpdateModal`) |
| `src/styles/search.css` | command-palette search |
| `src/styles/player.css` | player surface (scoped under `.pro-player-root`, `--ply-*` locals) |
| `src/styles/logo.css` | brand mark/wordmark (navbar, splash, intro) |
| `src/styles/intro.css` | dormant `CinematicIntro` only (not mounted; the live intro is inline in `index.html`) |

## 2 · Screen inventory (what exists, who owns it)

| Screen | Entry / owner | Design contract |
|---|---|---|
| Launch intro | `#mf-intro` in `web/index.html`, app-only | The Premiere: lamp → streak → clap-M → wordmark; ~2.95 s minimum, held until `movieflix-ready` (8 s cap), `aria-hidden`, inline reduced-motion rule; the website removes the node. `CinematicIntro.jsx`/`intro.css` exist but are NOT mounted. |
| Home | tab `home` → `HeroBillboard`, `.vf-genre-strip`, `ShelfRow`, `CuratorBento` | One dominant hero (5 curated films, 8 s auto-advance, pause on hover/focus/touch, ≤8 rail stops, 48 px swipe), then shelves: Continue Watching, New Releases (7 days), Top 10, Curators' Picks, Action, South Cinema, Sci-Fi, Thrillers; ≤18 items per mixed row. |
| Movies catalog | tab `movies` → `AllMoviesView` + `CatalogFilterHub` | "Sections" view by default; 8 sort options; genre/language filters; grid + list modes; 36-item chunks on IntersectionObserver (no Load More button); breadcrumb and empty state. |
| Web Series | tab `series` → `WebSeriesView` | Same hub with 7 sort options (incl. Most Episodes); sections + grid only; `cat-card--series` meta carries `S1 · 12 Eps`. |
| Genres / Languages | tabs `genres`, `languages` | 9 `.universe-tile-card` and 7 `.lang-hub-card` directory tiles + preview shelves; tiles are composition, labels only. |
| My List | tab `watchlist` | `.cine-catalog-grid` of `MovieCard`; designed empty state with one action. |
| Search | `Ctrl/⌘ K` or navbar pill → `SearchModal` | Command palette: 160 ms debounce, ≤40 results, ↑↓/Enter/Esc, quick-pick chips, `role="dialog" aria-modal`, listbox/option semantics. |
| Details — movie | `MovieDetailsView` | Cinematic 16:9 backdrop + 2:3 poster, one meta strip, Play (or `Resume · N% watched`) + Add to List, audio editions, synopsis, More Like This (10). |
| Details — series | `SeriesDetailsView` | Same hero system; episode explorer (Cards/Grid), season dropdown when >1 season, quick season pills for 2–6, 12 skeletons while loading, retry + empty states, More Web Series (12). |
| Player | `VideoPlayer` overlay | Immersive dark, landscape, chrome auto-hides (~3.5 s; 4 s after a tap), ONE quality chip, audio/quality/speed/subtitles/view-mode menus, buffering + error overlay (40 s timeout), online-subtitle modal. |
| Filter hub | inside both catalog pages | Chips + dropdowns measured and anchored under their button, active-filter row with one Reset, segmented layout control. |
| Status surfaces | `.vf-net-banner`, `.catalog-update-toast`, `AppUpdateModal` | Connectivity banner `role="status"`; update card is a designed dialog, never a bare alert. |

## 3 · Per-screen rules (the non-obvious ones)

- **Home** — hero copy anchors bottom; on phones the poster card and synopsis are hidden and the copy centres (`.home-hero__cluster` column) — don't undo without the spec. Shelf head = icon + title + count + "See all"; arrows are pointer-only (`@media (hover:none)` hides them); rails use the masked edge dissolve (`--home-gutter` 16 px, 40 px ≥769 px). Continue Watching = 16:9 art + progress fill + RESUME; Top 10 = number badge + rank pill.
- **Catalog** — filter dropdowns anchor under the button that owns them (phone menus are measured `position: fixed` inside `CatalogFilterHub`), never a detached sheet or corner panel. Cards: 2:3 art, 14–18 px gutters, 1-line title + 1-line meta, hover lift + 3% art zoom. The tail shows skeleton posters + "Loading more…", never a button.
- **Details** — exactly one primary and one secondary action; no wall of pills. Rating / year / genre / runtime share one strip with `•`. Keep the episode Cards/Grid toggle and season control on the right of the section head; skeletons use the real episode-tile height (`det-ep-skel`, 76 / 46 px).
- **Player** — the video is the screen: minimal chrome, auto-hidden, menus above the action row (`.floating-menu` must never clip — `overflow: visible`). Show `S1 · E2` in the top bar; never put a language annotation in the title. Transport stays 44 px+ even when the row wraps.
- **Search** — full-screen on phones (`.sr-panel` loses radius/border), overlay on desktop; the active row must be unmistakable, Esc or outside click closes, focus lands in `.sr-input` after opening.
- **Intro** — app-only and short; never gate the app longer than the ready signal allows. The only animation allowed over the app at launch; never replayable from a screen unless the replay handler actually exists (see §15).

## 4 · Token reference (values are `aurora.css` dark; every token has a light twin)

| Family | Exact tokens and values |
|---|---|
| Canvas | `--bg-deep #06070c` · `--bg-base #0a0c14` · `--bg-surface #10131d` · `--bg-card #151927` · `--bg-elevated #1c2131` |
| Glass | `--bg-glass rgba(10,12,20,.78)` · `--bg-glass-strong rgba(6,7,12,.94)` |
| Hairlines | `--border-subtle rgba(255,255,255,.07)` · `--border-strong rgba(255,255,255,.14)` · `--border-glow rgba(255,77,109,.4)` · `--edge-light inset 0 1px 0 rgba(255,255,255,.06)` |
| Ember (primary only) | `--primary #ff4d6d` · `--primary-hover #ff6b85` · `--primary-gradient linear-gradient(135deg,#ff4d6d 0%,#ff7a45 48%,#ffc15e 100%)` · `--primary-glow rgba(255,77,109,.28)` · `--primary-glow-strong rgba(255,77,109,.55)` |
| Accents | `--accent-gold #ffc15e` · `--accent-amber #ff9f45` · `--accent-red #ff4d6d` · `--accent-cyan #45e0ff` · `--accent-violet #a78bfa` · `--moviebox-gradient linear-gradient(135deg,#ff4d6d 0%,#a78bfa 55%,#45e0ff 100%)` |
| Text | `--text-main #ffffff` · `--text-muted #aab3c8` · `--text-dim #6c7789` |
| Type scale | `--fs-display clamp(1.9rem,5.2vw,3.25rem)` · `--fs-title clamp(1.3rem,3vw,1.95rem)` · `--fs-heading clamp(1.05rem,2.2vw,1.35rem)` · `--fs-body .95rem` · `--fs-meta .8rem` · `--fs-micro .7rem` · `--tracking-tight -.02em` · `--tracking-wide .08em` |
| Radii | `--radius-xl 24px` · `--radius-lg 18px` · `--radius-md 12px` · `--radius-sm 8px` · `--radius-pill 999px` |
| Elevation | `--shadow-card 0 1px 2px rgba(0,0,0,.45), 0 10px 30px rgba(0,0,0,.4)` · `--shadow-raised 0 2px 6px rgba(0,0,0,.5), 0 18px 46px rgba(0,0,0,.5)` · `--shadow-glow 0 10px 40px rgba(255,77,109,.25)` · `--shadow-modal 0 30px 90px rgba(0,0,0,.9)` |
| Motion | `--ease-out cubic-bezier(.16,1,.3,1)` · `--ease-spring cubic-bezier(.34,1.4,.64,1)` · `--dur-fast 160ms` · `--dur-base 280ms` · `--dur-slow 460ms` |
| Media | `--ratio-poster 2 / 3` · `--ratio-landscape 16 / 9` |

- Surfaces climb `deep → base → surface → card → elevated`, never skipping; the ember gradient only for a primary action, active state or focus; one light edge per surface (`--edge-light`); no raw hex outside this list.
- Light theme re-tints every token (`--bg-deep #f4f5f9`, `--primary #e11d48`, `--text-main #0d1220`) — test it, don't assume it.
- Player-only locals (`--ply-ink`, `--ply-ink-muted`, `--ply-ink-dim`, `--ply-surface`, `--ply-surface-strong`, `--ply-line`, `--ply-glass`, `--ply-scrim`, `--ply-scrim-soft`) are achromatic and scoped under `.pro-player-root`; never leak them outside the player.

## 5 · Primitives, components and their owners

- **`<Poster item src alt ratio className imgClassName eager onClick />`** (`components/Poster.jsx`; styles `.vf-poster`, `.vf-poster-img`, `.vf-poster-skeleton`, `.vf-poster-fallback`) — ALL content artwork: reserves the ratio, shimmers, fades in on decode, designed initial+title fallback with tap-to-retry, resets on URL change. `imgClassName` is where per-screen zoom/object-position attaches; `eager` only for above-the-fold hero/detail art. Never a raw `<img>` for content.
- **`.vf-btn`** — `.primary` (one per view decision, ember), `.ghost` (secondary), `.quiet` (tertiary/inline, 40 px). `.secondary` is not an Aurora variant (only `premium.css` mentions it) — do not use it.
- **`.vf-chip`** + `.accent`/`.gold`/`.violet` — metadata pills, max two on/around artwork. **`.vf-surface`** — raised panel (defined, no consumer yet). **`.vf-enter`** — one-shot entrance on a screen/section root; **`.vf-stagger`** — 40 ms per direct child, 320 ms cap after the 8th; first paint only.
- **Card families** — `.cine-card` (home rails via `MovieCard`), `.cat-card` / `.cat-card--series` (catalog), `.continue-card`, `.top10-poster-card` (home specials), `.home-bento__*` (editorial). Never add a third grid-card family.
- **Shell** — `.vf-nav` (fixed, 60 px → 56 px scrolled), `.vf-dock` (mobile only, safe-area bottom), `.vf-splash`, `.vf-net-banner`, `.vf-section-head`.
- **Loading family** — `.vf-skeleton`, `.vf-skeleton-grid`, `.vf-poster-skeleton`, `.vf-loader`/`.vf-loader-gem`/`.vf-loader-text`, `.det-ep-skel`, `.cat-tail-spinner`.
- **Ownership map** — shell: `Navbar`, `BottomNav`, `App.jsx`; home: `HeroBillboard`, `ShelfRow`, `MovieCard`, `CuratorBento`; catalog: `AllMoviesView`, `WebSeriesView`, `CatalogFilterHub`; details: `MovieDetailsView`, `SeriesDetailsView`; search: `SearchModal`; player: `VideoPlayer`; shared: `Poster`, `VikyFlixLogo`, `AppUpdateModal`; dormant: `CinematicIntro`.

## 6 · State design (all four, every screen you touch)

- **Loading** — match final geometry with skeletons of the real aspect ratio; never a layout shift, never a blank page, never a spinner-only screen. Live: `<Poster>` shimmer, `.vf-skeleton-grid` + `.vf-loader-text` at the catalog tail, `.det-ep-skel` for episodes, `.player-buffering` for streams.
- **Empty** — one human sentence + one recovery action. Live: `.cat-empty` (`.cat-empty-icon/title/text/action`), `.all-movies-empty`, `.sr-empty`, `.det-state`, `.ply-menu-empty`, My List empty state.
- **Error** — say what failed in user language and offer one retry. Live: `.det-state` + `.vf-btn.quiet` "Retry Loading", `.player-error-card` (retry/close), boot-error block with "Retry Connection", `ErrorBoundary` in `main.jsx`. Never ship a button whose handler does not exist.
- **Offline** — never blank; state what still works. `.vf-net-banner.is-offline` ("You're offline — showing what's already loaded", `role="status"`) and `.is-online` ("Back online"); the boot cache (localStorage + IndexedDB) keeps the last synced catalog visible.
- **Copy** — calm, short, no codes in the user's face, retry is a verb; one exclamation mark only where the app already speaks that way ("✨ N new titles added!").

## 7 · Motion rules

- Entrances only on first paint of a screen/section, token durations, `--ease-out`; `.vf-enter` or `.vf-stagger` — never on scroll into view, never on filter change.
- Hover = lift (≤6 px) + 2–4% artwork zoom in ≤280 ms; touch devices have no hover state (`@media (hover:none)`); nothing expands layout bounds.
- Menus may scale+translate in (`ply-menu-in` / `ply-menu-top-in`, 160–280 ms); that is chrome, not decoration.
- Hero has exactly one drift (Ken Burns) and one rail fill, both motion-gated and paused while the user interacts; `home-hero--static` is the reduced-motion state.
- Loops are reserved for the brand mark (logo sparkle, wordmark sheen, popcorn tilt). Cards, shelves, banners and buttons never loop and never bounce. Press feedback: `.vf-btn:active` scale .97, icon buttons .93–.94, `--dur-fast`.
- `prefers-reduced-motion: reduce` is honoured globally in `aurora.css` plus per-area blocks (shell, premium, player) and the inline intro rule. Any new decorative animation must be gated by `@media (prefers-reduced-motion: no-preference)`; state changes stay legible.

## 8 · Typography, metadata, badges

- Faces: Sora for display/titles, Inter for body/UI (`--pm-font-display/body` set in `premium.css`; self-hosted in `web/public/fonts`, `font-display: swap`). One family pair, no third font.
- Weights: 800–900 display/title, 700 card titles/buttons/labels, 400–500 body. The self-hosted variable faces declare 400–800, so CSS `font-weight: 900` clamps to 800 — spec "800–900" reads as 800 in practice.
- Sizes only from `--fs-*`; titles use `--tracking-tight`; uppercase eyebrows use `--tracking-wide` or 0.12–0.24em. The 11 px floor is content text; measured chrome debt below it (dock badge .58 rem, nav count .6 rem, rank badge .62 rem, dock label .66 rem) is not a licence to go smaller.
- Metadata = ONE line, ellipsis, never wrapped: `year · genre · runtime` (`.home-hero__meta`), `year · genre` (cards), `S1 · 12 Eps` (series). The codebase mixes ` · ` and ` • `; standardise on ` · ` when you touch a line, never a third.
- Badges: max two per artwork. Allowed: rating (`.cine-card-rating`, `.cat-card-badge`) and rank (`.cat-card-rank-badge`, `.top10-num-badge`, `.top10-pill-rank`). Forbidden: "WEB SERIES"/"ONLINE"/source tags on art — type is communicated by layout and route. Player: exactly one quality chip (`.top-quality-chip`); no language in the title. Titles: one line on desktop cards, two-line clamp on phones (premium mobile pass), never crop mid-glyph; poster fallback clamps two lines (`.vf-poster-fallback-title`).

## 9 · Accessibility

- Focus: global `:focus-visible` ring in `aurora.css` (2 px `--primary`, offset 2), re-tinted by `premium.css`, replaced in `tv-mode` (3 px `#e50914`, card `scale(1.07)`). Never remove an outline and never rely on hover alone.
- Targets: 44 px minimum on primary/touch paths (`.vf-btn`, player controls, dock ≥52 px, catalog menus 44 px on phones). 38–40 px desktop chrome (nav icons, catalog chips) is measured debt — do not go smaller, and ensure phone/TV reach 44.
- Labels: every icon-only control needs `aria-label`; toggles `aria-pressed`; nav `aria-current="page"`; rails/tabs `aria-selected` + `role="tab"`; modals `role="dialog" aria-modal="true"`; live regions (`role="status"`, `aria-live`) for splash, tail and connectivity; `<Poster>` fallback is `role="img"` with the title.
- Keyboard: full mouse-free path — Tab order sane, `Ctrl/⌘ K` opens search, Esc closes, ↑↓ moves results, Enter activates. Div-cards use `role="button" tabIndex={0}` + Enter/Space (`.cat-card`, `.cine-card`, `.top10-poster-card`).
- Contrast and calm: `--text-main` on dark surfaces; `--text-dim` only for non-essential chrome; chips carry dark ink on ember, never white; no strobing, no infinite shimmer on large surfaces (also a TV-GPU requirement).

## 10 · Responsive rules (the values that actually ship)

- Content max width 1680 px (`cat-catalog`, `det-shell`, `vf-nav-inner`, hero rail); `.cine-main-viewport` allows 1920 px but 1680 px is the design box.
- Padding 16 px base → 32 px ≥769 px → 40 px ≥1200 px (catalog, details, nav at 768/1200); vertical rhythm in 8 px steps; section gaps 16 / 24 px.
- Catalog grid columns: 3 → 4 @480 → 5 @768 → 6 @1024 → 7 @1300 (18 px gap) → 8 @1600; gutters 14/16 px. Series grid stays 3 columns with a 12 px gap.
- Shelves: card width 120 px (155 px ≥768), `--home-gutter` 16/40 px, masked edge dissolve; phone hero max-height 72 vh, min-height 480 px.
- ≤768 px: filter hub becomes a 2×2 full-width grid, breadcrumbs stack left-aligned, nav labels 12 px, hero poster + synopsis hidden, search full-screen. ≥769 px: hover affordances, "See all" + arrow rails, detail hero poster and copy side by side.
- Test 390 / 768 / 1440 px (docs/verification.md) plus the 480 / 1024 / 1300 / 1600 grid steps and one landscape phone; keep `env(safe-area-inset-*)` wherever it already exists (dock bottom, player top/bottom/HUDs, detail sticky header, intro footer).

## 11 · Android and TV adaptation

- One build, three products: `vikyflix.uk` (web), `uk.vikyflix.app` (phone), `uk.vikyflix.tv` (TV), plus the LG webOS artifact. Review every change through all three lenses; do not fork a screen per platform.
- Capacitor shell: status bar hidden app-wide (`StatusBar.hide()` in `App.jsx`, `overlaysWebView:false`, DARK style); player goes immersive landscape (`enterImmersive` + `ScreenOrientation.lock('landscape')`) and restores on close.
- TV detection: `IS_TV` in `web/src/tv.js` (`?tv=1`, `MovieFlixTV` UA, TV user-agents); it adds `html.tv-mode`.
- Remote focus: the `FOCUSABLE` selector list (buttons, inputs, `[tabindex="0"]`, `.cine-card`, `.continue-card`, `.universe-tile-card`, `.lang-hub-card`, `.vf-nav-link`, `.menu-option`, …). A new interactive element must be a `<button>`, carry `tabindex="0"`, or be added to that list — otherwise the remote cannot reach it. No dead ends: every overlay must be escapable with Back.
- Spatial navigation: arrows pick the nearest element in that direction, boot focus after 1.4 s, Enter/Space clicks div-cards, the page scrolls ~38% of the viewport at row edges, held keys are rate-limited (90 ms), and focus is revealed clear of 90 px top / 110 px bottom chrome.
- TV styling: `tv-mode` ring 3 px + card scale; `backdrop-filter` is disabled and infinite shimmer stopped automatically, cards use `content-visibility:auto`. Design TV states without blur/glass and without subtle opacity shifts — they die at 10 feet.
- Overscan: there is no overscan token. Keep critical text/controls ≥24 px from the screen edge, never put the only action in a corner, and verify on a real TV.
- Hardware Back order in `App.jsx`: player → movie details → series details → search → `consumeBack()` internal section → home → exit. A new overlay joins this chain via `useBackHandler` and returns `true` when it consumes Back. The search modal owns its own arrows/Enter and spatial navigation deliberately ignores it (`.sr-panel` guard).

## 12 · Correct vs incorrect (grounded in the real code)

- **Artwork** — ❌ `<img className="cat-card-img" src={movie.poster} alt={title} />` → ✅ `<Poster item={movie} src={getMediaPoster(movie)} alt={title} className="cat-card-poster" imgClassName="cat-card-img" ratio="2 / 3" />`
- **Colour** — ❌ `style={{ color: '#ff2a55' }}` (the legacy `App.css` `--primary`) → ✅ `color: var(--primary)`; better, a class in the area stylesheet.
- **New surface** — ❌ `.movies-panel { background:#12151f; border:1px solid #2a2f42; border-radius:14px }` → ✅ `className="vf-surface"` (or `var(--bg-card)` / `var(--border-subtle)` / `var(--radius-lg)` if a variant is justified).
- **Motion** — ❌ `.cat-card { animation: float 2s infinite; }` → ✅ `.vf-enter` on the section root, `.vf-stagger` on a short fixed list, hover only via `transform`.
- **Badges** — ❌ `<span className="vf-chip accent">WEB SERIES</span>` over the art → ✅ no type badge; the route/layout says it, and rating is the only artwork badge.
- **Hover-only** — ❌ `<div className="card" onClick={play}>` with the play button only on hover → ✅ the `.cat-card` pattern: `role="button" tabIndex={0}` + Enter/Space handler, action visible on touch.
- **Metadata** — ❌ `{year} / {genre} / {runtime}` wrapped over three lines → ✅ one `meta` string with `white-space: nowrap; overflow: hidden; text-overflow: ellipsis`.
- **Cascade** — ❌ editing `aurora.css` or appending to `App.css` for one screen → ✅ new `src/styles/<area>.css` imported by the component, prefixed classes.

## 13 · Design review checklist (all must pass before handoff)

- [ ] Every colour, radius, shadow, duration and type size traces to an `aurora.css` token; no new raw hex, no second palette, no new font.
- [ ] Artwork only through `<Poster>`: ratio reserved, fallback + retry intact, no layout shift.
- [ ] Loading / empty / error / offline designed for the screen you touched, each with one recovery action and real copy.
- [ ] One-line metadata, ≤2 artwork badges, no type/source labels on art, one quality chip in the player.
- [ ] 44 px touch targets on the phone/TV path; no new control below the floor.
- [ ] `:focus-visible` visible on every new control; icon-only buttons labelled; toggles `aria-pressed`; dialogs `aria-modal`.
- [ ] D-pad path: every new action reachable, focus unmistakable, Back order intact.
- [ ] Motion: entrance only on first paint, hover lift + 2–4% zoom, no loops/bounce, reduced-motion and TV-mode checked.
- [ ] 390 / 768 / 1440 px + one landscape phone + TV checked; no overflow, no clipped titles, light theme checked.
- [ ] No unrelated restyle, no content removed to fit, no new dependency.
- [ ] `cd web; npm run lint; npm run build` green, evidence recorded.

## 14 · Handoff contract

- **To developer** (design → code): screen + states list with exact copy; tokens and primitives used; new class names and the new `src/styles/<area>.css` that owns them; components reused (`Poster`, `.vf-btn`, `.cat-*`, `.home-*`); behaviour per breakpoint; motion + reduced-motion behaviour; a11y attributes; TV focus order and Back behaviour; what must NOT change; acceptance = `cd web; npm run lint; npm run build` plus the UI checks in `docs/verification.md` (390/768/1440, four states, keyboard, reduced motion, TV if available).
- **To tester** (design → proof): the matrix — three widths, four states, both themes, reduced motion, keyboard, TV/remote; platforms web, phone APK, TV APK; report in the `Skills/README.md` handoff shape (Summary / Files / Evidence / Verification / Risks / Follow-ups / Open questions). Screenshots or an exact observation, never "looks fine".
- Do not hand off work that only works in dark theme, only with a mouse, or only at one width.

## 15 · Verified gaps (audit findings; fix only when in scope)

- `.vf-chip`, `.vf-surface`, `.vf-stagger` are defined in `aurora.css` with no JSX consumer today — available, not live. Cite them as primitives to adopt, not as shipped UI.
- `.cat-search` pill CSS exists, but `CatalogFilterHub` accepts `searchPlaceholder`/`onSearchChange` and renders no input; catalog search currently runs only through `SearchModal`. Verify before promising in-page search.
- `CinematicIntro.jsx` + `intro.css` are unmounted; the live launch intro is the inline `#mf-intro` in `index.html`. `intro.css` has no reduced-motion block, and the live intro is not skippable (it exits on the ready signal / 8 s cap).
- `App.jsx` wires `onReplayIntro={() => setShowIntro(true)}` and the boot-error retry calls `fetchAdminStats()`; neither is defined in the file — those affordances would throw if clicked.
- `DESIGN_SPEC.md`'s "editorial panorama" has no component; `CuratorBento` is the live editorial block. On touch, the catalog play overlay is `display:none` (`@media (hover:none)`), so phone users open details instead of one-tap play from the grid.
- `player.css` still styles `.ply-play-btn`/`.ply-icon-btn`, which `VideoPlayer.jsx` no longer renders — verify class names against the component before citing them.
- Two Ken Burns definitions compete (`home-hero-kenburns` 20 s in `home.css`, `pm-kenburns` 30 s in `premium.css`); and `premium.css` is a third skin against a two-layer spec — state which layer each change edits.
