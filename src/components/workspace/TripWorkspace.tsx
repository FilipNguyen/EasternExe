"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import { TabsShell, type WorkspaceTab } from "@/components/workspace/TabsShell";
import { IngestProgress } from "@/components/workspace/IngestProgress";
import { TripBrainPanel } from "@/components/workspace/TripBrainPanel";
import { TripInfoPanel } from "@/components/workspace/TripInfoPanel";
import { NearbyPanel } from "@/components/workspace/NearbyPanel";
import { EventsPanel } from "@/components/workspace/EventsPanel";
import { AddContextPanel } from "@/components/workspace/AddContextPanel";
import { TripUserMenu } from "@/components/workspace/TripUserMenu";
import { TripMap } from "@/components/map/TripMap";
import { useChatMessages } from "@/hooks/useChatMessages";
import { useChatInactivityWatcher } from "@/hooks/useChatInactivityWatcher";
import { useParticipant } from "@/hooks/useParticipant";
import { useRealtimePlaces } from "@/hooks/useRealtimePlaces";
import { useTripStatus } from "@/hooks/useTripStatus";
import type { Participant, Place, Trip } from "@/types/db";

interface Props {
  trip: Trip;
  participants: Participant[];
  groupRoomId: string;
  agentRoomsByParticipant: Record<string, string>;
}

export function TripWorkspace({
  trip: initialTrip,
  participants,
  groupRoomId,
  agentRoomsByParticipant,
}: Props) {
  const router = useRouter();
  const { participantId, hydrated } = useParticipant(initialTrip.id);
  const [tab, setTab] = useState<WorkspaceTab>("group");
  const [addOpen, setAddOpen] = useState(false);

  const { trip: liveTrip, uploads } = useTripStatus(initialTrip.id, initialTrip);
  const trip = liveTrip ?? initialTrip;

  const { places } = useRealtimePlaces(initialTrip.id);

  const [prefill, setPrefill] = useState<{ key: number; text: string }>({
    key: 0,
    text: "",
  });

  const askAgentAbout = (place: Place) => {
    setTab("me");
    setPrefill((p) => ({
      key: p.key + 1,
      text: `Tell me about ${place.name}.`,
    }));
  };

  const shareToGroup = async (messageId: string) => {
    if (!participantId) throw new Error("No participant");
    const res = await fetch("/api/share-to-group", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message_id: messageId,
        group_room_id: groupRoomId,
        shared_by_participant_id: participantId,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Share failed");
    }
  };

  const participantMap = useMemo(
    () => Object.fromEntries(participants.map((p) => [p.id, p])),
    [participants]
  );

  const myAgentRoomId = participantId
    ? agentRoomsByParticipant[participantId]
    : undefined;

  const activeRoomId =
    tab === "group" ? groupRoomId : tab === "me" ? myAgentRoomId : undefined;

  const { messages, loading: loadingMessages, send } =
    useChatMessages(activeRoomId);

  // Group-room messages (may equal `messages` if we're on the group tab).
  // Drives the 30-min inactivity watcher that triggers a graph summary.
  const { messages: groupMessages } = useChatMessages(
    activeRoomId === groupRoomId ? undefined : groupRoomId
  );
  const watchedMessages =
    activeRoomId === groupRoomId ? messages : groupMessages;
  useChatInactivityWatcher(trip.id, watchedMessages);

  if (hydrated && !participantId) {
    router.replace(`/trip/${trip.id}/join`);
    return null;
  }

  const me = participantId ? participantMap[participantId] : null;
  const isMapTab = tab === "map";
  const isNearbyTab = tab === "nearby";
  const isEventsTab = tab === "events";
  const isPanelTab = isNearbyTab || isEventsTab;
  const isChatTab = !isMapTab && !isPanelTab;

  return (
    <main className="flex h-dvh flex-col bg-background">
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">
              {trip.name}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {trip.destination}
              {trip.status !== "ready" ? ` · ${trip.status}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              aria-label="Add context"
            >
              <Plus className="size-3.5" />
              Add
            </button>
            {me ? (
              <TripUserMenu
                tripId={trip.id}
                displayName={me.display_name}
                color={me.color}
              />
            ) : null}
          </div>
        </div>
      </header>
      {addOpen ? (
        <AddContextPanel
          tripId={trip.id}
          onClose={() => setAddOpen(false)}
        />
      ) : null}

      <TabsShell active={tab} onChange={setTab} />

      <div className="flex min-h-0 flex-1">
        {!isMapTab ? (
          <aside className="hidden w-64 shrink-0 lg:flex lg:flex-col">
            <TripInfoPanel
              trip={trip}
              participants={participants}
              currentParticipantId={participantId ?? null}
              messages={messages}
            />
          </aside>
        ) : null}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col pb-14 sm:pb-0">
          {isNearbyTab ? (
            <NearbyPanel trip={trip} places={places} />
          ) : isEventsTab ? (
            <EventsPanel trip={trip} />
          ) : !isMapTab ? (
            <>
              <MessageList
                messages={messages}
                loading={loadingMessages}
                participants={participantMap}
                currentParticipantId={participantId}
                tripId={trip.id}
                onShareToGroup={tab === "me" ? shareToGroup : undefined}
                emptyState={
                  tab === "group" ? (
                    <div className="mx-auto max-w-sm text-center">
                      <h3 className="text-base font-semibold">
                        No messages yet
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Say hi to the group — or tag{" "}
                        <code className="rounded bg-muted px-1 py-0.5 text-xs">
                          @agent
                        </code>{" "}
                        once your trip is ingested.
                      </p>
                    </div>
                  ) : (
                    <div className="mx-auto max-w-sm text-center">
                      <h3 className="text-base font-semibold">
                        Your private assistant
                      </h3>
                      <p className="mt-2 text-sm text-muted-foreground">
                        Ask anything about the trip — only you see these replies.
                      </p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        {[
                          "What should we do on day 1?",
                          "Any tensions in the group I should know about?",
                          "Find me a great dinner spot that fits the group.",
                        ].map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() =>
                              setPrefill((p) => ({
                                key: p.key + 1,
                                text: prompt,
                              }))
                            }
                            className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                }
              />
              <ChatInput
                placeholder={
                  tab === "group"
                    ? "Message the group… (@agent to ask the AI)"
                    : "Ask your private assistant…"
                }
                onSend={(content) =>
                  send({
                    content,
                    senderParticipantId: participantId,
                    senderType: "user",
                  })
                }
                disabled={!activeRoomId || !participantId}
                prefillKey={tab === "me" ? prefill.key : undefined}
                prefillContent={prefill.text}
              />
            </>
          ) : (
            <TripMap
              trip={trip}
              places={places}
              participants={participants}
              currentParticipantId={participantId ?? null}
              onAskAgent={askAgentAbout}
            />
          )}
        </section>

        {isChatTab ? (
          <aside className="hidden w-80 shrink-0 lg:flex lg:flex-col">
            <TripBrainPanel trip={trip} places={places} />
          </aside>
        ) : null}
      </div>

      {trip.status !== "ready" ? (
        <IngestProgress trip={trip} uploads={uploads} />
      ) : null}
    </main>
  );
}
