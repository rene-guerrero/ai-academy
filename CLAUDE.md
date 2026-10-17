# AI Academy

Static, bilingual (English/Spanish) learning site generated from Markdown, deployed to GitHub Pages from `master`.

## Rules

- Respond in English. Never put comments in code of any language.
- For any UI, layout, styling, interaction or visual design work on this site, load and follow the Apple design skill in `.claude/skills/apple-design/SKILL.md`: read its always-load references, audit through its five lenses, and keep the design tokens in `site-src/style.css` (system type, one indigo accent, grouped inset lists, segmented controls, sheets, the course progress ring as the single signature element).
- The owner chose an in-app appearance switch (System, Light, Dark) despite the HIG advice against app-specific appearance settings; keep System as the default.
- Content lives in `courses/<course-id>/`. See `docs/SETUP_AND_DEPLOYMENT.md` for authoring conventions.
- Before pushing: `npm run build && npm run check`, and `node tests/smoke.mjs` when Playwright is available. CI also runs `npm run runtime` and `node tests/runtime.mjs` (in-browser Python against real Python).
- Exercise scripts should only import the standard library, NumPy, `tiktoken` or `sentence_transformers` (all runnable in the browser), or omit `runtime: pyodide`. Never add comments to them.
- Never commit secret keys. `site-src/public-config.json` holds only the public Supabase URL and publishable key.
