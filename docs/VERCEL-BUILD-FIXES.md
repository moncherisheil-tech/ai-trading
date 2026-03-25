# Vercel build fixes applied

## 1. Syntax (app/actions.ts)

- **Error:** `Expected ',', got ')'` at line 419 — extra `});` in the repair `generateContent` call.
- **Fix:** Replaced the double `});` with a single `}` so that `config` is closed correctly and only one `});` closes `generateContent(...)`.

## 2. Missing dependencies (recharts peer deps)

- **Errors:** `Module not found: 'react-redux'` and `Module not found: 'immer'` (required by recharts).
- **Fix:** Added to `package.json`:
  - `"react-redux": "^9.0.0"`
  - `"immer": "^10.0.0"`
- Run `npm install` (Vercel does this automatically on deploy).

## 3. TypeScript & paths

- `tsconfig.json` has `"@/*": ["./*"]` — imports like `@/lib/config` and `@/components/AppHeader` resolve correctly.
- Imports use the same case as filenames (e.g. `PerformanceTrendsCharts`, `PnlTerminal`) for Linux/Vercel case-sensitivity.

## 4. Local Windows build notes

- `lightningcss.win32-x64-msvc` and `next-swc.win32-x64-msvc` errors are Windows-specific (native modules). Vercel builds on Linux and will use the correct binaries.
- If you see multiple lockfile warnings locally, they do not affect Vercel if the repo root has a single `package.json` and `package-lock.json`.
