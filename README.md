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

After milestone 2 is complete, you'll also need to:

1. Open your Supabase project → **SQL Editor** → paste the contents of `supabase/migrations/001_init.sql` → run.
2. Supabase dashboard → **Database → Replication** → enable realtime on these tables:
   - `chat_messages`
   - `places`
   - `trips`
   - `uploads`
   - `participant_profiles`
   - `trip_memory`

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
2. ⏳ M2 — Schema
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
