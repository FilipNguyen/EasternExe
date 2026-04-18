"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";

import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
} from "@/components/map/categories";
import type { Place, PlaceCategory } from "@/types/db";

interface Props {
  places: Place[];
}

function googleMapsUrl(place: Place) {
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

export function PlacesPanel({ places }: Props) {
  const [filter, setFilter] = useState<PlaceCategory | "all">("all");

  const filtered = places
    .filter((p) => p.lat != null && p.lng != null)
    .filter((p) => filter === "all" || p.category === filter);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap gap-1 px-1">
        <CategoryChip
          label="All"
          color="#475569"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        {CATEGORY_ORDER.map((cat) => (
          <CategoryChip
            key={cat}
            label={CATEGORY_LABELS[cat]}
            color={CATEGORY_COLORS[cat]}
            active={filter === cat}
            onClick={() => setFilter(cat)}
          />
        ))}
      </div>

      <ul className="flex flex-col gap-2 pr-1">
        {filtered.map((p) => (
          <li key={p.id}>
            <a
              href={googleMapsUrl(p)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex gap-2 overflow-hidden rounded-md border bg-background transition-colors hover:border-foreground/30 hover:bg-muted/30"
            >
              <div
                className="relative h-[72px] w-[96px] shrink-0 bg-muted"
                style={{
                  backgroundColor: p.category
                    ? `${CATEGORY_COLORS[p.category]}22`
                    : undefined,
                }}
              >
                <img
                  src={`/api/places/${p.id}/preview`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility =
                      "hidden";
                  }}
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col justify-center py-1.5 pr-2">
                <div className="flex items-center gap-1.5">
                  {p.category ? (
                    <span
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[p.category] }}
                      aria-hidden
                    />
                  ) : null}
                  <div className="truncate text-xs font-medium">{p.name}</div>
                </div>
                {p.category ? (
                  <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_LABELS[p.category]}
                  </div>
                ) : null}
                {p.notes ? (
                  <div className="line-clamp-2 text-[11px] text-muted-foreground">
                    {p.notes}
                  </div>
                ) : null}
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground/70 group-hover:text-foreground">
                  <ExternalLink className="size-3" />
                  Open in Google Maps
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No places in this category yet.
        </div>
      ) : null}
    </div>
  );
}

function CategoryChip({
  label,
  color,
  active,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
        active
          ? "border-transparent bg-foreground text-background"
          : "border-border bg-background text-muted-foreground hover:text-foreground"
      }`}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </button>
  );
}
