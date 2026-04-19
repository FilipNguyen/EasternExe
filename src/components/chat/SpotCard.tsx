"use client";

import { useMemo, useState } from "react";
import {
  Calendar,
  Landmark,
  MapPin,
  Music,
  ShoppingBag,
  Sparkles,
  Star,
  TreePine,
  Utensils,
  Wine,
} from "lucide-react";

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
  user_ratings_total?: number;
  primary_type_label?: string;
  price_level?: string;
  editorial_summary?: string;
  url?: string;
  source_host?: string;
  thumbnail_url?: string;
  already_saved?: boolean;
}

interface Props {
  spot: SpotData;
  tripId: string;
  onSave?: () => void;
}

const PRICE_LABELS: Record<string, string> = {
  PRICE_LEVEL_FREE: "Free",
  PRICE_LEVEL_INEXPENSIVE: "$",
  PRICE_LEVEL_MODERATE: "$$",
  PRICE_LEVEL_EXPENSIVE: "$$$",
  PRICE_LEVEL_VERY_EXPENSIVE: "$$$$",
};

const CATEGORY_ICONS: Record<PlaceCategory, React.ComponentType<{ className?: string }>> = {
  food: Utensils,
  drinks: Wine,
  sight: Landmark,
  shopping: ShoppingBag,
  nature: TreePine,
  nightlife: Music,
  other: Sparkles,
};

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

/**
 * Strip HTML tags and decode common entities that Brave + other sources
 * return in `title` / `description` fields (`<strong>`, `&#x27;`, `&amp;`).
 * Kept deliberately small — no arbitrary-HTML rendering.
 */
function cleanText(raw: string | undefined): string {
  if (!raw) return "";
  const withoutTags = raw.replace(/<\/?[a-z][^>]*>/gi, "");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function SpotCard({ spot, tripId, onSave }: Props) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(spot.already_saved ?? false);
  const [imgOk, setImgOk] = useState(true);

  const category: PlaceCategory = (spot.category as PlaceCategory | undefined) ??
    mapGoogleTypeToCategory((spot as { types?: string[] }).types);
  const categoryColor = CATEGORY_COLORS[category] ?? "#94a3b8";
  const categoryLabel = CATEGORY_LABELS[category] ?? "Place";
  const CategoryIcon = CATEGORY_ICONS[category] ?? Calendar;

  const cleanName = useMemo(() => cleanText(spot.name), [spot.name]);
  const cleanSummary = useMemo(
    () => cleanText(spot.editorial_summary ?? spot.summary),
    [spot.editorial_summary, spot.summary]
  );

  const price = spot.price_level ? PRICE_LABELS[spot.price_level] : undefined;
  const typeLabel = spot.primary_type_label;

  const imageSrc = spot.thumbnail_url
    ? spot.thumbnail_url
    : spot.place_id
      ? `/api/google-places/photo?id=${encodeURIComponent(spot.place_id)}&w=640`
      : null;

  const handleSave = async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      const res = await fetch("/api/places/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip_id: tripId,
          name: cleanName || spot.name,
          lat: spot.lat,
          lng: spot.lng,
          google_place_id: spot.place_id,
          category,
          notes: cleanSummary || null,
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
    <div className="group overflow-hidden rounded-lg border border-border bg-card shadow-sm transition-colors hover:border-foreground/20">
      <div
        className="relative h-32 w-full overflow-hidden"
        style={{
          backgroundColor: `${categoryColor}22`,
          backgroundImage: !imageSrc || !imgOk
            ? `linear-gradient(135deg, ${categoryColor}33 0%, ${categoryColor}11 100%)`
            : undefined,
        }}
      >
        {imageSrc && imgOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageSrc}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgOk(false)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <CategoryIcon
              className="size-10 opacity-50"
              // lucide icons inherit color via currentColor
            />
          </div>
        )}

        <span
          className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur"
        >
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: categoryColor }}
            aria-hidden
          />
          {categoryLabel}
        </span>

        {spot.rating ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-0.5 rounded-full bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 shadow-sm dark:bg-black/75">
            {spot.rating.toFixed(1)}
            <Star className="size-2.5 fill-current" />
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <h4 className="truncate text-sm font-semibold leading-tight">
          {cleanName || spot.name}
        </h4>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
          {spot.rating && spot.user_ratings_total ? (
            <span className="font-medium text-amber-600">
              {spot.rating.toFixed(1)}★{" "}
              <span className="font-normal text-muted-foreground">
                ({spot.user_ratings_total.toLocaleString()})
              </span>
            </span>
          ) : null}
          {typeLabel ? <span>{typeLabel}</span> : null}
          {price ? <span>{price}</span> : null}
          {spot.source_host && !typeLabel ? (
            <span className="truncate">{spot.source_host}</span>
          ) : null}
        </div>

        {cleanSummary ? (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {cleanSummary}
          </p>
        ) : null}

        <div className="mt-2.5 flex gap-2">
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
            {saved ? (
              <span className="inline-flex items-center justify-center gap-1">
                <MapPin className="size-3" /> On map
              </span>
            ) : saving ? (
              "Adding…"
            ) : (
              "Add to map"
            )}
          </button>
          {spot.url ? (
            <a
              href={spot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
            >
              Link
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
