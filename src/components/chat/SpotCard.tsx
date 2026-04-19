"use client";

import { useState } from "react";

import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/components/map/categories";
import type { PlaceCategory } from "@/types/db";

export interface SpotData {
  name: string;
  place_id?: string;
  lat: number;
  lng: number;
  category?: string;
  summary?: string;
  rating?: number;
  url?: string;
  already_saved?: boolean;
}

interface Props {
  spot: SpotData;
  tripId: string;
  onSave?: () => void;
}

function mapGoogleTypeToCategory(types?: string[]): PlaceCategory {
  if (!types || types.length === 0) return "other";
  const t = types.join(",");
  if (t.includes("restaurant") || t.includes("cafe") || t.includes("bakery") || t.includes("meal"))
    return "food";
  if (t.includes("bar") || t.includes("night_club")) return "nightlife";
  if (t.includes("tourist") || t.includes("museum") || t.includes("art_gallery"))
    return "sight";
  if (t.includes("shopping")) return "shopping";
  if (t.includes("park") || t.includes("nature")) return "nature";
  return "other";
}

export function SpotCard({ spot, tripId, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(spot.already_saved ?? false);

  const category = spot.category
    ? (spot.category as PlaceCategory)
    : mapGoogleTypeToCategory((spot as { types?: string[] }).types);
  const categoryColor = CATEGORY_COLORS[category] ?? "#94a3b8";
  const categoryLabel = CATEGORY_LABELS[category] ?? "Place";

  const handleSave = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch("/api/places/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          name: spot.name,
          lat: spot.lat,
          lng: spot.lng,
          google_place_id: spot.place_id,
          category,
          notes: spot.summary ?? null,
          source: "nearby",
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSave?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Color header */}
      <div
        className="h-20 w-full flex items-center justify-center relative"
        style={{ backgroundColor: `${categoryColor}22` }}
      >
        <span className="text-xl font-bold" style={{ color: categoryColor }}>
          {spot.name.charAt(0).toUpperCase()}
        </span>
        <span
          className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
          style={{ backgroundColor: categoryColor }}
        >
          {categoryLabel}
        </span>
        {spot.rating ? (
          <span className="absolute top-2 right-2 rounded-full bg-white/90 px-1.5 py-0.5 text-[10px] font-semibold text-foreground dark:bg-black/70">
            {spot.rating.toFixed(1)}
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <h4 className="font-semibold text-sm leading-tight truncate">{spot.name}</h4>
        {spot.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {spot.summary}
          </p>
        )}

        <div className="flex gap-2 mt-2">
          <button
            onClick={handleSave}
            disabled={saving || saved}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              saved
                ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                : saving
                  ? "bg-muted text-muted-foreground cursor-wait"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
            }`}
          >
            {saved ? "On map" : saving ? "Adding..." : "Add to map"}
          </button>
          {spot.url && (
            <a
              href={spot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Link
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
