import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the first photo for a Google place by its google_place_id directly,
 * without requiring the place to be saved in our DB. Used by SpotCard on the
 * Nearby panel so thumbnails render before a spot is added to the trip.
 *
 * GET /api/google-places/photo?id=<google_place_id>&w=640
 */
export async function GET(req: Request) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json({ error: "No api key" }, { status: 500 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const maxWidth = Math.min(Number(url.searchParams.get("w") ?? 400), 1600);

  const detailsRes = await fetch(
    `https://places.googleapis.com/v1/places/${id}`,
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
  const data = (await detailsRes.json()) as { photos?: { name: string }[] };
  const firstPhoto = data.photos?.[0]?.name;
  if (!firstPhoto) {
    return NextResponse.json({ error: "no photos" }, { status: 404 });
  }

  const mediaRes = await fetch(
    `https://places.googleapis.com/v1/${firstPhoto}/media?maxWidthPx=${maxWidth}&skipHttpRedirect=true`,
    { headers: { "X-Goog-Api-Key": key } }
  );
  if (!mediaRes.ok) {
    return NextResponse.json(
      { error: `media ${mediaRes.status}` },
      { status: 502 }
    );
  }
  const mediaJson = (await mediaRes.json()) as { photoUri?: string };
  if (!mediaJson.photoUri) {
    return NextResponse.json({ error: "no photoUri" }, { status: 502 });
  }

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
