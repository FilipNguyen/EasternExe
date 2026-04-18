import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a Google Static Maps PNG thumbnail for the given place.
 * Keeps GOOGLE_PLACES_API_KEY server-side — client just hits this route.
 */
export async function GET(
  _req: Request,
  { params }: { params: { placeId: string } }
) {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_PLACES_API_KEY not configured" },
      { status: 500 }
    );
  }

  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("places")
    .select("lat,lng,category")
    .eq("id", params.placeId)
    .maybeSingle();

  if (!data || data.lat == null || data.lng == null) {
    return NextResponse.json({ error: "No coords" }, { status: 404 });
  }

  const markerColor = MARKER_COLORS[data.category as string] ?? "0xF97316";
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("center", `${data.lat},${data.lng}`);
  url.searchParams.set("zoom", "16");
  url.searchParams.set("size", "320x160");
  url.searchParams.set("scale", "2");
  url.searchParams.set("maptype", "roadmap");
  url.searchParams.set(
    "markers",
    `color:${markerColor}|${data.lat},${data.lng}`
  );
  url.searchParams.set("style", "feature:poi|visibility:off");
  url.searchParams.set("key", key);

  const res = await fetch(url.toString());
  if (!res.ok) {
    return NextResponse.json(
      { error: `Static Maps ${res.status}` },
      { status: 502 }
    );
  }
  const buf = await res.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}

const MARKER_COLORS: Record<string, string> = {
  food: "0xF97316",
  drinks: "0xEC4899",
  sight: "0x3B82F6",
  shopping: "0x22C55E",
  nature: "0x14B8A6",
  nightlife: "0x8B5CF6",
  other: "0x94A3B8",
};
