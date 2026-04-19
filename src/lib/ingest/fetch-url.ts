import "server-only";

/**
 * Fetch a URL and return a best-effort plain-text extraction plus detected
 * title. Kept intentionally small — no readability library, just strips
 * script/style blocks and HTML tags, then decodes common entities.
 */
export interface FetchedUrl {
  url: string;
  title: string;
  text: string;
  host: string;
}

const USER_AGENT =
  "Mozilla/5.0 (compatible; EasternExeBot/1.0; +https://easternexe.app/)";

export async function fetchUrlText(url: string): Promise<FetchedUrl> {
  const parsed = new URL(url);
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.5" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Fetch ${url} failed: HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();

  // If it's not HTML, treat the body as plain text.
  if (!contentType.includes("html")) {
    return {
      url,
      title: parsed.hostname + parsed.pathname,
      text: body.slice(0, 200_000),
      host: parsed.hostname,
    };
  }

  const title = extractTitle(body) ?? parsed.hostname + parsed.pathname;
  const text = htmlToPlainText(body);

  return { url, title, text: text.slice(0, 200_000), host: parsed.hostname };
}

function extractTitle(html: string): string | null {
  const ogMatch = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i
  );
  if (ogMatch) return decodeEntities(ogMatch[1]);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return decodeEntities(titleMatch[1].trim());
  return null;
}

function htmlToPlainText(html: string): string {
  // Drop script/style blocks + HTML comments completely.
  const withoutScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Convert block-level breaks to newlines for readability.
  const withBreaks = withoutScript
    .replace(/<\/(p|div|h[1-6]|li|tr|br)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags.
  const stripped = withBreaks.replace(/<\/?[a-z][^>]*>/gi, " ");

  return decodeEntities(stripped).replace(/[ \t]+/g, " ").replace(
    /\n{3,}/g,
    "\n\n"
  ).trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
