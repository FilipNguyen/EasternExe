# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Source of truth

Two living documents take precedence over everything else. Read them in this order:

1. **`BUILD_SPEC.md`** — complete product + technical spec. The 10 milestones, schema, tool list, prompts, and UI contracts all originate here.
2. **`STATUS.md`** — what was actually built, verified IDs (e.g. the seeded Tokyo trip `090319ab-…`), and the "known gotchas" list. **Always read this at session start** — it records deviations from the spec and the reasons behind them.

Session-specific deltas land in `SESSION_<date>.md` files (most recent: `SESSION_2026-04-19.md`). They supersede older notes for the areas they touch.

## Commands

```bash
npm run dev        # next dev on :3000
npm run build      # production build — runs tsc + next lint
npm run lint       # next lint (eslint-config-next)
npm run start      # serve production build
```

No test runner is wired up. There is no `test` script; don't invent one. Manual verification goes through two fixtures:

```bash
curl http://localhost:3000/api/health                            # 5-service smoke test (Supabase R/W, Z.ai chat+tools, Google Places)
curl "http://localhost:3000/api/seed-test-trip?confirm=1"        # seeds the Tokyo WhatsApp demo trip end-to-end
```

Supabase migrations are **not** applied by a CLI — the user pastes `supabase/migrations/00N_*.sql` into the Supabase SQL editor. When you add a migration, number it next in sequence and tell the user to paste-and-run it; never assume it has been applied without verification (`/api/health` or a direct `curl` against PostgREST).

## Architecture

### Three-surface workspace

A trip has three UI surfaces backed by one shared context:

- **Group chat** — one `chat_rooms` row with `type='group'`, shared by all participants. Agent is invoked on demand via `@agent` regex.
- **Private AI chat ("Me")** — one `chat_rooms` row per participant with `type='agent'`, `owner_id=<participant>`. Every message from the owner triggers the agent automatically.
- **Map** — pins from the `places` table, filtered by category chips.

Plus one cross-surface flow: **share-to-group** re-inserts a private agent message into the group room with `shared_from_room_id` + `shared_by_participant_id` for attribution.

Rooms and participant profiles are **created by Postgres triggers** (`create_trip_side_effects`, `create_participant_side_effects` in `001_init.sql`), not by application code. Inserting a `trips` row automatically creates the group room + `trip_memory` shell; inserting a `participants` row creates their private agent room + `participant_profiles` shell. Don't duplicate this in app code — rely on the triggers.

### The LLM layer is Z.ai-only

- **All chat / tool-use / JSON generation** goes through `src/lib/llm.ts` → Z.ai (GLM-5.1) via the OpenAI SDK with a custom `baseURL`.
- **Every call must send `thinking: { type: "disabled" }`** (already wired in `callLlm`). GLM-5.1 is a reasoning model — without this, it burns the whole completion budget in hidden reasoning and returns empty content. Re-enable per-call with `callLlm({ reasoning: true })`.
- **No embeddings.** Z.ai's endpoint doesn't expose one (verified against `embedding`, `embedding-2`, `embedding-3`, `bge-m3`, `text-embedding-3-small`). `src/lib/embeddings.ts` only exports `chunkText` + `concatChunks` — **no vector similarity**. The `query_trip_brain` tool feeds whole-corpus chunks as context rather than similarity-ranking. Do not re-introduce an embeddings dependency without switching to a local embedder.
- **OpenAI is not used anywhere.** The original spec mentions OpenAI for embeddings + Whisper, but those paths were ripped out in commit `d4088fe`. `src/lib/openai.ts` exists but is untracked and unused — don't import from it.
- `callLlmJson` retries once with a repair prompt if the first response isn't valid JSON. Prefer it over hand-rolling JSON mode.

### Ingestion pipeline (`src/lib/ingest/pipeline.ts`)

`runIngestion(tripId)` orchestrates: download uploads → parse by kind (WhatsApp zip / PDF / txt) → chunk text → one LLM call per participant profile + one for `trip_memory` + one for places extraction → geocode each extracted place via Google Places + geocode the destination → set `trips.status='ready'`. Every LLM call is logged to `ai_runs`.

**Empty-trip short-circuit:** if `uploads.length === 0`, the pipeline geocodes the destination and marks the trip ready immediately (no LLM calls on empty context — they'd hallucinate). This was added to survive Vercel Hobby's 60s cap.

### Agent loop (`src/lib/agent/main.ts`)

Tool-call loop, max 5 turns. Context assembly differs by room type:

- **Group mode**: last 20 messages, full `trip_memory`, **all** participant profiles.
- **Private mode**: last 20 messages, full `trip_memory`, **only the owner's** profile, plus the group room's last 20 messages as read-only context.

Tools live in `src/lib/agent/tools.ts`: `query_trip_brain`, `search_places`, `save_place`, `get_participant_profile`, `research_activity`. The last one spawns the **research subagent** (`subagent-research.ts`) — a distinct chat actor with its own streaming placeholder message, up to 5 tool turns of its own, using Google Places + (optionally) Brave Search.

The agent streams into a pre-inserted placeholder `chat_messages` row via in-place UPDATEs: `thinking_state` transitions `thinking → streaming → done`, `content` grows incrementally. Clients observe via Supabase Realtime.

### Vercel serverless quirks

- **Fire-and-forget doesn't work.** `void foo().catch(...)` freezes the instant the response returns. Use `waitUntil(foo().catch(...))` from `@vercel/functions` — already wired in `/api/ingest/[tripId]` and `/api/agent`. Without it, ingestion silently halts after the first `await`.
- **`export const maxDuration = 60`** on those two routes matches the Hobby plan cap. Don't bump it to 300 without confirming the plan upgrade.

### Supabase access pattern

- **Browser** uses the anon key via `src/lib/supabase/client.ts`.
- **Server** uses the service-role key via `src/lib/supabase/server.ts` — all API routes + the ingestion + agent pipelines go through this.
- **RLS is disabled** on all public tables (MVP). The `trip_id` in the URL is the security boundary.
- **The anon role needs explicit GRANTs** — migration `003_grant_anon.sql` handles this. Supabase's new `sb_publishable_*` keys (unlike the legacy JWT anon keys) don't auto-grant public schema access, so PostgREST silently returns `[]` for browser reads without it.
- **Storage policies are separate** from table RLS. The `trip-uploads` bucket policies live in `002_storage_policies.sql` — without it, client uploads 403.
- **Realtime is toggled per-table** in the Supabase dashboard (Database → Replication). The 7 tables that need it: `trips`, `participants`, `uploads`, `chat_messages`, `places`, `participant_profiles`, `trip_memory`. `useTripStatus` polls as a fallback when Realtime isn't toggled.

## Cross-cutting conventions

- **Path alias**: `@/*` → `src/*`.
- **Strict TS** is on. Narrow tool-call types with `tc.type === "function"` before reading `tc.function.*` — the OpenAI SDK unions function calls with custom calls.
- **`pdf-parse` must be dynamically imported.** A direct `import` fires a test-file probe at startup that crashes the Next build. Use the existing helper in `src/lib/ingest/doc-extract.ts`.
- **Zod schemas for every LLM output** live in `src/lib/schemas.ts`. The LLM layer calls `callLlmJson`; the caller validates the parsed result against the zod schema.
- **All prompts live in `src/lib/prompts/`**, one file per purpose. Tuning output quality means editing these files — not the pipeline code.
- **`components/ui/`** is hand-coded Radix-based shadcn v2 primitives. Running `npx shadcn add` broke things with the Tailwind v3 setup — don't let it touch this directory without checking the Tailwind version it targets.
- **Participant identity is localStorage-only.** No auth. Key: `participantId_<tripId>`. `useParticipant` hydrates it; `/trip/[tripId]/join` is the picker.
