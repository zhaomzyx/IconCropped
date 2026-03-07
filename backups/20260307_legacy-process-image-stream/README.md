# Legacy Backup: process-image-stream

Backup date: 2026-03-07

This folder stores a snapshot of the legacy "process-image-stream" cropping flow before any future removal or unification.

## Backed up file

- `route.ts.bak` (copied from `src/app/api/process-image-stream/route.ts`)

## Current call site

- `src/app/debug/page.tsx` calls `/api/process-image-stream` in debug mode.

## Restore

Run from repository root:

```powershell
Copy-Item "backups/20260307_legacy-process-image-stream/route.ts.bak" "src/app/api/process-image-stream/route.ts" -Force
```

If needed, re-run lint:

```powershell
pnpm exec eslint src --ext .ts,.tsx
```
