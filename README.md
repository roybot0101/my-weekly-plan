# Weekly Planning Dashboard (Supabase Auth + Data)

A calming weekly planning app with account-based persistence.

## Features
- Email/password authentication via Supabase Auth
- Per-user task storage in Supabase (`tasks` table)
- Per-user selected week persistence (`profiles` table)
- Weekly timeline + Kanban view
- Global backlog, week-specific timeline scheduling

## 1. Supabase setup
1. Create a Supabase project.
2. In Supabase SQL editor, run `/Users/roybrubaker/Documents/My Weekly Plan/supabase/schema.sql`.
3. In Supabase Auth settings:
   - Enable `Email` provider.
   - Disable `Confirm email` for fastest local testing, or keep it on if preferred.

If your project was already created before backlog sorting support, rerun the latest SQL file to add `profiles.backlog_order`.

## 2. Environment variables
Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 3. Preview locally
Use Node 20+ (recommended) or Node 18+.

```bash
node -v
npm install
npm run dev
```

Then open the local Vite URL printed in terminal (usually [http://localhost:5173](http://localhost:5173)).

## 4. Production preview/build
```bash
npm run build
npm run preview
```

## 5. Vercel
Set these in Vercel project env vars:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

And set Node version to 20 (or at least 18) in Vercel settings.
