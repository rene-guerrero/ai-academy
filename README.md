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

| # | Topic | File |
|---|-------|------|
| 1 | Tokenization | `lessons/lesson_01_tokenization.py` |
| 2 | Embeddings | `lessons/lesson_02_embeddings.py` |

The first run of lesson 2 downloads the `all-MiniLM-L6-v2` model (about 90 MB).
