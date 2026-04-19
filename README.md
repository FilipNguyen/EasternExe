# EasternExe

> The AI workspace for group trips.

Upload your WhatsApp chat, docs, and audio intros. EasternExe reads everything and opens a group chat, a private AI assistant, and a live map — all grounded in what your group actually said.

The full product + technical spec lives in [`BUILD_SPEC.md`](./BUILD_SPEC.md). Milestone status is tracked inline as the build progresses.

---

## Prerequisites

- **Node 20+** (`node --version`)
- A **Supabase** project (free tier is fine; you'll need URL + anon key + service role key)
- A **Z.ai** API key — powers both the main agent chat completions and the embedding vectors (OpenAI-compatible endpoint)
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

## Milestones — all landed

All 10 milestones from [`BUILD_SPEC.md §13`](./BUILD_SPEC.md) are in `main`. Commit history is milestone-ordered (`feat(m1): …` through `feat(m10): …`).

1. ✅ **M1 — Scaffold:** Next.js 14 + Tailwind + shadcn/ui (Radix), Inter, landing.
2. ✅ **M2 — Schema:** `supabase/migrations/001_init.sql` + `verify.sql` + realtime toggle list.
3. ✅ **M3 — Setup flow:** 5-step reducer, participant color palette, drag-drop uploads, MediaRecorder audio intros, review screen; commits trip + participants + uploads.
4. ✅ **M4 — Chat + realtime:** `/trip/[tripId]` workspace with Group/Me/Map tabs (top tabs desktop, bottom nav mobile), `/join` participant picker, realtime INSERT/UPDATE subscription, optimistic sends.
5. ✅ **M5 — Ingestion pipeline:** `/api/ingest/[tripId]` fires async. WhatsApp zip (iOS+Android) + PDF + txt + Whisper transcription → chunk (≈500 tok, 50 overlap) → embed (text-embedding-3-small) → per-participant profile + trip memory + places extraction → Google Places geocoding → destination geocode. Every LLM call logged to `ai_runs`.
6. ✅ **M6 — Main agent:** `@agent` regex trigger (group) + owner-message trigger (private). Placeholder bubble streams through `thinking` → `streaming` → `done` with tool-call progress. Tools: `query_trip_brain`, `search_places`, `save_place`, `get_participant_profile`, `research_activity`.
7. ✅ **M7 — Map tab:** Mapbox dark-v11, category-colored pins, single-select filter chips, `PlaceCard` popover with "Ask Agent about this" (jumps to Me tab + prefills the input).
8. ✅ **M8 — Share-to-group:** Hover-revealed button on private agent/subagent messages, inline confirm, `/api/share-to-group` inserts a user message into the group with 💡 preamble + `shared_from_room_id`/`shared_by_participant_id`. Distinct violet border-left + attribution badge rendering.
9. ✅ **M9 — Research subagent:** `research_activity` tool spawns a subagent message (distinct Research Agent label + sparkles icon), runs up to 5 tool turns with Google Places + optional Brave `web_search` (only registered when `BRAVE_SEARCH_API_KEY` is set), streams progress updates, returns a 2–3 option summary.
10. ✅ **M10 — Polish:** Message skeleton loader, starter-prompt chips on empty Me chat, mobile bottom tab bar, Inter with balanced text, fade-in animations, `prefers-color-scheme` dark variables.

---

## Project structure

```
src/
├── app/
│   ├── page.tsx                        # landing
│   ├── setup/page.tsx                  # 5-step setup flow
│   ├── trip/[tripId]/page.tsx          # workspace (SSR)
│   ├── trip/[tripId]/join/page.tsx     # participant picker
│   └── api/
│       ├── trips/route.ts              # create trip + participants (atomic)
│       ├── participants/route.ts       # add one participant
│       ├── uploads/route.ts            # register a storage upload
│       ├── messages/route.ts           # insert + trigger agent
│       ├── ingest/[tripId]/route.ts    # fire ingestion pipeline
│       ├── agent/route.ts              # fire runAgent
│       └── share-to-group/route.ts     # cross-room share
├── lib/
│   ├── supabase/{client,server}.ts     # anon / service-role clients
│   ├── llm.ts                          # Z.ai (OpenAI-compatible) wrapper
│   ├── openai.ts                       # embeddings + Whisper
│   ├── embeddings.ts                   # chunking + cosine
│   ├── places.ts                       # Google Places (new API)
│   ├── brave.ts                        # optional Brave Search
│   ├── schemas.ts                      # zod schemas (forms + LLM outputs)
│   ├── colors.ts                       # participant palette
│   ├── ingest/
│   │   ├── pipeline.ts                 # orchestrator
│   │   ├── whatsapp-parser.ts          # iOS + Android line parser
│   │   ├── doc-extract.ts              # pdf-parse + utf-8
│   │   └── audio-transcribe.ts         # Whisper wrapper
│   ├── agent/
│   │   ├── main.ts                     # runAgent tool loop
│   │   ├── subagent-research.ts        # research subagent loop
│   │   └── tools.ts                    # tool defs + handlers
│   └── prompts/                        # all LLM prompts in one folder
├── components/
│   ├── ui/                             # shadcn primitives (button, input, card, …)
│   ├── chat/                           # MessageList, Bubble, Input, Thinking, Share
│   ├── map/                            # TripMap, PlaceCard, categories
│   ├── setup/                          # step components + AudioRecorder
│   └── workspace/                      # TabsShell, TripWorkspace, IngestProgress, Picker
├── hooks/                              # useChatMessages, useTripStatus, useRealtimePlaces, useParticipant
└── types/db.ts                         # hand-mirrored DB types
supabase/
├── migrations/001_init.sql             # full schema + triggers + bucket
└── verify.sql                          # DO-block trigger check
```

## What the colleague needs to do

1. `git clone` / `git pull` → `npm install`
2. Supabase: paste `supabase/migrations/001_init.sql` in SQL editor, enable realtime on the 6–7 listed tables, run `supabase/verify.sql` (expect five `1`s).
3. Fill `.env.local` (template in `.env.local.example`).
4. `npm run dev`, create a trip, upload a real WhatsApp export + audio intros, let ingestion run, verify profile/trip_memory/places quality in Supabase.
5. Iterate on prompts in `src/lib/prompts/` if outputs feel shallow — that's the main knob for quality.
