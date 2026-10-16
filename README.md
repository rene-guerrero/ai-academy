# AI Academy

Hands-on exercises for the daily AI Engineering lessons.

## Setup

Run once from the project folder in PowerShell:

    .\setup.ps1

This creates `.venv`, installs `requirements.txt`, initializes git and opens VS Code.

## Running an exercise

    .\.venv\Scripts\python.exe lessons\lesson_01_tokenization.py
    .\.venv\Scripts\python.exe lessons\lesson_02_embeddings.py

Write down your predictions before you run each one.

## Lessons

| # | Topic | Exercise | Lesson text |
|---|-------|----------|-------------|
| 1 | Tokenization | `lessons/lesson_01_tokenization.py` | `lessons-md/01-tokenization.md` |
| 2 | Embeddings | `lessons/lesson_02_embeddings.py` | `lessons-md/02-embeddings.md` |
| 3 | Attention | `lessons/lesson_03_attention.py` | `lessons-md/03-attention.md` |
| 4 | The transformer block | `lessons/lesson_04_transformer_block.py` | `lessons-md/04-transformer-block.md` |
| 5 | Training and generation | `lessons/lesson_05_training_generation.py` | `lessons-md/05-training-and-generation.md` |
| 6 | Evaluating semantic search | `lessons/lesson_06_semantic_search.py` | `lessons-md/06-semantic-search-evaluation.md` |

Lessons 2 and 6 download the `all-MiniLM-L6-v2` model on first run (about 90 MB).

## Lessons website

Live site: https://rene-guerrero.github.io/ai-academy/ (Spanish: https://rene-guerrero.github.io/ai-academy/es/)

The Markdown in `lessons-md/` (English) and `lessons-md/es/` (Spanish), plus `notes-md/`, is the source of truth. `site-src/build.mjs` turns it into a static site in `dist/` with light and dark themes, both languages, knowledge checks, bookmarks, notes, search, offline support and optional cloud sync.

    npm install
    npm run build
    npm run check
    npm run serve      # http://localhost:4173/
    npm test           # build, checks and a browser smoke test

Authoring conventions, the deployment workflow and the optional Supabase sync setup are documented in `docs/SETUP_AND_DEPLOYMENT.md`. The audit and roadmap are in `docs/IMPROVEMENT_PLAN.md`.

Pushing to `master` runs `.github/workflows/pages.yml`, which builds, checks and deploys to GitHub Pages.
