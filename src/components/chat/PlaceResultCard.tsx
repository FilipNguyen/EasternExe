"use client";

import { useState } from "react";

import { CATEGORY_COLORS, CATEGORY_LABELS } from "@/components/map/categories";

export interface PlaceResult {
  name: string;
  place_id?: string;
  lat: number;
  lng: number;
  category: string;
  summary?: string;
}

interface Props {
  place: PlaceResult;
  tripId: string;
  onSaved?: () => void;
}

export function PlaceResultCard({ place, tripId, onSaved }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  const categoryColor =
    CATEGORY_COLORS[place.category as keyof typeof CATEGORY_COLORS] ?? "#94a3b8";
  const categoryLabel =
    CATEGORY_LABELS[place.category as keyof typeof CATEGORY_LABELS] ?? place.category;

  // Photo served by our proxy route, which talks to Google Places directly
  // using the google_place_id. The <img> onError fallback handles places
  // without photos or missing place_id.
  const photoUrl = place.place_id
    ? `/api/google-places/photo?id=${encodeURIComponent(place.place_id)}&w=640`
    : null;

  const handleAddToMap = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch("/api/places/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          google_place_id: place.place_id,
          category: place.category,
          notes: place.summary ?? null,
          source: "agent",
        }),
      });
      if (res.ok) {
        setSaved(true);
        onSaved?.();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Photo or color placeholder */}
      <div
        className="h-28 w-full flex items-center justify-center relative"
        style={{ backgroundColor: `${categoryColor}22` }}
      >
        {!photoFailed && photoUrl ? (
          <img
            src={photoUrl}
            alt={place.name}
            className="h-full w-full object-cover"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <span className="text-2xl font-bold" style={{ color: categoryColor }}>
            {place.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span
          className="absolute top-2 left-2 rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: categoryColor }}
        >
          {categoryLabel}
        </span>
      </div>

      <div className="p-3">
        <h4 className="font-semibold text-sm leading-tight">{place.name}</h4>
        {place.summary && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
            {place.summary}
          </p>
        )}

        <button
          onClick={handleAddToMap}
          disabled={saving || saved}
          className={`mt-2 w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            saved
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : saving
                ? "bg-muted text-muted-foreground cursor-wait"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {saved ? "Added to map" : saving ? "Adding..." : "Add to map"}
        </button>
      </div>
    </div>
  );
}
