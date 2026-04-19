import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Photo {
  name: string;
  widthPx?: number;
  heightPx?: number;
}

interface PlaceDetails {
  displayName?: { text?: string };
  photos?: Photo[];
  rating?: number;
  userRatingCount?: number;
  priceLevel?:
    | "PRICE_LEVEL_FREE"
    | "PRICE_LEVEL_INEXPENSIVE"
    | "PRICE_LEVEL_MODERATE"
    | "PRICE_LEVEL_EXPENSIVE"
    | "PRICE_LEVEL_VERY_EXPENSIVE";
  primaryTypeDisplayName?: { text?: string };
  editorialSummary?: { text?: string };
  generativeSummary?: { overview?: { text?: string } };
  reviews?: Array<{ text?: { text?: string }; rating?: number }>;
  regularOpeningHours?: {
    openNow?: boolean;
    weekdayDescriptions?: string[];
  };
  websiteUri?: string;
  googleMapsUri?: string;
}

export async function GET(
  _req: Request,
  { params }: { params: { placeId: string } }
) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "No api key" }, { status: 500 });
  }

  const supabase = getSupabaseServerClient();
  const { data: place } = await supabase
    .from("places")
    .select("google_place_id,name,notes,category")
    .eq("id", params.placeId)
    .maybeSingle();

  if (!place) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (!(place as { google_place_id: string | null }).google_place_id) {
    return NextResponse.json({
      place,
      details: null,
    });
  }

  const detailsRes = await fetch(
    `https://places.googleapis.com/v1/places/${
      (place as { google_place_id: string }).google_place_id
    }`,
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "displayName,photos,rating,userRatingCount,priceLevel,primaryTypeDisplayName,editorialSummary,generativeSummary,reviews.text,reviews.rating,regularOpeningHours,websiteUri,googleMapsUri",
      },
    }
  );

  if (!detailsRes.ok) {
    return NextResponse.json(
      { place, details: null, error: await detailsRes.text().catch(() => "") },
      {
        status: 200,
        headers: { "cache-control": "public, max-age=300" },
      }
    );
  }

  const details = (await detailsRes.json()) as PlaceDetails;

  return NextResponse.json(
    { place, details },
    {
      status: 200,
      headers: { "cache-control": "public, max-age=3600" },
    }
  );
}
