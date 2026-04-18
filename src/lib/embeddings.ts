import "server-only";

/**
 * Chunking + context-assembly helpers.
 *
 * v1 doesn't use vector embeddings. Z.ai's coding endpoint doesn't serve an
 * embeddings model, and we committed to a Z.ai-only stack. For the scale of
 * a single trip (~200 WhatsApp messages, ~10k tokens), we can feed the full
 * chunked corpus as LLM context instead of similarity-ranking it.
 *
 * If we ever hit bigger corpora, swap in a local embedder (e.g.
 * @xenova/transformers) here.
 */

const CHARS_PER_TOKEN = 4;
const TARGET_TOKENS = 500;
const OVERLAP_TOKENS = 50;
const MAX_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const OVERLAP_CHARS = OVERLAP_TOKENS * CHARS_PER_TOKEN;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= MAX_CHARS) return [clean];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    let end = Math.min(cursor + MAX_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(end - 200, end);
      const nlIdx = window.lastIndexOf("\n");
      const sentIdx = Math.max(
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? ")
      );
      const pickIdx = nlIdx >= 0 ? nlIdx : sentIdx;
      if (pickIdx > 0) {
        end = end - 200 + pickIdx + 1;
      }
    }
    chunks.push(clean.slice(cursor, end).trim());
    if (end >= clean.length) break;
    cursor = Math.max(end - OVERLAP_CHARS, cursor + 1);
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Joins chunks into a single string, truncated to `maxChars`. Chunks are
 * joined in insertion order (chronological for WhatsApp, document order
 * otherwise).
 */
export function concatChunks(
  chunks: { content: string }[],
  maxChars: number
): string {
  let out = "";
  for (let i = 0; i < chunks.length; i++) {
    const sep = i === 0 ? "" : "\n\n---\n\n";
    const piece = `${sep}${chunks[i].content}`;
    if (out.length + piece.length > maxChars) {
      // Truncate the current chunk to fit
      const remaining = maxChars - out.length - sep.length;
      if (remaining > 200) {
        out += sep + chunks[i].content.slice(0, remaining) + "…";
      }
      break;
    }
    out += piece;
  }
  return out;
}
