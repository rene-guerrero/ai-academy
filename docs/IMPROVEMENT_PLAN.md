# AI Academy: audit and improvement plan

Date: 2026-10-16. Live site: https://rene-guerrero.github.io/ai-academy/

## 1. Audit

### 1.1 Architecture

| Area | Finding |
|---|---|
| Stack | Static site. `site-src/build.mjs` (Node 22, ESM) turns Markdown into HTML with `marked` 12, `highlight.js` 11 at build time, and `mermaid` 11 at runtime. No framework, no bundler, no TypeScript, no tests. |
| Content | `lessons-md/NN-slug.md` with front matter (`title, summary, area, n, minutes, exercise, regenerated`). `notes-md/*.md` for concept notes. Exercises in `lessons/*.py`. The tracker of delivered lessons lives outside the repo (assistant memory). |
| Routing | One HTML file per lesson at the site root (`01-tokenization.html`). All links and asset URLs are relative, so the GitHub Pages base path `/ai-academy/` works without configuration. |
| Styling | One `style.css` (178 lines) with CSS custom properties. Dark mode follows `prefers-color-scheme` only; no user choice, no persisted theme. |
| Client code | `app.js` (140 lines): copy buttons, done flag and predictions text stored in `localStorage` (`aia:done:<slug>`, `aia:pred:<slug>`), TOC highlighting, Mermaid init, offline badge, service worker registration. |
| Reusable pieces | `shell.html` template, `codeBlock()`, `tocHtml()`. No component layer; everything is string templating in the build. |
| Deployment | `.github/workflows/pages.yml` builds on push to `master` and deploys `dist/` with `actions/deploy-pages`. Verified green on 2026-10-16. |
| Size | `dist/` is 2.9 MB; 2.7 MB is `vendor/mermaid.min.js`, loaded only on pages that contain a diagram (all lesson pages today). Everything else is under 40 KB. |

### 1.2 Pages, links and interactive elements

Pages: `index.html`, six lesson pages, `note-rag.html`. Automated check at 360 px: 0 broken internal links, 0 console errors, 0 failed requests, 0 horizontal overflow, one `h1` per page, `lang="en"` and a meta description on every page.

Interactive elements: copy button per code block; collapsible TOC; collapsible exercise source; predictions textarea (debounced save); "Mark as done" toggle; previous/next pager; home page progress line and Done badges.

Gaps: no `<main>` landmark on lesson pages, no skip link, no search, no bookmarks, no knowledge checks, no "continue where I left off", no references sections, no language switch, no theme switch.

### 1.3 Layout

Desktop (62 rem and up): sticky TOC sidebar plus 46 rem reading column. Mobile: single column, TOC collapsed by default, 16 px gutters, tables scroll horizontally inside a wrapper, code blocks scroll horizontally. Tested earlier at 375 px and 1280 px (light and dark). The design is clean but plain: system sans everywhere, no typographic hierarchy beyond size, generic blue accent, cards with identical weight on the home page.

### 1.4 Persistence

- All state is `localStorage` in the origin `rene-guerrero.github.io`, wrapped in try/catch. If storage is blocked the page still works and says so.
- Reload: state survives. Offline: state survives (it is local). Another browser or device: nothing carries over; this is the main product gap.
- No export or import. No reading position. Theme and language are not stored (neither exists as a choice).

### 1.5 GitHub Pages requirements

- Relative URLs everywhere: satisfied. Must stay satisfied when adding a `es/` subfolder (prefix `../`).
- No client-side routing, so no 404 fallback is needed.
- Service worker is at the root, scope `./`, precache list generated at build with a content hash in the cache name. Updates are picked up on the next load after the new `sw.js` installs. Pages sends `Cache-Control: max-age=600` for files; the hashed cache name avoids serving a mix of old and new.
- A runtime configuration file (`config.js`) can be generated at build time from repository variables, which is how public backend configuration can reach a static site without committing it.

### 1.6 Accessibility, SEO, performance, maintainability

- Accessibility: focus-visible styles exist; buttons have labels; the done button uses `aria-pressed`. Missing: skip link, `<main>` on lesson pages, `aria-current` on pager, reduced-motion handling, visible labels on icon buttons, contrast not verified numerically.
- SEO: title and description present. Missing: canonical, Open Graph, `hreflang`, sitemap, robots.
- Performance: fast (tiny HTML and CSS, no web fonts). Mermaid is the only heavy asset and is deferred.
- Maintainability: the build script is readable but all UI strings are inline, which blocks localization. No validation of front matter, no link check, no tests.

### 1.7 Offline

The service worker precaches every built file, including the vendor bundle, and serves cache-first. After one visit the whole site reads offline. The "Offline" badge only reflects `navigator.onLine`; it does not say whether the page is cached, and it never shows a positive "available offline" state. The manifest allows Add to Home Screen; icons exist.

## 2. Priorities

### P0 (essential)

| # | Item | Acceptance criteria |
|---|---|---|
| P0-1 | State store v2: single JSON document with per-key timestamps, migration from the v1 keys, export/import | Old done flags and notes appear after upgrade; JSON export round-trips through import. |
| P0-2 | Theme system: light, dark, system; persisted; no flash | Choice survives reload; `data-theme` set before first paint by an inline script; all components covered in both themes; Mermaid re-themes. |
| P0-3 | English/Spanish: English at root (URLs unchanged), Spanish at `es/`; UI strings from `site-src/i18n/*.json`; lessons from `lessons-md/es/`; selector in the header; preference persisted; optional first-visit detection | Every page has a Spanish twin; switching keeps the same lesson and scroll position; untranslated lessons fall back to English with a notice; a build check fails on missing keys. |
| P0-4 | Cross-device sync: local-first store plus Supabase adapter (magic-link email auth, one table with row-level security), sync status in the header, merge on first sign-in, note conflict handling, retry with backoff | Works when configured; when not configured the UI says "Local only" and never claims sync. SQL, policies and setup in `docs/SETUP_AND_DEPLOYMENT.md`. |
| P0-5 | Home page hierarchy: intro, Continue learning, progress, catalog by track with search and filters, notes section, planned lessons marked as such, empty state | Next action visible above the fold on a 360 px phone. |
| P0-6 | Accessibility baseline: skip link, landmarks, 44 px tap targets, reduced motion, `aria-current`, contrast AA on tokens | Automated checks in `npm test` pass. |

### P1 (high value)

| # | Item |
|---|---|
| P1-1 | Visual design system: editorial type scale (serif display, sans body, mono code), one accent, consistent radii and borders, refined code and diagram presentation. |
| P1-2 | Knowledge checks per lesson (`::: quiz` blocks), self-grading, and a "Review" list on the home page. |
| P1-3 | Bookmarks per lesson and a Saved section on the home page. |
| P1-4 | Reading position per lesson and "Continue learning". |
| P1-5 | Lesson metadata: level, prerequisites, next steps, references. |
| P1-6 | Content review of the six lessons and the RAG note; Spanish translations reviewed as technical content. |
| P1-7 | Curriculum roadmap: planned lessons per track with dependencies, marked Planned, not clickable. |
| P1-8 | SEO: canonical, Open Graph, `hreflang`, `sitemap.xml`, `robots.txt`. |
| P1-9 | Offline indicator that reflects cache state. |
| P1-10 | Build-time checks and a Playwright smoke test (`npm test`). |

### P2 (optional)

| # | Item |
|---|---|
| P2-1 | Heading-level bookmarks ("saved concepts"). |
| P2-2 | Per-lesson Markdown export of notes. |
| P2-3 | Load Mermaid only when a diagram scrolls into view. |
| P2-4 | Mermaid replaced by prebuilt SVG at build time to drop the 2.7 MB runtime dependency. |

## 3. Decisions

- Keep the static build. It is the right tool for a personal reading site on GitHub Pages and keeps the offline story simple.
- Localization strategy: build-time duplication into `es/` rather than runtime string swapping. Reasons: lesson bodies are whole documents, not strings; separate URLs are indexable and linkable; the service worker precaches both; the client only needs a tiny dictionary for dynamic messages, injected per page.
- Theme tokens use `light-dark()` with `color-scheme`, so each color is defined once. Supported by Chromium 123+, Safari 17.5+, Firefox 120+; Brave on Android and iOS qualify.
- Backend: Supabase. Free tier, email magic links, Postgres with row-level security, a browser client loadable from a CDN without a bundler, and no server code to maintain. The anon key is public by design; RLS is what protects rows. The client library is only fetched when `config.js` carries a URL and key.
- Sync model: one row per state key (`user_id, key, value, updated_at`), last-writer-wins by timestamp except for notes, where a two-sided change produces a merged note with both versions, never a silent overwrite.
- No new build dependencies. Supabase JS comes from a CDN at runtime, only when configured.

## 4. Risks

- `light-dark()` on very old browsers falls back to no color; acceptable for a personal site, documented.
- Magic links require the Pages URL in the Supabase allow list; documented.
- Machine translation quality: translations were produced and then reviewed as technical text; code and identifiers stay in English.
- Mermaid is heavy; offline precache makes it a one-time cost.

## 5. Status (2026-10-16)

Implemented and verified locally with the build checks (`npm run check`) and the browser smoke test (`npm test`, 146 assertions at 320, 375, 390, 768, 1024, 1440 and 1920 px): P0-1 to P0-6, P1-1 to P1-10. Verified: theme choice persists and applies before first paint; language switch keeps the lesson and scroll position; Spanish first-visit detection honors a later explicit choice; notes, done flags, bookmarks and quiz grades survive reloads and appear on both language homes; catalog filters and heading search; JSON export and import round trip; blocked storage degrades with a message and no errors; service worker serves pages and diagrams offline.

Not verified here: cloud sync against a real Supabase project (no credentials in this environment; the adapter was exercised only with a dummy configuration, where it reports "could not be loaded" and keeps working locally), real Brave on Android and iOS, and the Add to Home Screen flow on a device. P2 items are open.
