# AI Academy

Hands-on exercises for the daily AI Engineering lessons.

## Setup

Run once from the project folder in PowerShell:

    .\setup.ps1

This creates `.venv`, installs `requirements.txt`, initializes git and opens VS Code.

## Courses

Content is organized as courses. Each course lives in its own folder:

    courses/<course-id>/
      course.json        title, summary, tracks and planned lessons (English and Spanish)
      lessons-md/        one Markdown file per lesson; lessons-md/es/ holds the Spanish versions
      notes-md/          concept notes; notes-md/es/ for Spanish
      exercises/         runnable exercise scripts

Current courses:

| Course | Folder | Lessons |
|--------|--------|---------|
| AI Engineering | `courses/ai-engineering/` | 6 |

## Running an exercise

    .\.venv\Scripts\python.exe courses\ai-engineering\exercises\lesson_01_tokenization.py

Write down your predictions before you run each one. Lessons 2 and 6 download the `all-MiniLM-L6-v2` model on first run (about 90 MB); lesson 1 downloads the `cl100k_base` vocabulary.

## Lessons website

Live site: https://rene-guerrero.github.io/ai-academy/ (Spanish: https://rene-guerrero.github.io/ai-academy/es/)

The Markdown under `courses/` is the source of truth. `site-src/build.mjs` turns it into a static site in `dist/` with light and dark themes, both languages, knowledge checks, bookmarks, notes, search, offline support and optional cloud sync.

    npm install
    npm run build
    npm run check
    npm run serve      # http://localhost:4173/
    npm test           # build, checks and a browser smoke test

Authoring conventions, the deployment workflow and the optional Supabase sync setup are documented in `docs/SETUP_AND_DEPLOYMENT.md`. The audit and roadmap are in `docs/IMPROVEMENT_PLAN.md`.

Pushing to `master` runs `.github/workflows/pages.yml`, which builds, checks and deploys to GitHub Pages.

UI work follows the Apple design skill in `.claude/skills/apple-design/` (see `CLAUDE.md`).
