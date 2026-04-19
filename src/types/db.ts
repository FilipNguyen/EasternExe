/**
 * EasternExe database types — hand-mirrored to supabase/migrations/001_init.sql.
 * If the schema changes, update these in lockstep.
 */

export type TripStatus = "setup" | "ingesting" | "ready" | "error";
export type UploadKind = "whatsapp_zip" | "doc" | "image" | "audio_intro" | "other";
export type UploadStatus = "pending" | "processing" | "processed" | "failed";
export type PlaceCategory =
  | "food"
  | "drinks"
  | "sight"
  | "shopping"
  | "nature"
  | "nightlife"
  | "other";
export type PlaceStatus = "saved" | "visited" | "suggested";
export type PlaceSource = "whatsapp" | "doc" | "agent" | "manual" | "ingest";
export type TimeOfDay = "morning" | "afternoon" | "evening" | "night" | "any";
export type ChatRoomType = "group" | "agent";
export type SenderType = "user" | "agent" | "subagent" | "system";
export type ThinkingState = "thinking" | "streaming" | "done" | "failed";

export interface Trip {
  id: string;
  name: string;
  destination: string | null;
  destination_lat: number | null;
  destination_lng: number | null;
  start_date: string | null;
  end_date: string | null;
  status: TripStatus;
  error: string | null;
  created_at: string;
}

export interface Participant {
  id: string;
  trip_id: string;
  display_name: string;
  color: string;
  created_at: string;
}

export interface Upload {
  id: string;
  trip_id: string;
  participant_id: string | null;
  kind: UploadKind;
  storage_path: string;
  filename: string | null;
  status: UploadStatus;
  error: string | null;
  created_at: string;
}

export interface UploadChunk {
  id: string;
  upload_id: string;
  trip_id: string;
  content: string;
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ParticipantProfile {
  participant_id: string;
  personality: string | null;
  interests: string[];
  budget_style: string | null;
  travel_style: string | null;
  food_preferences: string[];
  dislikes: string[];
  dealbreakers: string[];
  open_questions: string[];
  raw_intro_transcript: string | null;
  updated_at: string;
}

export interface TripMemory {
  trip_id: string;
  destination: string | null;
  constraints: string[];
  group_preferences: string[];
  priorities: string[];
  tensions: string[];
  decisions_made: string[];
  open_questions: string[];
  updated_at: string;
}

export interface Place {
  id: string;
  trip_id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  google_place_id: string | null;
  category: PlaceCategory | null;
  status: PlaceStatus;
  added_by: string | null;
  added_by_agent: boolean;
  notes: string | null;
  source: PlaceSource | null;
  time_of_day: TimeOfDay | null;
  created_at: string;
}

export interface ChatRoom {
  id: string;
  trip_id: string;
  type: ChatRoomType;
  owner_id: string | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  room_id: string;
  sender_participant_id: string | null;
  sender_type: SenderType;
  sender_label: string | null;
  content: string;
  attachments: unknown[];
  parent_message_id: string | null;
  shared_from_room_id: string | null;
  shared_by_participant_id: string | null;
  thinking_state: ThinkingState | null;
  tool_calls: unknown[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AiRun {
  id: string;
  trip_id: string | null;
  kind: string;
  input: unknown;
  output: unknown;
  error: string | null;
  duration_ms: number | null;
  model: string | null;
  created_at: string;
}
