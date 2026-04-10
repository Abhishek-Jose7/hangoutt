<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Frontend-Only Edit Boundary

When the user asks for frontend-only work (UI, styling, component behavior, layout, animations), follow this boundary.

### Allowed

- `src/app/**/page.tsx`
- `src/app/**/layout.tsx`
- `src/app/globals.css`
- `src/components/**`
- `src/hooks/**`
- `src/store/**`
- `public/**`

### Do Not Touch (Unless Explicitly Asked)

- `src/app/api/**`
- `src/lib/**`
- `src/migrations/**`
- `scripts/**`
- `next.config.ts`
- `.env*`
- `package.json`
- `package-lock.json`

### Enforcement

- If a frontend request would require backend changes, explain the dependency and stop.
- Only cross this boundary when the user explicitly approves backend edits.
- Mention any boundary override in the final summary.
