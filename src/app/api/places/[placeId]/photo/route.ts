import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the first photo for a place via Google Places (New) Photos.
 * Falls back to 404 if no photos available.
 */
export async function GET(
  req: Request,
  { params }: { params: { placeId: string } }
) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "No api key" }, { status: 500 });
  }

  const url = new URL(req.url);
  const maxWidth = Math.min(Number(url.searchParams.get("w") ?? 400), 1600);

  const supabase = getSupabaseServerClient();
  const { data: place } = await supabase
    .from("places")
    .select("google_place_id")
    .eq("id", params.placeId)
    .maybeSingle();
  const googlePlaceId = (place as { google_place_id: string | null } | null)
    ?.google_place_id;

  if (!googlePlaceId) {
    return NextResponse.json({ error: "no place_id" }, { status: 404 });
  }

  // Step 1: fetch photo refs for this place.
  const detailsRes = await fetch(
    `https://places.googleapis.com/v1/places/${googlePlaceId}`,
    {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "photos",
      },
    }
  );
  if (!detailsRes.ok) {
    return NextResponse.json(
      { error: `details ${detailsRes.status}` },
      { status: 502 }
    );
  }
  const data = (await detailsRes.json()) as {
    photos?: { name: string }[];
  };
  const firstPhoto = data.photos?.[0]?.name;
  if (!firstPhoto) {
    return NextResponse.json({ error: "no photos" }, { status: 404 });
  }

  // Step 2: fetch the media — skipHttpRedirect so we get the binary.
  const mediaRes = await fetch(
    `https://places.googleapis.com/v1/${firstPhoto}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
    {
      headers: { "X-Goog-Api-Key": key },
    }
  );
  if (!mediaRes.ok) {
    return NextResponse.json(
      { error: `media ${mediaRes.status}` },
      { status: 502 }
    );
  }

  const mediaJson = (await mediaRes.json()) as {
    photoUri?: string;
  };
  if (!mediaJson.photoUri) {
    return NextResponse.json({ error: "no photoUri" }, { status: 502 });
  }

  // Step 3: fetch the actual image bytes from the redirected URL and stream back.
  const imageRes = await fetch(mediaJson.photoUri);
  if (!imageRes.ok) {
    return NextResponse.json(
      { error: `image ${imageRes.status}` },
      { status: 502 }
    );
  }
  const buf = await imageRes.arrayBuffer();
  const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": contentType,
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
