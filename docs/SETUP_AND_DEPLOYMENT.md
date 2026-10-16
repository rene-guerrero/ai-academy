# Setup and deployment

## 1. Local build

Requirements: Node 22 (the version pinned in `.github/workflows/pages.yml`). Python is only needed for the exercises.

    npm install
    npm run build      # writes dist/
    npm run check      # validates front matter, translations, links, precache list
    npm run serve      # http://localhost:4173/
    npm test           # build + check + Playwright smoke test (skips if Playwright is not installed)

The smoke test uses a Playwright-controlled Chromium. Set `CHROMIUM_PATH` if the browser is not on the default path; without Playwright the test exits 0 with a notice.

## 2. Content authoring

Content is grouped into courses under `courses/<course-id>/`. Inside a course: lessons in `lessons-md/NN-slug.md`, Spanish versions in `lessons-md/es/NN-slug.md`, concept notes in `notes-md/` and `notes-md/es/`, exercise scripts in `exercises/`, and `course.json` with the bilingual title, summary, tracks and planned lessons.

To add a course: create the folder, write `course.json` with `id` equal to the folder name, an `order` number, `title`, `summary`, `tracks` and `planned`, and add lessons. It appears on the home page automatically. URLs are `<course-id>/<lesson-slug>.html` and `es/<course-id>/<lesson-slug>.html`. Progress keys are scoped by course (`done:<course-id>/<slug>`), so slugs only need to be unique within a course.

English front matter:

    ---
    title: Attention
    summary: One line for the catalog and the page lede.
    area: A                     # track key from the course's course.json
    n: 3                        # lesson number, drives ordering and navigation
    minutes: 30
    exercise: exercises/lesson_03_attention.py   # relative to the course folder
    level: foundations          # foundations | core | advanced
    prereqs: 01-tokenization, 02-embeddings
    note: rag                   # optional related concept note (notes-md/rag.md)
    regenerated: true           # optional, shows the regenerated-lesson notice
    ---

Spanish front matter contains only `title` and `summary`; every other field is inherited from the English file. A lesson without a Spanish file is still published under `es/` with the English body and an "untranslated" notice.

Body conventions:

- Standard Markdown with GFM tables. Headings `##` and `###` build the table of contents.
- Fenced code blocks get syntax highlighting and a copy button. ` ```mermaid ` blocks render as diagrams in both themes.
- A knowledge check is a block of the form:

      ::: quiz
      Q: Question text (Markdown inline allowed)
      A: Answer text (Markdown allowed, may span lines)
      Q: ...
      A: ...
      :::

- A `## References` section is ordinary Markdown.
- Code blocks must be byte-identical between the English and Spanish versions; `npm run check` enforces this.

Planned lessons (not yet written) are declared in the course's `course.json` under `planned`, with bilingual title and summary, track and prerequisites. They render as non-clickable "Planned" rows.

UI strings live in `site-src/i18n/en.json` and `es.json`. `npm run check` fails if a key is missing in one language or placeholders differ.

## 3. Deployment to GitHub Pages

`.github/workflows/pages.yml` runs on every push to `master`: `npm ci`, `npm run build`, `npm run check`, then deploys `dist/` with `actions/deploy-pages`. One-time setting: repository Settings, Pages, Source = GitHub Actions.

All URLs in the built site are relative, so the site works under the `/ai-academy/` base path. English pages are at the root (unchanged URLs); Spanish pages are under `es/`. `sitemap.xml`, `robots.txt`, canonical and `hreflang` links are generated with `SITE_URL` (defaults to `https://rene-guerrero.github.io/ai-academy/`).

Caching: the service worker precaches every built file under a cache named by a content hash, so a new deploy replaces the old cache entirely on the next visit. GitHub Pages serves files with a 10-minute cache; a fresh deploy is visible after at most that long plus one page load.

## 4. Cloud sync (Supabase)

The site is local-first. Everything is stored in `localStorage` under `aia:state` as a document of `{ key: { v, t } }` entries with millisecond timestamps. Sync is an optional layer on top.

### Why Supabase

Free tier, passwordless email sign-in, Postgres with row-level security, and a browser client that can be loaded from a CDN without a bundler. No server code to run. The anon key is public by design and only grants what the RLS policies allow.

### One-time setup (about 10 minutes)

1. Create a project at https://supabase.com. Note the Project URL and the anon public key (Settings, API).
2. In the SQL editor, run `supabase/schema.sql`. It creates `public.learning_items` and the four row-level security policies that limit every operation to `auth.uid() = user_id`, and revokes the `anon` role.
3. Authentication, URL configuration: set Site URL to `https://rene-guerrero.github.io/ai-academy/` and add `https://rene-guerrero.github.io/ai-academy/**` to the redirect allow list. For local testing add `http://localhost:4173/**`.
4. Authentication, Providers, Email: keep "Enable email provider" on. Magic links are used by default (`signInWithOtp`). You can turn off "Confirm email" if you prefer a single click.
5. Put the Project URL and the anon or publishable key in `site-src/public-config.json` (already done for project `crdjdcciopzxfcvcgpoq`). These are public client values; RLS is what protects the data. Repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` override the file if set. The build refuses to run if the key looks like a service-role or secret key.
6. Push to `master` or re-run the workflow. The build log ends with "sync configured".

For a local build, copy `.env.example` to `.env` and fill the same values. `.env` is ignored by git.

### How sync behaves

- Header shows one of: Local only / Sign in to sync (configured, signed out) / Syncing / Synced / Changes waiting to sync / Offline, will sync later / Sync failed, retrying. The account dialog shows the same plus the last sync time.
- The Supabase client is only downloaded when `config.js` has a URL and key, and only when there is a stored session or the account dialog is opened.
- Every change is saved locally first and marked dirty. A sync runs 1.5 s after the last change, on page load with a session, when the tab becomes visible, and when the browser comes back online. Failures retry with exponential backoff up to 64 s.
- Pull before push: rows newer than the local entry replace it. For notes (`pred:*`) that changed on both sides, the two versions are concatenated with a divider instead of overwriting either. Done flags, bookmarks, quiz grades and preferences use newest-wins.
- First sign-in on a device that already has local data and an account that already has data opens a merge dialog: merge both, use account data, or keep local and stay signed out. Nothing is deleted automatically.
- Signing out keeps the local copy. "Delete my cloud data" deletes the user's rows (allowed by the delete policy); the local copy stays until "Clear local data".
- Export (JSON or Markdown) and import work with or without an account. Import merges newest-wins with the same note-conflict rule.

### Security notes

- Never put the service role key anywhere in this repository or in `config.js`.
- `learning_items` has RLS enabled and the `anon` role has no grants, so an unauthenticated client cannot read any row even with the anon key.
- Deleting the account itself (not just its rows) requires the Supabase dashboard (Authentication, Users) or a server-side function; the site does not expose it.

## 5. Daily lesson automation

A new lesson for the AI Engineering course needs: `courses/ai-engineering/lessons-md/NN-slug.md`, optionally its Spanish twin in `courses/ai-engineering/lessons-md/es/`, the exercise in `courses/ai-engineering/exercises/`, removal of the matching `planned` entry in `course.json`, `npm run build && npm run check`, and a push to `master`. The deploy is automatic. The session that does this must have the repository attached with push access; scheduled tasks created from a chat cannot attach a repository by themselves, so attach it in the scheduled task's settings.

## 6. Migration notes

Until October 2026 lessons lived at the site root (`/03-attention.html`) and progress keys had no course prefix (`done:03-attention`). Old URLs now redirect, keeping the `#hash`, to `/ai-engineering/...`. On first load the client rewrites old keys to `done:ai-engineering/03-attention` and writes a null tombstone for each old key, so synced devices converge; incoming old-format keys from the cloud, imports or devices still running the old version are normalized the same way.
