# AI Academy

A bilingual (English and Spanish) AI engineering course that checks itself. Every exercise runs in the browser on real Python, every number a lesson quotes is verified against real output in CI, and the site's own semantic search ships with a labeled evaluation set and a quality gate.

Live: https://rene-guerrero.github.io/ai-academy/ · [Measured quality](https://rene-guerrero.github.io/ai-academy/quality.html) · [Engineering case study](https://rene-guerrero.github.io/ai-academy/case-study.html)

## What is different here

- **Real Python in the browser, proven equal to real Python.** Pyodide runs each exercise in a Web Worker, self-hosted and offline after first use. `tiktoken` and `sentence_transformers` are replaced by a pure-Python BPE over the real `cl100k_base` ranks and a NumPy MiniLM forward pass. CI fails if the BPE output differs from real tiktoken at all, or if any MiniLM cosine similarity differs from PyTorch by more than 0.005.
- **Claims as code.** Numbers and tables in lessons are placeholders (`{{claim:name}}`) with a pattern into the exercise's real output (`courses/<course>/claims.json`). CI runs the exercises; the build fails if a claim no longer matches.
- **Ask the course.** Section-level hybrid retrieval over the lessons: BM25 in JavaScript, MiniLM embeddings computed by CI, the query embedded in the browser, fused with reciprocal rank fusion. `tests/search-eval.json` holds labeled questions per language; the build computes hit@1, hit@3 and MRR for each mode, publishes them on the quality page and fails below the stored thresholds.
- **Predictions with calibration.** Readers commit to a numeric or multiple-choice prediction and a confidence before running; answers are scored against verified output and the home page shows a calibration chart.
- **Labs.** A model inspector (MiniLM attention per layer and head, residual norms, sentence similarity) and a training lab (train a bigram language model in the browser, scrub checkpoints, sample with temperature and top-p).
- **Shareable experiments and provenance.** Edited exercises compress into a link. Each lesson shows how it was drafted, which claims are verified, its browser parity and its review status.
- **Local-first sync.** Progress, notes and edits live in the browser and sync through Supabase with row-level security; two-sided note edits merge instead of overwriting. A daily GitHub Action keeps the free project awake.

## Pipeline

    npm run runtime                 real Python: wheels, tiktoken vocabulary, MiniLM export and accuracy check, reference outputs
    npm run build                   pages, claims, search chunks
    python tools/embed_search.py    MiniLM embeddings for the chunks and the labeled questions
    npm run build                   again, with vectors: search evaluation and quality gate (AIA_REQUIRE_SEARCH=1 in CI)
    npm run check                   front matter, translations, links, precache list
    node tests/smoke.mjs            Playwright: layout at 7 widths, persistence, sync states, search, quality page
    node tests/runtime.mjs          Playwright: every exercise in the browser compared with real Python, labs, hybrid search

All of it runs in `.github/workflows/pages.yml` on every push to `master`, then deploys to GitHub Pages. Free tiers only.

## Repository

    courses/<course-id>/   course.json, lessons-md/ (and es/), notes-md/, exercises/, claims.json
    site-src/              build, client code, styles, i18n, labs, Python runtime shims, case study pages
    tools/                 runtime preparation, embeddings, Supabase keep-alive
    tests/                 smoke and runtime browser tests, search evaluation set
    docs/                  setup, authoring conventions, deployment, improvement plan

## Running locally

    npm install
    npm run build && npm run check
    npm run serve        # http://localhost:4173/

Without `npm run runtime` the site still builds; lessons fall back to run-on-your-computer instructions and the quality page reports keyword search only. To run the exercises on your machine:

    .\setup.ps1
    .\.venv\Scripts\python.exe courses\ai-engineering\exercises\lesson_01_tokenization.py

Authoring conventions, deployment and Supabase setup: `docs/SETUP_AND_DEPLOYMENT.md`. UI work follows `.claude/skills/apple-design/` (see `CLAUDE.md`).
