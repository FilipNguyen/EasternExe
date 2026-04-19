"use client";

import { useEffect, useState } from "react";
import { Bot, Clock, ExternalLink, MessageCircle, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/components/map/categories";
import type { Participant, Place } from "@/types/db";

interface Props {
  place: Place;
  addedBy: Participant | null;
  onAskAgent: (place: Place) => void;
  onClose?: () => void;
  compact?: boolean;
}

interface Details {
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  primaryTypeDisplayName?: { text?: string };
  editorialSummary?: { text?: string };
  generativeSummary?: { overview?: { text?: string } };
  reviews?: Array<{ text?: { text?: string }; rating?: number }>;
  regularOpeningHours?: { openNow?: boolean };
  googleMapsUri?: string;
}

const PRICE_LEVELS: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

function googleMapsUrl(place: Place, fallback?: string) {
  if (fallback) return fallback;
  if (place.google_place_id) {
    return `https://www.google.com/maps/place/?q=place_id:${place.google_place_id}`;
  }
  if (place.lat != null && place.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    place.name
  )}`;
}

export function PlaceCard({
  place,
  addedBy,
  onAskAgent,
  onClose,
  compact,
}: Props) {
  const color = place.category ? CATEGORY_COLORS[place.category] : "#64748b";
  const label = place.category ? CATEGORY_LABELS[place.category] : "Other";
  const [details, setDetails] = useState<Details | null>(null);
  const [photoOk, setPhotoOk] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // no-store so we don't lock in a stale 404 from before a backfill;
        // server already sets 1h cache-control which is enough.
        const res = await fetch(`/api/places/${place.id}/details`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { details: Details | null };
        if (active && body.details) setDetails(body.details);
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [place.id]);

  const price = details?.priceLevel
    ? PRICE_LEVELS[details.priceLevel]
    : undefined;
  const openNow = details?.regularOpeningHours?.openNow;
  const subtitle =
    details?.primaryTypeDisplayName?.text ??
    (place.category ? CATEGORY_LABELS[place.category] : null);

  // Description priority: (1) Google's own generative overview, (2) editorial
  // blurb, (3) the first public review snippet, (4) whatever was ingested
  // into `notes` from the group's materials, (5) a synthesized "Rated 4.0★
  // Japanese cafe" fallback so the card never shows a bare title.
  const firstReview = details?.reviews?.[0]?.text?.text;
  const trimReview = (s: string) => {
    const clean = s.replace(/\s+/g, " ").trim();
    const firstSentence = clean.match(/^.{20,200}?[.!?](?=\s|$)/);
    return (firstSentence?.[0] ?? clean).slice(0, 220);
  };
  const generativeSummary = details?.generativeSummary?.overview?.text;
  const synthFallback =
    subtitle && details?.rating
      ? `${subtitle} · ${details.rating.toFixed(1)}★ on Google${
          details.userRatingCount
            ? ` (${details.userRatingCount.toLocaleString()} reviews)`
            : ""
        }.`
      : null;
  const summary =
    generativeSummary ??
    details?.editorialSummary?.text ??
    (firstReview ? trimReview(firstReview) : null) ??
    place.notes ??
    synthFallback ??
    null;

  return (
    <div
      className={`overflow-hidden rounded-xl border bg-card shadow-xl animate-fade-in ${
        compact ? "w-[260px]" : "w-[300px]"
      }`}
    >
      {photoOk ? (
        <div className="relative aspect-[16/10] w-full bg-muted">
          <img
            src={`/api/places/${place.id}/photo?w=640`}
            alt=""
            className="h-full w-full object-cover"
            onError={() => setPhotoOk(false)}
          />
          <span
            className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur"
          >
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: color }}
              aria-hidden
            />
            {label}
          </span>
        </div>
      ) : null}

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold leading-tight">
              {place.name}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
              {details?.rating ? (
                <span className="inline-flex items-center gap-0.5 font-medium text-amber-600">
                  {details.rating.toFixed(1)}
                  <Star className="size-3 fill-current" />
                  {details.userRatingCount ? (
                    <span className="text-muted-foreground">
                      ({details.userRatingCount.toLocaleString()})
                    </span>
                  ) : null}
                </span>
              ) : null}
              {subtitle ? <span>{subtitle}</span> : null}
              {price ? <span>{price}</span> : null}
              {openNow === true ? (
                <span className="font-medium text-green-600">Open</span>
              ) : openNow === false ? (
                <span className="font-medium text-red-600">Closed</span>
              ) : null}
              {place.time_of_day && place.time_of_day !== "any" ? (
                <span className="inline-flex items-center gap-0.5">
                  <Clock className="size-3" />
                  {place.time_of_day}
                </span>
              ) : null}
            </div>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              ✕
            </button>
          ) : null}
        </div>

        {summary ? (
          <p className="mt-2 line-clamp-3 rounded-md bg-muted/60 p-2 text-xs leading-relaxed text-foreground/80">
            {summary}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {place.added_by_agent ? (
            <>
              <Bot className="size-3" />
              Added by Agent
            </>
          ) : addedBy ? (
            <>
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: addedBy.color }}
                aria-hidden
              />
              Added by {addedBy.display_name}
            </>
          ) : (
            <>Ingested from group materials</>
          )}
        </div>

        <div className="mt-3 flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onAskAgent(place)}
          >
            <MessageCircle /> Ask
          </Button>
          <a
            href={googleMapsUrl(place, details?.googleMapsUri)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <ExternalLink className="size-3" />
            Maps
          </a>
        </div>
      </div>
    </div>
  );
}
