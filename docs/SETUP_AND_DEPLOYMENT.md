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
- Results from an exercise are never typed by hand. Write `{{claim:name}}` and add the claim to `courses/<course>/claims.json` under the lesson slug: `{ "name": { "pattern": "regex with one capture group", "value": "expected text" } }`. The build substitutes the value (inside code fences as plain text, elsewhere underlined) and, when reference outputs exist, fails if the pattern no longer captures exactly that value from the exercise's real output. Spanish lessons use the same placeholders.
- A prediction block goes right after the "Predict before you run" list:

      ::: predict
      P: id | number | claim:name or a literal | tolerance | Prompt text
      P: id | choice:a=Label A;b=Label B | b | | Prompt text
      :::

  Readers lock an answer and a confidence before running, then check it. Results are stored as `predq:<lesson key>:<id>` and feed the calibration chart on the home page.
- English front matter may carry provenance: `author`, `drafted` (date) and `reviewed` (date, empty until a person has reviewed the lesson).
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

## 6. Running exercises in the browser

Lessons with `runtime: pyodide` in their front matter get a Run button that executes the exercise script in the browser with Pyodide (CPython compiled to WebAssembly) inside a Web Worker. Everything is self-hosted under `dist/runtime/<version>/`; no third-party CDN is contacted at run time.

- Python core: copied from the `pyodide` npm package on every build.
- Packages: `npm run runtime` (`tools/build_runtime.py`) downloads the Pyodide wheels for NumPy and `regex`, checking the sha256 values from `pyodide-lock.json`, into `runtime-cache/` (git-ignored). The worker loads only the packages a script imports.
- `tiktoken` in the browser is a pure-Python implementation in `site-src/runtime/shims/tiktoken.py` that uses the real `cl100k_base` ranks (exported from the real package by `npm run runtime`). CI requires its output to be identical to real tiktoken.
- `sentence_transformers` in the browser is a NumPy implementation of the MiniLM BERT forward pass in `site-src/runtime/shims/sentence_transformers.py`. `npm run runtime` exports the real `all-MiniLM-L6-v2` weights (int8 per row, or fp16 if int8 is not accurate enough) and fails if any cosine similarity differs from PyTorch by more than 0.005.
- Reference outputs: `npm run runtime` also runs every exercise with real Python and the real packages; lesson pages show that output under "Reference output".
- Edits to an exercise are stored as `code:<course>/<lesson>` in the learning state and sync like notes.
- The service worker caches runtime files on first use in a cache named after the runtime version, so a lesson that has run once also runs offline.
- Packages that do not run in Pyodide, such as PyTorch, cannot run in the browser. Lessons that need them omit `runtime: pyodide`; they still get the reference output and the run-on-your-computer commands.

Local preparation needs internet access and the packages in `requirements.txt` (`pip install -r requirements.txt`), then `npm run runtime && npm run build`. `node tests/runtime.mjs` runs every runtime lesson in headless Chromium and compares the output with the reference: identical for lessons using NumPy or tiktoken, within 0.02 for the embedding lessons. CI runs all of this before deploying.

## 7. Migration notes

Until October 2026 lessons lived at the site root (`/03-attention.html`) and progress keys had no course prefix (`done:03-attention`). Old URLs now redirect, keeping the `#hash`, to `/ai-engineering/...`. On first load the client rewrites old keys to `done:ai-engineering/03-attention` and writes a null tombstone for each old key, so synced devices converge; incoming old-format keys from the cloud, imports or devices still running the old version are normalized the same way.

## 8. Ask the course and the quality page

The build splits every lesson and note into section chunks (by `##` and `###`, about 140 words per chunk, code blocks and references left out) and writes `dist/search/<lang>-chunks.json`. The home page ranks them with BM25 (`site-src/search-core.mjs`, shared by the browser and the build). In meaning mode the browser embeds the question with the in-browser MiniLM and fuses BM25 and cosine rankings with reciprocal rank fusion (k = 60).

Chunk vectors come from `python tools/embed_search.py`, which reads the chunks of a finished build, embeds them and the labeled questions with the real `all-MiniLM-L6-v2`, and writes `runtime-cache/search/`. The next build copies the vectors into `dist/search/` only if their hash matches the current chunks.

`tests/search-eval.json` lists questions in both languages with the English heading of each section that answers them; Spanish sections are matched by position, so the Spanish lesson must keep the same heading structure. Every build computes hit@1, hit@3 and MRR at section level for the modes it can (BM25 always; meaning and hybrid when vectors exist), writes `dist/quality.json`, renders `quality.html`, and fails below `thresholds`. With `AIA_REQUIRE_SEARCH=1` (set in CI) missing or stale vectors also fail the build.

The case study (`site-src/pages/case-study.md` and `es/`) can quote live numbers with `{{q:<lang>.<mode>.<hit1|hit3|mrr>}}`, `{{q:claims}}`, `{{q:queries}}` and `{{q:minilm}}`.

## 9. Supabase keep-alive

Free Supabase projects pause after a week without requests. `.github/workflows/keepalive.yml` runs `tools/keepalive.mjs` daily: it calls the optional `public.ping()` function from `supabase/schema.sql`, or, if that function does not exist, makes an anonymous read of `learning_items`, which row-level security rejects but which still counts as activity.
