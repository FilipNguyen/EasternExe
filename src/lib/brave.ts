import "server-only";

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
  thumbnail_url?: string;
  source_host?: string;
}

/**
 * Brave Search — optional. Returns null if BRAVE_SEARCH_API_KEY is unset so
 * callers can degrade gracefully (per BUILD_SPEC §3).
 */
export async function braveSearch(
  query: string,
  count = 8
): Promise<BraveSearchResult[] | null> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) return null;

  try {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(count));
    const res = await fetch(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(
        `Brave Search error ${res.status}:`,
        await res.text().catch(() => "")
      );
      return [];
    }
    const json = (await res.json()) as {
      web?: {
        results?: {
          title: string;
          url: string;
          description: string;
          thumbnail?: { src?: string; original?: string };
          meta_url?: { hostname?: string };
        }[];
      };
    };
    return (json.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      thumbnail_url: r.thumbnail?.src ?? r.thumbnail?.original,
      source_host: r.meta_url?.hostname,
    }));
  } catch (e) {
    console.warn("Brave search failed:", e);
    return [];
  }
}

export function isBraveAvailable(): boolean {
  return !!process.env.BRAVE_SEARCH_API_KEY;
}
