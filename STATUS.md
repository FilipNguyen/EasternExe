# EasternExe — current state + next-session playbook

_Last updated: 2026-04-18 by Claude Opus 4.7 (1M ctx). Remote: `FilipNguyen/EasternExe` `main` @ `fd72f43`._

## 🚨 THE MOST RECENT THING (what to pick up on)

Anon-key bug discovered and migration 003 written + pushed but **NOT YET APPLIED** by the user. User must paste `supabase/migrations/003_grant_anon.sql` into SQL editor + Run, then hard-refresh the browser. Once that's done, chat + map + polling all unblock.

If the user says "I ran it" on resume: verify via `curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/places?trip_id=eq.090319ab-dafe-4ad2-be70-5a0a83cb5aac&select=id" -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY"` — expect a non-empty array of 42 places.

## One-liner

EasternExe is a Z.ai-powered group-trip workspace — group chat, private AI assistant, and a map — grounded in the group's own WhatsApp + notes. Built end-to-end per `BUILD_SPEC.md` and its Z.ai-only adaptation.

## What's working today (verified 2026-04-18)

A **full end-to-end ingestion** run succeeded in ~45s for the Tokyo demo trip:

- `GET /api/health` → 5/5 services green (Supabase read, Supabase storage, Z.ai chat, Z.ai tools, Google Places)
- `GET /api/seed-test-trip?confirm=1` → trip `090319ab-dafe-4ad2-be70-5a0a83cb5aac` created, ingestion fired, completed with **42 places geocoded + 3 profiles + trip memory**
- `/trip/[tripId]` renders the 3-tab workspace with realtime
- `.env.local` is filled in and working (Z.ai + OpenAI already removed, Supabase, Mapbox, Places, Brave all wired)

## Stack (locked)

- Next.js 14 App Router, TypeScript strict
- Tailwind v3 + shadcn/ui v2 (Radix-based)
- Supabase Postgres + Realtime + Storage
- **Z.ai** (`GLM-5.1` via `https://api.z.ai/api/coding/paas/v4`) for all LLM calls
  - `thinking: { type: "disabled" }` is required on every call or GLM eats all tokens in its hidden reasoning
  - OpenAI-compatible tool calling + JSON mode both verified working
  - **No embeddings** — Z.ai's endpoint doesn't expose one. We feed whole-corpus chunks as context instead of similarity-ranking
- OpenAI: **removed**. Not used anywhere
- Mapbox GL JS via `react-map-gl` v7, `dark-v11` style (to be restyled)
- Google Places API (New) for geocoding + search
- Brave Search (optional, wraps research subagent when key present)

## File map (what lives where)

```
src/
├── app/
│   ├── page.tsx                       landing
│   ├── setup/page.tsx                 5-step reducer-driven setup
│   ├── trip/[tripId]/page.tsx         workspace (SSR → TripWorkspace client)
│   ├── trip/[tripId]/join/page.tsx    participant picker
│   └── api/
│       ├── health/route.ts            smoke-test 5 services
│       ├── seed-test-trip/route.ts    auto-seed demo trip (gated by ?confirm=1)
│       ├── trips/route.ts             POST create trip + participants
│       ├── participants/route.ts
│       ├── uploads/route.ts
│       ├── ingest/[tripId]/route.ts   fire runIngestion
│       ├── messages/route.ts          insert + detect @agent trigger
│       ├── agent/route.ts             fire runAgent
│       └── share-to-group/route.ts
├── lib/
│   ├── supabase/{client,server}.ts
│   ├── llm.ts                         Z.ai client (getZaiClient) + callLlm with thinking-disabled
│   ├── embeddings.ts                  chunkText + concatChunks only — NO vector embeddings
│   ├── places.ts                      Google Places (New) Text Search + geocode
│   ├── brave.ts                       optional web_search
│   ├── schemas.ts                     zod schemas for forms + LLM outputs
│   ├── colors.ts                      8-color participant palette
│   ├── ingest/
│   │   ├── pipeline.ts                orchestrates full ingestion
│   │   ├── whatsapp-parser.ts         iOS + Android line formats, strips media + system msgs
│   │   └── doc-extract.ts             pdf-parse (dynamic) + utf-8
│   ├── agent/
│   │   ├── main.ts                    tool-loop runAgent (5 turns max)
│   │   ├── subagent-research.ts       streaming subagent for research_activity
│   │   └── tools.ts                   5 tools: query_trip_brain, search_places, save_place,
│   │                                    get_participant_profile, research_activity (+ optional web_search)
│   └── prompts/
│       ├── agent-group.ts             group-chat system + context builder
│       ├── agent-private.ts           private AI system + context builder
│       ├── subagent-research.ts       research agent
│       ├── ingest-profile.ts          per-participant profile JSON
│       ├── ingest-trip-memory.ts      trip-wide JSON
│       └── ingest-places.ts           place extraction JSON
├── components/
│   ├── ui/                            button, input, label, textarea, card, progress (hand-coded shadcn v2)
│   ├── chat/                          MessageList, MessageBubble, ChatInput, ThinkingIndicator,
│   │                                    ShareToGroupButton, MessageSkeleton
│   ├── map/                           TripMap, PlaceCard, categories.ts
│   ├── setup/                         StepTripBasics, StepParticipants, StepUploads, StepIntros, StepReview
│   └── workspace/                     TabsShell, TripWorkspace, IngestProgress, ParticipantPicker
├── hooks/                             useParticipant, useChatMessages, useRealtimePlaces, useTripStatus
└── types/db.ts                        hand-mirrored DB types
supabase/
├── migrations/001_init.sql            schema (no vector column)
├── migrations/002_storage_policies.sql  storage.objects policies for trip-uploads bucket
└── verify.sql                         DO-block trigger check
test-data/
├── _chat.txt                          429-line realistic 3-guy Tokyo WhatsApp export
├── tokyo-chat.zip                     packaged for seed endpoint
└── {filip,taro,kenji}-notes.txt       per-person backstory notes
```

## Env (`.env.local` — gitignored)

All filled in. No OpenAI key anywhere. Z.ai does chat + (not embeddings — we skip them).

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…
ZAI_API_KEY=…
ZAI_BASE_URL=https://api.z.ai/api/coding/paas/v4
ZAI_MODEL=GLM-5.1
NEXT_PUBLIC_MAPBOX_TOKEN=pk.…
GOOGLE_PLACES_API_KEY=…
BRAVE_SEARCH_API_KEY=…   # optional
```

## Bring-up flow (if next session starts from scratch)

1. `git pull origin main`
2. `npm install`
3. `.env.local` already on disk locally (not in repo)
4. Migrations **already applied** in the Supabase project — `trips`, `participants`, `uploads`, `upload_chunks`, `participant_profiles`, `trip_memory`, `places`, `chat_rooms`, `chat_messages`, `ai_runs` all exist
5. `npm run dev`
6. `curl http://localhost:3000/api/health` → expect 5/5 green
7. `curl "http://localhost:3000/api/seed-test-trip?confirm=1"` → returns tripId + tripUrl
8. Open `/trip/<id>` in browser, watch ingestion, explore

## Demo trips already in the database

- `090319ab-dafe-4ad2-be70-5a0a83cb5aac` — Tokyo Apr 2026 (seed). Fully ingested: 22 chunks, 42 places, 3 profiles, 1 trip memory.

## Open scope — Tier 1 (promised but NOT built yet)

The user approved and I committed to these next but hit the "show me working" checkpoint first:

- [ ] **Pokemon-Go map style toggle** — custom dark 3D style with `fill-extrusion` buildings + 60° pitch + pulsing markers; second toggle for Google-Maps-style (e.g. `streets-v12`). One segmented control in the map corner. `react-map-gl` supports dynamic `mapStyle` swap.
- [ ] **Live participant locations** — new `participant_locations` table + `useGeolocation` hook + realtime dots on map with pulse animation + name on hover. Permission prompt on first visit.
- [ ] **Weave places into chat** — ✅ done in commit `eb60a6e` (Google Maps list from user added)

## Open scope — Tier 2 (discussed, not committed to)

- [ ] **Daily itinerary** — new table(s) + 7th ingestion LLM call proposing day-by-day plan + Itinerary panel in workspace. Enables "what should we do today" flow.
- [ ] **Visited / unvisited** — PlaceCard toggle; dimmed markers when visited. Schema already supports via `places.status`.
- [ ] **Location-aware agent** — pass user's current location into agent context; bias `search_places` to lat/lng; new tool `nearby_from_itinerary`.

## Open scope — Tier 3 (not started)

- [ ] Pre-canned starter prompts contextual to itinerary + location
- [ ] Edit-profile UI (if ingested profile is wrong)
- [ ] Ingestion retry button (actually DONE in commit `def8945` — overlay shows Retry on error)

## Known gotchas (burned during development)

1. **GLM-5.1 reasoning burns tokens.** Always send `thinking: { type: "disabled" }`. Re-enable per-call via `callLlm({ reasoning: true })`.
2. **Z.ai has no embeddings endpoint.** Tried `embedding`, `embedding-2`, `embedding-3`, `bge-m3`, `text-embedding-3-small` at both coding + paas URLs — all return "Unknown Model". Don't re-add embedding logic without swapping to a local embedder (e.g. `@xenova/transformers`).
3. **Tool-call narrowing.** Recent OpenAI SDK types union `ChatCompletionMessageFunctionToolCall` with custom calls. Always narrow with `tc.type === "function"` before reading `tc.function.*`.
4. **Supabase storage requires explicit policies.** Disabled table RLS doesn't cover the storage bucket. `002_storage_policies.sql` must run or client uploads 403.
5. **Supabase NEW-format API keys don't auto-grant public schema.** The user's key starts with `sb_publishable_*` (not the legacy `eyJ...` JWT). Unlike the old anon JWT, the new format requires an explicit `GRANT SELECT/INSERT/UPDATE/DELETE` to the `anon` + `authenticated` roles. Without this, PostgREST returns `[]` for every browser read even though RLS is off. Fix: `003_grant_anon.sql`.
6. **Realtime must be toggled per-table** in Dashboard → Database → Replication. Our 7 tables need this: `trips`, `participants`, `uploads`, `chat_messages`, `places`, `participant_profiles`, `trip_memory`. `useTripStatus` has a 5s polling fallback for when this isn't set.
7. **`test-data/` reads from `process.cwd()`.** The seed endpoint works in local dev. For Vercel deploy, either bundle the fixtures in `public/` or remove the endpoint from production.
8. **shadcn init v4 broke with our Tailwind v3 setup.** We rolled back to hand-coded Radix-based primitives; don't let `npx shadcn add` touch `components/ui/` without checking what Tailwind version it targets.
9. **pdf-parse dynamic import** is required — direct import fires a test-file probe at startup that crashes Next.

## Commit history (milestone-ordered)

```
fd72f43 fix(migration): grant anon + authenticated read/write on public schema
c3ca4fa fix: polling fallback for useTripStatus when Realtime is off
eb60a6e chore(test-data): weave ~30 Google-Maps places into the WhatsApp chat
567591d refactor: drop embeddings entirely + add test fixtures + /api/health + /api/seed-test-trip
d4088fe refactor: drop OpenAI — Z.ai handles chat + embeddings, no audio intros
def8945 feat: storage RLS policies + retry ingestion on failure
7b0373e chore: ignore run-*.png dev screenshots
1078d07 feat(m10): polish — skeletons, starter prompts, README final
152ce3c feat(m8): share-to-group with attribution
2c179c0 feat(m7): map tab — mapbox dark-v11, category pins, filter chips
d6b75f5 feat(m6): main agent + 4 tools + @agent trigger + subagent plumbing
7c3ce8d feat(m5): end-to-end ingestion pipeline
3f2a5d5 chore(m5): install ingestion deps
bba01d2 feat(m4): chat rooms + realtime, participant picker, tabbed workspace
67adfdb feat(m3): 5-step setup flow
912c2e0 feat(m2): schema migration + trigger verification
8b5c8ab feat(m1): scaffold
```

## Recommended next prompts after compaction

Pick any of these to resume cleanly:

- _"Read `STATUS.md`, then build Tier 1 (map restyle + live locations). Test locally after."_
- _"Read `STATUS.md`. I tried X in the demo trip and it didn't work — here's the error."_
- _"Read `STATUS.md`. Tune the ingestion prompts — here's a profile that came back too generic."_
- _"Read `STATUS.md`. I'm deploying to Vercel — what needs to change in serverless config?"_
