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

The Markdown files in `lessons-md/` and `notes-md/` are the source of truth. A small Node script builds them into a static site in `dist/`.

    npm install
    npm run build
    npm run serve

Then open http://localhost:4173/. The site works offline after the first visit and can be added to a phone home screen.

Each lesson file starts with front matter:

    ---
    title: Lesson title
    summary: One line shown on the home page.
    area: A
    n: 7
    minutes: 25
    exercise: lessons/lesson_07_name.py
    ---

Areas: A How modern AI works, B LLM engineering, C Agents, D ML and model development, E AI systems engineering, F Research and future. Add `regenerated: true` to show the regenerated-lesson notice.

Pushing to `master` runs `.github/workflows/pages.yml`, which builds and deploys to GitHub Pages. One-time setup: repository Settings, Pages, Source: GitHub Actions.
