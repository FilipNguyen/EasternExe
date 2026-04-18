# Quorum

> The AI workspace for group trips.

Upload your WhatsApp chat, docs, and audio intros. Quorum reads everything and opens a group chat, a private AI assistant, and a live map — all grounded in what your group actually said.

The full product + technical spec lives in [`BUILD_SPEC.md`](./BUILD_SPEC.md). Milestone status is tracked inline as the build progresses.

---

## Prerequisites

- **Node 20+** (`node --version`)
- A **Supabase** project (free tier is fine; you'll need URL + anon key + service role key)
- A **Z.ai** API key (OpenAI-compatible endpoint for the main agent)
- An **OpenAI** API key (embeddings + Whisper only)
- A **Mapbox** access token (public token is fine)
- A **Google Places** API key (Places API enabled)
- _Optional:_ a **Brave Search** API key (enables the research subagent's web search tool; degrades gracefully if absent)

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the env template and fill in your keys
cp .env.local.example .env.local
#    then edit .env.local

# 3. Run the dev server
npm run dev
#    → http://localhost:3000
```

## Supabase setup (one-time, after M2)

### 1. Run the schema migration

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Open [`supabase/migrations/001_init.sql`](./supabase/migrations/001_init.sql), copy its entire contents, paste into the editor, click **Run**.
3. You should see _"Success. No rows returned."_ — tables, triggers, indices, and the `trip-uploads` storage bucket are all created.

### 2. Enable realtime

Dashboard → **Database** → **Replication** → under the `supabase_realtime` publication, toggle ON for:

- `trips`
- `participants` _(optional but useful)_
- `uploads`
- `chat_messages`
- `places`
- `participant_profiles`
- `trip_memory`

### 3. Verify the triggers fire (optional but recommended)

In the SQL Editor, open a new query, paste the contents of [`supabase/verify.sql`](./supabase/verify.sql), and run.

The script creates a test trip + participant, checks that the five expected side-effects happened (group room, trip_memory shell, agent room, profile shell, storage bucket), then deletes the test rows. Look at the **Notices** panel; you should see:

```
group_rooms        (expect 1): 1
trip_memory_rows   (expect 1): 1
agent_rooms        (expect 1): 1
profile_rows       (expect 1): 1
bucket_exists      (expect 1): 1
✅ All triggers + storage bucket verified. Rolling back test rows.
```

If any line shows `0`, or the query errors, the trigger didn't fire — re-check that `001_init.sql` ran completely.

---

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

---

## Milestones

The build runs through 10 milestones (see [`BUILD_SPEC.md §13`](./BUILD_SPEC.md)). We stop at each one for operator verification before moving on.

1. ✅ **M1 — Scaffold:** Next.js 14 + Tailwind + shadcn/ui, Inter font, landing page, routing placeholder
2. ✅ **M2 — Schema:** `supabase/migrations/001_init.sql` + realtime instructions + `verify.sql` for trigger check
3. ⏳ M3 — Setup flow
4. ⏳ M4 — Basic chat + realtime
5. ⏳ M5 — Ingestion pipeline (highest-risk checkpoint)
6. ⏳ M6 — Main agent + tools
7. ⏳ M7 — Map tab
8. ⏳ M8 — Share-to-group
9. ⏳ M9 — Research subagent
10. ⏳ M10 — Polish pass

---

## Project structure

Target structure per `BUILD_SPEC.md §4`:

```
src/
├── app/            # routes (App Router)
├── lib/            # supabase client, llm wrappers, agents, ingest, prompts
├── components/     # ui, chat, map, setup, workspace
├── hooks/          # realtime + participant hooks
└── types/          # DB types
supabase/
└── migrations/     # 001_init.sql
```

Folders are created as their milestone lands — no empty scaffolding.
