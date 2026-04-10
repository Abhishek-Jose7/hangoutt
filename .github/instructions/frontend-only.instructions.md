---
description: "Use when the request is frontend only, UI-only, styling-only, component-only, page layout-only, or animation-only. Restrict edits to frontend paths and avoid backend/API/data-engine files unless explicitly overridden."
name: "Frontend Only Guardrails"
applyTo:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/hooks/**"
  - "src/store/**"
  - "src/app/globals.css"
  - "public/**"
---
# Frontend-Only Guardrails

When a task is frontend-only, apply these rules.

## Allowed Edit Scope

- `src/app/**/page.tsx`
- `src/app/**/layout.tsx`
- `src/app/globals.css`
- `src/components/**`
- `src/hooks/**`
- `src/store/**`
- `public/**`

## Protected (Do Not Touch)

- `src/app/api/**`
- `src/lib/**`
- `src/migrations/**`
- `scripts/**`
- `next.config.ts`
- `.env*`
- `package.json` and `package-lock.json`

## Behavior Rules

- If a requested UI change appears to require backend updates, stop and explain the backend dependency instead of editing protected files.
- If the user explicitly says backend changes are allowed, proceed and mention the override in your summary.
- Keep API contracts unchanged unless the user explicitly asks to update them.
- Prioritize presentational changes, accessibility, loading states, and client-side UX improvements.
