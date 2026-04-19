# EasternExe — Full Build Specification

**Read this entire document before writing any code. This is the complete source of truth for the build.**

---

## 1. Project overview

EasternExe is an AI-powered group trip workspace. A group of friends uploads trip-related material (WhatsApp chat export, documents, screenshots, and one short audio intro per person). The app ingests all of it, generates structured per-person profiles + shared trip memory + place pins, and opens a three-surface workspace:

1. **Group chat** — humans talk normally; the AI is invoked on demand with `@agent`
2. **Private AI chat** — each participant has their own persistent 1:1 with an AI assistant that knows the full trip context
3. **Map tab** — pins of every place extracted from the ingested material, colored by category, clickable for details

Plus one cross-surface feature: a **share-to-group** button that lets a user publish findings from their private AI chat into the group chat with attribution.

The main agent can invoke specialist **subagents** — long-running, visibly-distinct chat actors that do deeper work and stream progress updates. For v1 we ship exactly one: a **research subagent** that thoroughly investigates activities, bookings, or open questions.

This is for a real Tokyo trip happening next week. Real data will be used for testing.

---

## 2. Tech stack (locked — do not deviate)

| Concern | Choice |
|---|---|
| Framework | Next.js 14, App Router, TypeScript strict mode |
| Styling | Tailwind CSS + shadcn/ui (install via `npx shadcn@latest init`) |
| Backend | Supabase (Postgres + pgvector + Realtime + Storage) |
| LLM for agents | Z.ai via OpenAI-compatible client |
| Embeddings | OpenAI `text-embedding-3-small` |
| Audio transcription | OpenAI `whisper-1` |
| Maps | Mapbox GL JS via `react-map-gl` |
| Hosting | Vercel |
| Auth | None — `participantId_<tripId>` in localStorage |
| Forms | react-hook-form + zod |
| LLM output validation | zod |

Assume Z.ai is OpenAI-compatible (uses the standard `openai` SDK with a custom `baseURL`). If it turns out not to be, abstract the LLM client behind a `lib/llm.ts` wrapper so swapping providers is one file change.

---

## 3. Environment variables

All values will be pre-populated in `.env.local` at the project root by the operator. **Do not hardcode any keys anywhere.**

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Z.ai (main LLM for agents)
ZAI_API_KEY=
ZAI_BASE_URL=
ZAI_MODEL=

# OpenAI (embeddings + Whisper only)
OPENAI_API_KEY=

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=

# Google Places
GOOGLE_PLACES_API_KEY=

# Brave Search (optional; used by research subagent if present)
BRAVE_SEARCH_API_KEY=
```

If `BRAVE_SEARCH_API_KEY` is empty, the research subagent must degrade gracefully and operate on Google Places alone without error.

Generate a `.env.local.example` file that mirrors this (with empty values) and commit it.

---

## 4. File structure

```
easternexe/
├── BUILD_SPEC.md                  # this file
├── README.md                      # you generate: setup + run instructions
├── .env.local                     # operator-supplied, gitignored
├── .env.local.example             # you generate, committed
├── .gitignore
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
├── components.json                # shadcn config
├── supabase/
│   └── migrations/
│       └── 001_init.sql           # full schema + triggers + indices
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx               # landing, "Create a trip" CTA
│   │   ├── setup/
│   │   │   └── page.tsx           # stepped setup flow
│   │   ├── trip/[tripId]/
│   │   │   ├── layout.tsx
│   │   │   ├── page.tsx           # main workspace, 3 tabs
│   │   │   └── join/page.tsx      # "who are you?" picker
│   │   └── api/
│   │       ├── trips/route.ts
│   │       ├── participants/route.ts
│   │       ├── uploads/route.ts
│   │       ├── ingest/[tripId]/route.ts
│   │       ├── messages/route.ts
│   │       ├── agent/route.ts
│   │       └── share-to-group/route.ts
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts          # browser client (anon key)
│   │   │   └── server.ts          # server client (service role)
│   │   ├── llm.ts                 # Z.ai wrapper (OpenAI-compatible)
│   │   ├── openai.ts              # OpenAI wrapper (embeddings + whisper)
│   │   ├── embeddings.ts          # chunking + embedding helpers
│   │   ├── agent/
│   │   │   ├── main.ts            # main agent pipeline
│   │   │   ├── subagent-research.ts
│   │   │   └── tools.ts           # tool definitions + handlers
│   │   ├── ingest/
│   │   │   ├── pipeline.ts        # orchestrator
│   │   │   ├── whatsapp-parser.ts
│   │   │   ├── doc-extract.ts
│   │   │   └── audio-transcribe.ts
│   │   ├── prompts/
│   │   │   ├── ingest-profile.ts
│   │   │   ├── ingest-trip-memory.ts
│   │   │   ├── ingest-places.ts
│   │   │   ├── agent-group.ts
│   │   │   ├── agent-private.ts
│   │   │   └── subagent-research.ts
│   │   ├── schemas.ts             # zod schemas for all LLM outputs
│   │   ├── places.ts              # Google Places wrapper
│   │   ├── brave.ts               # Brave Search wrapper (optional)
│   │   └── utils.ts
│   ├── components/
│   │   ├── ui/                    # shadcn components
│   │   ├── chat/
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ChatInput.tsx
│   │   │   ├── ThinkingIndicator.tsx
│   │   │   └── ShareToGroupButton.tsx
│   │   ├── map/
│   │   │   ├── TripMap.tsx
│   │   │   └── PlaceCard.tsx
│   │   ├── setup/
│   │   │   ├── StepTripBasics.tsx
│   │   │   ├── StepParticipants.tsx
│   │   │   ├── StepUploads.tsx
│   │   │   ├── StepIntros.tsx
│   │   │   └── AudioRecorder.tsx
│   │   └── workspace/
│   │       ├── TabsShell.tsx
│   │       └── IngestProgress.tsx
│   ├── hooks/
│   │   ├── useParticipant.ts
│   │   ├── useChatMessages.ts
│   │   ├── useRealtimePlaces.ts
│   │   └── useTripStatus.ts
│   └── types/
│       └── db.ts                  # generated or hand-written Supabase types
```

---

## 5. Database schema

Place in `supabase/migrations/001_init.sql`. Execute by pasting into the Supabase SQL editor (instructed in README).

```sql
-- Extensions
create extension if not exists vector;
create extension if not exists "uuid-ossp";

-- trips
create table trips (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  destination text,
  destination_lat double precision,
  destination_lng double precision,
  start_date date,
  end_date date,
  status text default 'setup' check (status in ('setup','ingesting','ready','error')),
  error text,
  created_at timestamptz default now()
);

-- participants
create table participants (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  display_name text not null,
  color text not null,
  created_at timestamptz default now()
);

-- uploads
create table uploads (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  participant_id uuid references participants(id),
  kind text not null check (kind in ('whatsapp_zip','doc','image','audio_intro','other')),
  storage_path text not null,
  filename text,
  status text default 'pending' check (status in ('pending','processing','processed','failed')),
  error text,
  created_at timestamptz default now()
);

-- upload_chunks (for retrieval)
create table upload_chunks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references uploads(id) on delete cascade,
  trip_id uuid not null references trips(id) on delete cascade,
  content text not null,
  embedding vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on upload_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index on upload_chunks (trip_id);

-- participant_profiles
create table participant_profiles (
  participant_id uuid primary key references participants(id) on delete cascade,
  personality text,
  interests jsonb default '[]',
  budget_style text,
  travel_style text,
  food_preferences jsonb default '[]',
  dislikes jsonb default '[]',
  dealbreakers jsonb default '[]',
  open_questions jsonb default '[]',
  raw_intro_transcript text,
  updated_at timestamptz default now()
);

-- trip_memory
create table trip_memory (
  trip_id uuid primary key references trips(id) on delete cascade,
  destination text,
  constraints jsonb default '[]',
  group_preferences jsonb default '[]',
  priorities jsonb default '[]',
  tensions jsonb default '[]',
  decisions_made jsonb default '[]',
  open_questions jsonb default '[]',
  updated_at timestamptz default now()
);

-- places
create table places (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  name text not null,
  lat double precision,
  lng double precision,
  google_place_id text,
  category text check (category in ('food','drinks','sight','shopping','nature','nightlife','other')),
  status text default 'saved' check (status in ('saved','visited','suggested')),
  added_by uuid references participants(id),
  added_by_agent boolean default false,
  notes text,
  source text check (source in ('whatsapp','doc','agent','manual','ingest')),
  time_of_day text check (time_of_day in ('morning','afternoon','evening','night','any')),
  created_at timestamptz default now()
);
create index on places (trip_id);

-- chat_rooms
create table chat_rooms (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  type text not null check (type in ('group','agent')),
  owner_id uuid references participants(id),
  created_at timestamptz default now(),
  unique (trip_id, type, owner_id)
);

-- chat_messages
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat_rooms(id) on delete cascade,
  sender_participant_id uuid references participants(id),
  sender_type text not null check (sender_type in ('user','agent','subagent','system')),
  sender_label text,
  content text not null,
  attachments jsonb default '[]',
  parent_message_id uuid references chat_messages(id),
  shared_from_room_id uuid references chat_rooms(id),
  shared_by_participant_id uuid references participants(id),
  thinking_state text check (thinking_state in ('thinking','streaming','done','failed')),
  tool_calls jsonb default '[]',
  metadata jsonb default '{}',
  created_at timestamptz default now()
);
create index on chat_messages (room_id, created_at);

-- ai_runs (audit log)
create table ai_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id),
  kind text not null,
  input jsonb,
  output jsonb,
  error text,
  duration_ms int,
  model text,
  created_at timestamptz default now()
);

-- Trigger: auto-create group room + trip_memory shell when trip is created
create or replace function create_trip_side_effects()
returns trigger as $$
begin
  insert into chat_rooms (trip_id, type, owner_id) values (new.id, 'group', null);
  insert into trip_memory (trip_id) values (new.id);
  return new;
end;
$$ language plpgsql;

create trigger trip_insert_side_effects
  after insert on trips
  for each row execute function create_trip_side_effects();

-- Trigger: auto-create agent room + profile shell per participant
create or replace function create_participant_side_effects()
returns trigger as $$
begin
  insert into chat_rooms (trip_id, type, owner_id) values (new.trip_id, 'agent', new.id);
  insert into participant_profiles (participant_id) values (new.id);
  return new;
end;
$$ language plpgsql;

create trigger participant_insert_side_effects
  after insert on participants
  for each row execute function create_participant_side_effects();

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('trip-uploads', 'trip-uploads', false)
on conflict (id) do nothing;

-- RLS: disabled for MVP; trip_id in URL is the boundary
alter table trips disable row level security;
alter table participants disable row level security;
alter table uploads disable row level security;
alter table upload_chunks disable row level security;
alter table participant_profiles disable row level security;
alter table trip_memory disable row level security;
alter table places disable row level security;
alter table chat_rooms disable row level security;
alter table chat_messages disable row level security;
alter table ai_runs disable row level security;
```

After the migration, the README must instruct the operator to go to Supabase Dashboard → Database → Replication and toggle realtime ON for: `chat_messages`, `places`, `trips`, `uploads`, `participant_profiles`, `trip_memory`.

---

## 6. Routes and UI surfaces

### 6.1 `/` — Landing

A minimal centered page:
- Product name "EasternExe"
- One-line tagline ("The AI workspace for group trips")
- Primary button: "Create a trip" → `/setup`

### 6.2 `/setup` — Stepped setup flow

Single page, 5 steps, progress indicator at top, back/next navigation. Local state held in a reducer; only commits to DB at the "Run ingestion" step.

**Step 1: Trip basics**
- Name (required)
- Destination (required, text field)
- Start date, end date (optional)

**Step 2: Participants**
- Add participants by display name (minimum 2)
- Auto-assign a color per participant from a preset palette of 8 distinct colors
- Remove/rename inline

**Step 3: Shared material**
- Drag-and-drop or click-to-upload
- Accept: `.zip` (WhatsApp export), `.pdf`, `.txt`, `.md`, `.png`, `.jpg`, `.jpeg`
- Files list with remove button; no size limit client-side (Supabase storage handles up to 50MB free tier, which is plenty)

**Step 4: Audio intros per participant**
- For each participant, a card with:
  - Their display name + color avatar
  - `<AudioRecorder>` component: "Start recording" → "Stop" → shows waveform-like visual feedback → "Re-record" or "Keep"
  - Optional text notes field
- Browser MediaRecorder API, 48kbps mono, upload as `.webm` or `.m4a` (whichever Whisper accepts — use `.webm` opus, Whisper handles it)
- Skip button allowed per participant; profile quality will be lower

**Step 5: Review & run**
- Summary of everything uploaded
- "Run ingestion" button → POSTs to `/api/ingest/[tripId]`, navigates to `/trip/[tripId]`

### 6.3 `/trip/[tripId]/join` — Participant picker

- Shown the first time someone opens the trip URL without a `participantId_<tripId>` in localStorage
- List of participants as cards (avatar + name)
- Click → persist `participantId_<tripId>=<id>` in localStorage, redirect to `/trip/[tripId]`

### 6.4 `/trip/[tripId]` — Main workspace

Three tabs, sticky tab bar at top:
- **Group** (default): group chat room
- **Me**: the current participant's private AI chat room (redirects to `/join` if no participantId in localStorage)
- **Map**: the places map

While `trip.status !== 'ready'`, show a modal overlay: `<IngestProgress>` with a live list of uploads processing, profile generation progress, etc. (Driven by realtime subscription to `uploads` + `trips`.)

---

## 7. Ingestion pipeline

Endpoint: `POST /api/ingest/[tripId]`

Runs server-side, streams progress via DB updates that clients observe through Realtime.

**Steps:**

1. Set `trips.status = 'ingesting'`.
2. For each upload with `status = 'pending'`, update to `'processing'`, then handle by kind:
   - **`whatsapp_zip`**: unzip in-memory (use `adm-zip` or `jszip`), parse `_chat.txt`:
     - iOS format: `[DD/MM/YYYY, HH:MM:SS] Name: message`
     - Android format: `DD/MM/YYYY, HH:MM - Name: message`
     - Normalize to `[timestamp] Name: message` one per line
     - Save any media files inside the zip as additional `uploads` rows (`kind='image'` or `'other'`) with the same participant context
     - Concatenate all messages into a single text blob
   - **`doc`**: extract text. For PDFs use `pdf-parse`. For `.txt/.md` use utf-8 read. For images, skip text extraction in v1 (just store).
   - **`audio_intro`**: transcribe via OpenAI Whisper (`whisper-1`). Store the transcript in `participant_profiles.raw_intro_transcript` for the corresponding participant.
   - On success set upload `status='processed'`, on failure `'failed'` with error text.
3. Chunk all extracted text at ~500 tokens per chunk with ~50 token overlap. Embed with OpenAI `text-embedding-3-small`. Write to `upload_chunks`.
4. **Per-participant profile generation:** for each participant, run one Z.ai call with:
   - System prompt from `lib/prompts/ingest-profile.ts`
   - Input: their audio intro transcript + optional text notes + relevant chunks (top 10 by similarity to "preferences interests personality")
   - Force JSON output via response_format or strict prompting; validate with zod
   - Write to `participant_profiles`
5. **Trip memory generation:** one Z.ai call with:
   - System prompt from `lib/prompts/ingest-trip-memory.ts`
   - Input: all chunks (or a sampled/summarized subset if very large)
   - Write to `trip_memory`
6. **Places extraction:** one Z.ai call with:
   - System prompt from `lib/prompts/ingest-places.ts`
   - Input: all chunks + trip destination
   - Output: JSON array of `{ name, category, time_of_day, notes, source_hint }`
   - For each extracted place, call Google Places Text Search scoped to the destination city. Pick top result. Write to `places` with `source='ingest'`.
   - Also geocode the destination itself and write `trips.destination_lat`, `trips.destination_lng`.
7. Set `trips.status = 'ready'`.
8. Log every LLM call to `ai_runs` with input/output/duration_ms/model.

On failure at any step: set `trips.status = 'error'` with error text. UI surfaces a retry button (not required for v1; error state can simply show the message).

---

## 8. Agent system

### 8.1 Trigger conditions

- **Group room**: a message with `sender_type='user'` whose content contains `@agent` (case-insensitive, regex `/@agent\b/i`)
- **Agent room** (private): any message with `sender_type='user'` from the room owner

On trigger:
1. Immediately insert a placeholder agent message (`sender_type='agent'`, `sender_label='Agent'`, `content=''`, `thinking_state='thinking'`, `parent_message_id=<trigger>`)
2. Kick off the agent pipeline (async; the endpoint `POST /api/agent` does the work)
3. As the model streams / calls tools, update the placeholder message row in-place (content grows, `thinking_state` transitions through `'streaming'` → `'done'`)

### 8.2 Context construction

For every agent call, build the context as:
- Last 20 messages in the room (chronological)
- `trip_memory` (full JSON)
- **Group mode:** all `participant_profiles` (full JSON)
- **Private mode:** only the current participant's profile
- RAG: embed the latest user message, retrieve top 5 chunks from `upload_chunks` for this trip
- In private mode, also inject the group chat's last 20 messages as read-only context, clearly labeled so the agent can reference but not quote

### 8.3 Tools

All tools defined in `lib/agent/tools.ts`. Each has a handler that executes server-side.

| Tool | Parameters | Returns | Notes |
|---|---|---|---|
| `query_trip_brain` | `question: string` | top 5 chunks as concatenated text | Embeds question, cosine-similarity search on `upload_chunks` |
| `search_places` | `query: string`, `category?: string` | array of places | Google Places Text Search biased to trip destination |
| `save_place` | `name`, `lat`, `lng`, `category`, `notes`, `time_of_day` | inserted place | Sets `added_by_agent=true` |
| `get_participant_profile` | `name: string` | profile JSON | Fuzzy match on display_name |
| `research_activity` | `description: string`, `requester_context?: string` | subagent's final summary | **Triggers the research subagent; see 8.5** |

### 8.4 Main agent prompts

**Group mode** (`lib/prompts/agent-group.ts`):

```
You are the EasternExe trip assistant for a group of friends planning a trip. You are currently responding INSIDE THE GROUP CHAT — the whole group will see your reply.

Be concise. When surfacing options, present 2-3 choices with trade-offs and invite the group to decide. Use participants' names when referencing their preferences. Do not ramble.

Trip brain:
{trip_memory_json}

Participants:
{participant_profiles_json}

Recent messages:
{last_20_messages}

Retrieved context:
{rag_chunks}

When a task needs thorough investigation (researching activities, finding bookings, investigating specific options), use the research_activity tool instead of speculating. The tool spawns a specialist Research Agent that performs multi-step research and returns findings directly into the chat.
```

**Private mode** (`lib/prompts/agent-private.ts`):

```
You are the EasternExe trip assistant, responding privately to {participant_name}. Only they will see your reply.

Their profile:
{their_profile_json}

Shared trip brain:
{trip_memory_json}

Group chat context (read-only; do not quote directly back unless asked):
{group_recent_messages}

Their private chat history with you:
{private_recent_messages}

Retrieved context:
{rag_chunks}

Be more thorough than in the group chat. Tailor recommendations specifically to them. When your findings would benefit the whole group, suggest: "You can share this to the group with the share button if you want."

Use the research_activity tool when they ask for thorough investigation.
```

### 8.5 Research subagent

Triggered when the main agent calls `research_activity(description, requester_context)`.

**Flow:**
1. Insert a new message in the SAME room with `sender_type='subagent'`, `sender_label='Research Agent'`, `content='Looking into this — checking options, pricing, availability…'`, `thinking_state='thinking'`.
2. Start a separate Z.ai call with:
   - System prompt from `lib/prompts/subagent-research.ts`
   - Tools: `search_places`, `save_place`, and if `BRAVE_SEARCH_API_KEY` is set, `web_search(query: string)`
   - Loop up to 5 tool-use turns
3. During the loop, emit at least 2 progress updates by updating the subagent message content (e.g. "Found 12 candidates, filtering by group preferences…" → "Checking opening hours and prices…" → final reply). Budget updates roughly every 2-4 seconds or between tool calls.
4. Final content: structured response (brief intro, 2-3 options each with name/why-it-fits/practical details, one sentence on what was ruled out). Target <300 words.
5. Set subagent message `thinking_state='done'`.
6. Return a one-paragraph summary string to the main agent so it can comment briefly.

**Subagent prompt** (`lib/prompts/subagent-research.ts`):

```
You are the EasternExe Research Agent, a specialist subagent. Your job: thoroughly investigate one specific activity, booking, or question for a trip, then return 2-3 top options with clear reasoning.

Request: {description}
Requester context: {requester_context}
Trip context: {trip_memory_json}

Use your tools aggressively. Search places, follow up on promising candidates, cross-check with the requester's preferences. Don't settle for generic tourist options — find things that fit THIS group specifically.

Return your findings as:
- Brief intro (1 sentence)
- Option 1: name, why it fits, practical details (address, approx price, booking notes)
- Option 2: ...
- Option 3: ...
- One-sentence note on what you ruled out and why

Keep the final response under 300 words.
```

### 8.6 Error handling

- Wrap all LLM calls in try/catch. On failure: set the message's `thinking_state='failed'`, replace content with a friendly fallback ("Sorry, I hit an error. Try rephrasing?"), log to `ai_runs` with the error.
- If an LLM returns malformed JSON (for ingest steps): retry once with a correction prompt ("Your previous response was invalid JSON. Return ONLY valid JSON matching this schema: …"). Then fail.
- Validate every structured LLM output with zod before writing to DB.

---

## 9. Share-to-group behavior

On any `agent` or `subagent` message inside a private agent room, render a small "Share to group" icon button (arrow-up-right icon from lucide).

**Flow:**
1. Click → confirm dialog ("Share this to the group chat?")
2. On confirm, `POST /api/share-to-group` with `{ messageId, groupRoomId }`
3. Server inserts a new message in the group room:
   - `sender_participant_id = <user's id>`
   - `sender_type = 'user'`
   - `content` = styled preamble ("💡 Shared from private research:") + the original message content verbatim
   - `shared_from_room_id = <private room id>`
   - `shared_by_participant_id = <user's id>`
4. In the UI, group chat messages with `shared_from_room_id` set render with a distinct visual treatment: a subtle border-left accent, a small "Shared by {name} from private research" badge above the content.

---

## 10. Chat UI requirements

- **Auto-scroll**: only scroll to bottom on new message if user was already within 100px of bottom. If they've scrolled up, show a "↓ New messages" floating button that scrolls down on click.
- **User messages**: right-aligned, primary color bubble
- **Agent messages**: left-aligned, subtle muted background, small "Agent" label + bot icon
- **Subagent messages**: left-aligned, distinct accent color (purple or similar), "Research Agent" label with a different icon
- **Optimistic sends**: user's message appears immediately at opacity-50, transitions to opacity-100 on DB confirm, red underline if insert fails (retry button)
- **`thinking_state='thinking'`**: render bubble with only an animated 3-dot pulse, no text
- **`thinking_state='streaming'`**: render partial content with a blinking cursor at the end
- **`thinking_state='done'`**: render fully, no indicator
- **`thinking_state='failed'`**: red-tinted bubble with fallback text
- **Share-to-group button**: visible only on agent/subagent messages in private rooms, in the message's hover/tap affordance area
- **Shared messages in group chat**: border-left-4 with subtle accent, attribution badge above content
- **Avatar**: colored circle with first letter of display name, using `participants.color`
- **Typography**: Inter font loaded via `next/font`, tight letter-spacing on headings, generous line-height on body. Target Linear/Stripe-grade polish.
- **Empty states**: never "No messages yet" — instead, a welcome message from the agent suggesting starter prompts
- **Responsive**: mobile-first. On mobile, tabs are a bottom bar; chat input is fixed-bottom above it.

---

## 11. Map tab

- Mapbox GL JS via `react-map-gl`, default style `mapbox://styles/mapbox/dark-v11`
- Center on `trips.destination_lat/lng`, default zoom 12
- Render one marker per row in `places` for this trip, colored by category (use a small palette):
  - food: orange
  - drinks: pink
  - sight: blue
  - shopping: green
  - nature: teal
  - nightlife: purple
  - other: gray
- Click pin → small popover `PlaceCard`: name, category pill, who added it (participant name + avatar, or "Agent"), notes, "Ask Agent about this" button that switches tab to `me` and prefills input with "Tell me about {place name}"
- Filter chips row at top: All / Food / Drinks / Sights / Shopping / Nightlife (multi-select or single-select — single is simpler, use single)
- Subscribe to realtime on `places` table so new agent-added pins appear live

---

## 12. Realtime wiring

Use `@supabase/supabase-js` v2 realtime client.

Three hooks, all in `src/hooks/`:

```ts
// useChatMessages(roomId: string): { messages, sendMessage, pending }
// Subscribes to INSERT and UPDATE on chat_messages filtered by room_id.
// Merges with optimistic local state.

// useRealtimePlaces(tripId: string): Place[]
// Subscribes to INSERT/UPDATE on places filtered by trip_id.

// useTripStatus(tripId: string): { trip, uploads }
// Subscribes to UPDATE on trips and uploads for ingest progress UI.
```

---

## 13. Milestone checkpoints (execute sequentially, STOP at each)

At each STOP: commit with clean message, tell operator what to test, wait for confirmation before continuing.

1. **Scaffold** — Next.js + Tailwind + shadcn installed, basic layout, landing page renders. Operator runs `npm run dev`, sees the landing page. **STOP.**
2. **Schema** — `supabase/migrations/001_init.sql` complete. Print clear instructions for operator to paste into Supabase SQL editor, then enable realtime on listed tables in dashboard. Operator verifies by creating a test trip via SQL and confirming the trigger fires. **STOP.**
3. **Setup flow** — Steps 1–4 wired to local state; step 5 commits trip, participants, uploads (files uploaded to Supabase Storage) but does NOT yet run ingestion. Operator walks through the flow. **STOP.**
4. **Basic chat** — Group room and agent rooms render; sending messages works; realtime works cross-window. No agent yet. Operator opens two browser windows with different participantIds, verifies realtime. **STOP.**
5. **Ingestion pipeline** — Full end-to-end. Operator uploads real WhatsApp zip + real audio intros, runs ingestion, verifies profiles and trip memory look good, verifies place pins show up on the map tab (map tab may still be basic). **STOP — highest-risk milestone; do not move on until quality is verified.**
6. **Main agent** — `@agent` triggers in group; private AI chat always responds. All 4 non-subagent tools work. **Operator tests with 5+ queries.** **STOP.**
7. **Map tab** — Pins rendering, filters working, click-for-details working. **STOP.**
8. **Share-to-group** — Button appears in right places, sharing works end-to-end with proper attribution. **STOP.**
9. **Research subagent** — `research_activity` tool triggers subagent; progressive messages; full flow completes reliably. **STOP.**
10. **Polish pass** — Typography, animations, empty states, error states, mobile responsiveness, loading skeletons. **STOP.**

---

## 14. Not in scope (do not build)

- Authentication (no passwords, no magic links — just localStorage participantId)
- Email, calendar, Gmail integrations
- Actual booking (subagent returns *info only*)
- Custom Mapbox styling beyond `dark-v11`
- Read receipts, typing indicators (except agent thinking)
- Voice notes in chat (only the one-time ingest audio intros)
- Additional subagents (just research for v1)
- Complex error recovery UIs — a toast or banner is fine
- Multi-trip UI (schema supports multiple; UI only needs one at a time)
- Admin/participant-management UIs after setup
- Notifications, push, PWA features

---

## 15. Working agreement with operator

- **This spec is the source of truth.** If something is genuinely ambiguous, ask. If it's just a minor choice (naming, component structure), decide and move on.
- **Stop at milestone checkpoints and let the operator test.** Never blast through to the end without verification.
- **When errors occur, surface them clearly.** Don't silently work around. Show the error, propose a fix.
- **Commit after each milestone** with a descriptive message.
- **Use idiomatic Next.js 14 App Router patterns** — Server Components by default, Client Components with explicit `'use client'`, Route Handlers for APIs.
- **Validate all LLM outputs with zod before using them.**
- **Wrap all external calls (LLM, embeddings, Whisper, Places, Brave) in try/catch with logging to `ai_runs` where relevant.**

---

## 16. Start here

1. Confirm you have read and understood this entire spec.
2. Ask at most 3 genuinely blocking questions (don't invent questions — most things are answered above).
3. Begin milestone 1: scaffold. Execute it. Stop and tell the operator exactly how to verify before proceeding.

Go.
