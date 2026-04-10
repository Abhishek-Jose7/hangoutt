---
description: "Use when tasks mention API routes, server logic, data pipelines, geocoding, itinerary engine, scripts, or migrations. Helps keep backend scope explicit and separate from frontend-only requests."
name: "Backend Boundary Map"
applyTo:
  - "src/app/api/**"
  - "src/lib/**"
  - "src/migrations/**"
  - "scripts/**"
---
# Backend Boundary Map

Use this file as the backend ownership map.

## Backend-Owned Paths

- `src/app/api/**`
- `src/lib/**`
- `src/migrations/**`
- `scripts/**`

## Frontend-Owned Paths

- `src/app/**/page.tsx`
- `src/app/**/layout.tsx`
- `src/components/**`
- `src/app/globals.css`

## Coordination Rule

- If a frontend-only request conflicts with backend changes, do not modify backend-owned paths. Return the minimal backend delta as a follow-up proposal and wait for explicit approval.
