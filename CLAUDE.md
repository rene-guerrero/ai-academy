# AI Academy

Static, bilingual (English/Spanish) learning site generated from Markdown, deployed to GitHub Pages from `master`.

## Rules

- Respond in English. Never put comments in code of any language.
- For any UI, layout, styling, interaction or visual design work on this site, load and follow the Apple design skill in `.claude/skills/apple-design/SKILL.md`: read its always-load references, audit through its five lenses, and keep the design tokens in `site-src/style.css` (system type, one indigo accent, grouped inset lists, segmented controls, sheets, the course progress ring as the single signature element).
- The owner chose an in-app appearance switch (System, Light, Dark) despite the HIG advice against app-specific appearance settings; keep System as the default.
- Content lives in `courses/<course-id>/`. See `docs/SETUP_AND_DEPLOYMENT.md` for authoring conventions.
- Before pushing: `npm run build && npm run check`, `python3 tools/check_challenges.py`, and `node tests/smoke.mjs` when Playwright is available. CI also runs `npm run runtime` and `node tests/runtime.mjs` (in-browser Python against real Python).
- Exercise scripts should only import the standard library, NumPy, `tiktoken` or `sentence_transformers` (all runnable in the browser), or omit `runtime: pyodide`. Never add comments to them.
- Never commit secret keys. `site-src/public-config.json` holds only the public Supabase URL and publishable key.
- Never type results into lessons by hand. Quote exercise output with `{{claim:name}}` and define the claim (regex with one capture group, expected value) in `courses/<course>/claims.json`; the build fails when a claim stops matching the CI reference output.
- Predictions go in `::: predict` blocks (`P: id | number or choice:key=Label;... | claim:name or literal | tolerance | prompt`). See `docs/SETUP_AND_DEPLOYMENT.md`.
- Ask the course is evaluated against `tests/search-eval.json`. When lesson headings change, keep its expected sections valid; never lower a threshold to make a build pass without saying so.
- New features go in `site-src/features/<name>.js` and `.css`, with strings in `site-src/i18n/extra/<name>.en.json` and `.es.json`; use the `window.__aia` API, the `aia:ready` event and the page slots instead of editing app.js where possible.
- Coding challenges live in `courses/<course>/challenges/<slug>.json`; every reference solution must pass its tests and every starter must fail them (`tools/check_challenges.py`, also run in CI).
